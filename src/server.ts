import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

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

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  throw new Error(`Tool not found: ${request.params.name}`);
});

export async function startServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Consensus MCP Server running on stdio");
}
