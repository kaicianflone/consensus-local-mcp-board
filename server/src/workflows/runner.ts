import { FatalError } from 'workflow';
import { execFileSync } from 'node:child_process';
import {
  appendEvent,
  createRun,
  getRun,
  listEvents,
  updateRunStatus,
  createWorkflowRun,
  updateWorkflowRunStatus,
  upsertWorkflowRunLink,
  listParticipants,
  createParticipant,
  updateParticipant,
  getPolicyAssignment
} from '../db/store.js';
import { evaluateWithAiSdk, type AgentPersona } from '../adapters/ai-sdk.js';
import { sendHumanApprovalPrompt, type ChatPrompt } from '../adapters/chat-sdk.js';
import { evaluateViaConsensusTools, resolveVerdictsViaBoard, computeReputationFromLedger, type AgentVerdict } from '../adapters/consensus-tools.js';
import { registerPendingApproval } from '../engine/hitl-tracker.js';

// ── GitHub PR fetcher via gh CLI ──

function fetchGitHubPR(repo: string, branch: string): { pr: any; diff: string; files: string[] } | null {
  try {
    // Find the most recent open PR targeting the branch
    const prListRaw = execFileSync('gh', [
      'pr', 'list', '--repo', repo, '--base', branch, '--state', 'open',
      '--json', 'number,title,body,author,headRefName,additions,deletions,changedFiles,url',
      '--limit', '1'
    ], { encoding: 'utf8', timeout: 15000 }).trim();
    const prs = JSON.parse(prListRaw || '[]');
    if (!prs.length) return null;

    const pr = prs[0];
    const prNumber = pr.number;

    // Fetch the diff (truncate to 15k chars to avoid blowing up token context)
    let diff = '';
    try {
      diff = execFileSync('gh', [
        'pr', 'diff', String(prNumber), '--repo', repo
      ], { encoding: 'utf8', timeout: 15000 }).trim();
      if (diff.length > 15000) diff = diff.slice(0, 15000) + '\n... (diff truncated)';
    } catch { /* diff fetch is best-effort */ }

    // Fetch changed file list
    let files: string[] = [];
    try {
      const filesRaw = execFileSync('gh', [
        'pr', 'view', String(prNumber), '--repo', repo,
        '--json', 'files', '--jq', '.files[].path'
      ], { encoding: 'utf8', timeout: 10000 }).trim();
      files = filesRaw ? filesRaw.split('\n') : [];
    } catch { /* file list is best-effort */ }

    return { pr, diff, files };
  } catch (e: any) {
    console.warn(`[trigger] Failed to fetch GitHub PR for ${repo}: ${e?.message}`);
    return null;
  }
}

const REVIEWER_ARCHETYPES = [
  'security-reviewer',
  'performance-analyst',
  'code-quality-reviewer',
  'architecture-reviewer',
  'reliability-engineer',
  'api-design-reviewer',
  'data-integrity-analyst',
  'scalability-reviewer',
  'compliance-auditor',
  'ux-impact-reviewer',
];

type RunOpts = {
  runId?: string;
  startIndex?: number;
  context?: Record<string, any>;
};

/**
 * Primary entry point: starts a full durable workflow run.
 * Uses Vercel Workflow SDK "use workflow" directive for durable execution.
 */
export async function runWorkflow(definition: any, workflowId: string, opts: RunOpts = {}) {
  'use workflow';
  return executeLocalFlow(definition, workflowId, opts);
}

export async function resumeWorkflow(definition: any, workflowId: string, runId: string, decision: 'YES' | 'NO' | 'REWRITE', approver = 'human') {
  'use workflow';
  const boardId = String(definition?.boardId || 'workflow-system');
  await recordHumanDecision(boardId, runId, workflowId, decision, approver);

  if (decision === 'NO') {
    return { runId, boardId, blocked: true };
  }

  if (decision === 'REWRITE') {
    return { runId, boardId, revisionRequested: true };
  }

  const waits = listEvents({ runId, type: 'WORKFLOW_WAITING_HUMAN_APPROVAL', limit: 1 }) as any[];
  const waitPayload = waits[0]?.payload_json ? JSON.parse(String(waits[0].payload_json)) : null;
  const startIndex = typeof waitPayload?.node_index === 'number' ? waitPayload.node_index + 1 : 0;

  return executeLocalFlow(definition, workflowId, { runId, startIndex, context: { hitlDecision: decision, approvedBy: approver } });
}

