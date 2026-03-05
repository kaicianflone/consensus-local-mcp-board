import type { Decision, GuardVote, PolicyMetadata } from './schemas.js';

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
