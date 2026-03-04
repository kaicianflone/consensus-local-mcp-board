CREATE TABLE IF NOT EXISTS boards(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  config_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs(
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  meta_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events(
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  run_id TEXT,
  type TEXT NOT NULL,
  ts INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  prev_event_id TEXT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations(
  version TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
