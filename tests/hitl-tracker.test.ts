import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mocks so they're available in vi.mock factories
const {
  mockAppendEvent,
  mockSendTimeoutWarning,
  mockSendDeadlineExpired,
  mockHumanApprovePost,
} = vi.hoisted(() => ({
  mockAppendEvent: vi.fn(),
  mockSendTimeoutWarning: vi.fn(async () => ({
    delivered: true, provider: 'mock', message: '', promptMode: 'warning', results: [],
  })),
  mockSendDeadlineExpired: vi.fn(async () => ({
    delivered: true, provider: 'mock', message: '', promptMode: 'expired', results: [],
  })),
  mockHumanApprovePost: vi.fn(async () => ({
    ok: true, runId: 'test', decision: 'NO', complete: true,
  })),
}));

vi.mock('../server/src/db/store.js', () => ({
  db: {},
  appendEvent: mockAppendEvent,
  getRun: vi.fn(),
  updateRunStatus: vi.fn(),
  listEvents: vi.fn(() => []),
}));

vi.mock('../server/src/db/credentials.js', () => ({
  getCredential: vi.fn(() => null),
}));

vi.mock('../server/src/adapters/chat-sdk.js', () => ({
  sendTimeoutWarning: mockSendTimeoutWarning,
  sendDeadlineExpired: mockSendDeadlineExpired,
}));

vi.mock('../server/src/api/human.approve.post.js', () => ({
  humanApprovePost: mockHumanApprovePost,
}));

import {
  registerPendingApproval,
  recordVoteReceived,
  cancelPendingApproval,
  getPendingApproval,
  listPendingApprovals,
  stopTracker,
} from '../server/src/engine/hitl-tracker.js';
import type { ChatPrompt } from '../server/src/adapters/chat-sdk.js';

const basePrompt: ChatPrompt = {
  boardId: 'board-1',
  runId: 'run-1',
  quorum: 0.7,
  risk: 0.5,
  threshold: 0.7,
};

