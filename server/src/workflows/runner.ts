import {
  appendEvent,
  createRun,
  getRun,
  listEvents,
  updateRunStatus,
  createWorkflowRun,
  updateWorkflowRunStatus,
  upsertWorkflowRunLink,
  getWorkflowRunLink,
  listParticipants,
  createParticipant
} from '../db/store.js';
import { evaluateWithAiSdk, type AgentPersona } from '../adapters/ai-sdk.js';
import { sendHumanApprovalPrompt } from '../adapters/chat-sdk.js';
import { evaluateViaConsensusTools } from '../adapters/consensus-tools.js';

const REVIEWER_ARCHETYPES = [
  'security-reviewer',
  'performance-analyst',
  'code-quality-reviewer',
  'architecture-reviewer',
  'reliability-engineer',
  'api-design-reviewer',
  'data-integrity-analyst',
  'scalability-reviewer',
  'compliance-auditor',
  'ux-impact-reviewer',
];

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
  return executeLocalFlow(definition, workflowId, opts);
}

export async function resumeWorkflow(definition: any, workflowId: string, runId: string, decision: 'YES' | 'NO' | 'REWRITE', approver = 'human') {
  const boardId = String(definition?.boardId || 'workflow-system');
  appendEvent(boardId, runId, 'WORKFLOW_HUMAN_APPROVAL_DECISION', { workflow_id: workflowId, decision, approver });

  if (decision === 'NO') {
    appendEvent(boardId, runId, 'WORKFLOW_BLOCKED_BY_HUMAN', { workflow_id: workflowId, approver });
    updateRunStatus(runId, 'BLOCKED');
    updateWorkflowRunStatus(runId, 'BLOCKED');
    return { runId, boardId, blocked: true };
  }

  if (decision === 'REWRITE') {
    appendEvent(boardId, runId, 'WORKFLOW_REVISION_REQUESTED', { workflow_id: workflowId, approver });
    updateRunStatus(runId, 'REVISION_REQUESTED');
    updateWorkflowRunStatus(runId, 'REVISION_REQUESTED');
    return { runId, boardId, revisionRequested: true };
  }

  const link = getWorkflowRunLink(runId);
  if (link?.engine === 'devkit') {
    try {
      return await resumeWithDevkit(definition, workflowId, runId, approver);
    } catch {
      // fallback below
    }
  }

  const waits = listEvents({ runId, type: 'WORKFLOW_WAITING_HUMAN_APPROVAL', limit: 1 }) as any[];
  const waitPayload = waits[0]?.payload_json ? JSON.parse(String(waits[0].payload_json)) : null;
  const startIndex = typeof waitPayload?.node_index === 'number' ? waitPayload.node_index + 1 : 0;

  return executeLocalFlow(definition, workflowId, { runId, startIndex, context: { hitlDecision: decision, approvedBy: approver } });
}

async function runWithDevkit(definition: any, workflowId: string, opts: RunOpts = {}) {
  const boardId = String(definition?.boardId || 'workflow-system');
  const runId = ensureRun(boardId, workflowId, opts.runId);

  const importer = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
  const api = await importer('workflow/api');
  const jobs = await importer(new URL('./devkit-job.js', import.meta.url).href);

  const start = api?.start;
  const job = jobs?.devkitRunWorkflowJob;
  if (typeof start !== 'function' || typeof job !== 'function') {
    throw new Error('workflow/api start or devkit job not available');
  }

  const started = await start(job, [{
    definition,
    workflowId,
    runId,
    startIndex: opts.startIndex || 0,
    context: opts.context || {}
  }]);

  const externalRunId = started?.id || started?.runId || started?.workflowRunId || `devkit-${runId}`;
  upsertWorkflowRunLink(runId, workflowId, 'devkit', String(externalRunId), { startIndex: opts.startIndex || 0 });
  appendEvent(boardId, runId, 'WORKFLOW_ENGINE_SELECTED', {
    workflow_id: workflowId,
    engine: 'devkit',
    external_run_id: externalRunId,
    api_loaded: true
  });

  return { runId, boardId, engine: 'devkit', externalRunId };
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

  const waits = listEvents({ runId, type: 'WORKFLOW_WAITING_HUMAN_APPROVAL', limit: 1 }) as any[];
  const waitPayload = waits[0]?.payload_json ? JSON.parse(String(waits[0].payload_json)) : null;
  const startIndex = typeof waitPayload?.node_index === 'number' ? waitPayload.node_index + 1 : 0;

  const importer = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
  const api = await importer('workflow/api');
  const jobs = await importer(new URL('./devkit-job.js', import.meta.url).href);
  const start = api?.start;
  const job = jobs?.devkitRunWorkflowJob;
  if (typeof start !== 'function' || typeof job !== 'function') {
    throw new Error('workflow/api start or devkit job not available');
  }

  const resumed = await start(job, [{
    definition,
    workflowId,
    runId,
    startIndex,
    context: { hitlDecision: 'YES', approvedBy: approver }
  }]);

  const externalRunId = resumed?.id || resumed?.runId || resumed?.workflowRunId || link?.external_run_id || `devkit-${runId}`;
  upsertWorkflowRunLink(runId, workflowId, 'devkit', String(externalRunId), { startIndex, resumedBy: approver });
  return { runId, boardId, engine: 'devkit', externalRunId, resumed: true };
}

