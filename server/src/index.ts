import express from 'express';
import { z } from 'zod';
import { EvaluateInputSchema, GuardEvaluateRequestSchema, HumanApprovalRequestSchema } from '@local-mcp-board/shared';
import { aggregateVotes, connectAgent, createBoard, createParticipant, createWorkflow, db, deleteParticipant, getAgentByApiKey, getBoard, getPolicyAssignment, getRun, getWorkflow, getWorkflowRunByRunId, listAgents, listBoards, listEvents, listParticipants, listRuns, listWorkflowRunsDetailed, listWorkflows, searchEvents, submitVote, updateParticipant, updateWorkflow, upsertPolicyAssignment, type WorkflowRecord } from './db/store.js';
import { err, toHttpStatus } from './utils/errors.js';
import { invokeTool, listToolNames } from './tools/registry.js';
import { guardEvaluatePost } from './api/guard.evaluate.post.js';
import { humanApprovePost } from './api/human.approve.post.js';
import { resumeWorkflow, runWorkflow } from './workflows/runner.js';
import { upsertCredential, listCredentials, deleteCredential, getProviderStatus, getCredential } from './db/credentials.js';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import path from 'node:path';

const app = express();
const verbose = process.env.VERBOSE === '1' || process.argv.includes('--verbose');

const TEMPLATE_1 = {
  boardId: 'workflow-system',
  nodes: [
    { id: 'trigger-github-pr', type: 'trigger', label: 'GitHub PR Opened', config: { source: 'github.pr.opened', repo: '', branch: 'main' } },
    { id: 'guard-code-merge', type: 'guard', label: 'Code Merge Guard', config: { guardType: 'code_merge', quorum: 0.6, riskThreshold: 0.7, hitlThreshold: 0.6, numberOfReviewers: 3, policyPack: 'merge-default' } },
    { id: 'parallel-review', type: 'group', label: 'Parallel Review', config: { children: [
      { id: 'agent-1', type: 'agent', label: 'Security Reviewer', config: { agentCount: 1, personaMode: 'manual', personaNames: 'security-reviewer', model: 'gpt-4o-mini' } },
      { id: 'agent-2', type: 'agent', label: 'Performance Analyst', config: { agentCount: 1, personaMode: 'manual', personaNames: 'performance-analyst', model: 'gpt-4o-mini' } },
      { id: 'agent-3', type: 'agent', label: 'Code Quality', config: { agentCount: 1, personaMode: 'manual', personaNames: 'code-quality-reviewer', model: 'gpt-4o-mini' } }
    ] } },
    { id: 'hitl-final-yes-no', type: 'hitl', label: 'Slack Final Execute Y/N', config: { channel: 'slack', mode: 'yes-no', threshold: 0.5 } },
    { id: 'action-merge-pr', type: 'action', label: 'Merge PR', config: { action: 'github.merge_pr', requireGuardPass: true, requireFinalHitlYes: true, idempotencyKeyFrom: 'pr.sha' } }
  ]
};