/**
 * Step: persist the human approval decision and update run status.
 */
async function recordHumanDecision(boardId: string, runId: string, workflowId: string, decision: string, approver: string) {
  'use step';
  appendEvent(boardId, runId, 'WORKFLOW_HUMAN_APPROVAL_DECISION', { workflow_id: workflowId, decision, approver });

  if (decision === 'NO') {
    appendEvent(boardId, runId, 'WORKFLOW_BLOCKED_BY_HUMAN', { workflow_id: workflowId, approver });
    updateRunStatus(runId, 'BLOCKED');
    updateWorkflowRunStatus(runId, 'BLOCKED');
  } else if (decision === 'REWRITE') {
    appendEvent(boardId, runId, 'WORKFLOW_REVISION_REQUESTED', { workflow_id: workflowId, approver });
    updateRunStatus(runId, 'REVISION_REQUESTED');
    updateWorkflowRunStatus(runId, 'REVISION_REQUESTED');
  }
}

/**
 * Step: ensure a run record exists in the DB, creating it if needed.
 */
function ensureRun(boardId: string, workflowId: string, runId?: string) {
  'use step';
  const existing = runId ? getRun(runId) : null;
  if (existing && runId) return runId;
  const created = createRun(boardId, { workflow_id: workflowId, source: 'workflow' }, runId) as any;
  const id = String(created?.id);
  createWorkflowRun(workflowId, id, 'OPEN');
  return id;
}

/**
 * Core local flow executor — iterates workflow nodes using durable steps.
 * Each node execution is wrapped in a "use step" function for automatic
 * retries, suspension, and observability via the Workflow SDK.
 */
export async function executeLocalFlow(definition: any, workflowId: string, opts: RunOpts = {}) {
  'use workflow';
  const boardId = String(definition?.boardId || 'workflow-system');
  const runId = await ensureRun(boardId, workflowId, opts.runId);
  await linkRun(runId, workflowId, opts.startIndex || 0);

  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const startIndex = opts.startIndex ?? 0;
  const context: Record<string, any> = { ...(opts.context || {}) };

  await emitWorkflowLifecycle(boardId, runId, workflowId, startIndex, nodes.length);

  for (let i = startIndex; i < nodes.length; i++) {
    const node = nodes[i];
    const startedAt = Date.now();
    await emitNodeStarted(boardId, runId, workflowId, i, node);

    try {
      const output = await executeNodeStep(node, context, { boardId, runId, workflowId });
      context[node.id] = output;

      // Guard node emits board resolution scores via emitBoardResolution step (below)
      // which reads the already-resolved output from context
      const eventOutput = node.type === 'guard'
        ? { guardType: node.config?.guardType || 'agent_action', policyPack: node.config?.policyPack || '', configured: true, boardResolution: !!output?.boardResolution, guardConfig: extractGuardConfig(node.config) }
        : output;
      await emitNodeExecuted(boardId, runId, workflowId, i, node, Date.now() - startedAt, eventOutput);

      // After guard node, emit RISK_SCORE + CONSENSUS_QUORUM from the board resolution
      if (node.type === 'guard' && output?.boardResolution) {
        await emitBoardResolutionScores(boardId, runId, node, output);
      }

      if (output?.pause === true && (node.type === 'hitl' || node.type === 'group')) {
        await emitWaitingHuman(boardId, runId, workflowId, i, node);
        upsertWorkflowRunLink(runId, workflowId, 'local', null, { waitNodeIndex: i, contextKeys: Object.keys(context) });

        // Local mode: persist state and return paused response.
        // Resume via POST /api/workflow-runs/:runId/approve which calls resumeWorkflow().
        updateRunStatus(runId, 'WAITING_HUMAN');
        updateWorkflowRunStatus(runId, 'WAITING_HUMAN');

        return { runId, boardId, paused: true, waitNodeIndex: i };
      }
    } catch (error: any) {
      await emitNodeFailed(boardId, runId, workflowId, i, node, error);
      // FatalError prevents automatic retry by the SDK
      throw new FatalError(`Node ${node.id} (${node.type}) failed: ${error?.message || 'unknown'}`);
    }
  }

  await emitWorkflowCompleted(boardId, runId, workflowId, nodes.length);
  return { runId, boardId, completed: true };
}