function ensureRun(boardId: string, workflowId: string, runId?: string) {
  const existing = runId ? getRun(runId) : null;
  if (existing && runId) return runId;
  const created = createRun(boardId, { workflow_id: workflowId, source: 'workflow' }, runId) as any;
  const id = String(created?.id);
  createWorkflowRun(workflowId, id, 'OPEN');
  return id;
}

export async function executeLocalFlow(definition: any, workflowId: string, opts: RunOpts = {}, link?: { engine: string; externalRunId?: string | null }) {
  const boardId = String(definition?.boardId || 'workflow-system');
  const runId = ensureRun(boardId, workflowId, opts.runId);
  const existingLink = getWorkflowRunLink(runId);
  const engine = link?.engine || existingLink?.engine || 'local';
  const externalRunId = link?.externalRunId || existingLink?.external_run_id || null;
  upsertWorkflowRunLink(runId, workflowId, engine, externalRunId, { startIndex: opts.startIndex || 0 });

  const nodes = Array.isArray(definition?.nodes) ? definition.nodes : [];
  const startIndex = opts.startIndex ?? 0;
  const context: Record<string, any> = { ...(opts.context || {}) };

  appendEvent(boardId, runId, startIndex === 0 ? 'WORKFLOW_STARTED' : 'WORKFLOW_RESUMED', {
    workflow_id: workflowId,
    engine,
    external_run_id: externalRunId,
    node_count: nodes.length,
    start_index: startIndex
  });

  for (let i = startIndex; i < nodes.length; i++) {
    const node = nodes[i];
    const startedAt = Date.now();
    appendEvent(boardId, runId, 'WORKFLOW_NODE_STARTED', {
      workflow_id: workflowId,
      engine,
      external_run_id: externalRunId,
      external_step_id: externalRunId ? `${externalRunId}:step:${i}:start` : null,
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
        engine,
        external_run_id: externalRunId,
        external_step_id: externalRunId ? `${externalRunId}:step:${i}:done` : null,
        node_index: i,
        node_id: node.id,
        node_type: node.type,
        duration_ms: Date.now() - startedAt,
        output
      });

      if (output?.pause === true && (node.type === 'hitl' || node.type === 'group')) {
        appendEvent(boardId, runId, 'WORKFLOW_WAITING_HUMAN_APPROVAL', {
          workflow_id: workflowId,
          engine,
          external_run_id: externalRunId,
          external_step_id: externalRunId ? `${externalRunId}:step:${i}:wait` : null,
          node_index: i,
          node_id: node.id,
          reason: 'Human approval required'
        });
        updateRunStatus(runId, 'WAITING_HUMAN');
        updateWorkflowRunStatus(runId, 'WAITING_HUMAN');
        upsertWorkflowRunLink(runId, workflowId, engine, externalRunId, { waitNodeIndex: i, contextKeys: Object.keys(context) });
        return { runId, boardId, paused: true, waitNodeIndex: i };
      }
    } catch (error: any) {
      appendEvent(boardId, runId, 'WORKFLOW_NODE_FAILED', {
        workflow_id: workflowId,
        engine,
        external_run_id: externalRunId,
        external_step_id: externalRunId ? `${externalRunId}:step:${i}:fail` : null,
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

  appendEvent(boardId, runId, 'WORKFLOW_COMPLETED', { workflow_id: workflowId, engine, external_run_id: externalRunId, executed: nodes.length });
  updateRunStatus(runId, 'APPROVED');
  updateWorkflowRunStatus(runId, 'APPROVED');
  return { runId, boardId, completed: true };
}

async function executeNode(node: any, context: Record<string, any>, ids: { boardId: string; runId: string; workflowId: string }) {
  if (node.type === 'trigger') {
    const source = node.config?.source || node.config?.mode || 'manual';
    if (String(source).startsWith('github.')) {
      return { ok: true, trigger: source, provider: node.config?.provider || 'github-mcp', repo: node.config?.repo || '', branch: node.config?.branch || 'main' };
    }
    if (String(source).startsWith('chat.')) {
      return {
        ok: true,
        trigger: source,
        channel: node.config?.channel || 'slack',
        chatType: node.config?.chatType || 'group',
        matchText: node.config?.matchText || '',
        fromUsers: node.config?.fromUsers || ''
      };
    }
    return { ok: true, trigger: source };
  }

  if (node.type === 'agent') {
    const agentCount = Math.max(1, Math.min(10, Number(node.config?.agentCount ?? 3)));
    const personaMode = node.config?.personaMode || 'auto';
    const model = node.config?.model || 'gpt-4o-mini';
    const temperature = Number(node.config?.temperature ?? 0);
    const systemPrompt = node.config?.systemPrompt || '';

    const personas: AgentPersona[] = await resolvePersonas(ids.boardId, agentCount, personaMode, node.config?.personaNames || '');

    const votes = await evaluateWithAiSdk(
      {
        runId: ids.runId,
        boardId: ids.boardId,
        guardType: 'agent_action',
        payload: { input: context, prompt: node.config?.prompt || '', nodeConfig: node.config || {} },
        policy: { policyId: 'agent-node', version: 'v1', quorum: 0.7, riskThreshold: 0.7, hitlRequiredAboveRisk: 0.7, options: {} },
        idempotencyKey: `${ids.runId}:${node.id}`
      },
      { agentCount, personas, model, temperature, systemPrompt }
    );

    let totalWeight = 0;
    let weightedRisk = 0;
    for (let i = 0; i < votes.length; i++) {
      const rep = personas[i]?.reputation ?? 0.5;
      totalWeight += rep;
      weightedRisk += votes[i].risk * rep;
    }
    const aggregatedRisk = totalWeight > 0 ? weightedRisk / totalWeight : votes.length > 0 ? votes.reduce((s, v) => s + v.risk, 0) / votes.length : 0.5;

    return { votes, aggregatedRisk, agentCount, personas: personas.map((p) => ({ name: p.name, reputation: p.reputation })) };
  }

  if (node.type === 'guard') {
    const consensus = evaluateViaConsensusTools({
      runId: ids.runId,
      boardId: ids.boardId,
      guardType: String(node.config?.guardType || 'agent_action'),
      payload: { input: context, guardConfig: node.config || {} },
      policyPack: String(node.config?.policyPack || '')
    });

    return {
      decision: consensus.decision === 'ALLOW' ? 'ALLOW' : consensus.decision === 'BLOCK' ? 'BLOCK' : 'REWRITE',
      risk: Number(consensus.risk_score ?? 0.6),
      reasons: [consensus.reason],
      consensus: consensus.meta || null
    };
  }

  if (node.type === 'hitl') {
    const guardDecision = Object.values(context).find((v: any) => v?.decision && v?.risk !== undefined) as any;
    const risk = Number(guardDecision?.risk ?? 0.5);
    const threshold = Number(node.config?.threshold ?? 0.7);
    if (risk < threshold) return { pause: false, skipped: true, risk, threshold };

    const boardParticipants = listParticipants(ids.boardId) as any[];
    const chatLinkedParticipants = boardParticipants
      .filter((p: any) => {
        const meta = typeof p.metadata_json === 'string' ? JSON.parse(p.metadata_json) : (p.metadata_json || {});
        return meta.chatAdapter && meta.chatHandle;
      })
      .map((p: any) => {
        const meta = typeof p.metadata_json === 'string' ? JSON.parse(p.metadata_json) : (p.metadata_json || {});
        return { subjectId: p.subject_id, adapter: meta.chatAdapter, handle: meta.chatHandle };
      });

    const promptMode = node.config?.promptMode || 'yes-no';
    await sendHumanApprovalPrompt({
      boardId: ids.boardId,
      runId: ids.runId,
      quorum: 0.7,
      risk,
      threshold,
      promptMode,
      approverHint: node.config?.approver || 'human',
      chatTargets: chatLinkedParticipants.length > 0 ? chatLinkedParticipants : undefined
    });
    return { pause: true, risk, threshold, promptMode, chatTargets: chatLinkedParticipants };
  }

  if (node.type === 'group') {
    const children = Array.isArray(node.config?.children) ? node.config.children : [];
    if (!children.length) return { ok: true, group: true, children: [] };

    const childResults = await Promise.all(
      children.map((child: any) => executeNode(child, context, ids))
    );

    const merged: Record<string, any> = {};
    let hasPause = false;
    let pauseDetails: any = null;
    for (let i = 0; i < children.length; i++) {
      merged[children[i].id] = childResults[i];
      context[children[i].id] = childResults[i];
      if (childResults[i]?.pause === true) {
        hasPause = true;
        pauseDetails = { childId: children[i].id, childType: children[i].type, ...childResults[i] };
      }
    }

    if (hasPause) {
      return { pause: true, group: true, children: children.map((c: any) => c.id), results: merged, pauseDetails };
    }

    return { ok: true, group: true, children: children.map((c: any) => c.id), results: merged };
  }

  if (node.type === 'action') {
    return { ok: true, action: node.config?.action || 'noop', inputKeys: Object.keys(context) };
  }

  return { ok: true };
}

function parseParticipantMetadata(p: any): Record<string, any> {
  try {
    return JSON.parse(p.metadata_json || '{}');
  } catch {
    return {};
  }
}

async function resolvePersonas(boardId: string, agentCount: number, personaMode: string, personaNamesRaw: string): Promise<AgentPersona[]> {
  const personas: AgentPersona[] = [];

  if (personaMode === 'manual' && personaNamesRaw.trim()) {
    const names = personaNamesRaw.split(',').map((n) => n.trim()).filter(Boolean);
    const existing = listParticipants(boardId) as any[];
    for (let i = 0; i < agentCount; i++) {
      const name = names[i % names.length];
      let participant = existing.find((p: any) => p.subject_id === name);
      if (!participant) {
        participant = createParticipant({ boardId, subjectType: 'agent', subjectId: name, role: 'reviewer', weight: 1, reputation: 0.5 });
      }
      const meta = parseParticipantMetadata(participant);
      personas.push({
        name,
        reputation: Number(participant?.reputation ?? 0.5),
        systemPrompt: meta.systemPrompt || undefined,
        model: meta.model || undefined,
        temperature: meta.temperature !== undefined ? Number(meta.temperature) : undefined,
      });
    }
  } else {
    const existing = listParticipants(boardId) as any[];
    const internalAgents = existing.filter((p: any) => {
      if (p.subject_type !== 'agent') return false;
      const meta = parseParticipantMetadata(p);
      return meta.agentType === 'internal' || !meta.agentType;
    });
    for (let i = 0; i < agentCount; i++) {
      if (i < internalAgents.length) {
        const p = internalAgents[i];
        const meta = parseParticipantMetadata(p);
        personas.push({
          name: p.subject_id,
          reputation: Number(p.reputation ?? 0.5),
          systemPrompt: meta.systemPrompt || undefined,
          model: meta.model || undefined,
          temperature: meta.temperature !== undefined ? Number(meta.temperature) : undefined,
        });
      } else {
        const archetype = REVIEWER_ARCHETYPES[i % REVIEWER_ARCHETYPES.length];
        const alreadyExists = existing.find((p: any) => p.subject_id === archetype);
        if (!alreadyExists) {
          createParticipant({ boardId, subjectType: 'agent', subjectId: archetype, role: 'reviewer', weight: 1, reputation: 0.5 });
        }
        personas.push({ name: archetype, reputation: Number(alreadyExists?.reputation ?? 0.5) });
      }
    }
  }

  return personas;
}
