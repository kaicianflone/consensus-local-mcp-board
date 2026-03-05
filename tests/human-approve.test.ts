import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAppendEvent,
  mockGetRun,
  mockUpdateRunStatus,
  mockListEvents,
  mockRecordVoteReceived,
  mockGetPendingApproval,
  mockCancelPendingApproval,
} = vi.hoisted(() => ({
  mockAppendEvent: vi.fn(),
  mockGetRun: vi.fn(() => ({ board_id: 'board-fallback' })),
  mockUpdateRunStatus: vi.fn(),
  mockListEvents: vi.fn(() => []),
  mockRecordVoteReceived: vi.fn(() => ({ complete: true, total: 1, required: 1 })),
  mockGetPendingApproval: vi.fn(() => undefined as any),
  mockCancelPendingApproval: vi.fn(),
}));

vi.mock('../server/src/db/store.js', () => ({
  db: {},
  appendEvent: mockAppendEvent,
  getRun: mockGetRun,
  updateRunStatus: mockUpdateRunStatus,
  listEvents: mockListEvents,
}));

vi.mock('../server/src/db/credentials.js', () => ({
  getCredential: vi.fn(() => null),
}));

vi.mock('../server/src/engine/hitl-tracker.js', () => ({
  recordVoteReceived: mockRecordVoteReceived,
  getPendingApproval: mockGetPendingApproval,
  cancelPendingApproval: mockCancelPendingApproval,
}));

import { humanApprovePost } from '../server/src/api/human.approve.post.js';

