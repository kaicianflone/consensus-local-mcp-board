import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAppendEvent,
  mockCreateRun,
  mockUpdateRunStatus,
} = vi.hoisted(() => ({
  mockAppendEvent: vi.fn((boardId: string, runId: string, type: string, payload: any) => ({
    id: `evt-${type}-${Date.now()}`,
    boardId,
    runId,
    type,
    payload,
  })),
  mockCreateRun: vi.fn(() => ({ id: 'run-new' })),
  mockUpdateRunStatus: vi.fn(),
}));

vi.mock('../server/src/db/store.js', () => ({
  db: {},
  appendEvent: mockAppendEvent,
  createRun: mockCreateRun,
  updateRunStatus: mockUpdateRunStatus,
  getRun: vi.fn(),
  listEvents: vi.fn(() => []),
}));

import { evaluate } from '../server/src/engine/evaluate.js';

describe('Evaluate event log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function getEventsOfType(type: string) {
    return mockAppendEvent.mock.calls.filter(([, , t]) => t === type);
  }

  // ── AGENT_VERDICT ──

  describe('AGENT_VERDICT event', () => {
    it('should emit one AGENT_VERDICT per evaluator vote', () => {
      evaluate({ boardId: 'b1', action: { type: 'send_email', payload: { to: 'user@co.com', body: 'Hello' } } });
      const verdicts = getEventsOfType('AGENT_VERDICT');
      expect(verdicts).toHaveLength(1);
      const [, , , payload] = verdicts[0];
      expect(payload.evaluator).toBe('email-risk');
      expect(payload.verdict).toBe('YES');
      expect(payload.guardType).toBe('send_email');
      expect(payload.risk).toBeDefined();
      expect(payload.reason).toBeDefined();
    });

    it('should record NO verdict for blocked action', () => {
      evaluate({ boardId: 'b1', action: { type: 'send_email', payload: { to: 'ext@example.com', attachment: true, body: 'Hello' } } });
      const verdicts = getEventsOfType('AGENT_VERDICT');
      expect(verdicts[0][3].verdict).toBe('NO');
      expect(verdicts[0][3].risk).toBeGreaterThan(0.9);
    });

    it('should record REWRITE verdict', () => {
      evaluate({ boardId: 'b1', action: { type: 'code_merge', payload: { files: ['src/auth/login.ts'] } } });
      const verdicts = getEventsOfType('AGENT_VERDICT');
      expect(verdicts[0][3].verdict).toBe('REWRITE');
      expect(verdicts[0][3].evaluator).toBe('merge-risk');
    });
  });

  // ── RISK_SCORE ──

  describe('RISK_SCORE event', () => {
    it('should emit RISK_SCORE with final risk value', () => {
      evaluate({ boardId: 'b1', action: { type: 'send_email', payload: { to: 'ext@example.com', attachment: true, body: 'Hello' } } });
      const scores = getEventsOfType('RISK_SCORE');
      expect(scores).toHaveLength(1);
      const [, , , payload] = scores[0];
      expect(payload.risk_score).toBeGreaterThan(0.9);
      expect(payload.decision).toBe('BLOCK');
      expect(payload.guardType).toBe('send_email');
      expect(payload.voter_count).toBe(1);
    });

    it('should emit low risk score for clean actions', () => {
      evaluate({ boardId: 'b1', action: { type: 'send_email', payload: { to: 'user@co.com', body: 'Hello' } } });
      const scores = getEventsOfType('RISK_SCORE');
      expect(scores[0][3].risk_score).toBeLessThan(0.5);
      expect(scores[0][3].decision).toBe('ALLOW');
    });
  });

  // ── CONSENSUS_QUORUM ──

  describe('CONSENSUS_QUORUM event', () => {
    it('should emit CONSENSUS_QUORUM with vote breakdown', () => {
      evaluate({ boardId: 'b1', action: { type: 'publish', payload: { text: 'Clean text' } } });
      const quorums = getEventsOfType('CONSENSUS_QUORUM');
      expect(quorums).toHaveLength(1);
      const [, , , payload] = quorums[0];
      expect(payload.quorum_score).toBe(1); // 1/1 YES
      expect(payload.total_voters).toBe(1);
      expect(payload.yes_count).toBe(1);
      expect(payload.no_count).toBe(0);
      expect(payload.rewrite_count).toBe(0);
      expect(payload.decision).toBe('ALLOW');
    });

    it('should report 0 quorum when all votes are NO', () => {
      evaluate({ boardId: 'b1', action: { type: 'send_email', payload: { to: 'ext@example.com', attachment: true, body: 'Hello' } } });
      const quorums = getEventsOfType('CONSENSUS_QUORUM');
      expect(quorums[0][3].quorum_score).toBe(0);
      expect(quorums[0][3].no_count).toBe(1);
      expect(quorums[0][3].yes_count).toBe(0);
    });

    it('should report 0 quorum when all votes are REWRITE', () => {
      evaluate({ boardId: 'b1', action: { type: 'code_merge', payload: { files: ['src/auth/login.ts'] } } });
      const quorums = getEventsOfType('CONSENSUS_QUORUM');
      expect(quorums[0][3].quorum_score).toBe(0);
      expect(quorums[0][3].rewrite_count).toBe(1);
    });
  });

  // ── Event ordering ──

  describe('event ordering', () => {
    it('should emit events in correct order: PROPOSED_ACTION → EVALUATOR_VOTE → AGENT_VERDICT → RISK_SCORE → CONSENSUS_QUORUM → FINAL_DECISION', () => {
      evaluate({ boardId: 'b1', action: { type: 'send_email', payload: { to: 'user@co.com', body: 'Hello' } } });
      const types = mockAppendEvent.mock.calls.map(([, , t]) => t);
      expect(types).toEqual([
        'PROPOSED_ACTION',
        'EVALUATOR_VOTE',
        'AGENT_VERDICT',
        'RISK_SCORE',
        'CONSENSUS_QUORUM',
        'FINAL_DECISION',
      ]);
    });
  });
});
