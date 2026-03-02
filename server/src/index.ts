import express from 'express';
import { z } from 'zod';
import { EvaluateInputSchema } from '@local-mcp-board/shared';
import { createBoard, getBoard, getRun, listBoards, listEvents } from './db/store.js';
import { evaluate } from './engine/evaluate.js';

const app = express();
app.use(express.json());

app.get('/api/mcp/boards', (_req, res) => res.json({ boards: listBoards() }));
app.get('/api/mcp/boards/:id', (req, res) => res.json({ board: getBoard(req.params.id) }));
app.get('/api/mcp/runs/:id', (req, res) => res.json({ run: getRun(req.params.id) }));
app.get('/api/mcp/events', (req, res) => {
  const q = z.object({ boardId: z.string().optional(), runId: z.string().optional(), limit: z.coerce.number().optional() }).parse(req.query);
  res.json({ events: listEvents(q.boardId, q.runId, q.limit || 100) });
});
app.post('/api/mcp/evaluate', (req, res) => {
  const parsed = EvaluateInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = evaluate(parsed.data);
  res.json(r);
});

app.post('/api/mcp/boards', (req, res) => {
  const body = z.object({ name: z.string().default('default') }).parse(req.body || {});
  res.json({ board: createBoard(body.name) });
});

app.listen(4010, '127.0.0.1', () => console.log('local-mcp-board server on 127.0.0.1:4010'));