function validateWorkflowDefinition(definition: any) {
  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  if (!nodes.length) return 'Workflow must include at least one node';
  if (nodes[0]?.type !== 'trigger') return 'First node must be a trigger';

  const allowedNext: Record<string, string[]> = {
    trigger: ['agent', 'guard', 'action', 'group'],
    agent: ['agent', 'guard', 'hitl', 'action', 'group'],
    guard: ['agent', 'guard', 'hitl', 'action', 'group'],
    hitl: ['agent', 'guard', 'hitl', 'action', 'group'],
    action: ['agent', 'guard', 'hitl', 'action', 'group'],
    group: ['agent', 'guard', 'hitl', 'action', 'group']
  };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] || {};
    const t = node.type;
    const c = node.config || {};

    if (!['trigger', 'agent', 'guard', 'hitl', 'action', 'group'].includes(t)) {
      return `Invalid node type at index ${i}: ${String(t)}`;
    }

    if (t === 'trigger') {
      const source = String(c.source || c.mode || 'manual');
      if (source.startsWith('github.')) {
        if (!String(c.repo || '').includes('/')) return `Trigger index ${i}: github source requires repo in owner/repo format`;
      }
      if (source === 'chat.command' || source === 'chat.message' || source === 'chat.mention') {
        const channel = String(c.channel || '');
        const validChannels = ['slack', 'discord', 'telegram', 'whatsapp', 'signal', 'googlechat', 'irc', 'imessage'];
        if (!validChannels.includes(channel)) return `Trigger index ${i}: invalid chat channel '${channel}'`;
        if (source === 'chat.command' && !String(c.matchText || '').trim()) return `Trigger index ${i}: chat.command requires matchText`;
      }
    }

    if (t === 'guard') {
      const q = Number(c.quorum ?? 0.7);
      if (Number.isNaN(q) || q < 0 || q > 1) return `Guard index ${i}: quorum must be between 0 and 1`;
      const r = Number(c.riskThreshold ?? 0.7);
      if (Number.isNaN(r) || r < 0 || r > 1) return `Guard index ${i}: riskThreshold must be between 0 and 1`;
      if (c.policyBinding && !['explicit', 'auto'].includes(String(c.policyBinding))) return `Guard index ${i}: policyBinding must be explicit or auto`;
    }

    if (t === 'hitl') {
      // HITL channel and requiredVotes are now managed via participants or not needed
    }

    if (t === 'action') {
      if (!String(c.action || '').trim()) return `Action index ${i}: action is required`;
    }

    if (t === 'group') {
      const children = Array.isArray(c.children) ? c.children : [];
      if (!children.length) return `Group index ${i}: must have at least one child node`;
      for (let j = 0; j < children.length; j++) {
        const child = children[j] || {};
        const ct = child.type;
        if (!['agent', 'guard', 'hitl', 'action'].includes(ct)) {
          return `Group index ${i}, child ${j}: invalid type ${String(ct)}`;
        }
      }
    }
  }

  for (let i = 0; i < nodes.length - 1; i++) {
    const cur = nodes[i]?.type;
    const nxt = nodes[i + 1]?.type;
    if (!allowedNext[cur]?.includes(nxt)) {
      return `Invalid node order: ${cur} cannot connect to ${nxt} at index ${i}`;
    }
  }
  return null;
}

// CORS for local web dev
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use((req, res, next) => {
  if (req.path === '/api/webhooks/github') {
    express.raw({ type: 'application/json', limit: '1mb' })(req, res, next);
  } else {
    express.json({ limit: '1mb' })(req, res, next);
  }
});

// Verbose request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (!verbose) return;
    const ms = Date.now() - start;
    const bodyPreview = req.body && Object.keys(req.body).length ? JSON.stringify(req.body).slice(0, 400) : '';
    console.log(`[api] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms${bodyPreview ? ` body=${bodyPreview}` : ''}`);
  });
  next();
});

app.get('/api/mcp/tools', (_req, res) => res.json({ tools: listToolNames() }));

app.get('/api/mcp/boards', (_req, res) => res.json({ boards: listBoards() }));
app.post('/api/mcp/boards', (req, res) => {
  try {
    const body = z.object({ name: z.string().default('default') }).parse(req.body || {});
    res.json({ board: createBoard(body.name) });
  } catch (e: any) {
    res.status(400).json(err('INVALID_INPUT', 'Invalid board payload', e?.message));
  }
});
app.get('/api/mcp/boards/:id', (req, res) => {
  const board = getBoard(req.params.id);
  if (!board) return res.status(404).json(err('BOARD_NOT_FOUND', 'Board not found'));
  res.json({ board, runs: listRuns(req.params.id, 100) });
});

app.get('/api/mcp/runs/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json(err('RUN_NOT_FOUND', 'Run not found'));
  res.json({ run, events: listEvents({ runId: req.params.id, limit: 500 }) });
});

// Agent connect + participation APIs
app.post('/api/agents/connect', (req, res) => {
  try {
    const body = z.object({ name: z.string().min(1), scopes: z.array(z.string()).optional(), boards: z.array(z.string()).optional(), workflows: z.array(z.string()).optional() }).parse(req.body || {});
    res.json({ agent: connectAgent(body) });
  } catch (e: any) {
    res.status(400).json(err('INVALID_INPUT', 'Invalid agent connect payload', e?.message));
  }
});

app.get('/api/agents', (_req, res) => {
  res.json({ agents: listAgents() });
});

