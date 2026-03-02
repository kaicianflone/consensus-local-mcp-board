export function err(code, message, details) {
    return { error: { code, message, details } };
}
export function toHttpStatus(code) {
    if (code.includes('NOT_FOUND'))
        return 404;
    if (code.includes('INVALID') || code.includes('BAD_REQUEST'))
        return 400;
    return 500;
}
