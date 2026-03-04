import { GuardEvaluateRequestSchema } from '@local-mcp-board/shared';
import { executeGuardEvaluate } from '../workflows/guard-evaluate.js';

export async function guardEvaluatePost(body: unknown) {
  const input = GuardEvaluateRequestSchema.parse(body);
  const result = await executeGuardEvaluate(input);
  return { ok: true, runId: input.runId, result };
}