app.post('/api/participants', (req, res) => {
  try {
    const body = z.object({ boardId: z.string().min(1), subjectType: z.enum(['agent', 'human']), subjectId: z.string().min(1), role: z.string().optional(), weight: z.number().optional(), reputation: z.number().optional(), metadata: z.record(z.any()).optional() }).parse(req.body || {});
    res.json({ participant: createParticipant(body as any) });
  } catch (e: any) {
    res.status(400).json(err('INVALID_INPUT', 'Invalid participant payload', e?.message));
  }
});

app.get('/api/participants', (req, res) => {
  const boardId = String(req.query.boardId || '');
  if (!boardId) return res.status(400).json(err('INVALID_INPUT', 'boardId is required'));
  res.json({ participants: listParticipants(boardId) });
});

app.patch('/api/participants/:id', (req, res) => {
  try {
    const body = z.object({
      reputation: z.number().min(0).max(1).optional(),
      weight: z.number().min(0).max(100).optional(),
      role: z.string().optional(),
      status: z.enum(['active', 'disabled']).optional(),
      metadata: z.record(z.any()).optional()
    }).parse(req.body || {});
    const participant = updateParticipant(req.params.id, body);
    if (!participant) return res.status(404).json(err('PARTICIPANT_NOT_FOUND', 'Participant not found'));
    res.json({ participant });
  } catch (e: any) {
    res.status(400).json(err('INVALID_INPUT', 'Invalid participant update payload', e?.message));
  }
});

app.delete('/api/participants/:id', (req, res) => {
  try {
    const success = deleteParticipant(req.params.id);
    if (!success) return res.status(404).json(err('PARTICIPANT_NOT_FOUND', 'Participant not found'));
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json(err('DELETE_FAILED', 'Failed to delete participant', e?.message));
  }
});

app.post('/api/policies/assign', (req, res) => {
  try {
    const body = z.object({ boardId: z.string().min(1), policyId: z.string().min(1), participants: z.array(z.string()), weightingMode: z.enum(['static', 'reputation', 'hybrid']).default('hybrid'), quorum: z.number().min(0).max(1) }).parse(req.body || {});
    res.json({ assignment: upsertPolicyAssignment(body) });
  } catch (e: any) {
    res.status(400).json(err('INVALID_INPUT', 'Invalid policy assignment payload', e?.message));
  }
});

app.get('/api/policies/:boardId/:policyId', (req, res) => {
  const assignment = getPolicyAssignment(req.params.boardId, req.params.policyId);
  if (!assignment) return res.status(404).json(err('POLICY_NOT_FOUND', 'Policy assignment not found'));
  res.json({ assignment });
});

app.post('/api/votes', (req, res) => {
  try {
    const body = z.object({ boardId: z.string().min(1), runId: z.string().min(1), participantId: z.string().min(1), decision: z.enum(['YES', 'NO', 'REWRITE']), confidence: z.number().min(0).max(1), rationale: z.string().min(1), idempotencyKey: z.string().min(1) }).parse(req.body || {});
    const v = submitVote(body as any);
    const run = getRun(body.runId) as any;
    const policyId = (run?.meta_json ? JSON.parse(String(run.meta_json)).policy_id : null) || 'default';
    const policy = getPolicyAssignment(body.boardId, policyId);
    const quorum = Number(policy?.quorum ?? 0.6);
    const agg = aggregateVotes(body.runId, quorum);
    res.json({ vote: v, aggregate: agg });
  } catch (e: any) {
    res.status(400).json(err('INVALID_INPUT', 'Invalid vote payload', e?.message));
  }
});

