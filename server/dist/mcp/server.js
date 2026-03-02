import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { invokeTool, listToolNames } from '../tools/registry.js';
export async function startMcpServer() {
    const server = new Server({ name: 'local-mcp-board', version: '0.0.1' }, { capabilities: { tools: {} } });
    server.setRequestHandler(z.object({ method: z.literal('tools/list') }), async () => ({
        tools: listToolNames().map((name) => ({ name, description: `Tool ${name}`, inputSchema: { type: 'object' } }))
    }));
    server.setRequestHandler(z.object({ method: z.literal('tools/call'), params: z.object({ name: z.string(), arguments: z.any().optional() }) }), async (req) => {
        const out = invokeTool(req.params.name, req.params.arguments ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
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