describe('humanApprovePost', () => {
  let counter = 0;
  function uniqueKey() { return `key-${++counter}-${Date.now()}`; }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPendingApproval.mockReturnValue(undefined);
    mockRecordVoteReceived.mockReturnValue({ complete: true, total: 1, required: 1 });
  });

  // ── Basic approval decisions ──

  it('should approve with YES reply', async () => {
    const result = await humanApprovePost({
      runId: 'run-yes',
      replyText: 'YES',
      approver: 'alice',
      idempotencyKey: uniqueKey(),
      boardId: 'board-1',
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.decision).toBe('YES');
    expect(result.complete).toBe(true);
  });

  it('should block with NO reply', async () => {
    const result = await humanApprovePost({
      runId: 'run-no',
      replyText: 'NO',
      approver: 'bob',
      idempotencyKey: uniqueKey(),
      boardId: 'board-1',
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.decision).toBe('NO');
  });

  it('should handle REWRITE reply', async () => {
    const result = await humanApprovePost({
      runId: 'run-rw',
      replyText: 'rewrite',
      approver: 'carol',
      idempotencyKey: uniqueKey(),
      boardId: 'board-1',
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.decision).toBe('REWRITE');
  });

  it('should accept synonym replies (approve, block, deny, revise)', async () => {
    const approve = await humanApprovePost({
      runId: 'syn-1', replyText: 'approve', approver: 'x', idempotencyKey: uniqueKey(), boardId: 'b1',
    }) as any;
    expect(approve.decision).toBe('YES');

    const deny = await humanApprovePost({
      runId: 'syn-2', replyText: 'deny', approver: 'x', idempotencyKey: uniqueKey(), boardId: 'b1',
    }) as any;
    expect(deny.decision).toBe('NO');

    const revise = await humanApprovePost({
      runId: 'syn-3', replyText: 'revise', approver: 'x', idempotencyKey: uniqueKey(), boardId: 'b1',
    }) as any;
    expect(revise.decision).toBe('REWRITE');
  });

  // ── Event recording ──

  it('should append HUMAN_APPROVED and FINAL_DECISION events', async () => {
    await humanApprovePost({
      runId: 'run-ev',
      replyText: 'YES',
      approver: 'alice',
      idempotencyKey: uniqueKey(),
      boardId: 'board-1',
    });
    expect(mockAppendEvent).toHaveBeenCalledWith(
      'board-1', 'run-ev', 'HUMAN_APPROVED',
      expect.objectContaining({ decision: 'YES', approver: 'alice' }),
    );
    expect(mockAppendEvent).toHaveBeenCalledWith(
      'board-1', 'run-ev', 'FINAL_DECISION',
      expect.objectContaining({ decision: 'ALLOW', source: 'human.approve' }),
    );
  });

  it('should update run status to APPROVED for YES', async () => {
    await humanApprovePost({
      runId: 'run-st-y',
      replyText: 'YES',
      approver: 'alice',
      idempotencyKey: uniqueKey(),
      boardId: 'board-1',
    });
    expect(mockUpdateRunStatus).toHaveBeenCalledWith('run-st-y', 'APPROVED');
  });

  it('should update run status to BLOCKED for NO', async () => {
    await humanApprovePost({
      runId: 'run-st-n',
      replyText: 'block',
      approver: 'bob',
      idempotencyKey: uniqueKey(),
      boardId: 'board-1',
    });
    expect(mockUpdateRunStatus).toHaveBeenCalledWith('run-st-n', 'BLOCKED');
  });

  it('should update run status to REVISION_REQUESTED for REWRITE', async () => {
    await humanApprovePost({
      runId: 'run-st-r',
      replyText: 'revise',
      approver: 'carol',
      idempotencyKey: uniqueKey(),
      boardId: 'board-1',
    });
    expect(mockUpdateRunStatus).toHaveBeenCalledWith('run-st-r', 'REVISION_REQUESTED');
  });

  // ── Idempotency ──

  it('should deduplicate by idempotency key', async () => {
    const key = uniqueKey();
    const first = await humanApprovePost({
      runId: 'run-dup',
      replyText: 'YES',
      approver: 'alice',
      idempotencyKey: key,
      boardId: 'board-1',
    }) as any;
    expect(first.deduped).toBeUndefined();

    const second = await humanApprovePost({
      runId: 'run-dup',
      replyText: 'YES',
      approver: 'alice',
      idempotencyKey: key,
      boardId: 'board-1',
    }) as any;
    expect(second.deduped).toBe(true);
  });

  // ── Multi-voter mode ──

  describe('multi-voter mode', () => {
    it('should record partial vote without finalizing', async () => {
      mockGetPendingApproval.mockReturnValue({
        runId: 'vote-run',
        boardId: 'board-1',
        mode: 'vote',
        requiredVotes: 3,
        receivedVotes: 0,
      });
      mockRecordVoteReceived.mockReturnValue({ complete: false, total: 1, required: 3 });

      const result = await humanApprovePost({
        runId: 'vote-run',
        replyText: 'YES',
        approver: 'voter-1',
        idempotencyKey: uniqueKey(),
        boardId: 'board-1',
      }) as any;

      expect(result.ok).toBe(true);
      expect(result.complete).toBe(false);
      expect(result.voteRecorded).toBe(true);
      expect(result.votesReceived).toBe(1);
      expect(result.votesRequired).toBe(3);
      // Should record VOTE_RECEIVED event but NOT finalize
      expect(mockAppendEvent).toHaveBeenCalledWith(
        'board-1', 'vote-run', 'VOTE_RECEIVED',
        expect.objectContaining({ votes_received: 1, votes_required: 3 }),
      );
      expect(mockUpdateRunStatus).not.toHaveBeenCalled();
    });

    it('should finalize when all required votes are met', async () => {
      mockGetPendingApproval.mockReturnValue({
        runId: 'vote-final',
        boardId: 'board-1',
        mode: 'vote',
        requiredVotes: 2,
        receivedVotes: 1,
      });
      mockRecordVoteReceived.mockReturnValue({ complete: true, total: 2, required: 2 });

      const result = await humanApprovePost({
        runId: 'vote-final',
        replyText: 'YES',
        approver: 'voter-2',
        idempotencyKey: uniqueKey(),
        boardId: 'board-1',
      }) as any;

      expect(result.ok).toBe(true);
      expect(result.complete).toBe(true);
      expect(mockCancelPendingApproval).toHaveBeenCalledWith('vote-final');
      expect(mockUpdateRunStatus).toHaveBeenCalledWith('vote-final', 'APPROVED');
    });

    it('should finalize as BLOCKED when final vote is NO', async () => {
      mockGetPendingApproval.mockReturnValue({
        runId: 'vote-block',
        boardId: 'board-1',
        mode: 'vote',
        requiredVotes: 1,
        receivedVotes: 0,
      });
      mockRecordVoteReceived.mockReturnValue({ complete: true, total: 1, required: 1 });

      await humanApprovePost({
        runId: 'vote-block',
        replyText: 'NO',
        approver: 'voter-1',
        idempotencyKey: uniqueKey(),
        boardId: 'board-1',
      });

      expect(mockUpdateRunStatus).toHaveBeenCalledWith('vote-block', 'BLOCKED');
    });
  });

  // ── Board ID fallback ──

  it('should fall back to run board_id when boardId not provided', async () => {
    mockGetRun.mockReturnValue({ board_id: 'board-from-run' });

    await humanApprovePost({
      runId: 'run-fb',
      replyText: 'YES',
      approver: 'alice',
      idempotencyKey: uniqueKey(),
    });

    expect(mockAppendEvent).toHaveBeenCalledWith(
      'board-from-run', 'run-fb', 'HUMAN_APPROVED',
      expect.anything(),
    );
  });

  // ── Invalid input ──

  it('should reject unrecognized reply text', async () => {
    await expect(humanApprovePost({
      runId: 'run-bad',
      replyText: 'maybe',
      approver: 'charlie',
      idempotencyKey: uniqueKey(),
      boardId: 'board-1',
    })).rejects.toThrow();
  });
});
