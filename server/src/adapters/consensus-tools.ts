import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { computeDecision, computeEffectiveWeight, type WeightedVote, type WeightingMode } from '@local-mcp-board/shared';

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

// ── Ledger I/O (mirrors consensus-tools ledger model) ──

interface LedgerEntry {
  id: string;
  at: string;
  type: 'FAUCET' | 'STAKE' | 'UNSTAKE' | 'PAYOUT' | 'SLASH' | 'ADJUST';
  agentId: string;
  amount: number;
  jobId?: string;
  reason?: string;
}

function readLedger(root: string): LedgerEntry[] {
  const ledgerPath = path.join(root, 'ledger.json');
  if (!existsSync(ledgerPath)) return [];
  try { return JSON.parse(readFileSync(ledgerPath, 'utf8')); } catch { return []; }
}

function appendLedger(root: string, entry: LedgerEntry): void {
  const entries = readLedger(root);
  entries.push(entry);
  writeJsonFile(path.join(root, 'ledger.json'), entries);
}

/**
 * Compute reputation from ledger — same formula as consensus-tools engine:
 * reputation = 1 + sum(PAYOUT amounts) + sum(SLASH amounts), floor 0.1
 * Normalized to 0-100 scale for our participant DB.
 */
export function computeReputationFromLedger(root: string | undefined, agentId: string): number {
  const resolvedRoot = root || localBoardRoot();
  const entries = readLedger(resolvedRoot);
  let score = 1;
  for (const entry of entries) {
    if (entry.agentId !== agentId) continue;
    if (entry.type === 'PAYOUT') score += entry.amount;
    if (entry.type === 'SLASH') score += entry.amount; // slash amounts are negative
  }
  const raw = Math.max(0.1, score);
  // Normalize: score=1 → rep=100, score=0.1 → rep=10, score=2 → rep=200 clamped to 100
  return Math.min(100, Math.max(0, Math.round(raw * 100)));
}

/**
 * Write PAYOUT/SLASH ledger entries after a board resolution.
 * Agents whose verdict aligned with the decision get a payout;
 * agents who voted against get slashed.
 */