// ── Durable step wrappers for DB side-effects ──

async function linkRun(runId: string, workflowId: string, startIndex: number) {
  'use step';
  upsertWorkflowRunLink(runId, workflowId, 'local', null, { startIndex });
}

async function emitWorkflowLifecycle(boardId: string, runId: string, workflowId: string, startIndex: number, nodeCount: number) {
  'use step';
  appendEvent(boardId, runId, startIndex === 0 ? 'WORKFLOW_STARTED' : 'WORKFLOW_RESUMED', {
    workflow_id: workflowId,
    engine: 'workflow-sdk',
    node_count: nodeCount,
    start_index: startIndex
  });
}

async function emitNodeStarted(boardId: string, runId: string, workflowId: string, index: number, node: any) {
  'use step';
  appendEvent(boardId, runId, 'WORKFLOW_NODE_STARTED', {
    workflow_id: workflowId,
    node_index: index,
    node_id: node.id,
    node_type: node.type,
    label: node.label
  });
}

async function emitNodeExecuted(boardId: string, runId: string, workflowId: string, index: number, node: any, durationMs: number, output: any) {
  'use step';
  appendEvent(boardId, runId, 'WORKFLOW_NODE_EXECUTED', {
    workflow_id: workflowId,
    node_index: index,
    node_id: node.id,
    node_type: node.type,
    duration_ms: durationMs,
    output
  });
}

async function emitWaitingHuman(boardId: string, runId: string, workflowId: string, index: number, node: any) {
  'use step';
  appendEvent(boardId, runId, 'WORKFLOW_WAITING_HUMAN_APPROVAL', {
    workflow_id: workflowId,
    node_index: index,
    node_id: node.id,
    reason: 'Human approval required'
  });
  updateRunStatus(runId, 'WAITING_HUMAN');
  updateWorkflowRunStatus(runId, 'WAITING_HUMAN');
}

async function emitNodeFailed(boardId: string, runId: string, workflowId: string, index: number, node: any, error: any) {
  'use step';
  appendEvent(boardId, runId, 'WORKFLOW_NODE_FAILED', {
    workflow_id: workflowId,
    node_index: index,
    node_id: node.id,
    node_type: node.type,
    error: error?.message || 'unknown'
  });
  updateRunStatus(runId, 'BLOCKED');
  updateWorkflowRunStatus(runId, 'BLOCKED');
}

async function emitWorkflowCompleted(boardId: string, runId: string, workflowId: string, nodeCount: number) {
  'use step';
  appendEvent(boardId, runId, 'WORKFLOW_COMPLETED', { workflow_id: workflowId, engine: 'workflow-sdk', executed: nodeCount });
  updateRunStatus(runId, 'APPROVED');
  updateWorkflowRunStatus(runId, 'APPROVED');
}

/**
 * Emit RISK_SCORE + CONSENSUS_QUORUM events from the guard node's
 * board resolution output. Called only when the guard resolved agent
 * verdicts through the consensus-tools board (boardResolution=true).
 */
