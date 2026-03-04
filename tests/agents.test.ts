import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry, isInternalAgent, isExternalAgent, createAgentRegistry } from '../src/agents.js';
import type { AgentConfig } from '../src/agents.js';

describe('Agents', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = createAgentRegistry();
  });

  describe('createAgent', () => {
    it('should create an internal agent', () => {
      const agent = registry.createAgent({
        id: 'agent-1',
        name: 'Email Guard',
        kind: 'internal',
        scopes: ['send_email']
      });
      expect(agent.id).toBe('agent-1');
      expect(agent.name).toBe('Email Guard');
      expect(agent.kind).toBe('internal');
      expect(agent.status).toBe('active');
      expect(agent.apiKeyHash).toBeNull();
    });

    it('should create an external agent with apiKeyHash', () => {
      const agent = registry.createAgent({
        id: 'ext-1',
        name: 'External Reviewer',
        kind: 'external',
        scopes: ['publish'],
        apiKeyHash: 'hash-abc123'
      });
      expect(agent.kind).toBe('external');
      expect(agent.apiKeyHash).toBe('hash-abc123');
    });

    it('should reject external agent without apiKeyHash', () => {
      expect(() => registry.createAgent({
        id: 'ext-2',
        name: 'Bad External',
        kind: 'external',
        scopes: ['publish']
      })).toThrow('External agents require an apiKeyHash');
    });

    it('should reject duplicate agent IDs', () => {
      registry.createAgent({ id: 'dup', name: 'First', kind: 'internal', scopes: [] });
      expect(() => registry.createAgent({ id: 'dup', name: 'Second', kind: 'internal', scopes: [] }))
        .toThrow('Agent already exists: dup');
    });

    it('should store metadata', () => {
      const agent = registry.createAgent({
        id: 'meta-1',
        name: 'Meta Agent',
        kind: 'internal',
        scopes: [],
        metadata: { team: 'security', priority: 'high' }
      });
      expect(agent.metadata).toEqual({ team: 'security', priority: 'high' });
    });
  });

  describe('getAgent', () => {
    it('should retrieve an existing agent', () => {
      registry.createAgent({ id: 'a1', name: 'Test', kind: 'internal', scopes: [] });
      const agent = registry.getAgent('a1');
      expect(agent).toBeDefined();
      expect(agent!.name).toBe('Test');
    });

    it('should return undefined for non-existent agent', () => {
      expect(registry.getAgent('nonexistent')).toBeUndefined();
    });
  });

  describe('listAgents', () => {
    it('should return empty list initially', () => {
      expect(registry.listAgents()).toEqual([]);
    });

    it('should return all registered agents', () => {
      registry.createAgent({ id: 'a1', name: 'Agent 1', kind: 'internal', scopes: [] });
      registry.createAgent({ id: 'a2', name: 'Agent 2', kind: 'external', scopes: [], apiKeyHash: 'hash' });
      const agents = registry.listAgents();
      expect(agents).toHaveLength(2);
    });
  });

  describe('removeAgent', () => {
    it('should remove an existing agent', () => {
      registry.createAgent({ id: 'rm-1', name: 'Remove Me', kind: 'internal', scopes: [] });
      expect(registry.removeAgent('rm-1')).toBe(true);
      expect(registry.getAgent('rm-1')).toBeUndefined();
    });

    it('should return false for non-existent agent', () => {
      expect(registry.removeAgent('nonexistent')).toBe(false);
    });
  });

  describe('suspendAgent / activateAgent', () => {
    it('should suspend an active agent', () => {
      registry.createAgent({ id: 's1', name: 'Suspendable', kind: 'internal', scopes: [] });
      const agent = registry.suspendAgent('s1');
      expect(agent!.status).toBe('suspended');
    });

    it('should reactivate a suspended agent', () => {
      registry.createAgent({ id: 's2', name: 'Reactivatable', kind: 'internal', scopes: [] });
      registry.suspendAgent('s2');
      const agent = registry.activateAgent('s2');
      expect(agent!.status).toBe('active');
    });

    it('should return undefined for non-existent agent', () => {
      expect(registry.suspendAgent('nonexistent')).toBeUndefined();
      expect(registry.activateAgent('nonexistent')).toBeUndefined();
    });
  });

  describe('validateAgentScope', () => {
    it('should allow action within agent scope', () => {
      registry.createAgent({ id: 'scoped', name: 'Scoped', kind: 'internal', scopes: ['send_email', 'publish'] });
      const result = registry.validateAgentScope('scoped', 'send_email');
      expect(result.allowed).toBe(true);
    });

    it('should deny action outside agent scope', () => {
      registry.createAgent({ id: 'scoped2', name: 'Scoped', kind: 'internal', scopes: ['send_email'] });
      const result = registry.validateAgentScope('scoped2', 'code_merge');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('outside agent scope');
    });

    it('should allow any action for unrestricted agents (empty scopes)', () => {
      registry.createAgent({ id: 'unrestricted', name: 'Unrestricted', kind: 'internal', scopes: [] });
      const result = registry.validateAgentScope('unrestricted', 'code_merge');
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('unrestricted');
    });

    it('should deny action for non-existent agent', () => {
      const result = registry.validateAgentScope('ghost', 'send_email');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not found');
    });

    it('should deny action for suspended agent', () => {
      registry.createAgent({ id: 'suspended', name: 'Suspended', kind: 'internal', scopes: ['send_email'] });
      registry.suspendAgent('suspended');
      const result = registry.validateAgentScope('suspended', 'send_email');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('suspended');
    });
  });

  describe('isInternalAgent / isExternalAgent', () => {
    it('should correctly identify internal agents', () => {
      const agent = registry.createAgent({ id: 'int', name: 'Internal', kind: 'internal', scopes: [] });
      expect(isInternalAgent(agent)).toBe(true);
      expect(isExternalAgent(agent)).toBe(false);
    });

    it('should correctly identify external agents', () => {
      const agent = registry.createAgent({ id: 'ext', name: 'External', kind: 'external', scopes: [], apiKeyHash: 'hash' });
      expect(isExternalAgent(agent)).toBe(true);
      expect(isInternalAgent(agent)).toBe(false);
    });
  });

  describe('createAgentRegistry', () => {
    it('should create an independent registry', () => {
      const reg1 = createAgentRegistry();
      const reg2 = createAgentRegistry();
      reg1.createAgent({ id: 'a1', name: 'Test', kind: 'internal', scopes: [] });
      expect(reg1.listAgents()).toHaveLength(1);
      expect(reg2.listAgents()).toHaveLength(0);
    });
  });
});
