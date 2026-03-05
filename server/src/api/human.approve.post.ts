import { HumanApprovalRequestSchema, parseHumanApprovalYesNo } from '@local-mcp-board/shared';
import { appendEvent, getRun, listEvents, updateRunStatus } from '../db/store.js';
import { recordVoteReceived, getPendingApproval, cancelPendingApproval } from '../engine/hitl-tracker.js';

const seen = new Set<string>();

export async function humanApprovePost(body: unknown) {
  const parsed = HumanApprovalRequestSchema.parse(body);
  const dedupe = `${parsed.runId}:${parsed.idempotencyKey}`;
  if (seen.has(dedupe)) return { ok: true, runId: parsed.runId, deduped: true };

  const decision = parseHumanApprovalYesNo(parsed.replyText);

  const run = getRun(parsed.runId) as { board_id?: string } | undefined;
  const boardId = parsed.boardId || run?.board_id;

  if (boardId) {
    appendEvent(boardId, parsed.runId, 'HUMAN_APPROVED', {
      decision,
      approver: parsed.approver,
      idempotencyKey: parsed.idempotencyKey
    });

    // Check multi-voter tracking
    const pendingEntry = getPendingApproval(parsed.runId);
    const voteStatus = recordVoteReceived(parsed.runId);

    if (pendingEntry && pendingEntry.mode === 'vote' && !voteStatus.complete) {
      // Still waiting for more votes — record this vote but don't finalize yet
      appendEvent(boardId, parsed.runId, 'VOTE_RECEIVED', {
        approver: parsed.approver,
        decision,
        votes_received: voteStatus.total,
        votes_required: voteStatus.required,
      });
      seen.add(dedupe);
      return {
        ok: true,
        runId: parsed.runId,
        decision,
        voteRecorded: true,
        votesReceived: voteStatus.total,
        votesRequired: voteStatus.required,
        complete: false,
      };
    }

    // All votes received (or single-approval mode) — finalize
    if (pendingEntry) {
      cancelPendingApproval(parsed.runId);
    }

    const recent = listEvents({ runId: parsed.runId, limit: 20 }) as any[];
    const aggregated = recent.find((e: any) => e.type === 'AGGREGATED');
    const aggPayload = aggregated?.payload_json ? JSON.parse(String((aggregated as any).payload_json)) : {};

    const finalDecision = decision === 'YES' ? 'ALLOW' : decision === 'REWRITE' ? 'REWRITE' : 'BLOCK';
    const reasons: Record<string, string> = {
      ALLOW: 'Approved by human YES reply',
      BLOCK: 'Blocked by human NO reply',
      REWRITE: 'Revision requested by human REVISE reply',
    };
    const statusMap: Record<string, string> = {
      ALLOW: 'APPROVED',
      BLOCK: 'BLOCKED',
      REWRITE: 'REVISION_REQUESTED',
    };
    appendEvent(boardId, parsed.runId, 'FINAL_DECISION', {
      decision: finalDecision,
      reason: reasons[finalDecision],
      risk_score: Number(aggPayload?.top_risk ?? 0.5),
      weighted_yes: Number(aggPayload?.weighted_yes ?? 0),
      source: 'human.approve',
      votes_received: voteStatus.total || 1,
      votes_required: voteStatus.required || 1,
    });
    updateRunStatus(parsed.runId, statusMap[finalDecision]);
  }

  seen.add(dedupe);
  return {
    ok: true,
    runId: parsed.runId,
    decision,
    complete: true,
    votesReceived: 1,
    votesRequired: 1,
  };
}
