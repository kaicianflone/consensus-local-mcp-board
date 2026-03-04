const SECRET_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'apikey',
  'token',
  'password',
  'secret'
]);

export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redact) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(k.toLowerCase())) out[k] = '[REDACTED]';
      else out[k] = redact(v);
    }
    return out as T;
  }
  return value;
}
