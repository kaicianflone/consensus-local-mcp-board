import { describe, it, expect } from 'vitest';
import { localFallbackEvaluate } from '../server/src/adapters/consensus-tools.js';
import { extractGuardConfig } from '../server/src/workflows/runner.js';

function makeInput(guardType: string, payload: Record<string, unknown> = {}) {
  return { boardId: 'test-board', runId: 'run-1', guardType, payload };
}

describe('localFallbackEvaluate – guard-config-aware heuristics', () => {

  // ─── send_email ──────────────────────────────────────────────

  describe('send_email', () => {
    it('should BLOCK when recipient matches blocklist domain', () => {
      const r = localFallbackEvaluate(makeInput('send_email', {
        to: 'user@evil.com',
        body: 'Hello',
        guardConfig: { recipientBlocklist: 'evil.com, spam.org' },
      }));
      expect(r.decision).toBe('BLOCK');
      expect(r.reason).toContain('blocklist');
      expect(r.risk_score).toBeGreaterThanOrEqual(0.9);
    });

    it('should BLOCK when secrets detected and secretsScanning is on (default)', () => {
      const r = localFallbackEvaluate(makeInput('send_email', {
        to: 'user@co.com',
        body: 'Here is api_key=abc123',
        guardConfig: {},
      }));
      expect(r.decision).toBe('BLOCK');
      expect(r.reason).toContain('ecrets');
    });

    it('should ALLOW secrets when secretsScanning is off', () => {
      const r = localFallbackEvaluate(makeInput('send_email', {
        to: 'user@co.com',
        body: 'Here is api_key=abc123',
        guardConfig: { secretsScanning: false },
      }));
      expect(r.decision).not.toBe('BLOCK');
    });

    it('should BLOCK attachment when attachmentPolicy is block', () => {
      const r = localFallbackEvaluate(makeInput('send_email', {
        to: 'user@co.com',
        body: 'see attached',
        attachment: true,
        guardConfig: { attachmentPolicy: 'block' },
      }));
      expect(r.decision).toBe('BLOCK');
      expect(r.reason).toContain('Attachment blocked');
    });

    it('should REQUIRE_HUMAN for attachment+warn on external email', () => {
      const r = localFallbackEvaluate(makeInput('send_email', {
        to: 'user@external.com',
        body: 'see attached',
        attachment: true,
        guardConfig: { attachmentPolicy: 'warn' },
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
      expect(r.reason).toContain('attachment');
    });

    it('should ALLOW attachment when attachmentPolicy is allow', () => {
      const r = localFallbackEvaluate(makeInput('send_email', {
        to: 'user@co.com',
        body: 'see attached',
        attachment: true,
        guardConfig: { attachmentPolicy: 'allow' },
      }));
      expect(r.decision).toBe('ALLOW');
    });

    it('should REQUIRE_HUMAN when recipient not in allowlist', () => {
      const r = localFallbackEvaluate(makeInput('send_email', {
        to: 'user@external.com',
        body: 'Hello',
        guardConfig: { recipientAllowlist: 'internal.com, partner.com' },
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
      expect(r.reason).toContain('allowlist');
    });

    it('should ALLOW when recipient is in allowlist', () => {
      const r = localFallbackEvaluate(makeInput('send_email', {
        to: 'user@internal.com',
        body: 'Hello',
        guardConfig: { recipientAllowlist: 'internal.com, partner.com' },
      }));
      expect(r.decision).toBe('ALLOW');
    });

    it('should ALLOW clean email with no config', () => {
      const r = localFallbackEvaluate(makeInput('send_email', {
        to: 'user@co.com',
        body: 'Hello world',
        guardConfig: {},
      }));
      expect(r.decision).toBe('ALLOW');
      expect(r.risk_score).toBeLessThan(0.5);
    });

    it('should include guardConfig in meta', () => {
      const gc = { recipientAllowlist: 'a.com', secretsScanning: true };
      const r = localFallbackEvaluate(makeInput('send_email', {
        to: 'user@a.com',
        body: 'hi',
        guardConfig: gc,
      }));
      expect(r.meta?.guardConfig).toEqual(gc);
      expect(r.meta?.engine).toBe('local-fallback');
    });
  });

  // ─── code_merge ──────────────────────────────────────────────

  describe('code_merge', () => {
    it('should REQUIRE_HUMAN when sensitive file on protected branch', () => {
      const r = localFallbackEvaluate(makeInput('code_merge', {
        files: 'src/auth/login.ts',
        branch: 'main',
        guardConfig: { sensitiveFilePatterns: 'auth,security', protectedBranches: 'main,release/*' },
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
      expect(r.reason).toContain('Sensitive file');
      expect(r.reason).toContain('protected branch');
    });

    it('should REWRITE when sensitive file on non-protected branch', () => {
      const r = localFallbackEvaluate(makeInput('code_merge', {
        files: 'src/auth/login.ts',
        branch: 'feature-x',
        guardConfig: { sensitiveFilePatterns: 'auth,security', protectedBranches: 'main' },
      }));
      expect(r.decision).toBe('REWRITE');
    });

    it('should ALLOW when no sensitive patterns match', () => {
      const r = localFallbackEvaluate(makeInput('code_merge', {
        files: 'src/utils/helpers.ts',
        branch: 'main',
        guardConfig: { sensitiveFilePatterns: 'auth,security', protectedBranches: 'main' },
      }));
      expect(r.decision).toBe('ALLOW');
    });

    it('should use default sensitive patterns when not configured', () => {
      const r = localFallbackEvaluate(makeInput('code_merge', {
        files: 'lib/crypto/aes.ts',
        branch: 'develop',
        guardConfig: {},
      }));
      // default patterns include 'crypto'
      expect(r.decision).toBe('REWRITE');
    });

    it('should match custom glob-like patterns', () => {
      const r = localFallbackEvaluate(makeInput('code_merge', {
        files: 'config/database.yml',
        branch: 'main',
        guardConfig: { sensitiveFilePatterns: 'config/*,*.env', protectedBranches: 'main' },
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
    });

    it('should support wildcard protected branches', () => {
      const r = localFallbackEvaluate(makeInput('code_merge', {
        files: 'src/auth/login.ts',
        branch: 'release/v2.0',
        guardConfig: { sensitiveFilePatterns: 'auth', protectedBranches: 'main,release/*' },
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
    });
  });

  // ─── publish ─────────────────────────────────────────────────

  describe('publish', () => {
    it('should REWRITE when profanity detected and filter is on (default)', () => {
      const r = localFallbackEvaluate(makeInput('publish', {
        text: 'This is damn terrible',
        guardConfig: {},
      }));
      expect(r.decision).toBe('REWRITE');
      expect(r.reason).toContain('Profanity');
    });

    it('should ALLOW profanity when profanityFilter is off', () => {
      const r = localFallbackEvaluate(makeInput('publish', {
        text: 'This is damn terrible',
        guardConfig: { profanityFilter: false },
      }));
      expect(r.decision).not.toBe('REWRITE');
    });

    it('should BLOCK when SSN (PII) detected and piiDetection is on (default)', () => {
      const r = localFallbackEvaluate(makeInput('publish', {
        text: 'SSN: 123-45-6789',
        guardConfig: {},
      }));
      expect(r.decision).toBe('BLOCK');
      expect(r.reason).toContain('PII');
    });

    it('should ALLOW SSN when piiDetection is off', () => {
      const r = localFallbackEvaluate(makeInput('publish', {
        text: 'SSN: 123-45-6789',
        guardConfig: { piiDetection: false },
      }));
      expect(r.decision).not.toBe('BLOCK');
    });

    it('should REWRITE when blocked word found', () => {
      const r = localFallbackEvaluate(makeInput('publish', {
        text: 'Our competitor sucks big time',
        guardConfig: { blockedWords: 'competitor,confidential' },
      }));
      expect(r.decision).toBe('REWRITE');
      expect(r.reason).toContain('competitor');
    });

    it('should ALLOW when no blocked words match', () => {
      const r = localFallbackEvaluate(makeInput('publish', {
        text: 'Great product launch!',
        guardConfig: { blockedWords: 'competitor,confidential' },
      }));
      expect(r.decision).toBe('ALLOW');
    });

    it('should ALLOW clean publish with no config', () => {
      const r = localFallbackEvaluate(makeInput('publish', {
        text: 'Great announcement!',
        guardConfig: {},
      }));
      expect(r.decision).toBe('ALLOW');
      expect(r.risk_score).toBeLessThan(0.5);
    });
  });

  // ─── support_reply ───────────────────────────────────────────

  describe('support_reply', () => {
    it('should REQUIRE_HUMAN on escalation keyword with autoEscalate on (default)', () => {
      const r = localFallbackEvaluate(makeInput('support_reply', {
        message: 'We will issue a full refund',
        guardConfig: {},
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
      expect(r.reason).toContain('refund');
    });

    it('should REWRITE on escalation keyword with autoEscalate off', () => {
      const r = localFallbackEvaluate(makeInput('support_reply', {
        message: 'We will issue a full refund',
        guardConfig: { autoEscalate: false },
      }));
      expect(r.decision).toBe('REWRITE');
      expect(r.reason).toContain('refund');
    });

    it('should detect custom escalation keywords', () => {
      const r = localFallbackEvaluate(makeInput('support_reply', {
        message: 'I want to cancel my subscription',
        guardConfig: { escalationKeywords: 'cancel,chargeback,BBB' },
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
      expect(r.reason).toContain('cancel');
    });

    it('should ALLOW when no escalation keywords match', () => {
      const r = localFallbackEvaluate(makeInput('support_reply', {
        message: 'Thank you for contacting us',
        guardConfig: {},
      }));
      expect(r.decision).toBe('ALLOW');
      expect(r.risk_score).toBeLessThan(0.5);
    });

    it('should use default keywords (refund, lawsuit, legal action)', () => {
      const r = localFallbackEvaluate(makeInput('support_reply', {
        message: 'We will proceed with a lawsuit',
        guardConfig: {},
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
      expect(r.reason).toContain('lawsuit');
    });
  });

  // ─── agent_action ────────────────────────────────────────────

  describe('agent_action', () => {
    it('should REQUIRE_HUMAN when tool is on blocklist', () => {
      const r = localFallbackEvaluate(makeInput('agent_action', {
        tool: 'delete_database',
        guardConfig: { toolBlocklist: 'delete,drop' },
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
      expect(r.reason).toContain('blocklist');
    });

    it('should ALLOW when tool is on allowlist', () => {
      const r = localFallbackEvaluate(makeInput('agent_action', {
        tool: 'read_file',
        guardConfig: { toolAllowlist: 'read_file,list_dir' },
      }));
      expect(r.decision).toBe('ALLOW');
      expect(r.reason).toContain('allowlist');
    });

    it('should check blocklist before allowlist', () => {
      const r = localFallbackEvaluate(makeInput('agent_action', {
        tool: 'delete_data',
        guardConfig: { toolBlocklist: 'delete', toolAllowlist: 'delete_data' },
      }));
      // blocklist is checked first
      expect(r.decision).toBe('REQUIRE_HUMAN');
    });

    it('should REQUIRE_HUMAN for irreversible action (from payload)', () => {
      const r = localFallbackEvaluate(makeInput('agent_action', {
        irreversible: true,
        tool: 'custom_tool',
        guardConfig: {},
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
      expect(r.reason).toContain('Irreversible');
    });

    it('should REQUIRE_HUMAN for irreversible via config default', () => {
      const r = localFallbackEvaluate(makeInput('agent_action', {
        tool: 'custom_tool',
        guardConfig: { irreversibleDefault: true },
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
    });

    it('should ALLOW reversible action with no lists', () => {
      const r = localFallbackEvaluate(makeInput('agent_action', {
        tool: 'custom_tool',
        guardConfig: {},
      }));
      expect(r.decision).toBe('ALLOW');
      expect(r.risk_score).toBeLessThan(0.5);
    });
  });

  // ─── deployment ──────────────────────────────────────────────

  describe('deployment', () => {
    it('should REQUIRE_HUMAN for prod with requireProdApproval on (default)', () => {
      const r = localFallbackEvaluate(makeInput('deployment', {
        env: 'prod',
        guardConfig: {},
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
      expect(r.reason).toContain('Production');
    });

    it('should REWRITE for prod with requireProdApproval off', () => {
      const r = localFallbackEvaluate(makeInput('deployment', {
        env: 'prod',
        guardConfig: { requireProdApproval: false },
      }));
      expect(r.decision).toBe('REWRITE');
    });

    it('should ALLOW non-production deployment', () => {
      const r = localFallbackEvaluate(makeInput('deployment', {
        env: 'staging',
        guardConfig: {},
      }));
      expect(r.decision).toBe('ALLOW');
      expect(r.reason).toContain('Non-production');
    });

    it('should ALLOW dev deployment', () => {
      const r = localFallbackEvaluate(makeInput('deployment', {
        env: 'dev',
        guardConfig: { deployEnv: 'dev' },
      }));
      expect(r.decision).toBe('ALLOW');
    });

    it('should respect deployEnv from config when payload env absent', () => {
      const r = localFallbackEvaluate(makeInput('deployment', {
        guardConfig: { deployEnv: 'prod' },
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
    });

    it('should include next_step for REQUIRE_HUMAN', () => {
      const r = localFallbackEvaluate(makeInput('deployment', {
        env: 'prod',
        guardConfig: {},
      }));
      expect(r.next_step).toBeDefined();
      expect(r.next_step?.tool).toBe('human.approve');
    });
  });

  // ─── permission_escalation ───────────────────────────────────

  describe('permission_escalation', () => {
    it('should REQUIRE_HUMAN for break-glass escalation (payload)', () => {
      const r = localFallbackEvaluate(makeInput('permission_escalation', {
        breakGlass: true,
        guardConfig: {},
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
      expect(r.reason).toContain('Break-glass');
      expect(r.risk_score).toBeGreaterThanOrEqual(0.9);
    });

    it('should REQUIRE_HUMAN for break-glass via config default', () => {
      const r = localFallbackEvaluate(makeInput('permission_escalation', {
        guardConfig: { breakGlassDefault: true },
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
      expect(r.reason).toContain('Break-glass');
    });

    it('should REQUIRE_HUMAN when requireMfa is on', () => {
      const r = localFallbackEvaluate(makeInput('permission_escalation', {
        guardConfig: { requireMfa: true },
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
      expect(r.reason).toContain('MFA');
    });

    it('should REQUIRE_HUMAN even with no special flags (default behavior)', () => {
      const r = localFallbackEvaluate(makeInput('permission_escalation', {
        guardConfig: {},
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
      expect(r.reason).toContain('by default');
    });

    it('should have highest risk_score for break-glass', () => {
      const breakGlass = localFallbackEvaluate(makeInput('permission_escalation', {
        breakGlass: true,
        guardConfig: {},
      }));
      const mfa = localFallbackEvaluate(makeInput('permission_escalation', {
        guardConfig: { requireMfa: true },
      }));
      const def = localFallbackEvaluate(makeInput('permission_escalation', {
        guardConfig: {},
      }));
      expect(breakGlass.risk_score).toBeGreaterThan(mfa.risk_score);
      expect(mfa.risk_score).toBeGreaterThan(def.risk_score);
    });
  });

  // ─── generic fallback (unknown guard type) ───────────────────

  describe('generic fallback (unknown guard type)', () => {
    it('should BLOCK payload with secret markers', () => {
      const r = localFallbackEvaluate(makeInput('custom_guard', {
        data: 'api_key=abc123',
      }));
      expect(r.decision).toBe('BLOCK');
      expect(r.meta?.mode).toBe('heuristic');
    });

    it('should REQUIRE_HUMAN for prod/auth signals', () => {
      const r = localFallbackEvaluate(makeInput('custom_guard', {
        env: 'prod',
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
    });

    it('should ALLOW clean payload', () => {
      const r = localFallbackEvaluate(makeInput('custom_guard', {
        name: 'hello',
      }));
      expect(r.decision).toBe('ALLOW');
      expect(r.risk_score).toBeLessThan(0.5);
    });

    it('should detect token pattern', () => {
      const r = localFallbackEvaluate(makeInput('unknown_type', {
        header: 'Bearer token_xyz',
      }));
      expect(r.decision).toBe('BLOCK');
    });

    it('should detect permission escalation signals', () => {
      const r = localFallbackEvaluate(makeInput('unknown_type', {
        action: 'permission change',
      }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
    });
  });

  // ─── meta and structural checks ─────────────────────────────

  describe('result structure', () => {
    it('should always include guard_type', () => {
      for (const gt of ['send_email', 'code_merge', 'publish', 'support_reply', 'agent_action', 'deployment', 'permission_escalation']) {
        const r = localFallbackEvaluate(makeInput(gt, { guardConfig: {} }));
        expect(r.guard_type).toBe(gt);
      }
    });

    it('should always include audit_id with run prefix', () => {
      const r = localFallbackEvaluate(makeInput('send_email', { to: 'a@b.com', body: 'hi', guardConfig: {} }));
      expect(r.audit_id).toContain('run-1');
    });

    it('should include next_step for REQUIRE_HUMAN decisions', () => {
      const r = localFallbackEvaluate(makeInput('deployment', { env: 'prod', guardConfig: {} }));
      expect(r.decision).toBe('REQUIRE_HUMAN');
      expect(r.next_step).toBeDefined();
      expect(r.next_step?.tool).toBe('human.approve');
      expect(r.next_step?.input).toHaveProperty('runId');
      expect(r.next_step?.input).toHaveProperty('boardId');
    });

    it('should use guard-config mode for known types', () => {
      const r = localFallbackEvaluate(makeInput('publish', { text: 'clean', guardConfig: {} }));
      expect(r.meta?.mode).toBe('guard-config');
    });

    it('should use heuristic mode for unknown types', () => {
      const r = localFallbackEvaluate(makeInput('unknown', { data: 'safe' }));
      expect(r.meta?.mode).toBe('heuristic');
    });
  });

  // ─── payload.input fallback ──────────────────────────────────

  describe('payload.input fallback', () => {
    it('should read fields from nested input object', () => {
      const r = localFallbackEvaluate(makeInput('send_email', {
        input: { to: 'user@evil.com', body: 'hello' },
        guardConfig: { recipientBlocklist: 'evil.com' },
      }));
      expect(r.decision).toBe('BLOCK');
    });

    it('should prefer top-level fields over input', () => {
      const r = localFallbackEvaluate(makeInput('send_email', {
        to: 'user@safe.com',
        input: { to: 'user@evil.com' },
        body: 'hello',
        guardConfig: { recipientBlocklist: 'evil.com' },
      }));
      // top-level to=safe.com should take priority
      expect(r.decision).toBe('ALLOW');
    });
  });
});

// ─── extractGuardConfig ────────────────────────────────────────

describe('extractGuardConfig', () => {
  it('should return empty object for undefined', () => {
    expect(extractGuardConfig(undefined)).toEqual({});
  });

  it('should return empty object for empty config', () => {
    expect(extractGuardConfig({})).toEqual({});
  });

  it('should strip all shared fields', () => {
    const config = {
      guardType: 'send_email',
      quorum: 3,
      riskThreshold: 0.7,
      numberOfAgents: 2,
      numberOfHumans: 1,
      policyPack: 'strict',
      recipientAllowlist: 'a.com',
      secretsScanning: true,
    };
    const gc = extractGuardConfig(config);
    expect(gc).toEqual({ recipientAllowlist: 'a.com', secretsScanning: true });
    expect(gc).not.toHaveProperty('guardType');
    expect(gc).not.toHaveProperty('quorum');
    expect(gc).not.toHaveProperty('riskThreshold');
    expect(gc).not.toHaveProperty('numberOfAgents');
    expect(gc).not.toHaveProperty('numberOfHumans');
    expect(gc).not.toHaveProperty('policyPack');
  });

  it('should skip undefined and empty-string values', () => {
    const gc = extractGuardConfig({
      recipientAllowlist: 'a.com',
      recipientBlocklist: '',
      attachmentPolicy: undefined,
      secretsScanning: false,
    });
    expect(gc).toEqual({ recipientAllowlist: 'a.com', secretsScanning: false });
  });

  it('should preserve falsy non-empty values (false, 0)', () => {
    const gc = extractGuardConfig({
      secretsScanning: false,
      maxEscalationLevel: 0,
    });
    expect(gc).toEqual({ secretsScanning: false, maxEscalationLevel: 0 });
  });

  it('should work with deployment config', () => {
    const gc = extractGuardConfig({
      guardType: 'deployment',
      quorum: 2,
      deployEnv: 'prod',
      rolloutStrategy: 'canary',
      requireProdApproval: true,
      rollbackEnabled: true,
    });
    expect(gc).toEqual({
      deployEnv: 'prod',
      rolloutStrategy: 'canary',
      requireProdApproval: true,
      rollbackEnabled: true,
    });
  });
});
