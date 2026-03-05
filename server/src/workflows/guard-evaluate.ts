import {
  GuardEvaluateRequestSchema,
  GuardResultSchema,
  type GuardEvaluateRequest,
  type HumanDecision
} from '@local-mcp-board/shared';
import { appendEvent, createRun, getRun, updateRunStatus } from '../db/store.js';
import { evaluateViaConsensusTools } from '../adapters/consensus-tools.js';

// Kept for API compatibility; approvals are finalized via human.approve endpoint/events.
export function registerHumanDecision(_runId: string, _decision: HumanDecision) {
  return;
}

/**
 * Durable guard-evaluate workflow.
 * The "use workflow" directive makes this a recoverable, observable workflow
 * via the Vercel Workflow SDK.
 */
export async function guardEvaluateWorkflow(raw: unknown) {
  'use workflow';
  const input = GuardEvaluateRequestSchema.parse(raw);
  return executeGuardEvaluate(input);
}

export async function executeGuardEvaluate(input: GuardEvaluateRequest) {
  const runId = await initGuardRun(input);
  const result = await runConsensusEvaluation(runId, input);
  const guardResult = await finalizeGuardResult(runId, input.boardId, result);
  return guardResult;
}

/**
 * Step: initialize or reuse a run record in the DB.
 */
async function initGuardRun(input: GuardEvaluateRequest): Promise<string> {
  'use step';
  const existingRun = input.runId ? getRun(input.runId) : null;
  const runId = existingRun
    ? input.runId!
    : createRun(input.boardId, { actionType: input.guardType, externalRunId: input.runId ?? null }, input.runId).id;

  appendEvent(input.boardId, runId, 'PROPOSED_ACTION', { type: input.guardType, payload: input.payload, policy: input.policy });
  return runId;
}

/**
 * Step: invoke the consensus-tools evaluation engine.
 */
async function runConsensusEvaluation(runId: string, input: GuardEvaluateRequest) {
  'use step';
  return evaluateViaConsensusTools({
    runId,
    boardId: input.boardId,
    guardType: input.guardType,
    payload: (input.payload || {}) as Record<string, unknown>,
    policyPack: input.policy?.policyId
  });
}

/**
 * Step: persist the final decision event and update the run status.
 */
async function finalizeGuardResult(runId: string, boardId: string, result: any) {
  'use step';
  const audit = appendEvent(boardId, runId, 'FINAL_DECISION', {
    decision: result.decision,
    reason: result.reason,
    risk_score: result.risk_score,
    guard_type: result.guard_type,
    audit_id: result.audit_id,
    next_step: result.next_step,
    consensus_meta: result.meta || null
  });

  const statusMap: Record<string, string> = {
    ALLOW: 'APPROVED',
    BLOCK: 'BLOCKED',
    REWRITE: 'REVISION_REQUESTED',
    REQUIRE_HUMAN: 'WAITING_HUMAN'
  };
  updateRunStatus(runId, statusMap[result.decision] || 'REVIEWED');

  return GuardResultSchema.parse({
    decision: result.decision,
    reason: result.reason,
    risk_score: result.risk_score,
    audit_id: audit.id,
    weighted_yes: 0,
    votes: [],
    next_step: result.next_step,
    guard_type: result.guard_type
  });
}

export function normalizeGuardType(type: string): GuardEvaluateRequest['guardType'] {
  if (type === 'send_email' || type === 'code_merge' || type === 'publish' || type === 'support_reply' || type === 'agent_action' || type === 'deployment' || type === 'permission_escalation') {
    return type;
  }
  return 'agent_action';
}
