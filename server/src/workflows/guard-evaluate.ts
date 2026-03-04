import {
  GuardEvaluateRequestSchema,
  GuardResultSchema,
  HumanDecisionSchema,
  type GuardEvaluateRequest,
  type HumanDecision
} from '@local-mcp-board/shared';
import { appendEvent, createRun, getRun, updateRunStatus } from '../db/store.js';
import { evaluateWithAiSdk } from '../adapters/ai-sdk.js';
import { sendHitlPrompt } from '../adapters/chat-sdk.js';

const pendingApprovals = new Map<string, HumanDecision>();

export function registerHumanDecision(runId: string, decision: HumanDecision) {
  pendingApprovals.set(runId, HumanDecisionSchema.parse(decision));
}

export async function guardEvaluateWorkflow(raw: unknown) {
  'use workflow';
  const input = GuardEvaluateRequestSchema.parse(raw);
  return executeGuardEvaluate(input);
}

export async function executeGuardEvaluate(input: GuardEvaluateRequest) {
  const existingRun = input.runId ? getRun(input.runId) : null;
  const runId = existingRun
    ? input.runId
    : createRun(input.boardId, { actionType: input.guardType, externalRunId: input.runId ?? null }, input.runId).id;

  appendEvent(input.boardId, runId, 'PROPOSED_ACTION', { type: input.guardType, payload: input.payload, policy: input.policy });

  const votes = await collectVotesStep(input);
  votes.forEach((v) => appendEvent(input.boardId, runId, 'EVALUATOR_VOTE', v));

  const weightedYes = votes.filter((v) => v.vote === 'YES').length / Math.max(votes.length, 1);
  const topRisk = Math.max(0, ...votes.map((v) => v.risk));
  const requiresHitl = weightedYes >= input.policy.quorum && topRisk >= input.policy.hitlRequiredAboveRisk;

  appendEvent(input.boardId, runId, 'AGGREGATED', { weighted_yes: weightedYes, top_risk: topRisk, requires_hitl: requiresHitl });

  if (requiresHitl) {
    await requestHumanStep(input, runId, weightedYes, topRisk);
    await delayMs(2000);

    const human = pendingApprovals.get(runId);
    if (!human) {
      const audit = appendEvent(input.boardId, runId, 'FINAL_DECISION', {
        decision: 'REQUIRE_HUMAN',
        reason: 'Risk requires Human Approval confirmation',
        risk_score: topRisk,
        weighted_yes: weightedYes,
        votes,
        next_step: { tool: 'human.approve', input: { runId } },
        guard_type: input.guardType
      });
      updateRunStatus(runId, 'WAITING_HUMAN');
      return GuardResultSchema.parse({
        decision: 'REQUIRE_HUMAN',
        reason: 'Risk requires Human Approval confirmation',
        risk_score: topRisk,
        audit_id: audit.id,
        weighted_yes: weightedYes,
        votes,
        next_step: { tool: 'human.approve', input: { runId } },
        guard_type: input.guardType
      });
    }

    pendingApprovals.delete(runId);
    const decision = human.decision === 'YES' ? 'ALLOW' : 'BLOCK';
    const reason = human.decision === 'YES' ? 'Approved by human' : 'Blocked by human';
    const audit = appendEvent(input.boardId, runId, 'FINAL_DECISION', {
      decision,
      reason,
      risk_score: topRisk,
      weighted_yes: weightedYes,
      votes,
      human,
      guard_type: input.guardType
    });
    updateRunStatus(runId, decision === 'ALLOW' ? 'APPROVED' : 'BLOCKED');
    return GuardResultSchema.parse({
      decision,
      reason,
      risk_score: topRisk,
      audit_id: audit.id,
      weighted_yes: weightedYes,
      votes,
      guard_type: input.guardType
    });
  }

  const top = votes[0];
  const decision = top?.vote === 'NO' ? 'BLOCK' : top?.vote === 'REWRITE' ? 'REWRITE' : 'ALLOW';
  const audit = appendEvent(input.boardId, runId, 'FINAL_DECISION', {
    decision,
    reason: top?.reason ?? 'No issues',
    risk_score: top?.risk ?? topRisk,
    weighted_yes: weightedYes,
    votes,
    guard_type: input.guardType
  });
  updateRunStatus(runId, decision === 'ALLOW' ? 'APPROVED' : 'REVIEWED');

  return GuardResultSchema.parse({
    decision,
    reason: top?.reason ?? 'No issues',
    risk_score: top?.risk ?? topRisk,
    audit_id: audit.id,
    weighted_yes: weightedYes,
    votes,
    guard_type: input.guardType
  });
}

async function collectVotesStep(input: GuardEvaluateRequest) {
  'use step';
  return evaluateWithAiSdk(input);
}

async function requestHumanStep(input: GuardEvaluateRequest, runId: string, quorum: number, risk: number) {
  'use step';
  const result = await sendHitlPrompt({
    boardId: input.boardId,
    runId,
    quorum,
    risk,
    threshold: input.policy.hitlRequiredAboveRisk
  });
  appendEvent(input.boardId, runId, 'HUMAN_APPROVAL_REQUESTED', result);
}

export function normalizeGuardType(type: string): GuardEvaluateRequest['guardType'] {
  if (type === 'send_email' || type === 'code_merge' || type === 'publish' || type === 'support_reply' || type === 'agent_action' || type === 'deployment' || type === 'permission_escalation') {
    return type;
  }
  return 'agent_action';
}

function delayMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
