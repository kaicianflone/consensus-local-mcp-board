import express from 'express';
import { z } from 'zod';
import { EvaluateInputSchema, GuardEvaluateRequestSchema, HumanApprovalRequestSchema } from '@local-mcp-board/shared';
import { createBoard, createWorkflow, getBoard, getRun, getWorkflow, getWorkflowRunByRunId, listBoards, listEvents, listRuns, listWorkflowRuns, listWorkflows, searchEvents, updateWorkflow } from './db/store.js';
import { err, toHttpStatus } from './utils/errors.js';
import { invokeTool, listToolNames } from './tools/registry.js';
import { guardEvaluatePost } from './api/guard.evaluate.post.js';
import { humanApprovePost } from './api/human.approve.post.js';
import { resumeWorkflow, runWorkflow } from './workflows/runner.js';

const app = express();
const verbose = process.env.VERBOSE === '1' || process.argv.includes('--verbose');

// CORS for local web dev (Vite on 5173)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === 'http://127.0.0.1:5173' || origin === 'http://localhost:5173') {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '1mb' }));

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

app.get('/api/workflows', (_req, res) => {
  res.json({ workflows: listWorkflows() });
});

app.post('/api/workflows', (req, res) => {
  try {
    const body = z.object({ name: z.string().min(1), definition: z.record(z.any()).default({}) }).parse(req.body || {});
    res.json({ workflow: createWorkflow(body.name, body.definition) });
  } catch (e: any) {
    res.status(400).json(err('INVALID_INPUT', 'Invalid workflow payload', e?.message));
  }
});

app.get('/api/workflows/:id', (req, res) => {
  const workflow = getWorkflow(req.params.id);
  if (!workflow) return res.status(404).json(err('WORKFLOW_NOT_FOUND', 'Workflow not found'));
  res.json({ workflow, runs: listWorkflowRuns(req.params.id, 200) });
});

app.put('/api/workflows/:id', (req, res) => {
  try {
    const body = z.object({ name: z.string().optional(), definition: z.record(z.any()).optional() }).parse(req.body || {});
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
    const out = await runWorkflow(definition, workflow.id);
    res.json({ ok: true, workflowId: workflow.id, ...out });
  } catch (e: any) {
    res.status(500).json(err('WORKFLOW_RUN_FAILED', 'Failed to run workflow', e?.message));
  }
});

app.post('/api/workflow-runs/:runId/approve', async (req, res) => {
  try {
    const body = z.object({ decision: z.enum(['YES', 'NO']), approver: z.string().default('human') }).parse(req.body || {});
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

app.listen(4010, '127.0.0.1', () => console.log('local-mcp-board server on http://127.0.0.1:4010'));
