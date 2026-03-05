import { appendEvent, getRun, updateRunStatus } from '../db/store.js';
import { sendTimeoutWarning, sendDeadlineExpired, type ChatPrompt } from '../adapters/chat-sdk.js';
import { humanApprovePost } from '../api/human.approve.post.js';

type PendingApproval = {
  runId: string;
  boardId: string;
  workflowId?: string;
  prompt: ChatPrompt;
  startedAt: number;
  timeoutSec: number;
  warningSentAt: number | null;
  requiredVotes: number;
  receivedVotes: number;
  mode: 'approval' | 'vote';
  autoDecisionOnExpiry: string;
};

const pending = new Map<string, PendingApproval>();
let intervalId: ReturnType<typeof setInterval> | null = null;

const WARNING_THRESHOLD = 0.75; // warn at 75% of timeout elapsed
const CHECK_INTERVAL_MS = 15_000;

export function registerPendingApproval(opts: {
  runId: string;
  boardId: string;
  workflowId?: string;
  prompt: ChatPrompt;
  timeoutSec: number;
  requiredVotes?: number;
  mode?: 'approval' | 'vote';
  autoDecisionOnExpiry?: string;
}) {
  pending.set(opts.runId, {
    runId: opts.runId,
    boardId: opts.boardId,
    workflowId: opts.workflowId,
    prompt: opts.prompt,
    startedAt: Date.now(),
    timeoutSec: opts.timeoutSec,
    warningSentAt: null,
    requiredVotes: opts.requiredVotes ?? 1,
    receivedVotes: 0,
    mode: opts.mode ?? 'approval',
    autoDecisionOnExpiry: opts.autoDecisionOnExpiry ?? 'BLOCK',
  });
  ensureTimerRunning();
}

/**
 * Record that a vote/approval was received for a pending HITL run.
 * Returns whether the required vote count is now met.
 */
export function recordVoteReceived(runId: string): { complete: boolean; total: number; required: number } {
  const entry = pending.get(runId);
  if (!entry) return { complete: false, total: 0, required: 0 };
  entry.receivedVotes++;
  const complete = entry.receivedVotes >= entry.requiredVotes;
  if (complete) pending.delete(runId);
  return { complete, total: entry.receivedVotes, required: entry.requiredVotes };
}

export function cancelPendingApproval(runId: string) {
  pending.delete(runId);
}

export function getPendingApproval(runId: string): PendingApproval | undefined {
  return pending.get(runId);
}

export function listPendingApprovals(): PendingApproval[] {
  return Array.from(pending.values());
}

function ensureTimerRunning() {
  if (intervalId) return;
  intervalId = setInterval(checkDeadlines, CHECK_INTERVAL_MS);
}

async function checkDeadlines() {
  const now = Date.now();
  for (const [runId, entry] of pending) {
    const elapsedSec = (now - entry.startedAt) / 1000;
    const remaining = entry.timeoutSec - elapsedSec;

    // Send warning when threshold is crossed
    if (!entry.warningSentAt && elapsedSec >= entry.timeoutSec * WARNING_THRESHOLD) {
      entry.warningSentAt = now;
      try {
        await sendTimeoutWarning(entry.prompt, Math.max(0, remaining));
        appendEvent(entry.boardId, entry.runId, 'HITL_TIMEOUT_WARNING', {
          elapsed_sec: Math.round(elapsedSec),
          remaining_sec: Math.round(remaining),
          timeout_sec: entry.timeoutSec,
          votes_received: entry.receivedVotes,
          votes_required: entry.requiredVotes,
        });
      } catch (e: any) {
        console.warn(`[hitl-tracker] Failed to send timeout warning for ${runId}:`, e?.message);
      }
    }

    // Deadline expired — auto-resolve
    if (elapsedSec >= entry.timeoutSec) {
      pending.delete(runId);
      try {
        const decision = entry.autoDecisionOnExpiry;
        await sendDeadlineExpired(entry.prompt, decision);
        appendEvent(entry.boardId, entry.runId, 'HITL_DEADLINE_EXPIRED', {
          timeout_sec: entry.timeoutSec,
          auto_decision: decision,
          votes_received: entry.receivedVotes,
          votes_required: entry.requiredVotes,
        });
        // Auto-resolve via human.approve so the run status gets updated
        await humanApprovePost({
          runId: entry.runId,
          replyText: decision === 'BLOCK' ? 'NO' : decision === 'REWRITE' ? 'REWRITE' : 'YES',
          approver: 'system:timeout',
          idempotencyKey: `timeout:${entry.runId}:${entry.timeoutSec}`,
          boardId: entry.boardId,
        });
      } catch (e: any) {
        console.warn(`[hitl-tracker] Failed to handle deadline expiry for ${runId}:`, e?.message);
      }
    }
  }

  // Stop the interval when nothing is pending
  if (pending.size === 0 && intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export function stopTracker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  pending.clear();
}
