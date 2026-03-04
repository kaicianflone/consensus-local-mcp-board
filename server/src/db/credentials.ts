import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

const ALGO = 'aes-256-gcm';
const IV_LEN = 16;
const TAG_LEN = 16;

let _secret: Buffer | null = null;

function getSecret(db: Database.Database): Buffer {
  if (_secret) return _secret;

  const envSecret = process.env.CREDENTIALS_SECRET;
  if (envSecret) {
    _secret = crypto.scryptSync(envSecret, 'consensus-board-salt', 32);
    return _secret;
  }

  const row = db.prepare("SELECT value FROM _internal_config WHERE key = 'credentials_secret'").get() as { value: string } | undefined;
  if (row) {
    _secret = Buffer.from(row.value, 'hex');
    return _secret;
  }

  db.exec("CREATE TABLE IF NOT EXISTS _internal_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const generated = crypto.randomBytes(32);
  db.prepare("INSERT INTO _internal_config(key, value) VALUES (?, ?)").run('credentials_secret', generated.toString('hex'));
  _secret = generated;
  return _secret;
}

function encrypt(plaintext: string, db: Database.Database): string {
  const secret = getSecret(db);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, secret, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(encoded: string, db: Database.Database): string {
  const secret = getSecret(db);
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, secret, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export function upsertCredential(db: Database.Database, provider: string, keyName: string, value: string) {
  const encrypted = encrypt(value, db);
  const ts = Date.now();
  const existing = db.prepare('SELECT id FROM credentials WHERE provider = ? AND key_name = ?').get(provider, keyName) as { id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE credentials SET value_encrypted = ?, updated_at = ? WHERE provider = ? AND key_name = ?')
      .run(encrypted, ts, provider, keyName);
    return { id: existing.id, provider, keyName, updated: true };
  }
  const id = nanoid();
  db.prepare('INSERT INTO credentials(id, provider, key_name, value_encrypted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, provider, keyName, encrypted, ts, ts);
  return { id, provider, keyName, updated: false };
}

export function getCredential(db: Database.Database, provider: string, keyName: string): string | null {
  const row = db.prepare('SELECT value_encrypted FROM credentials WHERE provider = ? AND key_name = ?').get(provider, keyName) as { value_encrypted: string } | undefined;
  if (!row) return null;
  try {
    return decrypt(row.value_encrypted, db);
  } catch {
    return null;
  }
}

export function listCredentials(db: Database.Database): Array<{ provider: string; keyName: string; createdAt: number; updatedAt: number }> {
  const rows = db.prepare('SELECT provider, key_name, created_at, updated_at FROM credentials ORDER BY provider, key_name').all() as Array<{ provider: string; key_name: string; created_at: number; updated_at: number }>;
  return rows.map(r => ({ provider: r.provider, keyName: r.key_name, createdAt: r.created_at, updatedAt: r.updated_at }));
}

export function deleteCredential(db: Database.Database, provider: string, keyName: string): boolean {
  const result = db.prepare('DELETE FROM credentials WHERE provider = ? AND key_name = ?').run(provider, keyName);
  return result.changes > 0;
}

export function getProviderStatus(db: Database.Database, provider: string): Record<string, boolean> {
  const rows = db.prepare('SELECT key_name FROM credentials WHERE provider = ?').all(provider) as Array<{ key_name: string }>;
  const status: Record<string, boolean> = {};
  rows.forEach(r => { status[r.key_name] = true; });
  return status;
}
