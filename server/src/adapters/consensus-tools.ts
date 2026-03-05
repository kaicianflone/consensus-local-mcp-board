import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

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

// ── Local board via direct file I/O ──

function readConsensusConfig(): Record<string, any> | null {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.consensus', 'config.json');
    if (existsSync(candidate)) {
      try { return JSON.parse(readFileSync(candidate, 'utf8')); } catch { return null; }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function localBoardRoot(): string {
  const config = readConsensusConfig();
  const raw = config?.boards?.local?.root || '~/.openclaw/workplace/consensus-board';
  return raw.replace(/^~/, process.env.HOME || '');
}

function localRandId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomBytes(4).readUInt32BE(0) % 100000}`;
}

function ensureLocalBoard(root: string) {
  mkdirSync(path.join(root, 'jobs'), { recursive: true });
  const ledger = path.join(root, 'ledger.json');
  if (!existsSync(ledger)) writeFileSync(ledger, '[]', 'utf8');
}

function writeJsonFile(filePath: string, data: any) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function readJsonFile(filePath: string): any {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function localJobsPost(root: string, title: string, desc: string, input: string): any {
  ensureLocalBoard(root);
  const id = localRandId('job');
  const jobDir = path.join(root, 'jobs', id);
  mkdirSync(path.join(jobDir, 'submissions'), { recursive: true });
  mkdirSync(path.join(jobDir, 'votes'), { recursive: true });

  const job = {
    id,
    title,
    desc,
    input,
    mode: 'SUBMISSION',
    policyKey: 'HIGHEST_CONFIDENCE_SINGLE',
    rewardAmount: 8,
    stakeAmount: 4,
    leaseSeconds: 180,
    status: 'OPEN',
    createdAt: new Date().toISOString(),
  };
  writeJsonFile(path.join(root, 'jobs', `${id}.json`), job);
  return job;
}

function localSubmissionsCreate(root: string, jobId: string, artifact: any, summary: string): any {
  const sid = localRandId('sub');
  const sub = {
    id: sid,
    jobId,
    artifact,
    summary,
    createdAt: new Date().toISOString(),
    status: 'VALID',
  };
  writeJsonFile(path.join(root, 'jobs', jobId, 'submissions', `${sid}.json`), sub);
  return sub;
}

function localResolve(root: string, jobId: string): any {
  const subsDir = path.join(root, 'jobs', jobId, 'submissions');
  if (!existsSync(subsDir)) return null;

  const files = readdirSync(subsDir).filter((f: string) => f.endsWith('.json'));
  if (!files.length) return null;

  // Pick highest-confidence submission, or most recent
  let best: any = null;
  let bestConf = -1;
  let bestTime = '';
  for (const f of files) {
    const sub = readJsonFile(path.join(subsDir, f));
    const conf = typeof sub?.artifact?.confidence === 'number' ? sub.artifact.confidence : -1;
    const created = sub?.createdAt || '';
    if (conf > bestConf || (conf === bestConf && created > bestTime)) {
      best = sub;
      bestConf = conf;
      bestTime = created;
    }
  }

  if (!best) return null;
  const result = {
    jobId,
    mode: 'SUBMISSION',
    selectedSubmissionId: best.id,
    resolvedAt: new Date().toISOString(),
    artifact: best.artifact,
    summary: best.summary || '',
  };
  writeJsonFile(path.join(root, 'jobs', jobId, 'result.json'), result);
  return result;
}

function localResultGet(root: string, jobId: string): any {
  const resultPath = path.join(root, 'jobs', jobId, 'result.json');
  if (!existsSync(resultPath)) return null;
  return readJsonFile(resultPath);
}

// ── Remote CLI binary (for hosted boards) ──

function cliBin(): string {
  if (process.env.CONSENSUS_TOOLS_BIN) return process.env.CONSENSUS_TOOLS_BIN;
  try {
    const found = execSync('which consensus-tools', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (found && existsSync(found)) return found;
  } catch { /* not on PATH */ }
  const candidates = [
    '/opt/homebrew/lib/node_modules/@consensus-tools/consensus-tools/bin/consensus-tools.js',
    '/usr/local/lib/node_modules/@consensus-tools/consensus-tools/bin/consensus-tools.js',
    `${process.env.HOME}/.openclaw/workspace/repos/consensus-tools/bin/consensus-tools.js`,
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'consensus-tools';
}

function runCli(args: string[]): any {
  const bin = cliBin();
  const cmd = bin.endsWith('.js') ? 'node' : bin;
  const cmdArgs = bin.endsWith('.js') ? [bin, ...args] : args;
  const raw = execFileSync(cmd, cmdArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {
    const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try { return JSON.parse(lines[i]); } catch { /* keep scanning */ }
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

/**
 * Local heuristic fallback when the consensus-tools CLI is unavailable or unconfigured.
 * Applies rule-based risk scoring so workflows can still execute without the external service.
 */
function localFallbackEvaluate(input: ConsensusGuardInput): ConsensusGuardResult {
  const text = JSON.stringify(input.payload ?? {}).toLowerCase();
  const guardType = input.guardType;

  // High-risk patterns
  if (/(secret|api[_-]?key|token|password|ssn|private[_-]?key)/i.test(text)) {
    return {
      decision: 'BLOCK',
      reason: 'Local fallback: sensitive data markers detected in payload',
      risk_score: 0.95,
      guard_type: guardType,
      audit_id: `local-${input.runId}`,
      meta: { engine: 'local-fallback', mode: 'heuristic' }
    };
  }

  // Medium-risk patterns
  if (/(prod|permission|security|auth|crypto|rollback|delete|drop|truncate)/i.test(text)) {
    return {
      decision: 'REQUIRE_HUMAN',
      reason: 'Local fallback: high-impact domain signals require human review',
      risk_score: 0.75,
      guard_type: guardType,
      audit_id: `local-${input.runId}`,
      next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId } },
      meta: { engine: 'local-fallback', mode: 'heuristic' }
    };
  }

  // Guard-type specific defaults
  if (guardType === 'permission_escalation' || guardType === 'deployment') {
    return {
      decision: 'REQUIRE_HUMAN',
      reason: `Local fallback: ${guardType} actions require human approval by default`,
      risk_score: 0.7,
      guard_type: guardType,
      audit_id: `local-${input.runId}`,
      next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId } },
      meta: { engine: 'local-fallback', mode: 'heuristic' }
    };
  }

  // Low-risk default
  return {
    decision: 'ALLOW',
    reason: 'Local fallback: no high-risk signals detected',
    risk_score: 0.25,
    guard_type: guardType,
    audit_id: `local-${input.runId}`,
    meta: { engine: 'local-fallback', mode: 'heuristic' }
  };
}

export function evaluateViaConsensusTools(input: ConsensusGuardInput): ConsensusGuardResult {
  // Try local board (pure TypeScript file I/O) if config says local mode
  const config = readConsensusConfig();
  const boardMode = config?.board_mode || config?.boards?.local?.type;
  if (boardMode === 'local' || existsSync(localBoardRoot())) {
    try {
      return evaluateViaLocalBoard(input);
    } catch (e: any) {
      console.warn(`[consensus-tools] Local board evaluation failed: ${e?.message?.split('\n')[0]}`);
    }
  }

  // Try remote CLI
  if (boardMode !== 'local') {
    try {
      return evaluateViaRemoteCli(input);
    } catch (e: any) {
      console.warn(`[consensus-tools] Remote CLI failed: ${e?.message?.split('\n')[0]}`);
    }
  }

  // Final fallback: local heuristic
  console.warn('[consensus-tools] All consensus paths failed, using local heuristic fallback');
  return localFallbackEvaluate(input);
}

function evaluateViaLocalBoard(input: ConsensusGuardInput): ConsensusGuardResult {
  const root = localBoardRoot();
  const title = `guard:${input.guardType} run:${input.runId}`;
  const desc = `Consensus evaluation for ${input.guardType}`;

  // 1. Post a job to the local SQLite board
  const posted = localJobsPost(root, title, desc, summarizePayload(input.payload));
  const jobId = posted?.id;
  if (!jobId) {
    console.warn('[consensus-tools] Local board: job creation returned no id');
    return localFallbackEvaluate(input);
  }
  console.log(`[consensus-tools] Local board: created job ${jobId}`);

  // 2. Create a submission with the guard artifact
  const artifact = {
    runId: input.runId,
    boardId: input.boardId,
    guardType: input.guardType,
    payload: input.payload,
    proposedBy: 'consensus-local-mcp-board'
  };
  const submission = localSubmissionsCreate(root, jobId, artifact, `Guard proposal: ${input.guardType}`);
  const submissionId = submission?.id;
  console.log(`[consensus-tools] Local board: created submission ${submissionId || 'unknown'}`);

  // 3. Resolve (local resolution picks highest-confidence / most recent submission)
  let resolved: any = null;
  try {
    resolved = localResolve(root, jobId);
  } catch { /* expected if no votes yet */ }

  // 4. Get result
  let result: any = null;
  try {
    result = localResultGet(root, jobId);
  } catch {
    result = null;
  }

  const selectedId = result?.selectedSubmissionId;
  if (submissionId && selectedId === submissionId) {
    return {
      decision: 'ALLOW',
      reason: 'Consensus local board: proposal selected as winner',
      risk_score: 0.35,
      guard_type: input.guardType,
      audit_id: jobId,
      meta: { engine: 'consensus-local-board', jobId, submissionId }
    };
  }

  return {
    decision: 'REQUIRE_HUMAN',
    reason: 'Consensus local board: vote required before final decision',
    risk_score: 0.6,
    guard_type: input.guardType,
    audit_id: jobId,
    next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId, consensusJobId: jobId } },
    meta: { engine: 'consensus-local-board', jobId, submissionId }
  };
}

function evaluateViaRemoteCli(input: ConsensusGuardInput): ConsensusGuardResult {
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

  const posted = runCli([
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

  try {
    runCli(['resolve', jobId, '--json']);
  } catch { /* expected when not enough votes */ }

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
      meta: { engine: 'consensus-remote', jobId, submissionId }
    };
  }

  return {
    decision: 'REQUIRE_HUMAN',
    reason: 'Consensus vote required before final decision',
    risk_score: 0.6,
    guard_type: input.guardType,
    audit_id: jobId,
    next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId, consensusJobId: jobId } },
    meta: { engine: 'consensus-remote', jobId, submissionId }
  };
}