app.post('/api/agent/trigger', async (req, res) => {
  try {
    const key = String(req.headers['x-agent-key'] || '');
    const agent = key ? getAgentByApiKey(key) : null;
    if (!agent) return res.status(401).json(err('UNAUTHORIZED', 'Invalid or missing x-agent-key'));

    const scopes: string[] = JSON.parse(String(agent.scopes_json || '[]'));
    const boards: string[] = JSON.parse(String(agent.boards_json || '[]'));
    const workflows: string[] = JSON.parse(String(agent.workflows_json || '[]'));

    const body = z.object({ workflowId: z.string().optional(), boardId: z.string().optional(), tool: z.string().optional(), input: z.any().optional() }).parse(req.body || {});

    if (body.workflowId) {
      if (!scopes.includes('workflow.run')) return res.status(403).json(err('FORBIDDEN', 'Missing scope workflow.run'));
      if (workflows.length && !workflows.includes(body.workflowId)) return res.status(403).json(err('FORBIDDEN', 'Workflow not in agent allowlist'));
      const wf = getWorkflow(body.workflowId);
      if (!wf) return res.status(404).json(err('WORKFLOW_NOT_FOUND', 'Workflow not found'));
      const definition = JSON.parse(wf.definition_json || '{}');
      const wfBoard = String(definition?.boardId || 'workflow-system');
      if (boards.length && !boards.includes(wfBoard)) return res.status(403).json(err('FORBIDDEN', 'Board not in agent allowlist'));
      const out = await runWorkflow(definition, wf.id);
      return res.json({ ok: true, via: 'workflow', agent: { id: agent.id, name: agent.name }, ...out });
    }

    if (body.tool) {
      if (!(scopes.includes(body.tool) || scopes.includes('tool.*'))) return res.status(403).json(err('FORBIDDEN', `Missing scope ${body.tool}`));
      if (body.boardId && boards.length && !boards.includes(body.boardId)) return res.status(403).json(err('FORBIDDEN', 'Board not in agent allowlist'));
      const out = await invokeTool(body.tool as any, body.input ?? {});
      return res.json({ ok: true, via: 'tool', agent: { id: agent.id, name: agent.name }, out });
    }

    return res.status(400).json(err('INVALID_INPUT', 'Provide workflowId or tool'));
  } catch (e: any) {
    res.status(500).json(err('AGENT_TRIGGER_FAILED', 'Agent trigger failed', e?.message));
  }
});

app.get('/api/workflows', (_req, res) => {
  const existing = listWorkflows();
  if (!existing.length) {
    createWorkflow('Template 1 - GitHub PR Merge Guard', TEMPLATE_1 as any);
  }
  res.json({ workflows: listWorkflows() });
});

app.post('/api/workflows', (req, res) => {
  try {
    const body = z.object({ name: z.string().min(1), definition: z.record(z.any()).default({}) }).parse(req.body || {});
    const validationError = validateWorkflowDefinition(body.definition);
    if (validationError) return res.status(400).json(err('INVALID_WORKFLOW', validationError));
    res.json({ workflow: createWorkflow(body.name, body.definition) });
  } catch (e: any) {
    res.status(400).json(err('INVALID_INPUT', 'Invalid workflow payload', e?.message));
  }
});

app.get('/api/workflows/:id', (req, res) => {
  const workflow = getWorkflow(req.params.id);
  if (!workflow) return res.status(404).json(err('WORKFLOW_NOT_FOUND', 'Workflow not found'));
  res.json({ workflow, runs: listWorkflowRunsDetailed(req.params.id, 200) });
});

app.put('/api/workflows/:id', (req, res) => {
  try {
    const body = z.object({ name: z.string().optional(), definition: z.record(z.any()).optional() }).parse(req.body || {});
    if (body.definition) {
      const validationError = validateWorkflowDefinition(body.definition);
      if (validationError) return res.status(400).json(err('INVALID_WORKFLOW', validationError));
    }
    const workflow = updateWorkflow(req.params.id, body);
    if (!workflow) return res.status(404).json(err('WORKFLOW_NOT_FOUND', 'Workflow not found'));
    res.json({ workflow });
  } catch (e: any) {
    res.status(400).json(err('INVALID_INPUT', 'Invalid workflow update', e?.message));
  }
});

app.post('/api/workflows/:id/run', async (req, res) => {
  try {
    const workflow = getWorkflow(req.params.id);
    if (!workflow) return res.status(404).json(err('WORKFLOW_NOT_FOUND', 'Workflow not found'));
    const definition = JSON.parse(workflow.definition_json || '{}');
    const validationError = validateWorkflowDefinition(definition);
    if (validationError) return res.status(400).json(err('INVALID_WORKFLOW', validationError));
    const out = await runWorkflow(definition, workflow.id);
    res.json({ ok: true, workflowId: workflow.id, ...out });
  } catch (e: any) {
    res.status(500).json(err('WORKFLOW_RUN_FAILED', 'Failed to run workflow', e?.message));
  }
});

