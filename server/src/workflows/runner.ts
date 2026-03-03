import {
  appendEvent,
  createRun,
  getRun,
  listEvents,
  updateRunStatus,
  createWorkflowRun,
  updateWorkflowRunStatus,
  upsertWorkflowRunLink,
  getWorkflowRunLink
} from '../db/store.js';
import { evaluateWithAiSdk } from '../adapters/ai-sdk.js';
import { sendHitlPrompt } from '../adapters/chat-sdk.js';

type RunOpts = {
  runId?: string;
  startIndex?: number;
  context?: Record<string, any>;
};

const ENGINE = (process.env.WORKFLOW_ENGINE || 'devkit').toLowerCase();

export async function runWorkflow(definition: any, workflowId: string, opts: RunOpts = {}) {
  if (ENGINE === 'devkit') {
    try {
      return await runWithDevkit(definition, workflowId, opts);
    } catch (e: any) {
      const boardId = String(definition?.boardId || 'workflow-system');
      const runId = opts.runId || `wf-${Date.now()}`;
      appendEvent(boardId, runId, 'WORKFLOW_ENGINE_FALLBACK', {
        workflow_id: workflowId,
        preferred_engine: 'devkit',
        fallback_engine: 'local',
        reason: e?.message || 'devkit unavailable'
      });
    }
  }
  return runWithLocalEngine(definition, workflowId, opts);
}

export async function resumeWorkflow(definition: any, workflowId: string, runId: string, decision: 'YES' | 'NO', approver = 'human') {
  const boardId = String(definition?.boardId || 'workflow-system');
  appendEvent(boardId, runId, 'WORKFLOW_HITL_DECISION', { workflow_id: workflowId, decision, approver });

  if (decision === 'NO') {
    appendEvent(boardId, runId, 'WORKFLOW_BLOCKED_BY_HUMAN', { workflow_id: workflowId, approver });
    updateRunStatus(runId, 'BLOCKED');
    updateWorkflowRunStatus(runId, 'BLOCKED');
    return { runId, boardId, blocked: true };
  }

  const link = getWorkflowRunLink(runId);
  if (link?.engine === 'devkit') {
    try {
      return await resumeWithDevkit(definition, workflowId, runId, approver);
    } catch {
      // fallback below
    }
  }

  const waits = listEvents({ runId, type: 'WORKFLOW_WAITING_HITL', limit: 1 }) as any[];
  const waitPayload = waits[0]?.payload_json ? JSON.parse(String(waits[0].payload_json)) : null;
  const startIndex = typeof waitPayload?.node_index === 'number' ? waitPayload.node_index + 1 : 0;

  return runWithLocalEngine(definition, workflowId, { runId, startIndex, context: { hitlDecision: decision, approvedBy: approver } });
}

async function runWithDevkit(definition: any, workflowId: string, opts: RunOpts = {}) {
  const boardId = String(definition?.boardId || 'workflow-system');
  const runId = ensureRun(boardId, workflowId, opts.runId);

  // Runtime integration point: use Workflow DevKit if available.
  // We use dynamic import by expression to avoid hard compile dependency.
  const importer = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
  const api = await importer('workflow/api');

  // If workflow/api is available, register metadata and execute through local deterministic path
  // while preserving external_run_id linkage. (Next step can move to true start/resume primitives.)
  const externalRunId = `devkit-${runId}`;
  upsertWorkflowRunLink(runId, workflowId, 'devkit', externalRunId, { startIndex: opts.startIndex || 0 });
  appendEvent(boardId, runId, 'WORKFLOW_ENGINE_SELECTED', {
    workflow_id: workflowId,
    engine: 'devkit',
    external_run_id: externalRunId,
    api_loaded: Boolean(api)
  });

  return runWithLocalEngine(definition, workflowId, opts, { engine: 'devkit', externalRunId });
}

async function resumeWithDevkit(definition: any, workflowId: string, runId: string, approver: string) {
  const boardId = String(definition?.boardId || 'workflow-system');
  const link = getWorkflowRunLink(runId);
  appendEvent(boardId, runId, 'WORKFLOW_ENGINE_RESUME', {
    workflow_id: workflowId,
    engine: 'devkit',
    external_run_id: link?.external_run_id || null,
    approver
  });

  const waits = listEvents({ runId, type: 'WORKFLOW_WAITING_HITL', limit: 1 }) as any[];
  const waitPayload = waits[0]?.payload_json ? JSON.parse(String(waits[0].payload_json)) : null;
  const startIndex = typeof waitPayload?.node_index === 'number' ? waitPayload.node_index + 1 : 0;
  return runWithLocalEngine(definition, workflowId, { runId, startIndex, context: { hitlDecision: 'YES', approvedBy: approver } }, { engine: 'devkit', externalRunId: link?.external_run_id || null });
}

function ensureRun(boardId: string, workflowId: string, runId?: string) {
  const existing = runId ? getRun(runId) : null;
  if (existing && runId) return runId;
  const created = createRun(boardId, { workflow_id: workflowId, source: 'workflow' }, runId) as any;
  const id = String(created?.id);
  createWorkflowRun(workflowId, id, 'OPEN');
  return id;
}

