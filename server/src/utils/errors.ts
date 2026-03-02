export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export function err(code: string, message: string, details?: unknown): ApiError {
  return { error: { code, message, details } };
}

export function toHttpStatus(code: string): number {
  if (code.includes('NOT_FOUND')) return 404;
  if (code.includes('INVALID') || code.includes('BAD_REQUEST')) return 400;
  return 500;
}