export function writeLedgerOutcomes(
  root: string,
  jobId: string,
  verdicts: AgentVerdict[],
  finalDecision: 'ALLOW' | 'BLOCK' | 'REWRITE' | 'REQUIRE_HUMAN',
): void {
  const PAYOUT_AMOUNT = 0.1;
  const SLASH_AMOUNT = -0.05;

  // Map decision → which verdict aligns
  // ALLOW         → YES aligned, NO/REWRITE opposed
  // BLOCK         → NO aligned, YES opposed, REWRITE neutral (partial credit)
  // REWRITE       → REWRITE aligned, YES opposed, NO neutral (identified risk but over-rejected)
  // REQUIRE_HUMAN → REWRITE aligned, YES/NO neutral (no slash)
  for (const v of verdicts) {
    let aligned: boolean;
    let neutral = false;

    if (finalDecision === 'ALLOW') {
      aligned = v.verdict === 'YES';
    } else if (finalDecision === 'BLOCK') {
      aligned = v.verdict === 'NO';
      // REWRITE voters caught the risk — partial credit, not slashed
      if (v.verdict === 'REWRITE') { neutral = true; }
    } else if (finalDecision === 'REWRITE') {
      aligned = v.verdict === 'REWRITE';
      // NO voters identified risk but over-rejected — neutral, not slashed
      if (v.verdict === 'NO') { neutral = true; }
    } else {
      // REQUIRE_HUMAN — REWRITE is aligned, others are neutral
      aligned = v.verdict === 'REWRITE';
      if (!aligned) continue; // no slash for non-REWRITE on REQUIRE_HUMAN
    }

    if (neutral) continue; // no payout or slash for neutral verdicts

    appendLedger(root, {
      id: localRandId(aligned ? 'pay' : 'slash'),
      at: new Date().toISOString(),
      type: aligned ? 'PAYOUT' : 'SLASH',
      agentId: v.evaluator,
      amount: aligned ? PAYOUT_AMOUNT : SLASH_AMOUNT,
      jobId,
      reason: aligned
        ? `Verdict ${v.verdict} aligned with decision ${finalDecision}`
        : `Verdict ${v.verdict} opposed decision ${finalDecision}`,
    });
  }
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
export function localFallbackEvaluate(input: ConsensusGuardInput): ConsensusGuardResult {
  const text = JSON.stringify(input.payload ?? {}).toLowerCase();
  const guardType = input.guardType;
  const p = input.payload as Record<string, any>;
  const pi = (p?.input ?? {}) as Record<string, any>;
  const gc = (p?.guardConfig ?? {}) as Record<string, any>;

  // ── Guard-type-specific evaluation using config ──

  if (guardType === 'send_email') {
    const to = String(p.to ?? pi.to ?? '').toLowerCase();
    const body = String(p.body ?? pi.body ?? '');
    const hasAttachment = Boolean(p.attachment ?? pi.attachment);
    const allowlist = String(gc.recipientAllowlist ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const blocklist = String(gc.recipientBlocklist ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const attachmentPolicy = String(gc.attachmentPolicy ?? 'warn');
    const secretsScanning = gc.secretsScanning !== false;

    // Check blocklist
    if (blocklist.length > 0 && blocklist.some(d => to.includes(d))) {
      return { decision: 'BLOCK', reason: `Recipient matches blocklist domain`, risk_score: 0.95, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    // Check secrets
    if (secretsScanning && /(api[_-]?key|token|password|secret|private[_-]?key)/i.test(body)) {
      return { decision: 'BLOCK', reason: 'Secrets-like pattern detected in email body', risk_score: 0.92, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    // Check attachment policy
    if (hasAttachment && attachmentPolicy === 'block') {
      return { decision: 'BLOCK', reason: 'Attachment blocked by policy', risk_score: 0.85, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    if (hasAttachment && attachmentPolicy === 'warn' && to.includes('@')) {
      return { decision: 'REQUIRE_HUMAN', reason: 'External email with attachment requires review', risk_score: 0.7, guard_type: guardType, audit_id: `local-${input.runId}`, next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId } }, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    // Check allowlist (if set, recipients outside it require review)
    if (allowlist.length > 0 && to && !allowlist.some(d => to.includes(d))) {
      return { decision: 'REQUIRE_HUMAN', reason: 'Recipient not in allowlist', risk_score: 0.6, guard_type: guardType, audit_id: `local-${input.runId}`, next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId } }, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    return { decision: 'ALLOW', reason: 'Email passed all guard checks', risk_score: 0.2, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
  }

  if (guardType === 'code_merge') {
    const files = String(p.files ?? pi.files ?? '');
    const patterns = String(gc.sensitiveFilePatterns ?? 'auth,security,permission,crypto').split(',').map(s => s.trim()).filter(Boolean);
    const protectedBranches = String(gc.protectedBranches ?? 'main').split(',').map(s => s.trim()).filter(Boolean);
    const branch = String(p.branch ?? pi.branch ?? '');
    const ciRequired = gc.ciRequired !== false;

    const sensitiveMatch = patterns.some(pat => new RegExp(pat.replace(/\*/g, '.*'), 'i').test(files));
    const protectedMatch = protectedBranches.some(b => new RegExp(b.replace(/\*/g, '.*'), 'i').test(branch));

    if (sensitiveMatch && protectedMatch) {
      return { decision: 'REQUIRE_HUMAN', reason: `Sensitive file touched on protected branch (${branch})`, risk_score: 0.85, guard_type: guardType, audit_id: `local-${input.runId}`, next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId } }, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    if (sensitiveMatch) {
      return { decision: 'REWRITE', reason: 'Sensitive file pattern detected', risk_score: 0.75, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    return { decision: 'ALLOW', reason: 'Code merge passed guard checks', risk_score: 0.25, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
  }

  if (guardType === 'publish') {
    const content = String(p.text ?? pi.text ?? text);
    const profanityFilter = gc.profanityFilter !== false;
    const piiDetection = gc.piiDetection !== false;
    const blockedWords = String(gc.blockedWords ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    if (profanityFilter && /(damn|shit|fuck)/i.test(content)) {
      return { decision: 'REWRITE', reason: 'Profanity detected in content', risk_score: 0.75, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    if (piiDetection && /\b\d{3}-\d{2}-\d{4}\b/.test(content)) {
      return { decision: 'BLOCK', reason: 'PII pattern (SSN) detected in content', risk_score: 0.9, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    if (blockedWords.length > 0 && blockedWords.some(w => content.toLowerCase().includes(w))) {
      return { decision: 'REWRITE', reason: `Blocked word detected: ${blockedWords.find(w => content.toLowerCase().includes(w))}`, risk_score: 0.7, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    return { decision: 'ALLOW', reason: 'Publish content passed guard checks', risk_score: 0.2, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
  }

  if (guardType === 'support_reply') {
    const message = String(p.message ?? pi.message ?? text);
    const keywords = String(gc.escalationKeywords ?? 'refund,lawsuit,legal action').split(',').map(s => s.trim()).filter(Boolean);
    const autoEscalate = gc.autoEscalate !== false;

    const matched = keywords.find(k => message.toLowerCase().includes(k.toLowerCase()));
    if (matched) {
      if (autoEscalate) {
        return { decision: 'REQUIRE_HUMAN', reason: `Escalation keyword "${matched}" detected — auto-escalated`, risk_score: 0.75, guard_type: guardType, audit_id: `local-${input.runId}`, next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId } }, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
      }
      return { decision: 'REWRITE', reason: `Escalation keyword "${matched}" detected`, risk_score: 0.7, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    return { decision: 'ALLOW', reason: 'Support reply passed guard checks', risk_score: 0.15, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
  }

  if (guardType === 'agent_action') {
    const irreversible = Boolean(p.irreversible ?? pi.irreversible ?? gc.irreversibleDefault);
    const toolName = String(p.tool ?? pi.tool ?? '');
    const allowlist = String(gc.toolAllowlist ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const blocklist = String(gc.toolBlocklist ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    if (blocklist.length > 0 && toolName && blocklist.some(t => toolName.toLowerCase().includes(t))) {
      return { decision: 'REQUIRE_HUMAN', reason: `Tool "${toolName}" is on the blocklist`, risk_score: 0.85, guard_type: guardType, audit_id: `local-${input.runId}`, next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId } }, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    if (allowlist.length > 0 && toolName && allowlist.some(t => toolName.toLowerCase().includes(t))) {
      return { decision: 'ALLOW', reason: `Tool "${toolName}" is on the allowlist`, risk_score: 0.15, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    if (irreversible) {
      return { decision: 'REQUIRE_HUMAN', reason: 'Irreversible agent action requires review', risk_score: 0.85, guard_type: guardType, audit_id: `local-${input.runId}`, next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId } }, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    return { decision: 'ALLOW', reason: 'Reversible agent action', risk_score: 0.3, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
  }

  if (guardType === 'deployment') {
    const env = String(p.env ?? pi.env ?? gc.deployEnv ?? 'prod');
    const requireProdApproval = gc.requireProdApproval !== false;

    if (env === 'prod' && requireProdApproval) {
      return { decision: 'REQUIRE_HUMAN', reason: 'Production deployment requires human approval', risk_score: 0.8, guard_type: guardType, audit_id: `local-${input.runId}`, next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId } }, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    if (env === 'prod') {
      return { decision: 'REWRITE', reason: 'Production deployment flagged for review', risk_score: 0.7, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    return { decision: 'ALLOW', reason: `Non-production deployment (${env})`, risk_score: 0.2, guard_type: guardType, audit_id: `local-${input.runId}`, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
  }

  if (guardType === 'permission_escalation') {
    const breakGlass = Boolean(p.breakGlass ?? pi.breakGlass ?? gc.breakGlassDefault);
    const reqMfa = Boolean(gc.requireMfa);

    if (breakGlass) {
      return { decision: 'REQUIRE_HUMAN', reason: 'Break-glass escalation requires human approval', risk_score: 0.9, guard_type: guardType, audit_id: `local-${input.runId}`, next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId } }, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    if (reqMfa) {
      return { decision: 'REQUIRE_HUMAN', reason: 'MFA required for permission escalation', risk_score: 0.75, guard_type: guardType, audit_id: `local-${input.runId}`, next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId } }, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
    }
    return { decision: 'REQUIRE_HUMAN', reason: 'Permission escalation requires human approval by default', risk_score: 0.7, guard_type: guardType, audit_id: `local-${input.runId}`, next_step: { tool: 'human.approve', input: { runId: input.runId, boardId: input.boardId } }, meta: { engine: 'local-fallback', mode: 'guard-config', guardConfig: gc } };
  }

  // ── Generic fallback for unknown guard types ──

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

// ── Agent verdict types for board resolution ──

export type AgentVerdict = {
  evaluator: string;
  verdict: 'YES' | 'NO' | 'REWRITE';
  risk: number;
  reason: string;
  weight: number;
  reputation: number;
};

export type BoardResolutionResult = {
  decision: 'ALLOW' | 'BLOCK' | 'REWRITE' | 'REQUIRE_HUMAN';
  combinedRisk: number;
  weightedYesRatio: number;
  quorumMet: boolean;
  tally: { yes: number; no: number; rewrite: number; voterCount: number; totalWeight: number };
  reason: string;
  weightingMode?: WeightingMode;
  audit_id?: string;
  meta?: Record<string, unknown>;
};

/**
 * Resolve agent verdicts through the consensus-tools board.
 * Posts each verdict as a vote (not just submission), resolves via the board's
 * WEIGHTED_REPUTATION policy, writes PAYOUT/SLASH ledger entries, and returns
 * the board's authoritative decision.
 */
export function resolveVerdictsViaBoard(
  input: ConsensusGuardInput,
  verdicts: AgentVerdict[],
  quorum: number,
  riskThreshold: number,
  weightingMode: WeightingMode = 'hybrid',
): BoardResolutionResult {
  const config = readConsensusConfig();
  const boardMode = config?.board_mode || config?.boards?.local?.type;

  // Try local board voting resolution
  if (boardMode === 'local' || existsSync(localBoardRoot())) {
    try {
      return resolveVerdictsViaLocalBoard(input, verdicts, quorum, riskThreshold, weightingMode);
    } catch (e: any) {
      console.warn(`[consensus-tools] Local board verdict resolution failed: ${e?.message?.split('\n')[0]}`);
    }
  }

  // Try remote CLI voting resolution
  if (boardMode !== 'local') {
    try {
      return resolveVerdictsViaRemoteCli(input, verdicts, quorum, riskThreshold, weightingMode);
    } catch (e: any) {
      console.warn(`[consensus-tools] Remote CLI verdict resolution failed: ${e?.message?.split('\n')[0]}`);
    }
  }

  // Fallback: resolve locally using computeDecision
  console.warn('[consensus-tools] All board paths failed, resolving verdicts locally');
  return resolveVerdictsLocally(verdicts, quorum, riskThreshold, weightingMode, input.runId);
}

function resolveVerdictsViaLocalBoard(
  input: ConsensusGuardInput,
  verdicts: AgentVerdict[],
  quorum: number,
  riskThreshold: number,
  weightingMode: WeightingMode = 'hybrid',
): BoardResolutionResult {
  const root = localBoardRoot();
  const title = `guard:${input.guardType} run:${input.runId} [voting]`;
  const desc = `Board voting resolution for ${input.guardType} with ${verdicts.length} agent verdicts`;

  // 1. Create a VOTING job on the board (use WEIGHTED_REPUTATION policy)
  ensureLocalBoard(root);
  const jobId = localRandId('job');
  const jobDir = path.join(root, 'jobs', jobId);
  mkdirSync(path.join(jobDir, 'submissions'), { recursive: true });
  mkdirSync(path.join(jobDir, 'votes'), { recursive: true });

  const job = {
    id: jobId,
    title,
    desc,
    input: `${verdicts.length} agent verdicts`,
    mode: 'VOTING',
    policyKey: 'WEIGHTED_REPUTATION',
    weightingMode,
    quorum,
    riskThreshold,
    rewardAmount: 0.1,
    stakeAmount: 0,
    leaseSeconds: 60,
    status: 'OPEN',
    createdAt: new Date().toISOString(),
  };
  writeJsonFile(path.join(root, 'jobs', `${jobId}.json`), job);

  // 2. Post each verdict as both a submission and a vote
  for (const v of verdicts) {
    const sid = localRandId('sub');
    const sub = {
      id: sid,
      jobId,
      artifact: {
        evaluator: v.evaluator,
        verdict: v.verdict,
        risk: v.risk,
        reason: v.reason,
        weight: v.weight,
        reputation: v.reputation,
      },
      summary: `${v.evaluator}: ${v.verdict} (risk=${v.risk}, w=${v.weight}, rep=${v.reputation})`,
      createdAt: new Date().toISOString(),
      status: 'VALID',
    };
    writeJsonFile(path.join(jobDir, 'submissions', `${sid}.json`), sub);

    // Also write as a vote (consensus-tools resolveConsensus reads votes)
    const vid = localRandId('vote');
    const vote = {
      id: vid,
      jobId,
      agentId: v.evaluator,
      submissionId: sid,
      score: v.verdict === 'YES' ? 1 : v.verdict === 'NO' ? -1 : 0,
      weight: computeEffectiveWeight(v.weight, v.reputation, weightingMode),
      rationale: v.reason,
      createdAt: new Date().toISOString(),
    };
    writeJsonFile(path.join(jobDir, 'votes', `${vid}.json`), vote);
  }

  // 3. Resolve via weighted reputation voting
  const resolution = resolveVerdictsLocally(verdicts, quorum, riskThreshold, weightingMode);

  // 4. Write PAYOUT/SLASH ledger entries based on outcome
  writeLedgerOutcomes(root, jobId, verdicts, resolution.decision);

  // 5. Write result
  const result = {
    jobId,
    mode: 'VOTING',
    policyKey: 'WEIGHTED_REPUTATION',
    weightingMode,
    decision: resolution.decision,
    combinedRisk: resolution.combinedRisk,
    weightedYesRatio: resolution.weightedYesRatio,
    quorumMet: resolution.quorumMet,
    resolvedAt: new Date().toISOString(),
  };
  writeJsonFile(path.join(root, 'jobs', jobId, 'result.json'), result);

  console.log(`[consensus-tools] Local board: resolved job ${jobId} → ${resolution.decision} (${weightingMode})`);
  return {
    ...resolution,
    weightingMode,
    audit_id: jobId,
    meta: { engine: 'consensus-local-board', jobId, mode: 'VOTING', weightingMode },
  };
}

/**
 * Local board voting resolution using weighted reputation.
 * Delegates to computeDecision() with weighting mode awareness.
 */
function localVotingResolve(
  _root: string,
  _jobId: string,
  verdicts: AgentVerdict[],
  quorum: number,
  riskThreshold: number,
  weightingMode: WeightingMode = 'hybrid',
): BoardResolutionResult {
  return resolveVerdictsLocally(verdicts, quorum, riskThreshold, weightingMode);
}

function resolveVerdictsViaRemoteCli(
  input: ConsensusGuardInput,
  verdicts: AgentVerdict[],
  quorum: number,
  riskThreshold: number,
  weightingMode: WeightingMode = 'hybrid',
): BoardResolutionResult {
  const title = `guard:${input.guardType} run:${input.runId} [voting]`;
  const desc = `Board voting resolution for ${input.guardType}`;
  const policy = policyForGuardType(input.guardType, input.policyPack);

  // Create VOTING job via CLI
  const posted = runCli([
    'jobs', 'post',
    '--title', title,
    '--desc', desc,
    '--input', `${verdicts.length} agent verdicts`,
    '--mode', 'VOTING',
    '--policy', policy,
    '--reward', '0',
    '--stake', '0',
    '--expires', '60',
    '--json',
  ]);

  const jobId = posted?.job?.id || posted?.id;
  if (!jobId) {
    console.warn('[consensus-tools] Remote CLI: voting job creation failed, resolving locally');
    return resolveVerdictsLocally(verdicts, quorum, riskThreshold, weightingMode, input.runId);
  }

  // Post each verdict as a submission + cast a vote
  for (const v of verdicts) {
    try {
      runCli([
        'submissions', 'create', jobId,
        '--artifact', JSON.stringify({ evaluator: v.evaluator, verdict: v.verdict, risk: v.risk, reason: v.reason, weight: v.weight, reputation: v.reputation }),
        '--summary', `${v.evaluator}: ${v.verdict}`,
        '--confidence', String(v.verdict === 'YES' ? 1 - v.risk : v.risk),
        '--json',
      ]);
    } catch { /* continue with remaining verdicts */ }
    // Cast a vote with effective weight
    try {
      runCli([
        'votes', 'cast', jobId,
        '--weight', String(computeEffectiveWeight(v.weight, v.reputation, weightingMode)),
        '--json',
      ]);
    } catch { /* continue */ }
  }

  // Resolve
  try {
    runCli(['resolve', jobId, '--json']);
  } catch { /* may fail if no votes yet */ }

  // Read result — if the CLI returns a decision, use it; otherwise fall back
  let cliResult: any = null;
  try {
    cliResult = runCli(['result', 'get', jobId, '--json']);
  } catch { /* fall through to local resolution */ }

  if (cliResult?.decision) {
    const d = String(cliResult.decision).toUpperCase();
    const decision = d === 'ALLOW' ? 'ALLOW' : d === 'BLOCK' ? 'BLOCK' : 'REQUIRE_HUMAN';
    const local = resolveVerdictsLocally(verdicts, quorum, riskThreshold, weightingMode);
    return {
      ...local,
      decision: decision as 'ALLOW' | 'BLOCK' | 'REQUIRE_HUMAN',
      audit_id: jobId,
      meta: { engine: 'consensus-remote', jobId, mode: 'VOTING' },
    };
  }

  // CLI didn't return a decision — resolve locally
  const local = resolveVerdictsLocally(verdicts, quorum, riskThreshold, weightingMode, input.runId);
  return { ...local, audit_id: jobId, meta: { engine: 'consensus-remote-fallback', jobId, mode: 'VOTING' } };
}

/**
 * Pure-logic fallback: delegates to computeDecision() from shared
 * (combined risk → quorum → allow) — single source of truth for the three-step model.
 * Now weighting-mode aware: reputation modulates weight based on mode.
 */
function resolveVerdictsLocally(
  verdicts: AgentVerdict[],
  quorum: number,
  riskThreshold: number,
  weightingMode: WeightingMode = 'hybrid',
  runId?: string,
): BoardResolutionResult {
  const votes: WeightedVote[] = verdicts.map(v => ({
    evaluator: v.evaluator,
    vote: v.verdict as 'YES' | 'NO' | 'REWRITE',
    reason: v.reason,
    risk: v.risk,
    weight: v.weight,
    confidence: 1,
    reputation: v.reputation,
  }));

  const result = computeDecision(votes, {
    policyId: 'board-fallback',
    version: 'v1',
    quorum,
    riskThreshold,
    hitlRequiredAboveRisk: riskThreshold,
    options: {},
  }, weightingMode);

  const decision = result.decision as 'ALLOW' | 'BLOCK' | 'REWRITE' | 'REQUIRE_HUMAN';

  let reason: string;
  if (decision === 'BLOCK') {
    reason = `Combined risk ${result.combinedRisk.toFixed(3)} exceeds threshold ${riskThreshold}`;
  } else if (decision === 'REWRITE') {
    reason = `Agents recommend rewrite (risk ${result.combinedRisk.toFixed(3)}, ${result.tally.rewrite} REWRITE votes, 0 NO votes)`;
  } else if (decision === 'REQUIRE_HUMAN') {
    reason = result.quorumMet
      ? `Weighted YES ratio ${result.weightedYesRatio.toFixed(3)} below quorum ${quorum}`
      : `Total weight ${result.tally.totalWeight.toFixed(1)} below quorum ${quorum}`;
  } else {
    reason = `Risk ${result.combinedRisk.toFixed(3)} acceptable, quorum met (YES ratio ${result.weightedYesRatio.toFixed(3)})`;
  }

  return {
    decision,
    combinedRisk: result.combinedRisk,
    weightedYesRatio: result.weightedYesRatio,
    quorumMet: result.quorumMet,
    tally: {
      yes: result.tally.yes,
      no: result.tally.no,
      rewrite: result.tally.rewrite,
      voterCount: result.tally.voterCount,
      totalWeight: result.tally.totalWeight,
    },
    reason,
    audit_id: runId ? `board-${runId}` : undefined,
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
