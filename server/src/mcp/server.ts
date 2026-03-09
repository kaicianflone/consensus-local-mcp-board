import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { invokeTool, listToolNames, toolRegistry } from '../tools/registry.js';
import type { ToolName } from '../tools/registry.js';

export async function startMcpServer() {
  const server = new Server({ name: 'consensus-local-mcp-board', version: '0.0.1' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listToolNames().map((name) => ({
      name,
      description: toolRegistry[name].description,
      inputSchema: { type: 'object' }
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req: any) => {
    const name = req.params.name as string;

    if (!(name in toolRegistry)) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }]
      };
    }

    try {
      const out = await invokeTool(name as ToolName, req.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(out) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }]
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv.includes('--stdio')) {
  startMcpServer().catch((e) => {
    console.error('MCP server failed', e);
    process.exit(1);
  });
}
