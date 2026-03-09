import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { evaluateGuard, normalizeGuardType } from "./guards.js";
import { defaultRegistry } from "./agents.js";
import { EvaluateInputSchema, PolicyMetadataSchema } from "./schemas.js";

const defaultPolicy = PolicyMetadataSchema.parse({});

// Shared agentId property appended to all guard tool schemas
const agentIdProp = {
  agentId: { type: "string", description: "Optional agent identifier for scope enforcement" }
};

export function createServer() {
  const server = new Server(
    { name: "consensus-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  const toolDefinitions = [
    {
      name: "guard.evaluate",
      description: "Evaluate any action against guard policies. Use this when the action type is dynamic or unknown at call time.",
      inputSchema: {
        type: "object" as const,
        properties: {
          boardId: { type: "string", description: "Board identifier" },
          agentId: agentIdProp.agentId,
          action: {
            type: "object",
            properties: {
              type: { type: "string", description: "Action type (e.g. send_email, code_merge, publish)" },
              payload: { type: "object", description: "Action payload" }
            },
            required: ["type", "payload"]
          }
        },
        required: ["boardId", "action"]
      }
    },
    {
      name: "guard.send_email",
      description: "Evaluate an outbound email before sending. Blocks emails containing secrets, credentials, or external attachments that match risk patterns.",
      inputSchema: {
        type: "object" as const,
        properties: {
          boardId: { type: "string" },
          agentId: agentIdProp.agentId,
          action: {
            type: "object",
            properties: {
              type: { type: "string" },
              payload: {
                type: "object",
                properties: {
                  to: { type: "string", description: "Recipient address" },
                  body: { type: "string", description: "Email body text" },
                  attachment: { type: "boolean", description: "Whether an attachment is included" }
                },
                required: ["to", "body"]
              }
            },
            required: ["type", "payload"]
          }
        },
        required: ["boardId", "action"]
      }
    },
    {
      name: "guard.code_merge",
      description: "Evaluate a code merge or PR before it lands. Flags changes to auth, security, crypto, or permission files and routes them to human review.",
      inputSchema: {
        type: "object" as const,
        properties: {
          boardId: { type: "string" },
          agentId: agentIdProp.agentId,
          action: {
            type: "object",
            properties: {
              type: { type: "string" },
              payload: {
                type: "object",
                properties: {
                  files: { type: "array", items: { type: "string" }, description: "File paths changed in the merge" },
                  branch: { type: "string", description: "Target branch name" }
                },
                required: ["files"]
              }
            },
            required: ["type", "payload"]
          }
        },
        required: ["boardId", "action"]
      }
    },
    {
      name: "guard.publish",
      description: "Evaluate content before publishing to a public channel. Detects profanity, PII patterns (SSN), and custom blocked words.",
      inputSchema: {
        type: "object" as const,
        properties: {
          boardId: { type: "string" },
          agentId: agentIdProp.agentId,
          action: {
            type: "object",
            properties: {
              type: { type: "string" },
              payload: {
                type: "object",
                properties: {
                  text: { type: "string", description: "Content text to be published" },
                  channel: { type: "string", description: "Publication channel (e.g. blog, social)" }
                },
                required: ["text"]
              }
            },
            required: ["type", "payload"]
          }
        },
        required: ["boardId", "action"]
      }
    },
    {
      name: "guard.support_reply",
      description: "Evaluate a customer support reply before sending. Escalates messages containing refund commitments, legal threats, or escalation keywords.",
      inputSchema: {
        type: "object" as const,
        properties: {
          boardId: { type: "string" },
          agentId: agentIdProp.agentId,
          action: {
            type: "object",
            properties: {
              type: { type: "string" },
              payload: {
                type: "object",
                properties: {
                  message: { type: "string", description: "Support reply text" },
                  customerTier: { type: "string", description: "Customer tier (free, pro, enterprise)" }
                },
                required: ["message"]
              }
            },
            required: ["type", "payload"]
          }
        },
        required: ["boardId", "action"]
      }
    },
    {
      name: "guard.agent_action",
      description: "Evaluate a generic agent action. Blocks irreversible actions that have not been explicitly approved by a human.",
      inputSchema: {
        type: "object" as const,
        properties: {
          boardId: { type: "string" },
          agentId: agentIdProp.agentId,
          action: {
            type: "object",
            properties: {
              type: { type: "string" },
              payload: {
                type: "object",
                properties: {
                  irreversible: { type: "boolean", description: "Whether the action cannot be undone" },
                  tool: { type: "string", description: "MCP tool name being invoked" }
                },
                required: ["irreversible"]
              }
            },
            required: ["type", "payload"]
          }
        },
        required: ["boardId", "action"]
      }
    },
    {
      name: "guard.deployment",
      description: "Evaluate a deployment before it runs. Production deployments are flagged for human review; non-production environments are allowed through.",
      inputSchema: {
        type: "object" as const,
        properties: {
          boardId: { type: "string" },
          agentId: agentIdProp.agentId,
          action: {
            type: "object",
            properties: {
              type: { type: "string" },
              payload: {
                type: "object",
                properties: {
                  env: { type: "string", description: "Target environment (dev, staging, prod)" },
                  service: { type: "string", description: "Service or app being deployed" }
                },
                required: ["env"]
              }
            },
            required: ["type", "payload"]
          }
        },
        required: ["boardId", "action"]
      }
    },
    {
      name: "guard.permission_escalation",
      description: "Evaluate a permission escalation request. Break-glass escalations are always flagged; standard permission changes are assessed against scope.",
      inputSchema: {
        type: "object" as const,
        properties: {
          boardId: { type: "string" },
          agentId: agentIdProp.agentId,
          action: {
            type: "object",
            properties: {
              type: { type: "string" },
              payload: {
                type: "object",
                properties: {
                  breakGlass: { type: "boolean", description: "Whether this is a break-glass emergency escalation" },
                  role: { type: "string", description: "Role or permission being escalated to" }
                },
                required: ["breakGlass"]
              }
            },
            required: ["type", "payload"]
          }
        },
        required: ["boardId", "action"]
      }
    },
    // ── Agent management ────────────────────────────────────────────────────
    {
      name: "agent.register",
      description: "Register an agent with the guard registry. Internal agents need no API key. External (MCP-linked) agents require an apiKeyHash.",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "string", description: "Unique agent identifier" },
          name: { type: "string", description: "Human-readable agent name" },
          kind: { type: "string", enum: ["internal", "external"], description: "internal = same-process AI SDK agent; external = MCP-linked agent" },
          scopes: {
            type: "array",
            items: { type: "string" },
            description: "Guard types this agent may evaluate. Empty array = unrestricted."
          },
          apiKeyHash: { type: "string", description: "Hashed API key — required for external agents" },
          metadata: { type: "object", description: "Optional metadata bag" }
        },
        required: ["id", "name", "kind", "scopes"]
      }
    },
    {
      name: "agent.list",
      description: "List all agents currently registered in the guard registry.",
      inputSchema: { type: "object" as const, properties: {} }
    },
    {
      name: "agent.suspend",
      description: "Suspend an agent so it fails scope checks until reactivated.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "string", description: "Agent identifier to suspend" } },
        required: ["id"]
      }
    },
    {
      name: "agent.activate",
      description: "Reactivate a previously suspended agent.",
      inputSchema: {
        type: "object" as const,
        properties: { id: { type: "string", description: "Agent identifier to reactivate" } },
        required: ["id"]
      }
    }
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toolDefinitions };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    // ── Agent management ──────────────────────────────────────────────────
    if (name === "agent.register") {
      try {
        const agent = defaultRegistry.createAgent({
          id: a.id as string,
          name: a.name as string,
          kind: a.kind as "internal" | "external",
          scopes: (a.scopes as string[]) ?? [],
          apiKeyHash: a.apiKeyHash as string | undefined,
          metadata: a.metadata as Record<string, unknown> | undefined
        });
        return { content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: (err as Error).message }) }] };
      }
    }

    if (name === "agent.list") {
      return { content: [{ type: "text", text: JSON.stringify(defaultRegistry.listAgents(), null, 2) }] };
    }

    if (name === "agent.suspend") {
      const agent = defaultRegistry.suspendAgent(a.id as string);
      if (!agent) return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: `Agent not found: ${a.id}` }) }] };
      return { content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
    }

    if (name === "agent.activate") {
      const agent = defaultRegistry.activateAgent(a.id as string);
      if (!agent) return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: `Agent not found: ${a.id}` }) }] };
      return { content: [{ type: "text", text: JSON.stringify(agent, null, 2) }] };
    }

    // ── Guard evaluation ──────────────────────────────────────────────────
    if (name.startsWith("guard.")) {
      const guardType = name === "guard.evaluate"
        ? normalizeGuardType((a.action as Record<string, unknown>)?.type as string ?? "agent_action")
        : name.replace("guard.", "");

      try {
        const input = EvaluateInputSchema.parse({
          boardId: a.boardId ?? "default",
          agentId: a.agentId,
          action: {
            type: guardType,
            payload: (a.action as Record<string, unknown>)?.payload ?? {}
          }
        });

        const result = evaluateGuard(input, { policy: defaultPolicy, registry: defaultRegistry });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: (err as Error).message }) }] };
      }
    }

    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ error: `Tool not found: ${name}` }) }]
    };
  });

  return server;
}

export async function startServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Consensus MCP Server running on stdio");
}