async function emitBoardResolutionScores(boardId: string, runId: string, guardNode: any, guardOutput: any) {
  'use step';
  const quorum = Number(guardNode?.config?.quorum ?? 0.7);
  const riskThreshold = Number(guardNode?.config?.riskThreshold ?? 0.7);

  // Read the board result already computed by the guard node (no double-resolution)
  const result = guardOutput?._boardResult as import('../adapters/consensus-tools.js').BoardResolutionResult | undefined;
  if (!result) return;

  const gc = extractGuardConfig(guardNode?.config);
  appendEvent(boardId, runId, 'RISK_SCORE', {
    risk_score: Math.round(result.combinedRisk * 1000) / 1000,
    decision: result.decision,
    guard_type: String(guardNode?.config?.guardType || 'agent_action'),
    voter_count: result.tally.voterCount,
    yes_count: result.tally.yes,
    no_count: result.tally.no,
    rewrite_count: result.tally.rewrite,
    quorum_threshold: quorum,
    risk_threshold: riskThreshold,
    weighted_yes_ratio: Math.round(result.weightedYesRatio * 1000) / 1000,
    board_audit_id: result.audit_id,
    board_engine: result.meta?.engine,
    guard_config: gc,
  });

  appendEvent(boardId, runId, 'CONSENSUS_QUORUM', {
    quorum_score: Math.round(result.weightedYesRatio * 1000) / 1000,
    quorum_met: result.quorumMet,
    total_voters: result.tally.voterCount,
    total_weight: Math.round(result.tally.totalWeight * 1000) / 1000,
    yes_count: result.tally.yes,
    no_count: result.tally.no,
    rewrite_count: result.tally.rewrite,
    decision: result.decision,
    guard_type: String(guardNode?.config?.guardType || 'agent_action'),
    quorum_threshold: quorum,
    risk_threshold: riskThreshold,
    board_audit_id: result.audit_id,
    board_engine: result.meta?.engine,
    guard_config: gc,
  });
}

/**
 * Step wrapper around executeNode — makes each node execution a durable step
 * so the SDK can retry on transient failures and track each node independently.
 */
async function executeNodeStep(node: any, context: Record<string, any>, ids: { boardId: string; runId: string; workflowId: string }) {
  'use step';
  return executeNode(node, context, ids);
}

/** Extract guard-type-specific config fields (excludes shared fields like quorum, riskThreshold). */
export function extractGuardConfig(config: Record<string, any> | undefined): Record<string, any> {
  if (!config) return {};
  const shared = new Set(['guardType', 'quorum', 'riskThreshold', 'numberOfAgents', 'numberOfHumans', 'policyPack']);
  const gc: Record<string, any> = {};
  for (const [k, v] of Object.entries(config)) {
    if (!shared.has(k) && v !== undefined && v !== '') gc[k] = v;
  }
  return gc;
}

