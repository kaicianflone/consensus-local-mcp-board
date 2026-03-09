import { describe, it, expect } from 'vitest';
import { evaluatorVotes, finalizeVotes, evaluateGuard, normalizeGuardType } from '../src/guards.js';
import { createAgentRegistry } from '../src/agents.js';
import type { EvaluateInput } from '../src/schemas.js';

function makeInput(type: string, payload: Record<string, unknown> = {}, agentId?: string): EvaluateInput {
  return { boardId: 'test-board', action: { type, payload }, agentId };
}

describe('Guards', () => {
  describe('evaluatorVotes', () => {
    describe('send_email', () => {
      it('should block external email with attachment', () => {
        const votes = evaluatorVotes(makeInput('send_email', { to: 'ext@example.com', attachment: true, body: 'Hello' }));
        expect(votes).toHaveLength(1);
        expect(votes[0].vote).toBe('NO');
        expect(votes[0].evaluator).toBe('email-risk');
        expect(votes[0].risk).toBeGreaterThan(0.9);
      });

      it('should block email with secrets in body', () => {
        const votes = evaluatorVotes(makeInput('send_email', { to: 'internal', body: 'apiKey=abc123' }));
        expect(votes[0].vote).toBe('NO');
        expect(votes[0].reason).toContain('secrets');
      });

      it('should block email with token in body', () => {
        const votes = evaluatorVotes(makeInput('send_email', { to: 'user@co.com', body: 'token=xyz' }));
        expect(votes[0].vote).toBe('NO');
      });

      it('should block email with password in body', () => {
        const votes = evaluatorVotes(makeInput('send_email', { to: 'user@co.com', body: 'password: hunter2' }));
        expect(votes[0].vote).toBe('NO');
      });

      it('should allow clean email', () => {
        const votes = evaluatorVotes(makeInput('send_email', { to: 'user@co.com', body: 'Hello there' }));
        expect(votes[0].vote).toBe('YES');
        expect(votes[0].risk).toBeLessThan(0.5);
      });
    });

    describe('code_merge', () => {
      it('should flag merge touching auth files', () => {
        const votes = evaluatorVotes(makeInput('code_merge', { files: ['src/auth/login.ts'] }));
        expect(votes[0].vote).toBe('REWRITE');
        expect(votes[0].risk).toBeGreaterThan(0.8);
      });

      it('should flag merge touching security files', () => {
        const votes = evaluatorVotes(makeInput('code_merge', { files: ['lib/security.ts'] }));
        expect(votes[0].vote).toBe('REWRITE');
      });

      it('should flag merge touching crypto files', () => {
        const votes = evaluatorVotes(makeInput('code_merge', { files: ['src/crypto/hash.ts'] }));
        expect(votes[0].vote).toBe('REWRITE');
      });

      it('should allow safe merge', () => {
        const votes = evaluatorVotes(makeInput('code_merge', { files: ['src/utils/helpers.ts'] }));
        expect(votes[0].vote).toBe('YES');
        expect(votes[0].risk).toBeLessThan(0.5);
      });
    });

    describe('publish', () => {
      it('should flag profanity', () => {
        const votes = evaluatorVotes(makeInput('publish', { text: 'This is damn terrible' }));
        expect(votes[0].vote).toBe('REWRITE');
        expect(votes[0].reason).toContain('Profanity');
      });

      it('should flag SSN-like patterns (PII)', () => {
        const votes = evaluatorVotes(makeInput('publish', { text: 'SSN: 123-45-6789' }));
        expect(votes[0].vote).toBe('REWRITE');
        expect(votes[0].reason).toContain('personal-data');
      });

      it('should allow clean publish text', () => {
        const votes = evaluatorVotes(makeInput('publish', { text: 'Great product launch!' }));
        expect(votes[0].vote).toBe('YES');
      });
    });

    describe('support_reply', () => {
      it('should flag escalation language', () => {
        const votes = evaluatorVotes(makeInput('support_reply', { message: 'We will issue a refund' }));
        expect(votes[0].vote).toBe('REWRITE');
        expect(votes[0].reason).toContain('Escalation');
      });

      it('should flag legal threats', () => {
        const votes = evaluatorVotes(makeInput('support_reply', { message: 'We may take legal action' }));
        expect(votes[0].vote).toBe('REWRITE');
      });

      it('should allow standard reply', () => {
        const votes = evaluatorVotes(makeInput('support_reply', { message: 'Thank you for contacting us' }));
        expect(votes[0].vote).toBe('YES');
        expect(votes[0].risk).toBeLessThan(0.5);
      });
    });

    describe('agent_action', () => {
      it('should block irreversible actions', () => {
        const votes = evaluatorVotes(makeInput('agent_action', { irreversible: true }));
        expect(votes[0].vote).toBe('NO');
        expect(votes[0].risk).toBeGreaterThan(0.8);
      });

      it('should allow reversible actions', () => {
        const votes = evaluatorVotes(makeInput('agent_action', { irreversible: false }));
        expect(votes[0].vote).toBe('YES');
      });
    });

    describe('deployment', () => {
      it('should flag production deployment', () => {
        const votes = evaluatorVotes(makeInput('deployment', { env: 'prod' }));
        expect(votes[0].vote).toBe('REWRITE');
        expect(votes[0].risk).toBeGreaterThan(0.7);
      });

      it('should allow non-production deployment', () => {
        const votes = evaluatorVotes(makeInput('deployment', { env: 'staging' }));
        expect(votes[0].vote).toBe('YES');
      });
    });

    describe('permission_escalation', () => {
      it('should flag break-glass escalation', () => {
        const votes = evaluatorVotes(makeInput('permission_escalation', { breakGlass: true }));
        expect(votes[0].vote).toBe('REWRITE');
        expect(votes[0].risk).toBeGreaterThan(0.85);
      });

      it('should allow standard permission change', () => {
        const votes = evaluatorVotes(makeInput('permission_escalation', { breakGlass: false }));
        expect(votes[0].vote).toBe('YES');
      });
    });

    describe('unknown action type', () => {
      it('should return generic YES vote', () => {
        const votes = evaluatorVotes(makeInput('custom_action', {}));
        expect(votes[0].vote).toBe('YES');
        expect(votes[0].evaluator).toBe('generic');
      });
    });
  });

  describe('finalizeVotes', () => {
    it('should return BLOCK for NO votes', () => {
      const result = finalizeVotes([{ evaluator: 'test', vote: 'NO', reason: 'Blocked', risk: 0.9 }], 'send_email');
      expect(result.decision).toBe('BLOCK');
      expect(result.risk_score).toBe(0.9);
    });

    it('should return REQUIRE_HUMAN for REWRITE on code_merge (default no-policy behavior)', () => {
      const result = finalizeVotes([{ evaluator: 'test', vote: 'REWRITE', reason: 'Sensitive', risk: 0.8 }], 'code_merge');
      expect(result.decision).toBe('REQUIRE_HUMAN');
      expect(result.next_step).toBeDefined();
      expect(result.next_step?.tool).toBe('human.approve');
    });

    it('should return REWRITE for REWRITE on non-code_merge without policy', () => {
      // Without a policy, only code_merge escalates — publish stays as REWRITE
      const result = finalizeVotes([{ evaluator: 'test', vote: 'REWRITE', reason: 'Bad content', risk: 0.75 }], 'publish');
      expect(result.decision).toBe('REWRITE');
      expect(result.suggested_rewrite).toBeDefined();
    });

    it('should return ALLOW for YES votes', () => {
      const result = finalizeVotes([{ evaluator: 'test', vote: 'YES', reason: 'All clear', risk: 0.1 }], 'send_email');
      expect(result.decision).toBe('ALLOW');
    });

    it('should return ALLOW when no votes cast', () => {
      const result = finalizeVotes([], 'send_email');
      expect(result.decision).toBe('ALLOW');
      expect(result.risk_score).toBe(0);
    });

    describe('with policy', () => {
      const policy = { policyId: 'test', version: 'v1', quorum: 0.7, riskThreshold: 0.7, hitlRequiredAboveRisk: 0.7, options: {} };

      it('should escalate REWRITE to REQUIRE_HUMAN when risk >= hitlRequiredAboveRisk', () => {
        const result = finalizeVotes([{ evaluator: 'test', vote: 'REWRITE', reason: 'Risky', risk: 0.75 }], 'publish', policy);
        expect(result.decision).toBe('REQUIRE_HUMAN');
        expect(result.next_step?.tool).toBe('human.approve');
      });

      it('should keep REWRITE when risk is below hitlRequiredAboveRisk', () => {
        const lowPolicy = { ...policy, hitlRequiredAboveRisk: 0.9 };
        const result = finalizeVotes([{ evaluator: 'test', vote: 'REWRITE', reason: 'Minor', risk: 0.75 }], 'publish', lowPolicy);
        expect(result.decision).toBe('REWRITE');
      });
    });
  });

  describe('evaluateGuard', () => {
    it('should return full GuardResult with votes, guard_type, and audit_id', () => {
      const result = evaluateGuard(makeInput('send_email', { to: 'ext@example.com', attachment: true }));
      expect(result.decision).toBe('BLOCK');
      expect(result.votes).toBeDefined();
      expect(result.votes!.length).toBeGreaterThan(0);
      expect(result.guard_type).toBe('send_email');
      expect(result.audit_id).toBeDefined();
      expect(typeof result.audit_id).toBe('string');
    });

    it('should ALLOW clean actions', () => {
      const result = evaluateGuard(makeInput('send_email', { to: 'user@co.com', body: 'Hello' }));
      expect(result.decision).toBe('ALLOW');
    });

    it('should generate a unique audit_id on each call', () => {
      const r1 = evaluateGuard(makeInput('send_email', { to: 'user@co.com', body: 'Hello' }));
      const r2 = evaluateGuard(makeInput('send_email', { to: 'user@co.com', body: 'Hello' }));
      expect(r1.audit_id).not.toBe(r2.audit_id);
    });

    describe('agent scope enforcement', () => {
      it('should BLOCK when agent is not registered', () => {
        const registry = createAgentRegistry();
        const result = evaluateGuard(makeInput('send_email', {}, 'ghost-agent'), { registry });
        expect(result.decision).toBe('BLOCK');
        expect(result.reason).toContain('not found');
        expect(result.risk_score).toBe(1.0);
      });

      it('should BLOCK when agent action is outside its scope', () => {
        const registry = createAgentRegistry();
        registry.createAgent({ id: 'email-only', name: 'Email Agent', kind: 'internal', scopes: ['send_email'] });
        const result = evaluateGuard(makeInput('code_merge', { files: ['src/utils/helpers.ts'] }, 'email-only'), { registry });
        expect(result.decision).toBe('BLOCK');
        expect(result.reason).toContain('outside agent scope');
      });

      it('should proceed to evaluator when agent is in scope', () => {
        const registry = createAgentRegistry();
        registry.createAgent({ id: 'merge-agent', name: 'Merge Agent', kind: 'internal', scopes: ['code_merge'] });
        const result = evaluateGuard(makeInput('code_merge', { files: ['src/utils/helpers.ts'] }, 'merge-agent'), { registry });
        // Action is in scope, so evaluator runs — safe merge → ALLOW
        expect(result.decision).toBe('ALLOW');
      });

      it('should BLOCK when agent is suspended', () => {
        const registry = createAgentRegistry();
        registry.createAgent({ id: 'suspended-agent', name: 'Suspended', kind: 'internal', scopes: ['send_email'] });
        registry.suspendAgent('suspended-agent');
        const result = evaluateGuard(makeInput('send_email', { to: 'user@co.com', body: 'Hello' }, 'suspended-agent'), { registry });
        expect(result.decision).toBe('BLOCK');
        expect(result.reason).toContain('suspended');
      });

      it('should allow unrestricted agent (empty scopes) to perform any action', () => {
        const registry = createAgentRegistry();
        registry.createAgent({ id: 'super-agent', name: 'Super', kind: 'internal', scopes: [] });
        const result = evaluateGuard(makeInput('send_email', { to: 'user@co.com', body: 'Hello' }, 'super-agent'), { registry });
        expect(result.decision).toBe('ALLOW');
      });

      it('should skip scope check when no agentId is provided', () => {
        const registry = createAgentRegistry();
        // Registry has no agents registered, but no agentId → should proceed normally
        const result = evaluateGuard(makeInput('send_email', { to: 'user@co.com', body: 'Hello' }), { registry });
        expect(result.decision).toBe('ALLOW');
      });
    });
  });

  describe('normalizeGuardType', () => {
    it('should pass through known guard types', () => {
      expect(normalizeGuardType('send_email')).toBe('send_email');
      expect(normalizeGuardType('code_merge')).toBe('code_merge');
      expect(normalizeGuardType('publish')).toBe('publish');
    });

    it('should default unknown types to agent_action', () => {
      expect(normalizeGuardType('unknown_type')).toBe('agent_action');
      expect(normalizeGuardType('')).toBe('agent_action');
    });
  });
});
