import { execFileSync } from 'node:child_process';

type ConsensusGuardInput = {
  boardId: string;
  guardType: string;
  payload: Record<string, unknown>;
  policyPack?: string;
  runId: string;
};

type ConsensusGuardResult = {
  decision: 'ALLOW' | 'BLOCK' | 'REWRITE' | 'REQUIRE_HUMAN';
  reason: string;
  risk_score: number;
  guard_type: string;
  audit_id?: string;
  next_step?: { tool: string; input: Record<string, unknown> };
  meta?: Record<string, unknown>;
};

const DEFAULT_BIN = '/home/kaici/.openclaw/workspace/repos/consensus-tools/bin/consensus-tools.js';

function cliBin(): string {
  return process.env.CONSENSUS_TOOLS_BIN || DEFAULT_BIN;
}

function runCli(args: string[]): any {
  const raw = execFileSync('node', [cliBin(), ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        // keep scanning
      }
    }
    return { raw: trimmed };
  }
}

function summarizePayload(payload: Record<string, unknown>) {
  const text = JSON.stringify(payload);
  return text.length > 400 ? `${text.slice(0, 400)}...` : text;
}

function policyForGuardType(guardType: string, policyPack?: string) {
  if (policyPack && policyPack.trim()) return policyPack;
  const map: Record<string, string> = {
    send_email: 'consensus-send-email-guard',
    code_merge: 'consensus-code-merge-guard',
    publish: 'consensus-publish-guard',
    support_reply: 'consensus-support-reply-guard',
    agent_action: 'consensus-agent-action-guard',
    deployment: 'consensus-deployment-guard',
    permission_escalation: 'consensus-permission-escalation-guard'
  };
  return map[guardType] || 'APPROVAL_VOTE';
}

export function evaluateViaConsensusTools(input: ConsensusGuardInput): ConsensusGuardResult {
  const title = `guard:${input.guardType} run:${input.runId}`;
  const desc = `Consensus evaluation for ${input.guardType}`;
  const policy = policyForGuardType(input.guardType, input.policyPack);
  const artifact = {
    runId: input.runId,
    boardId: input.boardId,
    guardType: input.guardType,
    payload: input.payload,
    proposedBy: 'consensus-local-mcp-board'
  };

  let posted: any;
  try {
    posted = runCli([
      'jobs', 'post',
      '--title', title,
      '--desc', desc,
      '--input', summarizePayload(input.payload),
      '--mode', 'VOTING',
      '--policy', policy,
      '--reward', '1',
      '--stake', '0',
      '--expires', '3600',
      '--json'
    ]);
  } catch {
    posted = runCli([
      'jobs', 'post',
      '--title', title,
      '--desc', desc,
      '--input', summarizePayload(input.payload),
      '--mode', 'VOTING',
      '--policy', 'APPROVAL_VOTE',
      '--reward', '1',
      '--stake', '0',
      '--expires', '3600',
      '--json'
    ]);
  }

  const jobId = posted?.job?.id || posted?.id;
  if (!jobId) {
    return {
      decision: 'REQUIRE_HUMAN',
      reason: 'Consensus-tools job creation failed',
      risk_score: 0.5,
      guard_type: input.guardType
    };
  }

  const submission = runCli([
    'submissions', 'create',
    jobId,
    '--artifact', JSON.stringify(artifact),
    '--summary', `Guard proposal: ${input.guardType}`,
    '--confidence', '0.5',
    '--json'
  ]);

  const submissionId = submission?.submission?.id || submission?.id;

  // No auto-vote to preserve real consensus semantics.
  // If unresolved/no voters yet, return REQUIRE_HUMAN and include consensus job linkage.
  try {
    runCli(['resolve', jobId, '--json']);
  } catch {
    // expected when not enough votes/participants
  }

  let result: any = null;
  try {
    result = runCli(['result', 'get', jobId, '--json']);
  } catch {
    result = null;
  }

  const winners: string[] = result?.resolution?.winningSubmissionIds || result?.winningSubmissionIds || [];
  if (submissionId && Array.isArray(winners) && winners.includes(submissionId)) {
    return {
      decision: 'ALLOW',
      reason: 'Consensus-tools selected proposal as winner',
      risk_score: 0.35,
      guard_type: input.guardType,
      audit_id: jobId,
      meta: { jobId, submissionId }
    };
  }

  return {
    decision: 'REQUIRE_HUMAN',
    reason: 'Consensus vote required before final decision',
    risk_score: 0.6,
    guard_type: input.guardType,
    audit_id: jobId,
    next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId, consensusJobId: jobId } },
    meta: { jobId, submissionId }
  };
}
