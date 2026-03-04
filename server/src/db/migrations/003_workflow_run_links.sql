CREATE TABLE IF NOT EXISTS workflow_run_links(
  run_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  external_run_id TEXT,
  cursor_json TEXT,
  updated_at INTEGER NOT NULL
);
