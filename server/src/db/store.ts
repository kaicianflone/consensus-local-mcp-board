import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';

const dataDir = path.resolve(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'local-board.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS boards(id TEXT PRIMARY KEY, name TEXT, created_at INTEGER, config_json TEXT);
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, board_id TEXT, status TEXT, created_at INTEGER, updated_at INTEGER, meta_json TEXT);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, board_id TEXT, run_id TEXT, type TEXT, ts INTEGER, payload_json TEXT, prev_event_id TEXT NULL);
`);

export function createBoard(name: string) {
  const id = nanoid();
  const ts = Date.now();
  db.prepare('INSERT INTO boards(id,name,created_at,config_json) VALUES (?,?,?,?)').run(id, name, ts, '{}');
  return { id, name, created_at: ts };
}
export function listBoards() { return db.prepare('SELECT * FROM boards ORDER BY created_at DESC').all(); }
export function getBoard(id: string) { return db.prepare('SELECT * FROM boards WHERE id = ?').get(id); }

export function createRun(boardId: string) {
  const id = nanoid(); const ts = Date.now();
  db.prepare('INSERT INTO runs(id,board_id,status,created_at,updated_at,meta_json) VALUES (?,?,?,?,?,?)').run(id, boardId, 'OPEN', ts, ts, '{}');
  return { id, boardId, status: 'OPEN', created_at: ts, updated_at: ts };
}
export function getRun(id: string) { return db.prepare('SELECT * FROM runs WHERE id=?').get(id); }
export function updateRunStatus(id: string, status: string) {
  db.prepare('UPDATE runs SET status=?, updated_at=? WHERE id=?').run(status, Date.now(), id);
}

export function appendEvent(boardId: string, runId: string, type: string, payload: any) {
  const id = nanoid();
  const prev = db.prepare('SELECT id FROM events WHERE run_id=? ORDER BY ts DESC LIMIT 1').get(runId) as any;
  db.prepare('INSERT INTO events(id,board_id,run_id,type,ts,payload_json,prev_event_id) VALUES (?,?,?,?,?,?,?)')
    .run(id, boardId, runId, type, Date.now(), JSON.stringify(payload), prev?.id ?? null);
  return { id };
}
export function listEvents(boardId?: string, runId?: string, limit = 100) {
  let q = 'SELECT * FROM events'; const where: string[]=[]; const args:any[]=[];
  if (boardId) { where.push('board_id=?'); args.push(boardId); }
  if (runId) { where.push('run_id=?'); args.push(runId); }
  if (where.length) q += ' WHERE ' + where.join(' AND ');
  q += ' ORDER BY ts DESC LIMIT ?'; args.push(limit);
  return db.prepare(q).all(...args);
}
