import express from 'express';
import { z } from 'zod';
import { EvaluateInputSchema, GuardEvaluateRequestSchema, HumanApprovalRequestSchema } from '@local-mcp-board/shared';
import { aggregateVotes, connectAgent, createBoard, createParticipant, createWorkflow, db, deleteParticipant, deleteEvents, deleteWorkflow, getAgentByApiKey, getBoard, getPolicyAssignment, getRun, getWorkflow, getWorkflowRunByRunId, listAgents, listBoards, listDistinctRunIds, listEvents, listParticipants, listRuns, listWorkflowRunsDetailed, listWorkflows, searchEvents, submitVote, updateParticipant, updateWorkflow, upsertPolicyAssignment, type WorkflowRecord } from './db/store.js';
import { err, toHttpStatus } from './utils/errors.js';
import { invokeTool, listToolNames } from './tools/registry.js';
import { guardEvaluatePost } from './api/guard.evaluate.post.js';
import { humanApprovePost } from './api/human.approve.post.js';
import { resumeWorkflow, runWorkflow } from './workflows/runner.js';
import { upsertCredential, listCredentials, deleteCredential, getProviderStatus, getCredential } from './db/credentials.js';
import { initCronScheduler, registerCron, unregisterCron, listCronSchedules, loadPersistedSchedules } from './engine/cron-scheduler.js';
import crypto from 'node:crypto';
import { execSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

// ── consensus-tools bootstrap ──

function findConsensusBin(): string | null {
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
  return null;
}

function runConsensusCli(bin: string, args: string[]): any {
  const cmd = bin.endsWith('.js') ? 'node' : bin;
  const cmdArgs = bin.endsWith('.js') ? [bin, ...args] : args;
  const raw = execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { return { raw: trimmed }; }
}

function bootstrapConsensusTools() {
  const bin = findConsensusBin();
  if (!bin) {
    console.log('[bootstrap] consensus-tools CLI not found — skipping auto-init');
    return;
  }

  try {
    const boardMode = runConsensusCli(bin, ['config', 'get', 'board_mode']);
    // boardMode is a JSON value: "local", "remote", or null
    const mode = typeof boardMode === 'string' ? boardMode : null;

    if (!mode || mode === 'null') {
      // Not initialized → set up with local defaults pointing at our server
      console.log('[bootstrap] consensus-tools not configured — running auto-init with local defaults...');
      runConsensusCli(bin, ['board', 'use', 'local']);
      runConsensusCli(bin, ['config', 'set', 'board_mode', 'local']);
      runConsensusCli(bin, ['config', 'set', 'api_url', 'http://127.0.0.1:4010']);
      console.log('[bootstrap] consensus-tools initialized: board_mode=local, api_url=http://127.0.0.1:4010');
    } else {
      // Already initialized → create a new board for this session
      console.log(`[bootstrap] consensus-tools already configured (mode=${mode}) — creating startup board...`);
      const board = createBoard(`session-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}`);
      console.log(`[bootstrap] Created board: ${board.id} (${board.name})`);
    }
  } catch (e: any) {
    console.warn(`[bootstrap] consensus-tools bootstrap failed (non-fatal): ${e?.message || e}`);
  }
}

const app = express();
const verbose = process.env.VERBOSE === '1' || process.argv.includes('--verbose');

const TEMPLATE_1 = {
  boardId: 'workflow-system',
  nodes: [
    { id: 'trigger-github-pr', type: 'trigger', label: 'GitHub PR Opened', config: { source: 'github.pr.opened', repo: '', branch: 'main' } },
    { id: 'parallel-review', type: 'group', label: 'Parallel Review', config: { linkedGuardId: 'guard-code-merge', children: [
      { id: 'agent-1', type: 'agent', label: 'Security Reviewer', config: { agentCount: 1, personaMode: 'manual', personaNames: 'security-reviewer', model: 'gpt-5.4' } },
      { id: 'agent-2', type: 'agent', label: 'Performance Analyst', config: { agentCount: 1, personaMode: 'manual', personaNames: 'performance-analyst', model: 'gpt-5.4' } },
      { id: 'agent-3', type: 'agent', label: 'Code Quality', config: { agentCount: 1, personaMode: 'manual', personaNames: 'code-quality-reviewer', model: 'gpt-5.4' } }
    ] } },
    { id: 'guard-code-merge', type: 'guard', label: 'Code Merge Guard', config: { guardType: 'code_merge', quorum: 0.6, riskThreshold: 0.7, hitlThreshold: 0.6, blockAboveRisk: 0.92, numberOfReviewers: 3, policyPack: 'merge-default' } },
    { id: 'human-approval-final-yes-no', type: 'hitl', label: 'Slack Final Execute Y/N', config: { channel: 'slack', mode: 'yes-no', threshold: 0.5 } },
    { id: 'action-merge-pr', type: 'action', label: 'Merge PR', config: { action: 'github.merge_pr', requireGuardPass: true, requireFinalHumanApprovalYes: true, idempotencyKeyFrom: 'pr.sha' } }
  ]
};

const TEMPLATE_2 = {
  boardId: 'workflow-system',
  nodes: [
    { id: 'trigger-linear-task', type: 'trigger', label: 'Linear Task Submitted', config: { source: 'linear.task.created', provider: 'linear-mcp', project: '', team: '' } },
    { id: 'parallel-decomp-review', type: 'group', label: 'Parallel Review', config: { linkedGuardId: 'guard-task-decomp', children: [
      { id: 'agent-decomp-1', type: 'agent', label: 'Task Decomposer', config: { agentCount: 1, personaMode: 'manual', personaNames: 'task-decomposer', model: 'gpt-5.4', systemPrompt: 'You are a task decomposition specialist. Given a parent task, break it into logical, non-overlapping subtasks that can each be assigned independently. Ensure subtasks are concrete, ordered, and cover all critical steps. Return your analysis as a structured vote.' } },
      { id: 'agent-decomp-2', type: 'agent', label: 'Planning Reviewer', config: { agentCount: 1, personaMode: 'manual', personaNames: 'planning-reviewer', model: 'gpt-5.4', systemPrompt: 'You are a project planning reviewer. Evaluate proposed subtask decompositions for completeness, logical ordering, independence, and clarity. Flag any missing steps, overlaps, or vague items.' } },
      { id: 'agent-decomp-3', type: 'agent', label: 'Scope Analyst', config: { agentCount: 1, personaMode: 'manual', personaNames: 'scope-analyst', model: 'gpt-5.4', systemPrompt: 'You are a scope analyst. Verify that each proposed subtask stays within the bounds of the parent task, does not introduce scope creep, and is sized appropriately for independent assignment.' } }
    ] } },
    { id: 'guard-task-decomp', type: 'guard', label: 'Task Decomposition Guard', config: {
      guardType: 'agent_action',
      quorum: 0.6,
      riskThreshold: 0.7,
      hitlThreshold: 0.6,
      blockAboveRisk: 0.92,
      numberOfReviewers: 3,
      policyPack: 'task-decomposition',
      irreversibleDefault: false,
      evaluationRubric: JSON.stringify({
        evaluation_criteria: [
          'subtasks are logically ordered',
          'subtasks do not overlap',
          'each subtask can be assigned independently',
          'no critical steps missing',
          'subtasks are concrete and understandable'
        ]
      }),
      actionType: 'task_decomposition'
    } },
    { id: 'human-approval-decomp', type: 'hitl', label: 'Human Approval (optional)', config: { channel: 'slack', mode: 'yes-no', threshold: 0.7 } },
    { id: 'action-create-plan', type: 'action', label: 'Create Linear Task Plan', config: { action: 'linear.create_subtasks', requireGuardPass: true } }
  ]
};

const TEMPLATE_3 = {
  boardId: 'workflow-system',
  nodes: [
    { id: 'trigger-cron-linear', type: 'trigger', label: 'Cron: Fetch Unassigned Subtasks', config: { source: 'cron', adapter: 'linear', cronExpression: '*/30 * * * *', team: '', project: '', memberIds: '' } },
    { id: 'parallel-assignment-review', type: 'group', label: 'Parallel Assignment Review', config: { linkedGuardId: 'guard-assignment', children: [
      { id: 'agent-skill-matcher', type: 'agent', label: 'Skill Matcher', config: { agentCount: 1, personaMode: 'manual', personaNames: 'skill-matcher', model: 'gpt-5.4', systemPrompt: 'You are a skill-matching specialist. Given unassigned subtasks and team members with their recent task history, identify which member\'s recent work shows the most relevant domain expertise for each subtask. Return a JSON array of { subtaskId, assigneeId, assigneeName, reasoning } for each subtask.' } },
      { id: 'agent-load-balancer', type: 'agent', label: 'Load Balancer', config: { agentCount: 1, personaMode: 'manual', personaNames: 'load-balancer', model: 'gpt-5.4', systemPrompt: 'You are a workload distribution analyst. Review the team members and their recent task counts. Propose assignments that distribute work evenly while respecting skill requirements. Flag any member who appears overloaded. Return a JSON array of { subtaskId, assigneeId, assigneeName, reasoning }.' } },
      { id: 'agent-priority-analyst', type: 'agent', label: 'Priority Analyst', config: { agentCount: 1, personaMode: 'manual', personaNames: 'priority-analyst', model: 'gpt-5.4', systemPrompt: 'You are a task priority analyst. Ensure high-priority subtasks are assigned to the most capable and available members based on their recent work quality and availability. Return a JSON array of { subtaskId, assigneeId, assigneeName, reasoning }.' } }
    ] } },
    { id: 'guard-assignment', type: 'guard', label: 'Assignment Guard', config: {
      guardType: 'agent_action',
      quorum: 0.6,
      riskThreshold: 0.7,
      hitlThreshold: 0.6,
      blockAboveRisk: 0.92,
      numberOfReviewers: 3,
      policyPack: 'task-assignment',
      irreversibleDefault: false,
      evaluationRubric: JSON.stringify({
        evaluation_criteria: [
          'assignments match member expertise based on recent work',
          'workload is distributed evenly across team members',
          'high-priority subtasks are assigned to available and capable members',
          'no member is assigned more tasks than they can handle',
          'all unassigned subtasks have a proposed assignee'
        ]
      }),
      actionType: 'task_assignment'
    } },
    { id: 'human-approval-assignment', type: 'hitl', label: 'Human Approval (optional)', config: { channel: 'slack', mode: 'yes-no', threshold: 0.7 } },
    { id: 'action-assign-subtasks', type: 'action', label: 'Assign Linear Subtasks', config: { action: 'linear.assign_subtasks', requireGuardPass: true } }
  ]
};

const WORKFLOW_TEMPLATES: Record<string, { name: string; definition: any }> = {
  'template-github-pr': { name: 'Template 1 - GitHub PR Merge Guard', definition: TEMPLATE_1 },
  'template-linear-tasks': { name: 'Template 2 - Linear Task Decomposition', definition: TEMPLATE_2 },
  'template-linear-assign': { name: 'Template 3 - Cron: Auto-Assign Linear Subtasks', definition: TEMPLATE_3 },
};

function validateWorkflowDefinition(definition: any) {
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
      reputation: z.number().min(0).max(100).optional(),
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

app.get('/api/votes/:runId', (req, res) => {
  try {
    const run = getRun(req.params.runId) as any;
    if (!run) return res.status(404).json(err('RUN_NOT_FOUND', 'Run not found'));
    const policyId = (run?.meta_json ? JSON.parse(String(run.meta_json)).policy_id : null) || 'default';
    const policy = getPolicyAssignment(run.board_id, policyId);
    const quorum = Number(policy?.quorum ?? 0.6);
    const agg = aggregateVotes(req.params.runId, quorum);
    const participants = listParticipants(run.board_id);
    const participantMap: Record<string, any> = {};
    for (const p of participants) participantMap[(p as any).id] = p;
    const enrichedVotes = (agg.votes || []).map((v: any) => ({
      ...v,
      participant: participantMap[v.participant_id] || null
    }));
    res.json({ votes: enrichedVotes, aggregate: { totalWeight: agg.totalWeight, yesWeight: agg.yesWeight, ratio: agg.ratio, passed: agg.passed, quorum }, participants });
  } catch (e: any) {
    res.status(500).json(err('VOTES_FETCH_FAILED', 'Failed to fetch votes', e?.message));
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
  res.json({ workflows: listWorkflows() });
});

// ── Workflow Template Endpoints ──

app.get('/api/templates', (_req, res) => {
  const templates = Object.entries(WORKFLOW_TEMPLATES).map(([id, tmpl]) => ({
    id,
    name: tmpl.name,
    nodeCount: tmpl.definition.nodes?.length || 0,
  }));
  res.json({ templates });
});

app.get('/api/templates/:id', (req, res) => {
  const tmpl = WORKFLOW_TEMPLATES[req.params.id];
  if (!tmpl) return res.status(404).json(err('TEMPLATE_NOT_FOUND', 'Template not found'));
  res.json({ template: { id: req.params.id, name: tmpl.name, definition: tmpl.definition } });
});

app.post('/api/templates/:id/load', (req, res) => {
  const tmpl = WORKFLOW_TEMPLATES[req.params.id];
  if (!tmpl) return res.status(404).json(err('TEMPLATE_NOT_FOUND', 'Template not found'));
  res.json({ template: { id: req.params.id, name: tmpl.name, definition: tmpl.definition } });
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

app.delete('/api/workflows/:id', (req, res) => {
  const workflow = getWorkflow(req.params.id);
  if (!workflow) return res.status(404).json(err('WORKFLOW_NOT_FOUND', 'Workflow not found'));
  deleteWorkflow(req.params.id);
  res.json({ ok: true });
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

app.get('/api/mcp/events/run-ids', (_req, res) => {
  try {
    const rows = listDistinctRunIds(100);
    res.json({ runIds: rows.map(r => r.run_id) });
  } catch (e: any) {
    res.status(500).json(err('LIST_RUN_IDS_FAILED', 'Failed to list run IDs', e?.message));
  }
});

app.delete('/api/mcp/events', (req, res) => {
  try {
    const q = z.object({ boardId: z.string().optional(), runId: z.string().optional() }).parse(req.query);
    const result = deleteEvents(q);
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(400).json(err('DELETE_EVENTS_FAILED', 'Failed to delete events', e?.message));
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

// Chat inbound endpoint for Human Approval replies (e.g., webhook from chat surface)
app.post('/api/chat/human-approval-reply', async (req, res) => {
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
    res.status(toHttpStatus(code)).json(err(code, 'Failed to process Human Approval reply', e?.message));
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
  github: '',    // no npm package — fake install marks as enabled
  linear: '',    // no npm package — direct GraphQL fetch, fake install
};

function getInstalledAdapters(): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  for (const [id, pkg] of Object.entries(VALID_ADAPTERS)) {
    if (!pkg) {
      const cred = getCredential(db, 'adapter', id);
      status[id] = cred === 'installed';
    } else {
      try {
        require.resolve(pkg);
        status[id] = true;
      } catch {
        const cred = getCredential(db, 'adapter', id);
        status[id] = cred === 'installed';
      }
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
    if (!(body.adapter in VALID_ADAPTERS)) {
      console.error(`[adapter] Unknown adapter: ${body.adapter}`);
      return res.status(400).json(err('INVALID_ADAPTER', `Unknown adapter: ${body.adapter}. Valid: ${Object.keys(VALID_ADAPTERS).join(', ')}`));
    }

    const rootDir = path.resolve(process.cwd());
    console.log(`[adapter] Installing ${body.adapter} in ${rootDir}...`);

    let installOutput = '';
    let installed = false;
    if (!pkg) {
      // No npm package needed — just mark as enabled via credential
      installed = true;
    } else {
      try {
        installOutput = execSync(`npm install chat ${pkg} 2>&1`, { cwd: rootDir, timeout: 90000, encoding: 'utf8' });
        console.log(`[adapter] Install output: ${installOutput}`);
        installed = true;
      } catch (e: any) {
        installOutput = e?.stdout || e?.stderr || e?.message || 'Install failed';
        console.error(`[adapter] Install failed: ${installOutput}`);
        installed = false;
      }
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
    if (!(body.adapter in VALID_ADAPTERS)) return res.status(400).json(err('INVALID_ADAPTER', `Unknown adapter: ${body.adapter}`));

    const rootDir = path.resolve(process.cwd(), '..');
    if (pkg) {
      try {
        execSync(`npm uninstall ${pkg} 2>&1`, { cwd: rootDir, timeout: 30000, encoding: 'utf8' });
      } catch {
      }
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

// ── Cron Schedule Management ──

app.get('/api/cron', (_req, res) => {
  res.json({ schedules: listCronSchedules() });
});

app.post('/api/workflows/:id/cron', (req, res) => {
  try {
    const workflow = getWorkflow(req.params.id) as WorkflowRecord | undefined;
    if (!workflow) return res.status(404).json(err('WORKFLOW_NOT_FOUND', 'Workflow not found'));

    const definition = typeof workflow.definition_json === 'string' ? JSON.parse(workflow.definition_json) : workflow.definition_json;
    const triggerNode = (definition?.nodes || []).find((n: any) => n.type === 'trigger');
    const cronExpression = req.body?.cronExpression || triggerNode?.config?.cronExpression || '*/30 * * * *';

    const entry = registerCron(req.params.id, cronExpression);
    res.json({ ok: true, schedule: entry });
  } catch (e: any) {
    res.status(500).json(err('CRON_REGISTER_FAILED', 'Failed to register cron schedule', e?.message));
  }
});

app.delete('/api/workflows/:id/cron', (req, res) => {
  const removed = unregisterCron(req.params.id);
  res.json({ ok: true, removed });
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

    const webhookRepo = String(payload.repository?.full_name || '');
    const prBaseBranch = String(payload.pull_request?.base?.ref || '');

    // Build a pre-resolved trigger payload from the webhook data so the trigger node
    // uses it directly instead of polling via gh CLI. Also surfaces pr.sha for idempotency.
    const pr = payload.pull_request;
    const triggerPayload = pr ? {
      ok: true,
      trigger: source,
      repo: webhookRepo,
      branch: prBaseBranch,
      pr: {
        number: pr.number,
        title: pr.title || '',
        body: pr.body || '',
        author: pr.user?.login || '',
        headBranch: pr.head?.ref || '',
        sha: pr.head?.sha || '',
        url: pr.html_url || '',
        additions: pr.additions || 0,
        deletions: pr.deletions || 0,
        changedFiles: pr.changed_files || 0,
      },
    } : null;

    for (const wf of workflows) {
      try {
        const definition = JSON.parse(wf.definition_json || '{}');
        const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
        const triggerNode = nodes[0];
        if (!triggerNode || triggerNode.type !== 'trigger') continue;
        const triggerSource = triggerNode.config?.source;
        if (triggerSource !== source) continue;

        // Skip if repo is configured and doesn't match the webhook's repository
        const triggerRepo = String(triggerNode.config?.repo || '');
        if (triggerRepo && webhookRepo && triggerRepo !== webhookRepo) continue;

        // Skip if branch is configured and the PR is not targeting that base branch
        const triggerBranch = String(triggerNode.config?.branch || 'main');
        if (prBaseBranch && triggerBranch !== prBaseBranch) continue;

        const runOpts = triggerPayload ? { context: { __triggerPayload: triggerPayload } } : {};
        const out = await runWorkflow(definition, wf.id, runOpts);
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

// ── Adapter-Specific Inbound Webhooks ──
// These endpoints receive replies from chat surfaces and route them to human.approve.

// Slack Events API handler
app.post('/api/webhooks/slack/events', async (req, res) => {
  try {
    const body = req.body || {};

    // Slack URL verification challenge
    if (body.type === 'url_verification') {
      return res.json({ challenge: body.challenge });
    }

    if (body.type !== 'event_callback') {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const event = body.event || {};
    // Only handle message events that are replies (not from bots)
    if (event.type !== 'message' || event.bot_id || event.subtype) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const text = String(event.text || '').trim();
    const userId = event.user || '';

    // Extract runId from message metadata or thread context
    const runIdMatch = text.match(/run[:\s_]+(\S+)/i);
    let runId = runIdMatch?.[1] || '';

    // Also check message metadata if available
    if (!runId && event.metadata?.event_payload?.runId) {
      runId = event.metadata.event_payload.runId;
    }

    // Try to find a pending approval matching this user
    if (!runId) {
      const { listPendingApprovals } = await import('./engine/hitl-tracker.js');
      const pendings = listPendingApprovals();
      const match = pendings.find(p =>
        p.prompt.chatTargets?.some(t => t.adapter === 'slack' && t.handle === userId)
      );
      if (match) runId = match.runId;
    }

    if (!runId) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Could not determine runId' });
    }

    // Clean reply text: remove any "run:xxx" prefix
    const replyText = text.replace(/run[:\s_]+\S+\s*/i, '').trim() || text;

    const out = await humanApprovePost({
      runId,
      replyText,
      approver: `slack:${userId}`,
      idempotencyKey: `slack:${event.event_ts || Date.now()}`,
      boardId: body.event?.metadata?.event_payload?.boardId
    });
    res.json(out);
  } catch (e: any) {
    console.error('[webhook:slack]', e?.message);
    res.status(200).json({ ok: true, error: e?.message });
  }
});

// Teams Bot Framework activity handler
app.post('/api/webhooks/teams/activity', async (req, res) => {
  try {
    const activity = req.body || {};
    if (activity.type !== 'message') {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const text = String(activity.text || '').replace(/<at>[^<]*<\/at>/g, '').trim();
    const userId = activity.from?.id || activity.from?.name || 'teams-user';

    const runIdMatch = text.match(/run[:\s_]+(\S+)/i);
    let runId = runIdMatch?.[1] || '';

    // Try to find pending approval for this user
    if (!runId) {
      const { listPendingApprovals } = await import('./engine/hitl-tracker.js');
      const pendings = listPendingApprovals();
      const match = pendings.find(p =>
        p.prompt.chatTargets?.some(t => t.adapter === 'teams' && (t.handle === userId || t.subjectId === activity.from?.name))
      );
      if (match) runId = match.runId;
    }

    if (!runId) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Could not determine runId' });
    }

    const replyText = text.replace(/run[:\s_]+\S+\s*/i, '').trim() || text;
    const out = await humanApprovePost({
      runId,
      replyText,
      approver: `teams:${userId}`,
      idempotencyKey: `teams:${activity.id || Date.now()}`,
      boardId: activity.channelData?.consensus?.boardId
    });
    res.json(out);
  } catch (e: any) {
    console.error('[webhook:teams]', e?.message);
    res.status(200).json({ ok: true, error: e?.message });
  }
});

// Discord webhook interactions handler
app.post('/api/webhooks/discord/interactions', async (req, res) => {
  try {
    const body = req.body || {};
    // Discord ping verification
    if (body.type === 1) return res.json({ type: 1 });

    const text = String(body.data?.options?.[0]?.value || body.content || '').trim();
    const userId = body.member?.user?.id || body.user?.id || 'discord-user';

    const runIdMatch = text.match(/run[:\s_]+(\S+)/i);
    let runId = runIdMatch?.[1] || '';

    if (!runId) {
      const { listPendingApprovals } = await import('./engine/hitl-tracker.js');
      const pendings = listPendingApprovals();
      const match = pendings.find(p =>
        p.prompt.chatTargets?.some(t => t.adapter === 'discord' && t.handle === userId)
      );
      if (match) runId = match.runId;
    }

    if (!runId) return res.status(200).json({ ok: true, skipped: true });

    const replyText = text.replace(/run[:\s_]+\S+\s*/i, '').trim() || text;
    const out = await humanApprovePost({
      runId,
      replyText,
      approver: `discord:${userId}`,
      idempotencyKey: `discord:${body.id || Date.now()}`
    });
    res.json(out);
  } catch (e: any) {
    console.error('[webhook:discord]', e?.message);
    res.status(200).json({ ok: true, error: e?.message });
  }
});

// Telegram webhook handler
app.post('/api/webhooks/telegram', async (req, res) => {
  try {
    const update = req.body || {};
    const message = update.message || update.edited_message;
    if (!message?.text) return res.status(200).json({ ok: true, skipped: true });

    const text = String(message.text).trim();
    const userId = String(message.from?.id || 'telegram-user');

    const runIdMatch = text.match(/run[:\s_]+(\S+)/i);
    let runId = runIdMatch?.[1] || '';

    if (!runId) {
      const { listPendingApprovals } = await import('./engine/hitl-tracker.js');
      const pendings = listPendingApprovals();
      const match = pendings.find(p =>
        p.prompt.chatTargets?.some(t => t.adapter === 'telegram' && t.handle === userId)
      );
      if (match) runId = match.runId;
    }

    if (!runId) return res.status(200).json({ ok: true, skipped: true });

    const replyText = text.replace(/run[:\s_]+\S+\s*/i, '').trim() || text;
    const out = await humanApprovePost({
      runId,
      replyText,
      approver: `telegram:${userId}`,
      idempotencyKey: `telegram:${update.update_id || Date.now()}`
    });
    res.json(out);
  } catch (e: any) {
    console.error('[webhook:telegram]', e?.message);
    res.status(200).json({ ok: true, error: e?.message });
  }
});

// Generic adapter inbound (for custom/gchat adapters)
app.post('/api/webhooks/chat/:adapter', async (req, res) => {
  try {
    const adapter = req.params.adapter;
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
      approver: `${adapter}:${body.approver}`,
      idempotencyKey: body.idempotencyKey ?? `${adapter}:${body.runId}:${Date.now()}`,
      boardId: body.boardId
    });
    res.json(out);
  } catch (e: any) {
    const code = e?.name === 'ZodError' ? 'INVALID_INPUT' : 'CHAT_REPLY_FAILED';
    res.status(toHttpStatus(code)).json(err(code, 'Failed to process chat adapter reply', e?.message));
  }
});

// ── Pending Approvals API ──

app.get('/api/hitl/pending', (_req, res) => {
  try {
    const { listPendingApprovals } = require('./engine/hitl-tracker.js');
    res.json({ pending: listPendingApprovals() });
  } catch (e: any) {
    res.status(500).json(err('HITL_LIST_FAILED', 'Failed to list pending approvals', e?.message));
  }
});

// ── Production: serve built web UI ──
if (process.env.NODE_ENV === 'production') {
  const webDist = path.join(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '..', '..', 'web', 'dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
    console.log(`Serving UI from ${webDist}`);
  }
}

const PORT = parseInt(process.env.PORT || '4010', 10);
app.listen(PORT, '127.0.0.1', () => {
  console.log(`local-mcp-board on http://127.0.0.1:${PORT}`);
  bootstrapConsensusTools();

  // Initialize cron scheduler: load persisted schedules and wire up workflow triggering
  initCronScheduler(db, async (workflowId: string) => {
    const workflow = getWorkflow(workflowId) as WorkflowRecord | undefined;
    if (!workflow) {
      console.warn(`[cron] Workflow ${workflowId} not found — skipping`);
      return;
    }
    console.log(`[cron] Triggering workflow ${workflowId} (${workflow.name})`);
    const definition = typeof workflow.definition_json === 'string' ? JSON.parse(workflow.definition_json) : workflow.definition_json;
    await runWorkflow(definition, workflowId, { context: { __triggerPayload: { ok: true, trigger: 'cron', source: 'cron-scheduler' } } });
  });
  loadPersistedSchedules(db);
});