app.post('/api/workflow-runs/:runId/approve', async (req, res) => {
  try {
    const body = z.object({ decision: z.enum(['YES', 'NO', 'REWRITE']), approver: z.string().default('human') }).parse(req.body || {});
    const wr = getWorkflowRunByRunId(req.params.runId);
    if (!wr) return res.status(404).json(err('WORKFLOW_RUN_NOT_FOUND', 'Workflow run not found'));
    const workflow = getWorkflow(wr.workflow_id);
    if (!workflow) return res.status(404).json(err('WORKFLOW_NOT_FOUND', 'Workflow not found'));
    const definition = JSON.parse(workflow.definition_json || '{}');
    const out = await resumeWorkflow(definition, workflow.id, req.params.runId, body.decision, body.approver);
    res.json({ ok: true, workflowId: workflow.id, ...out });
  } catch (e: any) {
    res.status(500).json(err('WORKFLOW_RESUME_FAILED', 'Failed to resume workflow', e?.message));
  }
});

app.get('/api/mcp/events', (req, res) => {
  try {
    const q = z.object({ boardId: z.string().optional(), runId: z.string().optional(), type: z.string().optional(), limit: z.coerce.number().optional() }).parse(req.query);
    res.json({ events: listEvents({ ...q, limit: q.limit || 100 }) });
  } catch (e: any) {
    res.status(400).json(err('INVALID_QUERY', 'Invalid query params', e?.message));
  }
});

app.post('/api/mcp/evaluate', async (req, res) => {
  try {
    const parsed = EvaluateInputSchema.parse(req.body);
    const r = await invokeTool('guard.evaluate', parsed);
    res.json(r);
  } catch (e: any) {
    const code = e?.name === 'ZodError' ? 'INVALID_INPUT' : 'EVALUATE_FAILED';
    res.status(toHttpStatus(code)).json(err(code, 'Failed to evaluate action', e?.message));
  }
});

app.post('/api/guard.evaluate', async (req, res) => {
  try {
    const parsed = GuardEvaluateRequestSchema.parse(req.body);
    res.json(await guardEvaluatePost(parsed));
  } catch (e: any) {
    const code = e?.name === 'ZodError' ? 'INVALID_INPUT' : 'EVALUATE_FAILED';
    res.status(toHttpStatus(code)).json(err(code, 'Failed to start guard workflow', e?.message));
  }
});

app.post('/api/human.approve', async (req, res) => {
  try {
    const parsed = HumanApprovalRequestSchema.parse(req.body);
    res.json(await humanApprovePost(parsed));
  } catch (e: any) {
    const code = e?.name === 'ZodError' ? 'INVALID_INPUT' : 'HUMAN_APPROVE_FAILED';
    res.status(toHttpStatus(code)).json(err(code, 'Failed to capture human approval', e?.message));
  }
});

// Chat inbound endpoint for HITL replies (e.g., webhook from chat surface)
app.post('/api/chat/hitl-reply', async (req, res) => {
  try {
    const body = z.object({
      runId: z.string(),
      replyText: z.string(),
      approver: z.string().default('human'),
      idempotencyKey: z.string().optional(),
      boardId: z.string().optional()
    }).parse(req.body ?? {});

    const out = await humanApprovePost({
      runId: body.runId,
      replyText: body.replyText,
      approver: body.approver,
      idempotencyKey: body.idempotencyKey ?? `${body.runId}:${Date.now()}`,
      boardId: body.boardId
    });
    res.json(out);
  } catch (e: any) {
    const code = e?.name === 'ZodError' ? 'INVALID_INPUT' : 'HUMAN_APPROVE_FAILED';
    res.status(toHttpStatus(code)).json(err(code, 'Failed to process HITL reply', e?.message));
  }
});

app.get('/api/mcp/audit/search', (req, res) => {
  try {
    const q = z.object({ query: z.string().default(''), limit: z.coerce.number().optional() }).parse(req.query);
    res.json({ events: searchEvents(q.query, q.limit || 100) });
  } catch (e: any) {
    res.status(400).json(err('INVALID_QUERY', 'Invalid search query', e?.message));
  }
});

