import { EvaluateInput, GuardResult } from '@local-mcp-board/shared';
import { appendEvent, createRun, updateRunStatus } from '../db/store.js';

function decide(input: EvaluateInput): Omit<GuardResult,'audit_id'> {
  const type = input.action.type;
  const payload = input.action.payload || {};
  if (type === 'send_email') {
    const to = String(payload.to || '');
    if (to.includes('@') && payload.attachment) return { decision:'BLOCK', reason:'External recipient with attachment', risk_score:0.9 };
  }
  if (type === 'code_merge') {
    const files = (payload.files as string[] || []).join(' ');
    if (/auth|security|permission/i.test(files)) return { decision:'REQUIRE_HUMAN', reason:'Sensitive file touch', risk_score:0.8 };
  }
  if (type === 'publish') {
    const text = String(payload.text || '');
    if (/damn|ssn|\b\d{3}-\d{2}-\d{4}\b/i.test(text)) return { decision:'REWRITE', reason:'Content policy rewrite required', risk_score:0.7, suggested_rewrite:'Remove profanity/PII.' };
  }
  return { decision:'ALLOW', reason:'Passed local policy checks', risk_score:0.2 };
}

export function evaluate(input: EvaluateInput): GuardResult {
  const runId = input.runId || createRun(input.boardId).id;
  appendEvent(input.boardId, runId, 'PROPOSED_ACTION', input.action);
  appendEvent(input.boardId, runId, 'EVALUATOR_VOTE', { evaluator:'stub-1', vote:'YES' });
  const base = decide(input);
  const final = appendEvent(input.boardId, runId, 'FINAL_DECISION', base);
  updateRunStatus(runId, base.decision === 'ALLOW' ? 'APPROVED' : 'REVIEWED');
  return { ...base, audit_id: final.id };
}
