import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { evaluateGuard, normalizeGuardType } from "./guards.js";
import { EvaluateInputSchema } from "./schemas.js";

export function createServer() {
  const server = new Server(
    {
      name: "consensus-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const toolDefinitions = [
    {
      name: "guard.evaluate",
      description: "Evaluate an action against guard policies",
      inputSchema: {
        type: "object" as const,
        properties: {
          boardId: { type: "string", description: "Board identifier" },
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
      description: "Evaluate a send_email action against guard policies",
      inputSchema: {
        type: "object" as const,
        properties: {
          boardId: { type: "string" },
          action: { type: "object", properties: { type: { type: "string" }, payload: { type: "object" } }, required: ["type", "payload"] }
        },
        required: ["boardId", "action"]
      }
    },
    {
      name: "guard.code_merge",
      description: "Evaluate a code_merge action against guard policies",
      inputSchema: {
        type: "object" as const,
        properties: {
          boardId: { type: "string" },
          action: { type: "object", properties: { type: { type: "string" }, payload: { type: "object" } }, required: ["type", "payload"] }
        },
        required: ["boardId", "action"]
      }
    },
    {
      name: "guard.publish",
      description: "Evaluate a publish action against guard policies",
      inputSchema: {
        type: "object" as const,
        properties: {
          boardId: { type: "string" },
          action: { type: "object", properties: { type: { type: "string" }, payload: { type: "object" } }, required: ["type", "payload"] }
        },
        required: ["boardId", "action"]
      }
    }
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toolDefinitions };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name.startsWith("guard.")) {
      const guardType = name === "guard.evaluate"
        ? normalizeGuardType((args as Record<string, unknown>)?.action
            ? ((args as Record<string, unknown>).action as Record<string, unknown>).type as string
            : "agent_action")
        : name.replace("guard.", "");

      const input = EvaluateInputSchema.parse({
        boardId: (args as Record<string, unknown>)?.boardId ?? "default",
        action: {
          type: guardType,
          payload: (args as Record<string, unknown>)?.action
            ? ((args as Record<string, unknown>).action as Record<string, unknown>).payload ?? {}
            : {}
        }
      });

      const result = evaluateGuard(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }

    throw new Error(`Tool not found: ${name}`);
  });

  return server;
}

export async function startServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Consensus MCP Server running on stdio");
}
