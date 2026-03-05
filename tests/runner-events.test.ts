import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──

const {
  mockAppendEvent,
  mockCreateRun,
  mockGetRun,
  mockUpdateRunStatus,
  mockCreateWorkflowRun,
  mockUpdateWorkflowRunStatus,
  mockUpsertWorkflowRunLink,
  mockListEvents,
  mockListParticipants,
  mockCreateParticipant,
  mockUpdateParticipant,
  mockGetPolicyAssignment,
  mockEvaluateWithAiSdk,
  mockEvaluateViaConsensusTools,
  mockResolveVerdictsViaBoard,
  mockComputeReputationFromLedger,
  mockSendHumanApprovalPrompt,
  mockRegisterPendingApproval,
} = vi.hoisted(() => ({
  mockAppendEvent: vi.fn(),
  mockCreateRun: vi.fn(() => ({ id: 'run-test-1' })),
  mockGetRun: vi.fn(),
  mockUpdateRunStatus: vi.fn(),
  mockCreateWorkflowRun: vi.fn(),
  mockUpdateWorkflowRunStatus: vi.fn(),
  mockUpsertWorkflowRunLink: vi.fn(),
  mockListEvents: vi.fn(() => []),
  mockListParticipants: vi.fn(() => []),
  mockCreateParticipant: vi.fn((input: any) => ({
    id: `p-${input.subjectId}`,
    subject_id: input.subjectId,
    subject_type: input.subjectType,
    weight: input.weight ?? 1,
    reputation: input.reputation ?? 100,
    metadata_json: '{}',
  })),
  mockUpdateParticipant: vi.fn(),
  mockGetPolicyAssignment: vi.fn(() => ({ weighting_mode: 'hybrid', quorum: 0.6 })),
  mockEvaluateWithAiSdk: vi.fn(async () => [
    { evaluator: 'security-reviewer', vote: 'YES', reason: 'Looks safe', risk: 0.2 },
    { evaluator: 'performance-analyst', vote: 'YES', reason: 'No perf issues', risk: 0.3 },
    { evaluator: 'code-quality-reviewer', vote: 'REWRITE', reason: 'Needs cleanup', risk: 0.6 },
  ]),
  mockEvaluateViaConsensusTools: vi.fn(() => ({
    decision: 'ALLOW',
    risk_score: 0.35,
    reason: 'Consensus local board: proposal selected as winner',
    meta: { engine: 'consensus-local-board' },
  })),
  mockResolveVerdictsViaBoard: vi.fn((_input: any, verdicts: any[], quorum: number, riskThreshold: number) => {
    // Replicate the three-step model: combined risk → quorum → allow
    let riskNum = 0, riskDen = 0, weightedYes = 0, totalWeight = 0;
    let yes = 0, no = 0, rewrite = 0;
    for (const v of verdicts) {
      riskNum += v.risk * v.weight;
      riskDen += v.weight;
      totalWeight += v.weight;
      if (v.verdict === 'YES') { yes++; weightedYes += v.weight; }
      else if (v.verdict === 'NO') { no++; }
      else if (v.verdict === 'REWRITE') { rewrite++; }
    }
    const combinedRisk = riskDen > 0 ? riskNum / riskDen : 0.5;
    const weightedYesRatio = totalWeight > 0 ? weightedYes / totalWeight : 0;
    const quorumMet = totalWeight >= quorum && verdicts.length > 0;
    let decision: string;
    if (combinedRisk > riskThreshold) decision = 'BLOCK';
    else if (!quorumMet || weightedYesRatio < quorum) decision = 'REQUIRE_HUMAN';
    else decision = 'ALLOW';
    return {
      decision,
      combinedRisk,
      weightedYesRatio,
      quorumMet,
      tally: { yes, no, rewrite, voterCount: verdicts.length, totalWeight },
      reason: `Board resolved: ${decision}`,
      audit_id: `board-test`,
      meta: { engine: 'consensus-local-board', mode: 'VOTING' },
    };
  }),
  mockSendHumanApprovalPrompt: vi.fn(async () => {}),
  mockRegisterPendingApproval: vi.fn(),
  mockComputeReputationFromLedger: vi.fn(() => 100),
}));

