import { EvaluateInput, GuardResult } from '@local-mcp-board/shared';
import { appendEvent, createRun, updateRunStatus } from '../db/store.js';

type Vote = { evaluator: string; vote: 'YES' | 'NO' | 'REWRITE'; reason: string; risk: number };

function evaluatorVotes(input: EvaluateInput): Vote[] {
  const t = input.action.type;
  const p = input.action.payload || {};

  if (t === 'send_email') {
    const body = String(p.body || '');
    const to = String(p.to || '');
    if ((to.includes('@') && p.attachment) || /(api[_-]?key|token|password|secret)/i.test(body)) {
      return [{ evaluator: 'email-risk', vote: 'NO', reason: 'External attachment or secrets-like pattern', risk: 0.92 }];
    }
    return [{ evaluator: 'email-risk', vote: 'YES', reason: 'No high-risk signals', risk: 0.2 }];
  }

  if (t === 'code_merge') {
    const files = ((p.files as string[]) || []).join(' ');
    if (/auth|security|permission|crypto/i.test(files)) {
      return [{ evaluator: 'merge-risk', vote: 'REWRITE', reason: 'Sensitive file touched', risk: 0.82 }];
    }
    return [{ evaluator: 'merge-risk', vote: 'YES', reason: 'No sensitive file touch', risk: 0.25 }];
  }

  if (t === 'publish') {
    const text = String(p.text || '');
    if (/(damn|shit|fuck)/i.test(text) || /\b\d{3}-\d{2}-\d{4}\b/.test(text)) {
      return [{ evaluator: 'publish-risk', vote: 'REWRITE', reason: 'Profanity or personal-data pattern', risk: 0.75 }];
    }
    return [{ evaluator: 'publish-risk', vote: 'YES', reason: 'Clean publish text', risk: 0.2 }];
  }

  return [{ evaluator: 'generic', vote: 'YES', reason: 'No blocking rule matched', risk: 0.2 }];
}

function finalize(votes: Vote[], actionType: string): Omit<GuardResult, 'audit_id'> {
  const top = votes[0];
  if (top.vote === 'NO') return { decision: 'BLOCK', reason: top.reason, risk_score: top.risk };
  if (top.vote === 'REWRITE') {
    if (actionType === 'code_merge') {
      return {
        decision: 'REQUIRE_HUMAN',
        reason: top.reason,
        risk_score: top.risk,
        next_step: { tool: 'human.approve', input: { reason: top.reason } }
      };
    }
    return { decision: 'REWRITE', reason: top.reason, risk_score: top.risk, suggested_rewrite: 'Revise high-risk content and retry.' };
  }
  return { decision: 'ALLOW', reason: top.reason, risk_score: top.risk };
}

export function evaluate(input: EvaluateInput): GuardResult {
  const runId = input.runId || createRun(input.boardId, { actionType: input.action.type }).id;

  appendEvent(input.boardId, runId, 'PROPOSED_ACTION', input.action);

  const votes = evaluatorVotes(input);
  for (const v of votes) appendEvent(input.boardId, runId, 'EVALUATOR_VOTE', v);

  const result = finalize(votes, input.action.type);
  const final = appendEvent(input.boardId, runId, 'FINAL_DECISION', result);
  updateRunStatus(runId, result.decision === 'ALLOW' ? 'APPROVED' : 'REVIEWED');

  return { ...result, audit_id: final.id };
}
