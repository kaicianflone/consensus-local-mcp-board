import { executeLocalFlow } from './runner.js';

/**
 * Durable workflow job entry point for the Workflow DevKit.
 * The "use workflow" directive makes this function a durable workflow —
 * the SDK will handle suspension, resumption, retries and observability.
 */
export async function devkitRunWorkflowJob(payload: {
  definition: any;
  workflowId: string;
  runId: string;
  startIndex?: number;
  context?: Record<string, any>;
}) {
  'use workflow';

  const result = await runFlow(payload);
  return result;
}

/**
 * Step: delegate to the local flow executor.
 * Wrapped as a step so the SDK tracks it as a single retryable unit.
 */
async function runFlow(payload: {
  definition: any;
  workflowId: string;
  runId: string;
  startIndex?: number;
  context?: Record<string, any>;
}) {
  'use step';
  return executeLocalFlow(payload.definition, payload.workflowId, {
    runId: payload.runId,
    startIndex: payload.startIndex,
    context: payload.context
  });
}
