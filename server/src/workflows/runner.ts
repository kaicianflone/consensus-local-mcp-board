import { createRun, appendEvent, updateRunStatus, createWorkflowRun, updateWorkflowRunStatus } from '../db/store.js';

export async function runWorkflow(definition: any, workflowId: string) {
  const boardId = String(definition?.boardId || 'workflow-system');
  const run = createRun(boardId, { workflow_id: workflowId, source: 'workflow' });
  createWorkflowRun(workflowId, run.id, 'OPEN');

  appendEvent(boardId, run.id, 'WORKFLOW_STARTED', { workflow_id: workflowId, node_count: (definition?.nodes || []).length });

  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  for (const node of nodes) {
    appendEvent(boardId, run.id, 'WORKFLOW_NODE_EXECUTED', {
      workflow_id: workflowId,
      node_id: node.id,
      node_type: node.type,
      label: node.label,
      config: node.config || {}
    });
  }

  appendEvent(boardId, run.id, 'WORKFLOW_COMPLETED', { workflow_id: workflowId, executed: nodes.length });
  updateRunStatus(run.id, 'APPROVED');
  updateWorkflowRunStatus(run.id, 'APPROVED');

  return { runId: run.id, boardId };
}
