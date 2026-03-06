#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fork } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

if (args.includes('--mcp') || args.includes('--stdio')) {
  // MCP stdio mode — run the MCP server directly
  const mcp = join(__dirname, '..', 'server', 'dist', 'mcp', 'server.js');
  const child = fork(mcp, ['--stdio'], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
} else {
  // Default: start the API server (serves UI in production mode)
  process.env.NODE_ENV = 'production';
  const server = join(__dirname, '..', 'server', 'dist', 'index.js');
  const child = fork(server, [], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
}
