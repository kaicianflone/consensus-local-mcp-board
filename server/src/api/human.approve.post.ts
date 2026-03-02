import { HumanApprovalRequestSchema, parseHitlYesNo } from '@local-mcp-board/shared';
import { appendEvent, getRun, listEvents, updateRunStatus } from '../db/store.js';
import { registerHumanDecision } from '../workflows/guard-evaluate.js';

const seen = new Set<string>();

export async function humanApprovePost(body: unknown) {
  const parsed = HumanApprovalRequestSchema.parse(body);
  const dedupe = `${parsed.runId}:${parsed.idempotencyKey}`;
  if (seen.has(dedupe)) return { ok: true, runId: parsed.runId, deduped: true };

  const decision = parseHitlYesNo(parsed.replyText);
  registerHumanDecision(parsed.runId, {
    decision,
    approver: parsed.approver,
    idempotencyKey: parsed.idempotencyKey,
    createdAt: new Date().toISOString()
  });

  const run = getRun(parsed.runId) as { board_id?: string } | undefined;
  const boardId = parsed.boardId || run?.board_id;

  if (boardId) {
    appendEvent(boardId, parsed.runId, 'HUMAN_APPROVED', {
      decision,
      approver: parsed.approver,
      idempotencyKey: parsed.idempotencyKey
    });

    const recent = listEvents({ runId: parsed.runId, limit: 20 }) as any[];
    const aggregated = recent.find((e: any) => e.type === 'AGGREGATED');
    const aggPayload = aggregated?.payload_json ? JSON.parse(String((aggregated as any).payload_json)) : {};

    const finalDecision = decision === 'YES' ? 'ALLOW' : 'BLOCK';
    appendEvent(boardId, parsed.runId, 'FINAL_DECISION', {
      decision: finalDecision,
      reason: decision === 'YES' ? 'Approved by human YES reply' : 'Blocked by human NO reply',
      risk_score: Number(aggPayload?.top_risk ?? 0.5),
      weighted_yes: Number(aggPayload?.weighted_yes ?? 0),
      source: 'human.approve'
    });
    updateRunStatus(parsed.runId, finalDecision === 'ALLOW' ? 'APPROVED' : 'BLOCKED');
  }

  seen.add(dedupe);
  return { ok: true, runId: parsed.runId, decision };
}