async function runWithLocalEngine(definition: any, workflowId: string, opts: RunOpts = {}, link?: { engine: string; externalRunId?: string | null }) {
  const boardId = String(definition?.boardId || 'workflow-system');
  const runId = ensureRun(boardId, workflowId, opts.runId);
  upsertWorkflowRunLink(runId, workflowId, link?.engine || 'local', link?.externalRunId || null, { startIndex: opts.startIndex || 0 });

  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const startIndex = opts.startIndex ?? 0;
  const context: Record<string, any> = { ...(opts.context || {}) };

  appendEvent(boardId, runId, startIndex === 0 ? 'WORKFLOW_STARTED' : 'WORKFLOW_RESUMED', {
    workflow_id: workflowId,
    engine: link?.engine || 'local',
    node_count: nodes.length,
    start_index: startIndex
  });

  for (let i = startIndex; i < nodes.length; i++) {
    const node = nodes[i];
    const startedAt = Date.now();
    appendEvent(boardId, runId, 'WORKFLOW_NODE_STARTED', {
      workflow_id: workflowId,
      node_index: i,
      node_id: node.id,
      node_type: node.type,
      label: node.label
    });

    try {
      const output = await executeNode(node, context, { boardId, runId, workflowId });
      context[node.id] = output;

      appendEvent(boardId, runId, 'WORKFLOW_NODE_EXECUTED', {
        workflow_id: workflowId,
        node_index: i,
        node_id: node.id,
        node_type: node.type,
        duration_ms: Date.now() - startedAt,
        output
      });

      if (output?.pause === true && node.type === 'hitl') {
        appendEvent(boardId, runId, 'WORKFLOW_WAITING_HITL', {
          workflow_id: workflowId,
          node_index: i,
          node_id: node.id,
          reason: 'Human approval required'
        });
        updateRunStatus(runId, 'WAITING_HUMAN');
        updateWorkflowRunStatus(runId, 'WAITING_HUMAN');
        upsertWorkflowRunLink(runId, workflowId, link?.engine || 'local', link?.externalRunId || null, { waitNodeIndex: i, contextKeys: Object.keys(context) });
        return { runId, boardId, paused: true, waitNodeIndex: i };
      }
    } catch (error: any) {
      appendEvent(boardId, runId, 'WORKFLOW_NODE_FAILED', {
        workflow_id: workflowId,
        node_index: i,
        node_id: node.id,
        node_type: node.type,
        error: error?.message || 'unknown'
      });
      updateRunStatus(runId, 'BLOCKED');
      updateWorkflowRunStatus(runId, 'BLOCKED');
      return { runId, boardId, failed: true, error: error?.message || 'unknown' };
    }
  }

  appendEvent(boardId, runId, 'WORKFLOW_COMPLETED', { workflow_id: workflowId, executed: nodes.length });
  updateRunStatus(runId, 'APPROVED');
  updateWorkflowRunStatus(runId, 'APPROVED');
  return { runId, boardId, completed: true };
}

async function executeNode(node: any, context: Record<string, any>, ids: { boardId: string; runId: string; workflowId: string }) {
  if (node.type === 'trigger') return { ok: true, trigger: node.config?.mode || 'manual' };

  if (node.type === 'agent') {
    const votes = await evaluateWithAiSdk({
      runId: ids.runId,
      boardId: ids.boardId,
      guardType: 'agent_action',
      payload: { input: context, prompt: node.config?.prompt || '', nodeConfig: node.config || {} },
      policy: { policyId: 'agent-node', version: 'v1', quorum: 0.7, riskThreshold: 0.7, hitlRequiredAboveRisk: 0.7, options: {} },
      idempotencyKey: `${ids.runId}:${node.id}`
    });
    return { votes };
  }

  if (node.type === 'guard') {
    const votes = await evaluateWithAiSdk({
      runId: ids.runId,
      boardId: ids.boardId,
      guardType: node.config?.guardType || 'agent_action',
      payload: { input: context, guardConfig: node.config || {} },
      policy: {
        policyId: 'guard-node',
        version: 'v1',
        quorum: Number(node.config?.quorum ?? 0.7),
        riskThreshold: Number(node.config?.riskThreshold ?? 0.7),
        hitlRequiredAboveRisk: Number(node.config?.hitlThreshold ?? 0.7),
        options: { assignedAgents: node.config?.assignedAgents || [], weights: node.config?.weights || {} }
      },
      idempotencyKey: `${ids.runId}:${node.id}`
    });
    const top = votes[0] || { vote: 'YES', risk: 0 };
    return {
      decision: top.vote === 'NO' ? 'BLOCK' : top.vote === 'REWRITE' ? 'REWRITE' : 'ALLOW',
      risk: top.risk,
      reasons: votes.map((v) => v.reason)
    };
  }

  if (node.type === 'hitl') {
    const guardDecision = Object.values(context).find((v: any) => v?.decision && v?.risk !== undefined) as any;
    const risk = Number(guardDecision?.risk ?? 0.5);
    const threshold = Number(node.config?.threshold ?? 0.7);
    if (risk < threshold) return { pause: false, skipped: true, risk, threshold };

    await sendHitlPrompt({
      boardId: ids.boardId,
      runId: ids.runId,
      quorum: 0.7,
      risk,
      threshold,
      approverHint: node.config?.approver || 'human'
    });
    return { pause: true, risk, threshold };
  }

  if (node.type === 'action') {
    return { ok: true, action: node.config?.action || 'noop', inputKeys: Object.keys(context) };
  }

  return { ok: true };
}
