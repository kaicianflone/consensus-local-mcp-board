import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function runMigrations(db: Database.Database) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const dir = path.resolve(process.cwd(), 'server/src/db/migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const exists = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(file);
    if (exists) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?,?)').run(file, Date.now());
  }
}
