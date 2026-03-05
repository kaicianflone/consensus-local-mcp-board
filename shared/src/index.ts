import { z } from 'zod';

export const DecisionSchema = z.enum(['ALLOW', 'BLOCK', 'REWRITE', 'REQUIRE_HUMAN']);
export const GuardTypeSchema = z.enum([
  'send_email',
  'code_merge',
  'publish',
  'support_reply',
  'agent_action',
  'deployment',
  'permission_escalation'
]);

export const PolicyMetadataSchema = z.object({
  policyId: z.string().default('default'),
  version: z.string().default('v1'),
  quorum: z.number().min(0).max(1).default(0.7),
  riskThreshold: z.number().min(0).max(1).default(0.7),
  hitlRequiredAboveRisk: z.number().min(0).max(1).default(0.7),
  options: z.record(z.any()).default({})
});

export const GuardVoteSchema = z.object({
  evaluator: z.string(),
  vote: z.enum(['YES', 'NO', 'REWRITE']),
  reason: z.string(),
  risk: z.number().min(0).max(1)
});

export const GuardResultSchema = z.object({
  decision: DecisionSchema,
  reason: z.string(),
  risk_score: z.number().min(0).max(1),
  suggested_rewrite: z.any().optional(),
  audit_id: z.string(),
  next_step: z.object({ tool: z.string(), input: z.any() }).optional(),
  weighted_yes: z.number().min(0).max(1).optional(),
  votes: z.array(GuardVoteSchema).optional(),
  guard_type: GuardTypeSchema.optional()
});

export const EvaluateInputSchema = z.object({
  boardId: z.string().min(1),
  runId: z.string().optional(),
  action: z.object({
    type: z.string().min(1),
    payload: z.record(z.any())
  }),
  policyPack: z.string().optional()
});

export const GuardEvaluateRequestSchema = z.object({
  runId: z.string(),
  boardId: z.string(),
  guardType: GuardTypeSchema,
  payload: z.record(z.any()),
  policy: PolicyMetadataSchema.default({}),
  idempotencyKey: z.string()
});

export const HumanDecisionSchema = z.object({
  decision: z.enum(['YES', 'NO']),
  approver: z.string(),
  reason: z.string().optional(),
  idempotencyKey: z.string(),
  createdAt: z.string()
});

export const HumanApprovalRequestSchema = z.object({
  runId: z.string(),
  approver: z.string().default('human'),
  replyText: z.string(),
  idempotencyKey: z.string(),
  boardId: z.string().optional()
});

export type GuardResult = z.infer<typeof GuardResultSchema>;
export type EvaluateInput = z.infer<typeof EvaluateInputSchema>;
export type GuardEvaluateRequest = z.infer<typeof GuardEvaluateRequestSchema>;
export type HumanDecision = z.infer<typeof HumanDecisionSchema>;

export function parseHumanApprovalYesNo(text: string): 'YES' | 'NO' | 'REWRITE' {
  const t = text.trim().toLowerCase();
  if (['yes', 'y', 'approve', 'ack', 'acknowledge'].includes(t)) return 'YES';
  if (['no', 'n', 'block', 'deny', 'reject'].includes(t)) return 'NO';
  if (['rewrite', 'revise', 'revision'].includes(t)) return 'REWRITE';
  throw new Error('Unrecognized Human Approval reply; expected YES, NO, or REWRITE');
}

// ── Voting utilities (single source of truth for the three-step decision model) ──

export type Decision = z.infer<typeof DecisionSchema>;
export type PolicyMetadata = z.infer<typeof PolicyMetadataSchema>;
export type GuardVote = z.infer<typeof GuardVoteSchema>;

export interface VoteTally {
  yes: number;
  no: number;
  rewrite: number;
  totalWeight: number;
  weightedYes: number;
  weightedNo: number;
  weightedRewrite: number;
  voterCount: number;
}

export type WeightingMode = 'static' | 'reputation' | 'hybrid';

export interface WeightedVote extends GuardVote {
  weight: number;
  confidence: number;
  reputation?: number; // 0-100 ledger-derived score
}

/**
 * Compute effective weight used in decisions based on weighting mode.
 * - static:     raw weight (ignore reputation)
 * - reputation: reputation/100 (ignore manual weight)
 * - hybrid:     weight * (reputation/100)
 */
export function computeEffectiveWeight(weight: number, reputation: number, mode: WeightingMode = 'hybrid'): number {
  switch (mode) {
    case 'static':     return weight;
    case 'reputation': return reputation / 100;
    case 'hybrid':     return weight * (reputation / 100);
  }
}

export function tallyVotes(votes: WeightedVote[], weightingMode: WeightingMode = 'hybrid'): VoteTally {
  const tally: VoteTally = {
    yes: 0, no: 0, rewrite: 0,
    totalWeight: 0,
    weightedYes: 0, weightedNo: 0, weightedRewrite: 0,
    voterCount: votes.length
  };

  for (const v of votes) {
    const baseWeight = computeEffectiveWeight(v.weight, v.reputation ?? 100, weightingMode);
    const effectiveWeight = baseWeight * v.confidence;
    tally.totalWeight += effectiveWeight;

    if (v.vote === 'YES') {
      tally.yes++;
      tally.weightedYes += effectiveWeight;
    } else if (v.vote === 'NO') {
      tally.no++;
      tally.weightedNo += effectiveWeight;
    } else if (v.vote === 'REWRITE') {
      tally.rewrite++;
      tally.weightedRewrite += effectiveWeight;
    }
  }

  return tally;
}

export function reachesQuorum(tally: VoteTally, quorum: number): boolean {
  if (tally.totalWeight === 0) return false;
  const participationRatio = tally.voterCount > 0 ? 1 : 0;
  const weightedParticipation = tally.totalWeight;
  return weightedParticipation >= quorum && participationRatio > 0;
}

export function computeDecision(votes: WeightedVote[], policy: PolicyMetadata, weightingMode: WeightingMode = 'hybrid'): {
  decision: Decision;
  tally: VoteTally;
  quorumMet: boolean;
  weightedYesRatio: number;
  combinedRisk: number;
} {
  const tally = tallyVotes(votes, weightingMode);

  let riskNum = 0;
  let riskDen = 0;
  for (const v of votes) {
    const ew = computeEffectiveWeight(v.weight, v.reputation ?? 100, weightingMode);
    riskNum += v.risk * ew;
    riskDen += ew;
  }
  const combinedRisk = riskDen > 0 ? riskNum / riskDen : 0.5;

  const weightedYesRatio = tally.totalWeight > 0 ? tally.weightedYes / tally.totalWeight : 0;
  const quorumMet = reachesQuorum(tally, policy.quorum);

  // Step 1: Combined risk exceeds threshold → BLOCK
  if (combinedRisk > policy.riskThreshold) {
    return { decision: 'BLOCK', tally, quorumMet, weightedYesRatio, combinedRisk };
  }

  // Step 2: Quorum not met (weighted YES ratio < quorum) → REQUIRE_HUMAN
  if (!quorumMet || weightedYesRatio < policy.quorum) {
    return { decision: 'REQUIRE_HUMAN', tally, quorumMet, weightedYesRatio, combinedRisk };
  }

  // Step 3: Risk acceptable and quorum met → ALLOW
  return { decision: 'ALLOW', tally, quorumMet, weightedYesRatio, combinedRisk };
}
