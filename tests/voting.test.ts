import { describe, it, expect } from 'vitest';
import { tallyVotes, reachesQuorum, computeDecision } from '../src/voting.js';
import type { WeightedVote } from '../src/voting.js';
import type { PolicyMetadata } from '../src/schemas.js';

function makeVote(vote: 'YES' | 'NO' | 'REWRITE', weight = 1, confidence = 1, evaluator = 'test'): WeightedVote {
  return { evaluator, vote, reason: `Vote ${vote}`, risk: 0.5, weight, confidence };
}

const defaultPolicy: PolicyMetadata = {
  policyId: 'default',
  version: 'v1',
  quorum: 0.7,
  riskThreshold: 0.7,
  hitlRequiredAboveRisk: 0.7,
  options: {}
};

describe('Voting', () => {
  describe('tallyVotes', () => {
    it('should tally all YES votes', () => {
      const tally = tallyVotes([makeVote('YES'), makeVote('YES'), makeVote('YES')]);
      expect(tally.yes).toBe(3);
      expect(tally.no).toBe(0);
      expect(tally.rewrite).toBe(0);
      expect(tally.voterCount).toBe(3);
      expect(tally.weightedYes).toBe(3);
    });

    it('should tally mixed votes', () => {
      const tally = tallyVotes([makeVote('YES'), makeVote('NO'), makeVote('REWRITE')]);
      expect(tally.yes).toBe(1);
      expect(tally.no).toBe(1);
      expect(tally.rewrite).toBe(1);
    });

    it('should apply weights correctly', () => {
      const tally = tallyVotes([makeVote('YES', 2), makeVote('NO', 1)]);
      expect(tally.weightedYes).toBe(2);
      expect(tally.weightedNo).toBe(1);
      expect(tally.totalWeight).toBe(3);
    });

    it('should apply confidence to effective weight', () => {
      const tally = tallyVotes([makeVote('YES', 1, 0.5)]);
      expect(tally.weightedYes).toBe(0.5);
      expect(tally.totalWeight).toBe(0.5);
    });

    it('should handle empty votes', () => {
      const tally = tallyVotes([]);
      expect(tally.voterCount).toBe(0);
      expect(tally.totalWeight).toBe(0);
    });

    it('should handle single voter', () => {
      const tally = tallyVotes([makeVote('NO', 1, 1)]);
      expect(tally.no).toBe(1);
      expect(tally.voterCount).toBe(1);
      expect(tally.weightedNo).toBe(1);
    });
  });

  describe('reachesQuorum', () => {
    it('should return true when weight meets quorum', () => {
      const tally = tallyVotes([makeVote('YES'), makeVote('YES')]);
      expect(reachesQuorum(tally, 1)).toBe(true);
    });

    it('should return false when weight is below quorum', () => {
      const tally = tallyVotes([makeVote('YES', 0.3, 1)]);
      expect(reachesQuorum(tally, 0.7)).toBe(false);
    });

    it('should return false for empty votes', () => {
      const tally = tallyVotes([]);
      expect(reachesQuorum(tally, 0.7)).toBe(false);
    });

    it('should account for confidence in quorum', () => {
      const tally = tallyVotes([makeVote('YES', 1, 0.5)]);
      expect(reachesQuorum(tally, 0.7)).toBe(false);
      expect(reachesQuorum(tally, 0.5)).toBe(true);
    });
  });

  describe('computeDecision', () => {
    it('should ALLOW when majority YES and quorum met', () => {
      const votes = [makeVote('YES', 1), makeVote('YES', 1), makeVote('YES', 1)];
      const result = computeDecision(votes, defaultPolicy);
      expect(result.decision).toBe('ALLOW');
      expect(result.quorumMet).toBe(true);
      expect(result.weightedYesRatio).toBe(1);
      expect(result.combinedRisk).toBe(0.5);
    });

    it('should BLOCK when combined risk exceeds threshold', () => {
      const votes = [
        { evaluator: 'a', vote: 'NO' as const, reason: 'Dangerous', risk: 0.9, weight: 1, confidence: 1 },
        { evaluator: 'b', vote: 'NO' as const, reason: 'Risky', risk: 0.8, weight: 1, confidence: 1 },
        { evaluator: 'c', vote: 'YES' as const, reason: 'OK', risk: 0.6, weight: 0.5, confidence: 1 },
      ];
      const result = computeDecision(votes, defaultPolicy);
      // combinedRisk = (0.9+0.8+0.3)/2.5 = 2.0/2.5 = 0.8 > 0.7 → BLOCK
      expect(result.decision).toBe('BLOCK');
      expect(result.combinedRisk).toBeCloseTo(0.8, 2);
    });

    it('should REQUIRE_HUMAN when YES ratio below quorum despite low risk', () => {
      const votes = [makeVote('REWRITE', 1), makeVote('REWRITE', 1), makeVote('YES', 0.5)];
      const result = computeDecision(votes, defaultPolicy);
      // combinedRisk=0.5 <= 0.7, weightedYesRatio = 0.5/2.5 = 0.2 < 0.7 quorum → REQUIRE_HUMAN
      expect(result.decision).toBe('REQUIRE_HUMAN');
    });

    it('should REQUIRE_HUMAN when quorum not met', () => {
      const votes = [makeVote('YES', 0.2, 1)];
      const result = computeDecision(votes, defaultPolicy);
      expect(result.decision).toBe('REQUIRE_HUMAN');
      expect(result.quorumMet).toBe(false);
    });

    it('should BLOCK when high-risk votes in split scenario', () => {
      const votes = [
        { evaluator: 'a', vote: 'YES' as const, reason: '', risk: 0.8, weight: 0.5, confidence: 1 },
        { evaluator: 'b', vote: 'NO' as const, reason: '', risk: 0.9, weight: 0.5, confidence: 1 },
      ];
      const result = computeDecision(votes, defaultPolicy);
      // combinedRisk = (0.8*0.5 + 0.9*0.5) / 1.0 = 0.85 > 0.7 → BLOCK
      expect(result.decision).toBe('BLOCK');
    });

    it('should REQUIRE_HUMAN when YES ratio barely misses quorum', () => {
      const votes = [makeVote('YES', 0.4), makeVote('NO', 0.3), makeVote('REWRITE', 0.3)];
      const result = computeDecision(votes, { ...defaultPolicy, quorum: 0.5, riskThreshold: 0.9 });
      // combinedRisk=0.5 <= 0.9. weightedYesRatio = 0.4/1.0 = 0.4 < 0.5 quorum → REQUIRE_HUMAN
      expect(result.decision).toBe('REQUIRE_HUMAN');
    });

    it('should BLOCK when all voters assess high risk', () => {
      const votes = [
        { evaluator: 'a', vote: 'NO' as const, reason: '', risk: 0.9, weight: 1, confidence: 1 },
        { evaluator: 'b', vote: 'NO' as const, reason: '', risk: 0.8, weight: 1, confidence: 1 },
        { evaluator: 'c', vote: 'NO' as const, reason: '', risk: 0.85, weight: 1, confidence: 1 },
      ];
      const result = computeDecision(votes, defaultPolicy);
      // combinedRisk = (0.9+0.8+0.85)/3 = 0.85 > 0.7 → BLOCK
      expect(result.decision).toBe('BLOCK');
      expect(result.tally.no).toBe(3);
    });

    it('should respect different policy thresholds', () => {
      const strictPolicy = { ...defaultPolicy, riskThreshold: 0.9 };
      const votes = [makeVote('YES', 1), makeVote('YES', 1), makeVote('NO', 0.5)];
      const result = computeDecision(votes, strictPolicy);
      expect(result.quorumMet).toBe(true);
    });

    it('should REQUIRE_HUMAN on weighted tie (low YES ratio)', () => {
      const votes = [makeVote('YES', 1), makeVote('NO', 1)];
      const result = computeDecision(votes, defaultPolicy);
      // combinedRisk=0.5<=0.7, weightedYesRatio=0.5<0.7 quorum → REQUIRE_HUMAN
      expect(result.decision).toBe('REQUIRE_HUMAN');
    });

    // ── Guard harness weighted voting scenarios ──

    it('should ALLOW with 2 YES + 1 REWRITE when YES ratio meets threshold', () => {
      const policy = { ...defaultPolicy, quorum: 0.6, riskThreshold: 0.6 };
      const votes = [makeVote('YES', 1), makeVote('YES', 1), makeVote('REWRITE', 1)];
      const result = computeDecision(votes, policy);
      // weightedYes = 2/3 = 0.667, threshold 0.6 → ALLOW
      expect(result.decision).toBe('ALLOW');
      expect(result.weightedYesRatio).toBeCloseTo(0.667, 2);
    });

    it('should respect participant weight in decision', () => {
      const policy = { ...defaultPolicy, quorum: 0.5, riskThreshold: 0.5 };
      // High-weight YES (3) vs two low-weight NOs (1 each)
      const votes = [makeVote('YES', 3), makeVote('NO', 1), makeVote('NO', 1)];
      const result = computeDecision(votes, policy);
      // combinedRisk=0.5 (not > 0.5), weightedYesRatio = 3/5 = 0.6 >= 0.5 quorum → ALLOW
      expect(result.decision).toBe('ALLOW');
    });

    it('should not discount weight by risk (confidence=1)', () => {
      const policy = { ...defaultPolicy, quorum: 0.5, riskThreshold: 0.7 };
      const votes = [
        { evaluator: 'a', vote: 'YES' as const, reason: '', risk: 0.9, weight: 1, confidence: 1 },
        { evaluator: 'b', vote: 'YES' as const, reason: '', risk: 0.8, weight: 1, confidence: 1 },
      ];
      const tally = tallyVotes(votes);
      // With confidence=1, totalWeight = 2, not discounted by risk
      expect(tally.totalWeight).toBe(2);
      expect(tally.weightedYes).toBe(2);
    });

    it('should REQUIRE_HUMAN when total weight below quorum threshold', () => {
      const policy = { ...defaultPolicy, quorum: 2 };
      const votes = [makeVote('YES', 0.5), makeVote('YES', 0.5)];
      const result = computeDecision(votes, policy);
      expect(result.decision).toBe('REQUIRE_HUMAN');
      expect(result.quorumMet).toBe(false);
    });
  });
});