async function executeNode(node: any, context: Record<string, any>, ids: { boardId: string; runId: string; workflowId: string }) {
  if (node.type === 'trigger') {
    const source = node.config?.source || node.config?.mode || 'manual';
    if (String(source).startsWith('github.')) {
      const repo = node.config?.repo || '';
      const branch = node.config?.branch || 'main';
      const base = { ok: true, trigger: source, provider: node.config?.provider || 'github-mcp', repo, branch };

      // Fetch actual PR data when a repo is configured
      if (repo) {
        const prData = fetchGitHubPR(repo, branch);
        if (prData) {
          return {
            ...base,
            pr: {
              number: prData.pr.number,
              title: prData.pr.title,
              body: prData.pr.body || '',
              author: prData.pr.author?.login || '',
              headBranch: prData.pr.headRefName || '',
              url: prData.pr.url || '',
              additions: prData.pr.additions || 0,
              deletions: prData.pr.deletions || 0,
              changedFiles: prData.pr.changedFiles || 0,
            },
            files: prData.files,
            diff: prData.diff,
          };
        }
      }

      return base;
    }
    if (String(source).startsWith('chat.')) {
      return {
        ok: true,
        trigger: source,
        channel: node.config?.channel || 'slack',
        chatType: node.config?.chatType || 'group',
        matchText: node.config?.matchText || '',
        fromUsers: node.config?.fromUsers || ''
      };
    }
    return { ok: true, trigger: source };
  }

  if (node.type === 'agent') {
    const agentCount = Math.max(1, Math.min(10, Number(node.config?.agentCount ?? 3)));
    const personaMode = node.config?.personaMode || 'auto';
    const model = node.config?.model || 'gpt-4o-mini';
    const temperature = Number(node.config?.temperature ?? 0);
    const systemPrompt = node.config?.systemPrompt || '';

    const personas: AgentPersona[] = await resolvePersonas(ids.boardId, agentCount, personaMode, node.config?.personaNames || '');

    const votes = await evaluateWithAiSdk(
      {
        runId: ids.runId,
        boardId: ids.boardId,
        guardType: 'agent_action',
        payload: { input: context, prompt: node.config?.prompt || '', nodeConfig: node.config || {} },
        policy: { policyId: 'agent-node', version: 'v1', quorum: 0.7, riskThreshold: 0.7, hitlRequiredAboveRisk: 0.7, options: {} },
        idempotencyKey: `${ids.runId}:${node.id}`
      },
      { agentCount, personas, model, temperature, systemPrompt }
    );

    let totalWeight = 0;
    let weightedRisk = 0;
    for (let i = 0; i < votes.length; i++) {
      const rep = personas[i]?.reputation ?? 100;
      totalWeight += rep;
      weightedRisk += votes[i].risk * rep;
    }
    const aggregatedRisk = totalWeight > 0 ? weightedRisk / totalWeight : votes.length > 0 ? votes.reduce((s, v) => s + v.risk, 0) / votes.length : 0.5;

    // Emit per-evaluator AGENT_VERDICT events (include participant weight + reputation for rolling scores)
    for (let vi = 0; vi < votes.length; vi++) {
      const v = votes[vi];
      const w = personas[vi]?.weight ?? 1;
      const r = personas[vi]?.reputation ?? 100;
      appendEvent(ids.boardId, ids.runId, 'AGENT_VERDICT', {
        evaluator: v.evaluator,
        verdict: v.vote,
        risk: v.risk,
        reason: v.reason,
        weight: w,
        reputation: r,
        guardType: 'agent_action',
      });
    }

    return { votes, aggregatedRisk, agentCount, personas: personas.map((p) => ({ name: p.name, reputation: p.reputation })) };
  }

  if (node.type === 'guard') {
    const guardType = String(node.config?.guardType || 'agent_action');
    const quorum = Number(node.config?.quorum ?? 0.7);
    const riskThreshold = Number(node.config?.riskThreshold ?? 0.7);

    // Check for agent verdicts from upstream agent/group nodes
    const storedVerdicts = (listEvents({ runId: ids.runId, type: 'AGENT_VERDICT', limit: 500 }) as any[]);

    if (storedVerdicts.length > 0) {
      // Agents ran before guard — resolve their verdicts through the board
      const verdicts: AgentVerdict[] = [];
      for (const v of storedVerdicts) {
        let p: any = {};
        try { p = JSON.parse(v.payload_json); } catch {}
        verdicts.push({
          evaluator: String(p.evaluator || 'unknown'),
          verdict: String(p.verdict || 'YES').toUpperCase() as 'YES' | 'NO' | 'REWRITE',
          risk: Number(p.risk ?? 0.5),
          reason: String(p.reason || ''),
          weight: Number(p.weight ?? 1),
          reputation: Number(p.reputation ?? 100),
        });
      }

      // Look up policy assignment for weighting mode
      const policyAssignment = getPolicyAssignment(ids.boardId, 'default') as any;
      const weightingMode = (policyAssignment?.weighting_mode || 'hybrid') as import('@local-mcp-board/shared').WeightingMode;

      const result = resolveVerdictsViaBoard(
        { boardId: ids.boardId, runId: ids.runId, guardType, payload: { input: context, guardConfig: node.config || {} }, policyPack: String(node.config?.policyPack || '') },
        verdicts,
        quorum,
        riskThreshold,
        weightingMode,
      );

      // Sync participant reputation from ledger after resolution
      syncReputationFromLedger(ids.boardId, verdicts);

      // Post-resolution escalation: blockAboveRisk overrides REWRITE → BLOCK
      // when combined risk exceeds the guard's hard ceiling
      let finalDecision = result.decision;
      let finalReasons = [result.reason];
      const blockAboveRisk = Number(node.config?.blockAboveRisk ?? 1.0);
      if (finalDecision === 'REWRITE' && result.combinedRisk > blockAboveRisk) {
        finalDecision = 'BLOCK';
        finalReasons = [`REWRITE escalated to BLOCK: risk ${result.combinedRisk.toFixed(3)} exceeds blockAboveRisk ${blockAboveRisk}`, ...finalReasons];
      }

      return {
        decision: finalDecision,
        risk: result.combinedRisk,
        reasons: finalReasons,
        consensus: result.meta || null,
        boardResolution: true,
        _boardResult: result,
      };
    }

    // No agent verdicts — standalone guard (guard-only or guard-before-agents workflow)
    const consensus = evaluateViaConsensusTools({
      runId: ids.runId,
      boardId: ids.boardId,
      guardType,
      payload: { input: context, guardConfig: node.config || {} },
      policyPack: String(node.config?.policyPack || '')
    });

    const guardDecisionVal = consensus.decision === 'ALLOW' ? 'ALLOW' : consensus.decision === 'BLOCK' ? 'BLOCK' : 'REWRITE';
    const guardRisk = Number(consensus.risk_score ?? 0.6);

    return {
      decision: guardDecisionVal,
      risk: guardRisk,
      reasons: [consensus.reason],
      consensus: consensus.meta || null,
      boardResolution: false,
    };
  }

  if (node.type === 'hitl') {
    const guardDecision = Object.values(context).find((v: any) => v?.decision && v?.risk !== undefined) as any;
    const risk = Number(guardDecision?.risk ?? 0.5);
    const decision = String(guardDecision?.decision || '');
    const threshold = Number(node.config?.threshold ?? 0.7);

    // Always trigger HITL for REWRITE or BLOCK decisions regardless of threshold
    // Only skip if risk is below threshold AND decision is not REWRITE/BLOCK
    if (risk < threshold && decision !== 'REWRITE' && decision !== 'BLOCK') {
      return { pause: false, skipped: true, risk, threshold, decision };
    }

    const boardParticipants = listParticipants(ids.boardId) as any[];
    const chatLinkedParticipants = boardParticipants
      .filter((p: any) => {
        const meta = typeof p.metadata_json === 'string' ? JSON.parse(p.metadata_json) : (p.metadata_json || {});
        return meta.chatAdapter && meta.chatHandle;
      })
      .map((p: any) => {
        const meta = typeof p.metadata_json === 'string' ? JSON.parse(p.metadata_json) : (p.metadata_json || {});
        return { subjectId: p.subject_id, adapter: meta.chatAdapter, handle: meta.chatHandle };
      });

    const promptMode = node.config?.promptMode || 'yes-no';
    const timeoutSec = Number(node.config?.timeoutSec ?? 900);
    const requiredVotes = Number(node.config?.requiredVotes ?? 1);
    const isVoteMode = promptMode === 'vote';
    const autoDecisionOnExpiry = node.config?.autoDecisionOnExpiry || 'BLOCK';

    const prompt: ChatPrompt = {
      boardId: ids.boardId,
      runId: ids.runId,
      quorum: 0.7,
      risk,
      threshold,
      promptMode,
      timeoutSec,
      requiredVotes: isVoteMode ? requiredVotes : 1,
      approverHint: node.config?.approver || 'human',
      chatTargets: chatLinkedParticipants.length > 0 ? chatLinkedParticipants : undefined
    };

    await sendHumanApprovalPrompt(prompt);

    // Register with the HITL timeout tracker for deadline warnings and auto-expiry
    registerPendingApproval({
      runId: ids.runId,
      boardId: ids.boardId,
      workflowId: ids.workflowId,
      prompt,
      timeoutSec,
      requiredVotes: isVoteMode ? requiredVotes : 1,
      mode: isVoteMode ? 'vote' : 'approval',
      autoDecisionOnExpiry,
    });

    return { pause: true, risk, threshold, promptMode, timeoutSec, requiredVotes, chatTargets: chatLinkedParticipants };
  }

  if (node.type === 'group') {
    const children = Array.isArray(node.config?.children) ? node.config.children : [];
    if (!children.length) return { ok: true, group: true, children: [] };

    const childResults = await Promise.all(
      children.map((child: any) => executeNode(child, context, ids))
    );

    const merged: Record<string, any> = {};
    let hasPause = false;
    let pauseDetails: any = null;
    for (let i = 0; i < children.length; i++) {
      merged[children[i].id] = childResults[i];
      context[children[i].id] = childResults[i];
      if (childResults[i]?.pause === true) {
        hasPause = true;
        pauseDetails = { childId: children[i].id, childType: children[i].type, ...childResults[i] };
      }
    }

    if (hasPause) {
      return { pause: true, group: true, children: children.map((c: any) => c.id), results: merged, pauseDetails };
    }

    return { ok: true, group: true, children: children.map((c: any) => c.id), results: merged };
  }

  if (node.type === 'action') {
    return { ok: true, action: node.config?.action || 'noop', inputKeys: Object.keys(context) };
  }

  return { ok: true };
}

