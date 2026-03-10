import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import crypto from 'node:crypto';
import { runMigrations } from './migrate.js';
import { redact } from '../utils/redact.js';

const dataDir = path.resolve(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
export const db = new Database(path.join(dataDir, 'local-board.db'));
runMigrations(db);

const mirrorEnabled = process.env.CONSENSUS_TOOLS_MIRROR === '1';
const mirrorDbPath = process.env.CONSENSUS_TOOLS_DB_PATH || '';
let mirrorDb: any = null;

function getMirrorDb() {
  if (!mirrorEnabled || !mirrorDbPath) return null;
  if (mirrorDb) return mirrorDb;
  try {
    mirrorDb = new Database(mirrorDbPath);
    mirrorDb.pragma('journal_mode = WAL');
    return mirrorDb;
  } catch (e: any) {
    console.warn('[mirror] unable to open consensus-tools sqlite:', e?.message || e);
    return null;
  }
}

function mirrorEventToConsensusTools(payload: {
  id: string;
  boardId: string;
  runId: string | null;
  type: string;
  ts: number;
  data: unknown;
}) {
  const mdb = getMirrorDb();
  if (!mdb) return;
  try {
    mdb.prepare('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)').run();
    const row = mdb.prepare('SELECT value FROM kv WHERE key = ?').get('state') as { value?: string } | undefined;
    const state = row?.value ? JSON.parse(row.value) : {
      jobs: [], bids: [], claims: [], submissions: [], votes: [], resolutions: [], ledger: [], audit: [], errors: []
    };
    if (!Array.isArray(state.audit)) state.audit = [];

    state.audit.push({
      id: `lmb_${payload.id}`,
      at: new Date(payload.ts).toISOString(),
      type: payload.type,
      jobId: payload.runId || undefined,
      actorAgentId: 'consensus-local-mcp-board',
      details: {
        boardId: payload.boardId,
        runId: payload.runId,
        source: 'consensus-local-mcp-board',
        payload: payload.data
      }
    });

    mdb.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('state', JSON.stringify(state));
  } catch (e: any) {
    console.warn('[mirror] failed to mirror event:', e?.message || e);
  }
}

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
  const ts = Date.now();
  const redacted = redact(payload);
  const prev = runId ? db.prepare('SELECT id FROM events WHERE run_id=? ORDER BY ts DESC LIMIT 1').get(runId) as { id?: string } | undefined : undefined;
  db.prepare('INSERT INTO events(id,board_id,run_id,type,ts,payload_json,prev_event_id) VALUES (?,?,?,?,?,?,?)')
    .run(id, boardId, runId, type, ts, JSON.stringify(redacted), prev?.id ?? null);

  mirrorEventToConsensusTools({ id, boardId, runId, type, ts, data: redacted });
  return { id };
}

export function listEvents(filters: { boardId?: string; runId?: string; type?: string; limit?: number }) {
  let q = 'SELECT rowid AS seq, * FROM events'; const where: string[] = []; const args: unknown[] = [];
  if (filters.boardId) { where.push('board_id=?'); args.push(filters.boardId); }
  if (filters.runId) { where.push('run_id=?'); args.push(filters.runId); }
  if (filters.type) { where.push('type=?'); args.push(filters.type); }
  if (where.length) q += ' WHERE ' + where.join(' AND ');
  q += ' ORDER BY rowid DESC LIMIT ?'; args.push(filters.limit ?? 100);
  return db.prepare(q).all(...args);
}

export function searchEvents(query: string, limit = 100) {
  const like = `%${query}%`;
  return db.prepare('SELECT rowid AS seq, * FROM events WHERE payload_json LIKE ? OR type LIKE ? ORDER BY rowid DESC LIMIT ?').all(like, like, limit);
}

export function deleteEvents(filters: { boardId?: string; runId?: string }) {
  let q = 'DELETE FROM events';
  const where: string[] = [];
  const args: unknown[] = [];
  if (filters.boardId) { where.push('board_id=?'); args.push(filters.boardId); }
  if (filters.runId) { where.push('run_id=?'); args.push(filters.runId); }
  if (where.length) q += ' WHERE ' + where.join(' AND ');
  const result = db.prepare(q).run(...args);
  return { deleted: result.changes };
}

