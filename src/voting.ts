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

export interface WeightedVote extends GuardVote {
  weight: number;
  confidence: number;
}

export function tallyVotes(votes: WeightedVote[]): VoteTally {
  const tally: VoteTally = {
    yes: 0, no: 0, rewrite: 0,
    totalWeight: 0,
    weightedYes: 0, weightedNo: 0, weightedRewrite: 0,
    voterCount: votes.length
  };

  for (const v of votes) {
    const effectiveWeight = v.weight * v.confidence;
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

export function computeDecision(votes: WeightedVote[], policy: PolicyMetadata): {
  decision: Decision;
  tally: VoteTally;
  quorumMet: boolean;
  weightedYesRatio: number;
} {
  const tally = tallyVotes(votes);
  const quorumMet = reachesQuorum(tally, policy.quorum);

  if (!quorumMet) {
    return {
      decision: 'REQUIRE_HUMAN',
      tally,
      quorumMet,
      weightedYesRatio: 0
    };
  }

  const weightedYesRatio = tally.totalWeight > 0 ? tally.weightedYes / tally.totalWeight : 0;
  const weightedNoRatio = tally.totalWeight > 0 ? tally.weightedNo / tally.totalWeight : 0;

  if (weightedNoRatio > (1 - policy.riskThreshold)) {
    return { decision: 'BLOCK', tally, quorumMet, weightedYesRatio };
  }

  const weightedRewriteRatio = tally.totalWeight > 0 ? tally.weightedRewrite / tally.totalWeight : 0;
  if (weightedRewriteRatio > (1 - policy.riskThreshold)) {
    return { decision: 'REWRITE', tally, quorumMet, weightedYesRatio };
  }

  if (weightedYesRatio >= policy.riskThreshold) {
    return { decision: 'ALLOW', tally, quorumMet, weightedYesRatio };
  }

  return { decision: 'REQUIRE_HUMAN', tally, quorumMet, weightedYesRatio };
}
