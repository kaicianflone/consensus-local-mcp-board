import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { runMigrations } from './migrate.js';
import { redact } from '../utils/redact.js';

const dataDir = path.resolve(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'local-board.db'));
runMigrations(db);

type Json = Record<string, unknown>;

export type WorkflowRecord = {
  id: string;
  name: string;
  definition_json: string;
  created_at: number;
  updated_at: number;
};

export function createBoard(name: string, config: Json = {}) {
  const id = nanoid();
  const ts = Date.now();
  db.prepare('INSERT INTO boards(id,name,created_at,config_json) VALUES (?,?,?,?)').run(id, name, ts, JSON.stringify(redact(config)));
  return { id, name, created_at: ts, config };
}
export function listBoards() { return db.prepare('SELECT * FROM boards ORDER BY created_at DESC').all(); }
export function getBoard(id: string) { return db.prepare('SELECT * FROM boards WHERE id = ?').get(id); }

export function createRun(boardId: string, meta: Json = {}, id?: string) {
  const runId = id || nanoid(); const ts = Date.now();
  db.prepare('INSERT INTO runs(id,board_id,status,created_at,updated_at,meta_json) VALUES (?,?,?,?,?,?)').run(runId, boardId, 'OPEN', ts, ts, JSON.stringify(redact(meta)));
  return { id: runId, boardId, status: 'OPEN', created_at: ts, updated_at: ts };
}
export function getRun(id: string) { return db.prepare('SELECT * FROM runs WHERE id=?').get(id); }
export function listRuns(boardId?: string, limit = 100) {
  if (boardId) return db.prepare('SELECT * FROM runs WHERE board_id=? ORDER BY created_at DESC LIMIT ?').all(boardId, limit);
  return db.prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT ?').all(limit);
}
export function updateRunStatus(id: string, status: string) {
  db.prepare('UPDATE runs SET status=?, updated_at=? WHERE id=?').run(status, Date.now(), id);
}

export function appendEvent(boardId: string, runId: string | null, type: string, payload: unknown) {
  const id = nanoid();
  const prev = runId ? db.prepare('SELECT id FROM events WHERE run_id=? ORDER BY ts DESC LIMIT 1').get(runId) as { id?: string } | undefined : undefined;
  db.prepare('INSERT INTO events(id,board_id,run_id,type,ts,payload_json,prev_event_id) VALUES (?,?,?,?,?,?,?)')
    .run(id, boardId, runId, type, Date.now(), JSON.stringify(redact(payload)), prev?.id ?? null);
  return { id };
}

export function listEvents(filters: { boardId?: string; runId?: string; type?: string; limit?: number }) {
  let q = 'SELECT * FROM events'; const where: string[] = []; const args: unknown[] = [];
  if (filters.boardId) { where.push('board_id=?'); args.push(filters.boardId); }
  if (filters.runId) { where.push('run_id=?'); args.push(filters.runId); }
  if (filters.type) { where.push('type=?'); args.push(filters.type); }
  if (where.length) q += ' WHERE ' + where.join(' AND ');
  q += ' ORDER BY ts DESC LIMIT ?'; args.push(filters.limit ?? 100);
  return db.prepare(q).all(...args);
}

export function searchEvents(query: string, limit = 100) {
  const like = `%${query}%`;
  return db.prepare('SELECT * FROM events WHERE payload_json LIKE ? OR type LIKE ? ORDER BY ts DESC LIMIT ?').all(like, like, limit);
}

export function createWorkflow(name: string, definition: Json = {}) {
  const id = nanoid();
  const ts = Date.now();
  db.prepare('INSERT INTO workflows(id,name,definition_json,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, name, JSON.stringify(definition), ts, ts);
  return getWorkflow(id);
}

export function listWorkflows(limit = 100) {
  return db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC LIMIT ?').all(limit);
}

export function getWorkflow(id: string) {
  return db.prepare('SELECT * FROM workflows WHERE id=?').get(id) as WorkflowRecord | undefined;
}

export function updateWorkflow(id: string, patch: { name?: string; definition?: Json }) {
  const current = getWorkflow(id);
  if (!current) return null;
  const nextName = patch.name ?? current.name;
  const nextDef = patch.definition ?? JSON.parse(current.definition_json || '{}');
  db.prepare('UPDATE workflows SET name=?, definition_json=?, updated_at=? WHERE id=?').run(nextName, JSON.stringify(nextDef), Date.now(), id);
  return getWorkflow(id);
}

export function createWorkflowRun(workflowId: string, runId: string, status = 'OPEN') {
  const id = nanoid();
  const ts = Date.now();
  db.prepare('INSERT INTO workflow_runs(id,workflow_id,run_id,status,created_at) VALUES (?,?,?,?,?)').run(id, workflowId, runId, status, ts);
  return { id, workflow_id: workflowId, run_id: runId, status, created_at: ts };
}

export function updateWorkflowRunStatus(runId: string, status: string) {
  db.prepare('UPDATE workflow_runs SET status=? WHERE run_id=?').run(status, runId);
}

export function listWorkflowRuns(workflowId: string, limit = 100) {
  return db.prepare('SELECT * FROM workflow_runs WHERE workflow_id=? ORDER BY created_at DESC LIMIT ?').all(workflowId, limit);
}

export function getWorkflowRunByRunId(runId: string) {
  return db.prepare('SELECT * FROM workflow_runs WHERE run_id=? LIMIT 1').get(runId) as any;
}