vi.mock('workflow', () => ({
  sleep: vi.fn(async () => {}),
  FatalError: class FatalError extends Error {
    constructor(msg: string) { super(msg); this.name = 'FatalError'; }
  },
}));

vi.mock('../server/src/db/store.js', () => ({
  db: {},
  appendEvent: mockAppendEvent,
  createRun: mockCreateRun,
  getRun: mockGetRun,
  updateRunStatus: mockUpdateRunStatus,
  createWorkflowRun: mockCreateWorkflowRun,
  updateWorkflowRunStatus: mockUpdateWorkflowRunStatus,
  upsertWorkflowRunLink: mockUpsertWorkflowRunLink,
  listEvents: mockListEvents,
  listParticipants: mockListParticipants,
  createParticipant: mockCreateParticipant,
  updateParticipant: mockUpdateParticipant,
  getPolicyAssignment: mockGetPolicyAssignment,
}));

vi.mock('../server/src/adapters/ai-sdk.js', () => ({
  evaluateWithAiSdk: mockEvaluateWithAiSdk,
}));

vi.mock('../server/src/adapters/consensus-tools.js', () => ({
  evaluateViaConsensusTools: mockEvaluateViaConsensusTools,
  resolveVerdictsViaBoard: mockResolveVerdictsViaBoard,
  computeReputationFromLedger: mockComputeReputationFromLedger,
}));

vi.mock('../server/src/adapters/chat-sdk.js', () => ({
  sendHumanApprovalPrompt: mockSendHumanApprovalPrompt,
}));

vi.mock('../server/src/engine/hitl-tracker.js', () => ({
  registerPendingApproval: mockRegisterPendingApproval,
}));

import { executeLocalFlow } from '../server/src/workflows/runner.js';

// ── Helpers ──

function getEventsOfType(type: string) {
  return mockAppendEvent.mock.calls.filter(([, , t]: any) => t === type);
}

function getAllEventTypes(): string[] {
  return mockAppendEvent.mock.calls.map(([, , t]: any) => t);
}

function makeWorkflow(nodes: any[], boardId = 'board-1') {
  return { boardId, nodes };
}

const guardNode = {
  id: 'guard-code-merge',
  type: 'guard',
  label: 'Code Merge Guard',
  config: { guardType: 'code_merge', quorum: 0.6, riskThreshold: 0.7, policyPack: 'merge-default' },
};

const agentNode = {
  id: 'agent-review',
  type: 'agent',
  label: 'Agent Review',
  config: { agentCount: 3, personaMode: 'auto', model: 'gpt-4o-mini' },
};

const triggerNode = {
  id: 'trigger-manual',
  type: 'trigger',
  label: 'Manual Trigger',
  config: { source: 'manual' },
};

// ── Tests ──