app.post('/api/mcp/tool/:name', async (req, res) => {
  try {
    const out = await invokeTool(req.params.name as any, req.body ?? {});
    res.json(out);
  } catch (e: any) {
    const code = e?.name === 'ZodError' ? 'INVALID_INPUT' : 'TOOL_CALL_FAILED';
    res.status(toHttpStatus(code)).json(err(code, `Tool failed: ${req.params.name}`, e?.message));
  }
});

// ── Reputation & Slashing Settings API ──

const DEFAULT_REPUTATION_CONFIG = {
  faucet: {
    initialReputation: 0.5,
    minReputation: 0.0,
    maxReputation: 1.0,
    dripAmount: 0.02,
    dripTrigger: 'consensus_match',
    decayRate: 0.01,
    decayInterval: 'per_round',
  },
  slashing: {
    enabled: true,
    rules: [
      { id: 'consensus_disagree', label: 'Consensus Disagreement', description: 'Agent voted opposite to final consensus outcome', penalty: 0.05, enabled: true },
      { id: 'low_confidence_wrong', label: 'Low Confidence + Wrong', description: 'Agent had low confidence (<0.3) and voted incorrectly', penalty: 0.08, enabled: true },
      { id: 'high_risk_miss', label: 'High Risk Miss', description: 'Agent marked low risk on a payload that was blocked', penalty: 0.10, enabled: true },
      { id: 'timeout', label: 'Response Timeout', description: 'Agent failed to respond within the allotted time', penalty: 0.03, enabled: false },
      { id: 'repeated_rewrite', label: 'Repeated Rewrite', description: 'Agent requested rewrite 3+ times in a row', penalty: 0.04, enabled: false },
    ],
  },
  persona: {
    archetypeBonus: 0.05,
    diversityWeight: 0.1,
    minPersonasForBonus: 3,
  },
};