function parseParticipantMetadata(p: any): Record<string, any> {
  try {
    return JSON.parse(p.metadata_json || '{}');
  } catch {
    return {};
  }
}

async function resolvePersonas(boardId: string, agentCount: number, personaMode: string, personaNamesRaw: string): Promise<AgentPersona[]> {
  const personas: AgentPersona[] = [];

  if (personaMode === 'manual' && personaNamesRaw.trim()) {
    const names = personaNamesRaw.split(',').map((n) => n.trim()).filter(Boolean);
    const existing = listParticipants(boardId) as any[];
    for (let i = 0; i < agentCount; i++) {
      const name = names[i % names.length];
      let participant = existing.find((p: any) => p.subject_id === name);
      if (!participant) {
        participant = createParticipant({ boardId, subjectType: 'agent', subjectId: name, role: 'reviewer', weight: 1, reputation: 100 });
      }
      const meta = parseParticipantMetadata(participant);
      personas.push({
        name,
        reputation: Number(participant?.reputation ?? 100),
        weight: Number(participant?.weight ?? 1),
        systemPrompt: meta.systemPrompt || undefined,
        model: meta.model || undefined,
        temperature: meta.temperature !== undefined ? Number(meta.temperature) : undefined,
      });
    }
  } else {
    const existing = listParticipants(boardId) as any[];
    const internalAgents = existing.filter((p: any) => {
      if (p.subject_type !== 'agent') return false;
      const meta = parseParticipantMetadata(p);
      return meta.agentType === 'internal' || !meta.agentType;
    });
    for (let i = 0; i < agentCount; i++) {
      if (i < internalAgents.length) {
        const p = internalAgents[i];
        const meta = parseParticipantMetadata(p);
        personas.push({
          name: p.subject_id,
          reputation: Number(p.reputation ?? 100),
          weight: Number(p.weight ?? 1),
          systemPrompt: meta.systemPrompt || undefined,
          model: meta.model || undefined,
          temperature: meta.temperature !== undefined ? Number(meta.temperature) : undefined,
        });
      } else {
        const archetype = REVIEWER_ARCHETYPES[i % REVIEWER_ARCHETYPES.length];
        const alreadyExists = existing.find((p: any) => p.subject_id === archetype);
        if (!alreadyExists) {
          createParticipant({ boardId, subjectType: 'agent', subjectId: archetype, role: 'reviewer', weight: 1, reputation: 100 });
        }
        personas.push({ name: archetype, reputation: Number(alreadyExists?.reputation ?? 100), weight: Number(alreadyExists?.weight ?? 1) });
      }
    }
  }

  return personas;
}

/**
 * After a board resolution, sync participant reputation from the consensus-tools ledger.
 * This reads the ledger file and updates each agent's reputation in our DB.
 * Weight (manual override) is left untouched.
 */
function syncReputationFromLedger(boardId: string, verdicts: AgentVerdict[]) {
  try {
    const participants = listParticipants(boardId) as any[];
    const agentNames = new Set(verdicts.map(v => v.evaluator));

    for (const name of agentNames) {
      const participant = participants.find((p: any) => p.subject_id === name);
      if (!participant) continue;

      const ledgerRep = computeReputationFromLedger(undefined, name);
      if (ledgerRep !== Number(participant.reputation)) {
        updateParticipant(participant.id, { reputation: ledgerRep });
      }
    }
  } catch (e: any) {
    console.warn(`[runner] Failed to sync reputation from ledger: ${e?.message?.split('\\n')[0]}`);
  }
}