describe('Runner event emissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset implementations that setupVerdictEvents may have overridden
    mockListEvents.mockImplementation(() => []);
    // Default: no existing participants, so resolvePersonas creates archetypes
    mockListParticipants.mockReturnValue([]);
  });

  function setupVerdictEvents(verdicts: Array<{ verdict: string; risk: number; weight: number }>) {
    mockListEvents.mockImplementation((filters: any) => {
      if (filters?.type === 'AGENT_VERDICT') {
        return verdicts.map((v, i) => ({
          payload_json: JSON.stringify({
            evaluator: `agent-${i}`,
            verdict: v.verdict,
            risk: v.risk,
            weight: v.weight,
            reason: `Test reason ${i}`,
          }),
        }));
      }
      return [];
    });
  }

  // ── Guard node ──

  describe('Guard node (harness)', () => {
    it('should NOT emit AGENT_VERDICT for guard nodes', async () => {
      const def = makeWorkflow([triggerNode, guardNode]);
      await executeLocalFlow(def, 'wf-1');

      const verdicts = getEventsOfType('AGENT_VERDICT');
      expect(verdicts).toHaveLength(0);
    });

    it('should NOT emit board scores when guard has no agent verdicts', async () => {
      const def = makeWorkflow([triggerNode, guardNode]);
      await executeLocalFlow(def, 'wf-1');

      const riskScores = getEventsOfType('RISK_SCORE');
      const quorums = getEventsOfType('CONSENSUS_QUORUM');
      expect(riskScores).toHaveLength(0);
      expect(quorums).toHaveLength(0);
    });

    it('should use standalone evaluateViaConsensusTools when no agent verdicts exist', async () => {
      const def = makeWorkflow([triggerNode, guardNode]);
      await executeLocalFlow(def, 'wf-1');

      expect(mockEvaluateViaConsensusTools).toHaveBeenCalledTimes(1);
      expect(mockResolveVerdictsViaBoard).not.toHaveBeenCalled();
    });

    it('should use resolveVerdictsViaBoard when agent verdicts exist', async () => {
      setupVerdictEvents([
        { verdict: 'YES', risk: 0.2, weight: 1 },
        { verdict: 'YES', risk: 0.3, weight: 1 },
      ]);

      const def = makeWorkflow([triggerNode, agentNode, guardNode]);
      await executeLocalFlow(def, 'wf-1');

      expect(mockResolveVerdictsViaBoard).toHaveBeenCalled();
      expect(mockEvaluateViaConsensusTools).not.toHaveBeenCalled();
    });

    it('should sanitize guard node output in WORKFLOW_NODE_EXECUTED event', async () => {
      const def = makeWorkflow([triggerNode, guardNode]);
      await executeLocalFlow(def, 'wf-1');

      const executed = getEventsOfType('WORKFLOW_NODE_EXECUTED');
      const guardExec = executed.find(([, , , p]: any) => p.node_type === 'guard');
      expect(guardExec).toBeDefined();

      const payload = guardExec![3];
      // Should have harness config, NOT verdict fields
      expect(payload.output).toHaveProperty('guardType', 'code_merge');
      expect(payload.output).toHaveProperty('configured', true);
      expect(payload.output).not.toHaveProperty('decision');
      expect(payload.output).not.toHaveProperty('risk');
      expect(payload.output).not.toHaveProperty('reasons');
    });

    it('should still populate context with full guard output for downstream nodes', async () => {
      // The guard node's full output goes into context, not the event log
      const def = makeWorkflow([guardNode]);
      const result = await executeLocalFlow(def, 'wf-1');
      expect(result.completed).toBe(true);
      // We can verify the guard adapter was called
      expect(mockEvaluateViaConsensusTools).toHaveBeenCalledTimes(1);
    });
  });

  // ── Agent node ──

  describe('Agent node verdicts', () => {
    it('should emit one AGENT_VERDICT per evaluator', async () => {
      const def = makeWorkflow([triggerNode, agentNode]);
      await executeLocalFlow(def, 'wf-1');

      const verdicts = getEventsOfType('AGENT_VERDICT');
      expect(verdicts).toHaveLength(3);
    });

    it('should include participant weight (not reputation) in AGENT_VERDICT', async () => {
      // Set up participants with different weights
      mockListParticipants.mockReturnValue([
        { subject_id: 'security-reviewer', subject_type: 'agent', weight: 2, reputation: 100, metadata_json: '{}' },
        { subject_id: 'performance-analyst', subject_type: 'agent', weight: 1.5, reputation: 100, metadata_json: '{}' },
        { subject_id: 'code-quality-reviewer', subject_type: 'agent', weight: 1, reputation: 100, metadata_json: '{}' },
      ]);

      const def = makeWorkflow([agentNode]);
      await executeLocalFlow(def, 'wf-1');

      const verdicts = getEventsOfType('AGENT_VERDICT');
      expect(verdicts).toHaveLength(3);

      expect(verdicts[0][3].weight).toBe(2);
      expect(verdicts[1][3].weight).toBe(1.5);
      expect(verdicts[2][3].weight).toBe(1);
    });

    it('should default weight to 1 when participant has no weight set', async () => {
      mockListParticipants.mockReturnValue([]);

      const def = makeWorkflow([agentNode]);
      await executeLocalFlow(def, 'wf-1');

      const verdicts = getEventsOfType('AGENT_VERDICT');
      for (const v of verdicts) {
        expect(v[3].weight).toBe(1);
      }
    });

    it('should include verdict, evaluator, risk, and reason in AGENT_VERDICT', async () => {
      const def = makeWorkflow([agentNode]);
      await executeLocalFlow(def, 'wf-1');

      const verdicts = getEventsOfType('AGENT_VERDICT');
      const first = verdicts[0][3];
      expect(first).toHaveProperty('evaluator', 'security-reviewer');
      expect(first).toHaveProperty('verdict', 'YES');
      expect(first).toHaveProperty('risk', 0.2);
      expect(first).toHaveProperty('reason', 'Looks safe');
      expect(first).toHaveProperty('guardType', 'agent_action');
    });
  });

  // ── Board resolution scores (via guard after agents) ──

  describe('Board resolution scores (RISK_SCORE + CONSENSUS_QUORUM)', () => {
    it('should emit RISK_SCORE and CONSENSUS_QUORUM when guard follows agents', async () => {
      setupVerdictEvents([
        { verdict: 'YES', risk: 0.2, weight: 1 },
        { verdict: 'YES', risk: 0.3, weight: 1 },
        { verdict: 'YES', risk: 0.1, weight: 1 },
      ]);

      const def = makeWorkflow([triggerNode, agentNode, guardNode]);
      await executeLocalFlow(def, 'wf-1');

      const riskScores = getEventsOfType('RISK_SCORE');
      const quorums = getEventsOfType('CONSENSUS_QUORUM');
      expect(riskScores).toHaveLength(1);
      expect(quorums).toHaveLength(1);
    });

    it('should use guard config quorum and riskThreshold for board resolution', async () => {
      setupVerdictEvents([
        { verdict: 'YES', risk: 0.2, weight: 1 },
        { verdict: 'YES', risk: 0.3, weight: 1 },
        { verdict: 'REWRITE', risk: 0.6, weight: 1 },
      ]);

      const customGuard = {
        ...guardNode,
        config: { ...guardNode.config, quorum: 0.5, riskThreshold: 0.8 },
      };
      const def = makeWorkflow([triggerNode, agentNode, customGuard]);
      await executeLocalFlow(def, 'wf-1');

      const riskScores = getEventsOfType('RISK_SCORE');
      const quorums = getEventsOfType('CONSENSUS_QUORUM');

      expect(riskScores[0][3].quorum_threshold).toBe(0.5);
      expect(riskScores[0][3].risk_threshold).toBe(0.8);
      expect(quorums[0][3].quorum_threshold).toBe(0.5);
      expect(quorums[0][3].risk_threshold).toBe(0.8);
    });

    it('should ALLOW with 2 YES + 1 REWRITE when YES weighted ratio meets threshold', async () => {
      setupVerdictEvents([
        { verdict: 'YES', risk: 0.2, weight: 1 },
        { verdict: 'YES', risk: 0.3, weight: 1 },
        { verdict: 'REWRITE', risk: 0.6, weight: 1 },
      ]);

      const def = makeWorkflow([
        triggerNode,
        agentNode,
        { ...guardNode, config: { ...guardNode.config, quorum: 0.6, riskThreshold: 0.6 } },
      ]);
      await executeLocalFlow(def, 'wf-1');

      const quorums = getEventsOfType('CONSENSUS_QUORUM');
      // 2/3 YES = 0.667 weighted yes ratio, threshold is 0.6 → ALLOW
      expect(quorums[0][3].decision).toBe('ALLOW');
      expect(quorums[0][3].yes_count).toBe(2);
      expect(quorums[0][3].rewrite_count).toBe(1);
    });

    it('should use participant weight for weighted voting, not reputation', async () => {
      setupVerdictEvents([
        { verdict: 'YES', risk: 0.2, weight: 3 },     // high-weight YES
        { verdict: 'NO', risk: 0.8, weight: 1 },        // low-weight NO
        { verdict: 'REWRITE', risk: 0.5, weight: 1 },   // low-weight REWRITE
      ]);

      const def = makeWorkflow([
        triggerNode,
        agentNode,
        { ...guardNode, config: { ...guardNode.config, quorum: 0.5, riskThreshold: 0.6 } },
      ]);
      await executeLocalFlow(def, 'wf-1');

      const quorums = getEventsOfType('CONSENSUS_QUORUM');
      // Total weight: 3+1+1 = 5. Weighted YES: 3/5 = 0.6 >= 0.5 quorum → ALLOW
      expect(quorums[0][3].total_weight).toBe(5);
      expect(quorums[0][3].decision).toBe('ALLOW');
    });

    it('should not discount weight by risk (confidence=1)', async () => {
      setupVerdictEvents([
        { verdict: 'YES', risk: 0.9, weight: 1 },   // high risk but YES
        { verdict: 'YES', risk: 0.8, weight: 1 },
      ]);

      const def = makeWorkflow([
        triggerNode,
        agentNode,
        { ...guardNode, config: { ...guardNode.config, quorum: 0.5, riskThreshold: 0.95 } },
      ]);
      await executeLocalFlow(def, 'wf-1');

      const quorums = getEventsOfType('CONSENSUS_QUORUM');
      // With confidence=1, total_weight = 1+1 = 2 (not discounted by risk)
      expect(quorums[0][3].total_weight).toBe(2);
    });

    it('should BLOCK when combined risk exceeds threshold', async () => {
      setupVerdictEvents([
        { verdict: 'NO', risk: 0.95, weight: 1 },
        { verdict: 'NO', risk: 0.9, weight: 1 },
        { verdict: 'YES', risk: 0.4, weight: 1 },
      ]);

      const def = makeWorkflow([
        triggerNode,
        agentNode,
        { ...guardNode, config: { ...guardNode.config, riskThreshold: 0.7 } },
      ]);
      await executeLocalFlow(def, 'wf-1');

      const quorums = getEventsOfType('CONSENSUS_QUORUM');
      // combinedRisk = (0.95+0.9+0.4)/3 = 0.75 > 0.7 → BLOCK
      expect(quorums[0][3].decision).toBe('BLOCK');
    });

    it('should REQUIRE_HUMAN when quorum not met', async () => {
      setupVerdictEvents([
        { verdict: 'YES', risk: 0.2, weight: 0.1 },
      ]);

      const def = makeWorkflow([
        triggerNode,
        agentNode,
        { ...guardNode, config: { ...guardNode.config, quorum: 0.7 } },
      ]);
      await executeLocalFlow(def, 'wf-1');

      const quorums = getEventsOfType('CONSENSUS_QUORUM');
      expect(quorums[0][3].decision).toBe('REQUIRE_HUMAN');
      expect(quorums[0][3].quorum_met).toBe(false);
    });

    it('should calculate weighted risk score as sum(risk*weight)/sum(weight)', async () => {
      setupVerdictEvents([
        { verdict: 'YES', risk: 0.2, weight: 2 },
        { verdict: 'YES', risk: 0.8, weight: 1 },
      ]);

      const def = makeWorkflow([triggerNode, agentNode, guardNode]);
      await executeLocalFlow(def, 'wf-1');

      const riskScores = getEventsOfType('RISK_SCORE');
      // Weighted risk = (0.2*2 + 0.8*1) / (2+1) = 1.2/3 = 0.4
      expect(riskScores[0][3].risk_score).toBe(0.4);
    });

    it('should include voter breakdown in events', async () => {
      setupVerdictEvents([
        { verdict: 'YES', risk: 0.2, weight: 1 },
        { verdict: 'NO', risk: 0.9, weight: 1 },
        { verdict: 'REWRITE', risk: 0.5, weight: 1 },
      ]);

      const def = makeWorkflow([triggerNode, agentNode, guardNode]);
      await executeLocalFlow(def, 'wf-1');

      const riskScores = getEventsOfType('RISK_SCORE');
      expect(riskScores[0][3].voter_count).toBe(3);
      expect(riskScores[0][3].yes_count).toBe(1);
      expect(riskScores[0][3].no_count).toBe(1);
      expect(riskScores[0][3].rewrite_count).toBe(1);

      const quorums = getEventsOfType('CONSENSUS_QUORUM');
      expect(quorums[0][3].total_voters).toBe(3);
    });

    it('should not emit board scores when guard has no verdicts to resolve', async () => {
      mockListEvents.mockReturnValue([]);

      // Guard with no agents before it — no verdicts to resolve
      const def = makeWorkflow([triggerNode, guardNode]);
      await executeLocalFlow(def, 'wf-1');

      const riskScores = getEventsOfType('RISK_SCORE');
      const quorums = getEventsOfType('CONSENSUS_QUORUM');
      expect(riskScores).toHaveLength(0);
      expect(quorums).toHaveLength(0);
    });

    it('should not emit scores when agents run without a guard', async () => {
      setupVerdictEvents([
        { verdict: 'YES', risk: 0.2, weight: 1 },
        { verdict: 'YES', risk: 0.3, weight: 1 },
      ]);

      // No guard node → no board resolution → no scores
      const def = makeWorkflow([triggerNode, agentNode]);
      await executeLocalFlow(def, 'wf-1');

      const quorums = getEventsOfType('CONSENSUS_QUORUM');
      expect(quorums).toHaveLength(0);
    });

    it('should include board metadata in score events', async () => {
      setupVerdictEvents([
        { verdict: 'YES', risk: 0.2, weight: 1 },
        { verdict: 'YES', risk: 0.3, weight: 1 },
      ]);

      const def = makeWorkflow([triggerNode, agentNode, guardNode]);
      await executeLocalFlow(def, 'wf-1');

      const riskScores = getEventsOfType('RISK_SCORE');
      const quorums = getEventsOfType('CONSENSUS_QUORUM');
      expect(riskScores[0][3]).toHaveProperty('board_audit_id');
      expect(riskScores[0][3]).toHaveProperty('board_engine');
      expect(quorums[0][3]).toHaveProperty('board_audit_id');
      expect(quorums[0][3]).toHaveProperty('board_engine');
    });
  });

  // ── Workflow lifecycle ──

  describe('Workflow lifecycle events', () => {
    it('should emit WORKFLOW_STARTED and WORKFLOW_COMPLETED', async () => {
      const def = makeWorkflow([triggerNode]);
      await executeLocalFlow(def, 'wf-1');

      const types = getAllEventTypes();
      expect(types[0]).toBe('WORKFLOW_STARTED');
      expect(types[types.length - 1]).toBe('WORKFLOW_COMPLETED');
    });

    it('should emit NODE_STARTED and NODE_EXECUTED for each node', async () => {
      const def = makeWorkflow([triggerNode, guardNode]);
      await executeLocalFlow(def, 'wf-1');

      const started = getEventsOfType('WORKFLOW_NODE_STARTED');
      const executed = getEventsOfType('WORKFLOW_NODE_EXECUTED');
      expect(started).toHaveLength(2);
      expect(executed).toHaveLength(2);
    });
  });
});