function getReputationConfig(): typeof DEFAULT_REPUTATION_CONFIG {
  db.exec("CREATE TABLE IF NOT EXISTS _internal_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const row = db.prepare("SELECT value FROM _internal_config WHERE key = 'reputation_config'").get() as { value: string } | undefined;
  if (row) {
    try {
      const stored = JSON.parse(row.value);
      const storedRules = Array.isArray(stored.slashing?.rules) ? stored.slashing.rules : [];
      const mergedRules = DEFAULT_REPUTATION_CONFIG.slashing.rules.map(defaultRule => {
        const override = storedRules.find((r: any) => r.id === defaultRule.id);
        return override ? { ...defaultRule, ...override } : defaultRule;
      });
      return {
        faucet: { ...DEFAULT_REPUTATION_CONFIG.faucet, ...(stored.faucet || {}) },
        slashing: {
          enabled: stored.slashing?.enabled ?? DEFAULT_REPUTATION_CONFIG.slashing.enabled,
          rules: mergedRules,
        },
        persona: { ...DEFAULT_REPUTATION_CONFIG.persona, ...(stored.persona || {}) },
      };
    } catch {
      return DEFAULT_REPUTATION_CONFIG;
    }
  }
  return DEFAULT_REPUTATION_CONFIG;
}

function saveReputationConfig(config: any) {
  db.exec("CREATE TABLE IF NOT EXISTS _internal_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const existing = db.prepare("SELECT key FROM _internal_config WHERE key = 'reputation_config'").get();
  const json = JSON.stringify(config);
  if (existing) {
    db.prepare("UPDATE _internal_config SET value = ? WHERE key = 'reputation_config'").run(json);
  } else {
    db.prepare("INSERT INTO _internal_config(key, value) VALUES (?, ?)").run('reputation_config', json);
  }
}

app.get('/api/settings/reputation', (_req, res) => {
  try {
    res.json({ config: getReputationConfig() });
  } catch (e: any) {
    res.status(500).json(err('REPUTATION_CONFIG_FAILED', 'Failed to load reputation config', e?.message));
  }
});

app.put('/api/settings/reputation', (req, res) => {
  try {
    const current = getReputationConfig();
    const merged = { ...current, ...req.body };
    if (req.body.faucet) merged.faucet = { ...current.faucet, ...req.body.faucet };
    if (req.body.slashing) merged.slashing = { ...current.slashing, ...req.body.slashing };
    if (req.body.persona) merged.persona = { ...current.persona, ...req.body.persona };
    saveReputationConfig(merged);
    res.json({ config: merged });
  } catch (e: any) {
    res.status(400).json(err('REPUTATION_CONFIG_UPDATE_FAILED', 'Failed to update reputation config', e?.message));
  }
});

// ── Credentials Settings API ──

app.get('/api/settings/credentials', (_req, res) => {
  try {
    res.json({ credentials: listCredentials(db) });
  } catch (e: any) {
    res.status(500).json(err('CREDENTIALS_LIST_FAILED', 'Failed to list credentials', e?.message));
  }
});

app.post('/api/settings/credentials', (req, res) => {
  try {
    const body = z.object({
      provider: z.string().min(1),
      keyName: z.string().min(1),
      value: z.string().min(1)
    }).parse(req.body || {});
    const result = upsertCredential(db, body.provider, body.keyName, body.value);
    res.json({ ok: true, ...result });
  } catch (e: any) {
    const code = e?.name === 'ZodError' ? 'INVALID_INPUT' : 'CREDENTIALS_UPSERT_FAILED';
    res.status(toHttpStatus(code)).json(err(code, 'Failed to save credential', e?.message));
  }
});

app.delete('/api/settings/credentials/:provider/:keyName', (req, res) => {
  try {
    const deleted = deleteCredential(db, req.params.provider, req.params.keyName);
    if (!deleted) return res.status(404).json(err('CREDENTIAL_NOT_FOUND', 'Credential not found'));
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json(err('CREDENTIALS_DELETE_FAILED', 'Failed to delete credential', e?.message));
  }
});

app.get('/api/settings/credentials/:provider/status', (req, res) => {
  try {
    res.json({ provider: req.params.provider, configured: getProviderStatus(db, req.params.provider) });
  } catch (e: any) {
    res.status(500).json(err('CREDENTIALS_STATUS_FAILED', 'Failed to get provider status', e?.message));
  }
});

// ── Chat Adapter Management ──

const VALID_ADAPTERS: Record<string, string> = {
  slack: '@chat-adapter/slack',
  teams: '@chat-adapter/teams',
  gchat: '@chat-adapter/gchat',
  discord: '@chat-adapter/discord',
  telegram: '@chat-adapter/telegram',
};

function getInstalledAdapters(): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  for (const [id, pkg] of Object.entries(VALID_ADAPTERS)) {
    try {
      require.resolve(pkg);
      status[id] = true;
    } catch {
      const cred = getCredential(db, 'adapter', id);
      status[id] = cred === 'installed';
    }
  }
  return status;
}

app.get('/api/settings/adapters', (_req, res) => {
  try {
    res.json({ adapters: getInstalledAdapters() });
  } catch (e: any) {
    res.status(500).json(err('ADAPTERS_LIST_FAILED', 'Failed to list adapters', e?.message));
  }
});

app.post('/api/settings/adapters/install', async (req, res) => {
  try {
    const body = z.object({ adapter: z.string().min(1) }).parse(req.body || {});
    console.log(`[adapter] Request to install: ${body.adapter}`);
    const pkg = VALID_ADAPTERS[body.adapter];
    if (!pkg) {
      console.error(`[adapter] Unknown adapter: ${body.adapter}`);
      return res.status(400).json(err('INVALID_ADAPTER', `Unknown adapter: ${body.adapter}. Valid: ${Object.keys(VALID_ADAPTERS).join(', ')}`));
    }

    const rootDir = path.resolve(process.cwd()); // Changed to current directory to ensure it installs in server's node_modules if needed, or check workspace root
    console.log(`[adapter] Installing ${pkg} in ${rootDir}...`);
    
    let installOutput = '';
    let installed = false;
    try {
      // Use --no-save to avoid modifying package.json in dev-only iteration if desired, or just install
      installOutput = execSync(`npm install chat ${pkg} 2>&1`, { cwd: rootDir, timeout: 90000, encoding: 'utf8' });
      console.log(`[adapter] Install output: ${installOutput}`);
      installed = true;
    } catch (e: any) {
      installOutput = e?.stdout || e?.stderr || e?.message || 'Install failed';
      console.error(`[adapter] Install failed: ${installOutput}`);
      installed = false;
    }

    upsertCredential(db, 'adapter', body.adapter, installed ? 'installed' : 'failed');

    res.json({
      ok: true,
      adapter: body.adapter,
      package: pkg,
      installed,
      output: installOutput.slice(0, 2000),
    });
  } catch (e: any) {
    console.error(`[adapter] Critical error:`, e);
    const code = e?.name === 'ZodError' ? 'INVALID_INPUT' : 'ADAPTER_INSTALL_FAILED';
    res.status(toHttpStatus(code)).json(err(code, 'Failed to install adapter', e?.message));
  }
});

app.post('/api/settings/adapters/uninstall', async (req, res) => {
  try {
    const body = z.object({ adapter: z.string().min(1) }).parse(req.body || {});
    const pkg = VALID_ADAPTERS[body.adapter];
    if (!pkg) return res.status(400).json(err('INVALID_ADAPTER', `Unknown adapter: ${body.adapter}`));

    const rootDir = path.resolve(process.cwd(), '..');
    try {
      execSync(`npm uninstall ${pkg} 2>&1`, { cwd: rootDir, timeout: 30000, encoding: 'utf8' });
    } catch {
    }

    deleteCredential(db, 'adapter', body.adapter);
    deleteCredential(db, body.adapter, 'bot_token');
    deleteCredential(db, body.adapter, 'webhook_url');
    deleteCredential(db, body.adapter, 'api_key');

    res.json({ ok: true, adapter: body.adapter, uninstalled: true });
  } catch (e: any) {
    const code = e?.name === 'ZodError' ? 'INVALID_INPUT' : 'ADAPTER_UNINSTALL_FAILED';
    res.status(toHttpStatus(code)).json(err(code, 'Failed to uninstall adapter', e?.message));
  }
});

// ── GitHub Webhook Receiver ──

function verifyGitHubSignature(payload: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function mapGitHubEventToSource(event: string, action?: string): string | null {
  const mapping: Record<string, string> = {
    'pull_request:opened': 'github.pr.opened',
    'pull_request:synchronize': 'github.pr.updated',
    'pull_request:closed': 'github.pr.closed',
    'push': 'github.commit',
    'issues:opened': 'github.issue.opened',
    'issues:closed': 'github.issue.closed',
    'issue_comment:created': 'github.comment.created',
  };
  const key = action ? `${event}:${action}` : event;
  return mapping[key] || mapping[event] || null;
}

app.post('/api/webhooks/github', async (req, res) => {
  try {
    const rawBody = typeof req.body === 'string' ? req.body : (Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body));
    const signature = String(req.headers['x-hub-signature-256'] || '');
    const webhookSecret = getCredential(db, 'github', 'webhook_secret');

    if (webhookSecret) {
      if (!signature) {
        return res.status(401).json(err('MISSING_SIGNATURE', 'Webhook secret is configured but no X-Hub-Signature-256 header was provided'));
      }
      if (!verifyGitHubSignature(rawBody, signature, webhookSecret)) {
        return res.status(401).json(err('INVALID_SIGNATURE', 'GitHub webhook signature verification failed'));
      }
    }

    const event = String(req.headers['x-github-event'] || '');
    const payload = typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : JSON.parse(rawBody);
    const action = payload?.action;
    const source = mapGitHubEventToSource(event, action);

    if (!source) {
      return res.status(200).json({ ok: true, matched: false, reason: `Unhandled event: ${event}${action ? ':' + action : ''}` });
    }

    const workflows = listWorkflows(1000) as WorkflowRecord[];
    const matched: Array<{ workflowId: string; runId?: string }> = [];

    for (const wf of workflows) {
      try {
        const definition = JSON.parse(wf.definition_json || '{}');
        const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
        const triggerNode = nodes[0];
        if (!triggerNode || triggerNode.type !== 'trigger') continue;
        const triggerSource = triggerNode.config?.source;
        if (triggerSource !== source) continue;

        const out = await runWorkflow(definition, wf.id);
        matched.push({ workflowId: wf.id, runId: out?.runId });
      } catch (e: any) {
        console.error(`[webhook] Failed to run workflow ${wf.id}:`, e?.message);
        matched.push({ workflowId: wf.id });
      }
    }

    res.json({ ok: true, event, source, matched });
  } catch (e: any) {
    res.status(500).json(err('WEBHOOK_FAILED', 'Failed to process GitHub webhook', e?.message));
  }
});

app.listen(4010, '127.0.0.1', () => console.log('local-mcp-board server on http://127.0.0.1:4010'));
