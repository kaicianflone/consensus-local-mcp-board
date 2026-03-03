import { executeLocalFlow } from './runner.js';

export async function devkitRunWorkflowJob(payload: {
  definition: any;
  workflowId: string;
  runId: string;
  startIndex?: number;
  context?: Record<string, any>;
}) {
  'use workflow';
  return executeLocalFlow(payload.definition, payload.workflowId, {
    runId: payload.runId,
    startIndex: payload.startIndex,
    context: payload.context
  }, { engine: 'devkit' });
}