export function listDistinctRunIds(limit = 50) {
  return db.prepare('SELECT DISTINCT run_id FROM events WHERE run_id IS NOT NULL ORDER BY rowid DESC LIMIT ?').all(limit) as { run_id: string }[];
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

export function deleteWorkflow(id: string) {
  db.prepare('DELETE FROM workflow_runs WHERE workflow_id=?').run(id);
  db.prepare('DELETE FROM workflows WHERE id=?').run(id);
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

export function listWorkflowRunsDetailed(workflowId: string, limit = 100) {
  return db.prepare(`
    SELECT wr.*, l.engine, l.external_run_id, l.cursor_json, l.updated_at as link_updated_at
    FROM workflow_runs wr
    LEFT JOIN workflow_run_links l ON l.run_id = wr.run_id
    WHERE wr.workflow_id=?
    ORDER BY wr.created_at DESC
    LIMIT ?
  `).all(workflowId, limit);
}

export function getWorkflowRunByRunId(runId: string) {
  return db.prepare('SELECT * FROM workflow_runs WHERE run_id=? LIMIT 1').get(runId) as any;
}

export function upsertWorkflowRunLink(runId: string, workflowId: string, engine: string, externalRunId?: string | null, cursor?: unknown) {
  const existing = db.prepare('SELECT run_id FROM workflow_run_links WHERE run_id=?').get(runId) as any;
  const ts = Date.now();
  const cursorJson = cursor === undefined ? null : JSON.stringify(redact(cursor as any));
  if (existing) {
    db.prepare('UPDATE workflow_run_links SET workflow_id=?, engine=?, external_run_id=?, cursor_json=?, updated_at=? WHERE run_id=?')
      .run(workflowId, engine, externalRunId ?? null, cursorJson, ts, runId);
  } else {
    db.prepare('INSERT INTO workflow_run_links(run_id,workflow_id,engine,external_run_id,cursor_json,updated_at) VALUES (?,?,?,?,?,?)')
      .run(runId, workflowId, engine, externalRunId ?? null, cursorJson, ts);
  }
}

export function getWorkflowRunLink(runId: string) {
  return db.prepare('SELECT * FROM workflow_run_links WHERE run_id=? LIMIT 1').get(runId) as any;
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function connectAgent(input: { name: string; scopes?: string[]; boards?: string[]; workflows?: string[] }) {
  const id = nanoid();
  const apiKey = `ag_${nanoid()}_${nanoid()}`;
  const apiKeyHash = hashToken(apiKey);
  const ts = Date.now();
  db.prepare('INSERT INTO agents(id,name,api_key_hash,scopes_json,boards_json,workflows_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, input.name, apiKeyHash, JSON.stringify(input.scopes || []), JSON.stringify(input.boards || []), JSON.stringify(input.workflows || []), 'active', ts, ts);
  return { id, name: input.name, apiKey, created_at: ts };
}

export function listAgents() {
  return db.prepare('SELECT id,name,scopes_json,boards_json,workflows_json,status,created_at,updated_at FROM agents ORDER BY created_at DESC').all();
}

export function getAgentByApiKey(apiKey: string) {
  const h = hashToken(apiKey);
  return db.prepare('SELECT * FROM agents WHERE api_key_hash=? AND status=? LIMIT 1').get(h, 'active') as any;
}

export function createParticipant(input: { boardId: string; subjectType: 'agent' | 'human'; subjectId: string; role?: string; weight?: number; reputation?: number; metadata?: Json }) {
  const id = nanoid();
  const ts = Date.now();
  const rep = Math.round(input.reputation ?? 100);
  db.prepare('INSERT INTO participants(id,board_id,subject_type,subject_id,role,weight,reputation,status,metadata_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, input.boardId, input.subjectType, input.subjectId, input.role || 'voter', input.weight ?? 1, rep, 'active', JSON.stringify(input.metadata || {}), ts, ts);
  return db.prepare('SELECT * FROM participants WHERE id=?').get(id);
}

export function listParticipants(boardId: string) {
  return db.prepare('SELECT * FROM participants WHERE board_id=? ORDER BY created_at DESC').all(boardId);
}

export function updateParticipant(id: string, patch: { reputation?: number; weight?: number; role?: string; status?: string; metadata?: Record<string, unknown> }) {
  const current = db.prepare('SELECT * FROM participants WHERE id=?').get(id) as any;
  if (!current) return null;
  const reputation = patch.reputation != null ? Math.round(patch.reputation) : current.reputation;
  const weight = patch.weight ?? current.weight;
  const role = patch.role ?? current.role;
  const status = patch.status ?? current.status;
  let metadataJson = current.metadata_json || '{}';
  if (patch.metadata) {
    const existing = JSON.parse(metadataJson);
    metadataJson = JSON.stringify({ ...existing, ...patch.metadata });
  }
  db.prepare('UPDATE participants SET reputation=?, weight=?, role=?, status=?, metadata_json=?, updated_at=? WHERE id=?').run(reputation, weight, role, status, metadataJson, Date.now(), id);
  return db.prepare('SELECT * FROM participants WHERE id=?').get(id);
}

export function deleteParticipant(id: string) {
  const result = db.prepare('DELETE FROM participants WHERE id = ?').run(id);
  return result.changes > 0;
}

export function upsertPolicyAssignment(input: { boardId: string; policyId: string; participants: string[]; weightingMode: string; quorum: number }) {
  const ts = Date.now();
  const existing = db.prepare('SELECT id FROM policy_assignments WHERE board_id=? AND policy_id=?').get(input.boardId, input.policyId) as any;
  if (existing) {
    db.prepare('UPDATE policy_assignments SET participants_json=?, weighting_mode=?, quorum=?, updated_at=? WHERE board_id=? AND policy_id=?')
      .run(JSON.stringify(input.participants), input.weightingMode, input.quorum, ts, input.boardId, input.policyId);
  } else {
    db.prepare('INSERT INTO policy_assignments(id,board_id,policy_id,participants_json,weighting_mode,quorum,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(nanoid(), input.boardId, input.policyId, JSON.stringify(input.participants), input.weightingMode, input.quorum, ts, ts);
  }
  return db.prepare('SELECT * FROM policy_assignments WHERE board_id=? AND policy_id=?').get(input.boardId, input.policyId);
}

export function getPolicyAssignment(boardId: string, policyId: string) {
  return db.prepare('SELECT * FROM policy_assignments WHERE board_id=? AND policy_id=?').get(boardId, policyId) as any;
}

export function submitVote(input: { boardId: string; runId: string; participantId: string; decision: string; confidence: number; rationale: string; idempotencyKey: string }) {
  const participant = db.prepare('SELECT * FROM participants WHERE id=?').get(input.participantId) as any;
  if (!participant) throw new Error('participant not found');
  const key = `${input.runId}:${input.participantId}:${input.idempotencyKey}`;
  const existing = db.prepare('SELECT * FROM votes WHERE unique_key=? LIMIT 1').get(key) as any;
  if (existing) return existing;
  const id = nanoid();
  const ts = Date.now();
  db.prepare('INSERT INTO votes(id,board_id,run_id,participant_id,decision,confidence,rationale,weight_snapshot,reputation_snapshot,created_at,unique_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, input.boardId, input.runId, input.participantId, input.decision, input.confidence, input.rationale, participant.weight, participant.reputation, ts, key);
  return db.prepare('SELECT * FROM votes WHERE id=?').get(id);
}

export function listVotes(runId: string) {
  return db.prepare('SELECT * FROM votes WHERE run_id=? ORDER BY created_at ASC').all(runId);
}

export function aggregateVotes(runId: string, quorum: number) {
  const votes = listVotes(runId) as any[];
  const totalWeight = votes.reduce((s, v) => s + Number(v.weight_snapshot || 0), 0);
  const yesWeight = votes.filter(v => String(v.decision).toUpperCase() === 'YES').reduce((s, v) => s + Number(v.weight_snapshot || 0), 0);
  const ratio = totalWeight > 0 ? yesWeight / totalWeight : 0;
  return { votes, totalWeight, yesWeight, ratio, passed: ratio >= quorum };
}
