const SECRET_KEYS = new Set([
    'authorization',
    'cookie',
    'set-cookie',
    'apikey',
    'token',
    'password',
    'secret'
]);
export function redact(value) {
    if (Array.isArray(value))
        return value.map(redact);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (SECRET_KEYS.has(k.toLowerCase()))
                out[k] = '[REDACTED]';
            else
                out[k] = redact(v);
        }
        return out;
    }
    return value;
}