describe('HITL Tracker', () => {
  afterEach(() => {
    stopTracker();
    vi.clearAllMocks();
  });

  // ── Registration ──

  describe('registerPendingApproval', () => {
    it('should register and retrieve a pending approval', () => {
      registerPendingApproval({
        runId: 'run-1',
        boardId: 'board-1',
        prompt: basePrompt,
        timeoutSec: 600,
      });
      const entry = getPendingApproval('run-1');
      expect(entry).toBeDefined();
      expect(entry!.timeoutSec).toBe(600);
      expect(entry!.runId).toBe('run-1');
    });

    it('should set sensible defaults', () => {
      registerPendingApproval({
        runId: 'run-def',
        boardId: 'board-1',
        prompt: { ...basePrompt, runId: 'run-def' },
        timeoutSec: 300,
      });
      const entry = getPendingApproval('run-def')!;
      expect(entry.requiredVotes).toBe(1);
      expect(entry.mode).toBe('approval');
      expect(entry.autoDecisionOnExpiry).toBe('BLOCK');
      expect(entry.receivedVotes).toBe(0);
      expect(entry.warningSentAt).toBeNull();
    });

    it('should accept custom vote and mode settings', () => {
      registerPendingApproval({
        runId: 'run-custom',
        boardId: 'board-1',
        prompt: { ...basePrompt, runId: 'run-custom' },
        timeoutSec: 900,
        requiredVotes: 3,
        mode: 'vote',
        autoDecisionOnExpiry: 'ALLOW',
      });
      const entry = getPendingApproval('run-custom')!;
      expect(entry.requiredVotes).toBe(3);
      expect(entry.mode).toBe('vote');
      expect(entry.autoDecisionOnExpiry).toBe('ALLOW');
    });
  });

  // ── Listing ──

  describe('listPendingApprovals', () => {
    it('should return empty when no pending', () => {
      expect(listPendingApprovals()).toEqual([]);
    });

    it('should list all registered entries', () => {
      registerPendingApproval({ runId: 'r1', boardId: 'b1', prompt: { ...basePrompt, runId: 'r1' }, timeoutSec: 60 });
      registerPendingApproval({ runId: 'r2', boardId: 'b1', prompt: { ...basePrompt, runId: 'r2' }, timeoutSec: 60 });
      expect(listPendingApprovals()).toHaveLength(2);
    });
  });

  // ── Vote recording ──

  describe('recordVoteReceived', () => {
    it('should track partial votes', () => {
      registerPendingApproval({
        runId: 'vote-1',
        boardId: 'board-1',
        prompt: { ...basePrompt, runId: 'vote-1' },
        timeoutSec: 600,
        requiredVotes: 3,
        mode: 'vote',
      });

      const first = recordVoteReceived('vote-1');
      expect(first.complete).toBe(false);
      expect(first.total).toBe(1);
      expect(first.required).toBe(3);

      const second = recordVoteReceived('vote-1');
      expect(second.complete).toBe(false);
      expect(second.total).toBe(2);
    });

    it('should mark complete when all votes received', () => {
      registerPendingApproval({
        runId: 'vote-done',
        boardId: 'board-1',
        prompt: { ...basePrompt, runId: 'vote-done' },
        timeoutSec: 600,
        requiredVotes: 2,
      });

      recordVoteReceived('vote-done');
      const second = recordVoteReceived('vote-done');
      expect(second.complete).toBe(true);
      expect(second.total).toBe(2);
      expect(second.required).toBe(2);
    });

    it('should auto-remove from pending on completion', () => {
      registerPendingApproval({
        runId: 'auto-rm',
        boardId: 'board-1',
        prompt: { ...basePrompt, runId: 'auto-rm' },
        timeoutSec: 600,
        requiredVotes: 1,
      });
      recordVoteReceived('auto-rm');
      expect(getPendingApproval('auto-rm')).toBeUndefined();
    });

    it('should return zeroes for unknown runId', () => {
      const result = recordVoteReceived('nonexistent');
      expect(result.complete).toBe(false);
      expect(result.total).toBe(0);
      expect(result.required).toBe(0);
    });
  });

  // ── Cancellation ──

  describe('cancelPendingApproval', () => {
    it('should remove a pending entry', () => {
      registerPendingApproval({
        runId: 'cancel-me',
        boardId: 'board-1',
        prompt: { ...basePrompt, runId: 'cancel-me' },
        timeoutSec: 600,
      });
      cancelPendingApproval('cancel-me');
      expect(getPendingApproval('cancel-me')).toBeUndefined();
    });

    it('should not throw for unknown runId', () => {
      expect(() => cancelPendingApproval('nonexistent')).not.toThrow();
    });
  });

  // ── Stop ──

  describe('stopTracker', () => {
    it('should clear all pending entries', () => {
      registerPendingApproval({ runId: 's1', boardId: 'b1', prompt: { ...basePrompt, runId: 's1' }, timeoutSec: 60 });
      registerPendingApproval({ runId: 's2', boardId: 'b1', prompt: { ...basePrompt, runId: 's2' }, timeoutSec: 60 });
      expect(listPendingApprovals()).toHaveLength(2);
      stopTracker();
      expect(listPendingApprovals()).toHaveLength(0);
    });
  });

  // ── Timer-based deadline checks ──

  describe('deadline checks', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      stopTracker();
      vi.useRealTimers();
    });

    it('should send timeout warning at 75% of deadline', async () => {
      registerPendingApproval({
        runId: 'timer-warn',
        boardId: 'board-1',
        prompt: { ...basePrompt, runId: 'timer-warn' },
        timeoutSec: 100,
      });

      // Advance past 75% threshold (75s) + one check interval (15s)
      await vi.advanceTimersByTimeAsync(90_000);

      expect(mockSendTimeoutWarning).toHaveBeenCalled();
      expect(mockAppendEvent).toHaveBeenCalledWith(
        'board-1',
        'timer-warn',
        'HITL_TIMEOUT_WARNING',
        expect.objectContaining({ timeout_sec: 100 }),
      );
    });

    it('should auto-resolve when deadline expires', async () => {
      registerPendingApproval({
        runId: 'timer-exp',
        boardId: 'board-1',
        prompt: { ...basePrompt, runId: 'timer-exp' },
        timeoutSec: 60,
        autoDecisionOnExpiry: 'BLOCK',
      });

      // Advance past full timeout + check interval
      await vi.advanceTimersByTimeAsync(75_000);

      expect(mockSendDeadlineExpired).toHaveBeenCalled();
      expect(mockHumanApprovePost).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'timer-exp',
          approver: 'system:timeout',
        }),
      );
      // Should be removed from pending
      expect(getPendingApproval('timer-exp')).toBeUndefined();
    });

    it('should auto-resolve as ALLOW when configured', async () => {
      registerPendingApproval({
        runId: 'timer-allow',
        boardId: 'board-1',
        prompt: { ...basePrompt, runId: 'timer-allow' },
        timeoutSec: 60,
        autoDecisionOnExpiry: 'ALLOW',
      });

      await vi.advanceTimersByTimeAsync(75_000);

      expect(mockHumanApprovePost).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'timer-allow',
          replyText: 'YES',
        }),
      );
    });
  });
});
