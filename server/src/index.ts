import express from 'express';
import { z } from 'zod';
import { EvaluateInputSchema } from '@local-mcp-board/shared';
import { createBoard, getBoard, getRun, listBoards, listEvents, listRuns, searchEvents } from './db/store.js';
import { evaluate } from './engine/evaluate.js';
import { err, toHttpStatus } from './utils/errors.js';
import { invokeTool, listToolNames } from './tools/registry.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

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

app.get('/api/mcp/events', (req, res) => {
  try {
    const q = z.object({ boardId: z.string().optional(), runId: z.string().optional(), type: z.string().optional(), limit: z.coerce.number().optional() }).parse(req.query);
    res.json({ events: listEvents({ ...q, limit: q.limit || 100 }) });
  } catch (e: any) {
    res.status(400).json(err('INVALID_QUERY', 'Invalid query params', e?.message));
  }
});

app.post('/api/mcp/evaluate', (req, res) => {
  try {
    const parsed = EvaluateInputSchema.parse(req.body);
    const r = evaluate(parsed);
    res.json(r);
  } catch (e: any) {
    const code = e?.name === 'ZodError' ? 'INVALID_INPUT' : 'EVALUATE_FAILED';
    res.status(toHttpStatus(code)).json(err(code, 'Failed to evaluate action', e?.message));
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

app.post('/api/mcp/tool/:name', (req, res) => {
  try {
    const out = invokeTool(req.params.name as any, req.body ?? {});
    res.json(out);
  } catch (e: any) {
    const code = e?.name === 'ZodError' ? 'INVALID_INPUT' : 'TOOL_CALL_FAILED';
    res.status(toHttpStatus(code)).json(err(code, `Tool failed: ${req.params.name}`, e?.message));
  }
});

app.listen(4010, '127.0.0.1', () => console.log('local-mcp-board server on http://127.0.0.1:4010'));
