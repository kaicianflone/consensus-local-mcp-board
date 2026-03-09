import type { GuardType } from './schemas.js';

export type AgentKind = 'internal' | 'external';

export interface AgentConfig {
  id: string;
  name: string;
  kind: AgentKind;
  scopes: GuardType[];
  apiKeyHash?: string;
  metadata?: Record<string, unknown>;
}

export interface Agent {
  id: string;
  name: string;
  kind: AgentKind;
  scopes: GuardType[];
  apiKeyHash: string | null;
  status: 'active' | 'suspended';
  metadata: Record<string, unknown>;
  createdAt: number;
}

export class AgentRegistry {
  private agents = new Map<string, Agent>();

  createAgent(config: AgentConfig): Agent {
    if (this.agents.has(config.id)) {
      throw new Error(`Agent already exists: ${config.id}`);
    }

    if (config.kind === 'external' && !config.apiKeyHash) {
      throw new Error('External agents require an apiKeyHash');
    }

    const agent: Agent = {
      id: config.id,
      name: config.name,
      kind: config.kind,
      scopes: config.scopes,
      apiKeyHash: config.apiKeyHash ?? null,
      status: 'active',
      metadata: config.metadata ?? {},
      createdAt: Date.now()
    };

    this.agents.set(config.id, agent);
    return agent;
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  listAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  removeAgent(id: string): boolean {
    return this.agents.delete(id);
  }

  suspendAgent(id: string): Agent | undefined {
    const agent = this.agents.get(id);
    if (agent) {
      agent.status = 'suspended';
    }
    return agent;
  }

  activateAgent(id: string): Agent | undefined {
    const agent = this.agents.get(id);
    if (agent) {
      agent.status = 'active';
    }
    return agent;
  }

  validateAgentScope(agentId: string, actionType: string): { allowed: boolean; reason: string } {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return { allowed: false, reason: `Agent not found: ${agentId}` };
    }

    if (agent.status === 'suspended') {
      return { allowed: false, reason: `Agent is suspended: ${agentId}` };
    }

    if (agent.scopes.length === 0) {
      return { allowed: true, reason: 'Agent has unrestricted scope' };
    }

    if (agent.scopes.includes(actionType as GuardType)) {
      return { allowed: true, reason: `Action '${actionType}' is within agent scope` };
    }

    return { allowed: false, reason: `Action '${actionType}' is outside agent scope [${agent.scopes.join(', ')}]` };
  }
}

export function isInternalAgent(agent: Agent): boolean {
  return agent.kind === 'internal';
}

export function isExternalAgent(agent: Agent): boolean {
  return agent.kind === 'external';
}

export function createAgentRegistry(): AgentRegistry {
  return new AgentRegistry();
}

/**
 * Process-scoped default registry shared by the lean MCP server.
 * Internal AI SDK agents and self-declared external agents both register here.
 * Resets on process restart — for persistence, use the server/ SQLite layer.
 */
export const defaultRegistry = createAgentRegistry();
