import { GuardEvaluateRequestSchema } from '@local-mcp-board/shared';
import { invokeTool } from '../tools/registry.js';

export async function guardEvaluatePost(body: unknown) {
  const input = GuardEvaluateRequestSchema.parse(body);
  const runId = input.runId ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await invokeTool('guard.evaluate', {
    runId,
    boardId: input.boardId,
    policyPack: input.policy.policyId,
    action: {
      type: input.guardType,
      payload: input.payload
    }
  });
  return { ok: true, runId, result };
}
