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
    });

    it('should BLOCK when majority NO and quorum met', () => {
      const votes = [makeVote('NO', 1), makeVote('NO', 1), makeVote('YES', 0.5)];
      const result = computeDecision(votes, defaultPolicy);
      expect(result.decision).toBe('BLOCK');
      expect(result.quorumMet).toBe(true);
    });

    it('should REWRITE when majority REWRITE and quorum met', () => {
      const votes = [makeVote('REWRITE', 1), makeVote('REWRITE', 1), makeVote('YES', 0.5)];
      const result = computeDecision(votes, defaultPolicy);
      expect(result.decision).toBe('REWRITE');
    });

    it('should REQUIRE_HUMAN when quorum not met', () => {
      const votes = [makeVote('YES', 0.2, 1)];
      const result = computeDecision(votes, defaultPolicy);
      expect(result.decision).toBe('REQUIRE_HUMAN');
      expect(result.quorumMet).toBe(false);
    });

    it('should BLOCK when NO weight exceeds threshold in split vote', () => {
      const votes = [makeVote('YES', 0.5), makeVote('NO', 0.5)];
      const result = computeDecision(votes, defaultPolicy);
      expect(result.decision).toBe('BLOCK');
    });

    it('should REQUIRE_HUMAN when result is ambiguous below thresholds', () => {
      const votes = [makeVote('YES', 0.5), makeVote('NO', 0.05), makeVote('REWRITE', 0.05)];
      const result = computeDecision(votes, { ...defaultPolicy, quorum: 0.5, riskThreshold: 0.9 });
      expect(result.decision).toBe('REQUIRE_HUMAN');
    });

    it('should handle all same votes', () => {
      const votes = [makeVote('NO'), makeVote('NO'), makeVote('NO')];
      const result = computeDecision(votes, defaultPolicy);
      expect(result.decision).toBe('BLOCK');
      expect(result.tally.no).toBe(3);
    });

    it('should respect different policy thresholds', () => {
      const strictPolicy = { ...defaultPolicy, riskThreshold: 0.9 };
      const votes = [makeVote('YES', 1), makeVote('YES', 1), makeVote('NO', 0.5)];
      const result = computeDecision(votes, strictPolicy);
      expect(result.quorumMet).toBe(true);
    });

    it('should handle weighted tie scenario', () => {
      const votes = [makeVote('YES', 1), makeVote('NO', 1)];
      const result = computeDecision(votes, defaultPolicy);
      expect(['REQUIRE_HUMAN', 'BLOCK', 'ALLOW']).toContain(result.decision);
    });
  });
});
