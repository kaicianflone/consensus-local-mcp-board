CREATE TABLE IF NOT EXISTS agents(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  boards_json TEXT NOT NULL,
  workflows_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants(
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  role TEXT NOT NULL,
  weight REAL NOT NULL,
  reputation REAL NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS votes(
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  confidence REAL NOT NULL,
  rationale TEXT NOT NULL,
  weight_snapshot REAL NOT NULL,
  reputation_snapshot REAL NOT NULL,
  created_at INTEGER NOT NULL,
  unique_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS policy_assignments(
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  participants_json TEXT NOT NULL,
  weighting_mode TEXT NOT NULL,
  quorum REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(board_id, policy_id)
);
