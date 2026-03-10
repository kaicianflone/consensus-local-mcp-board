CREATE TABLE IF NOT EXISTS cron_schedules (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
