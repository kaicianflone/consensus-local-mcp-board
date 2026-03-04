# Consensus MCP Server

Consensus.tools MCP Server packaged as an npm CLI.

## Structure
- `src/server.ts`: Main server logic using MCP SDK.
- `bin/cli.js`: Executable entry point.
- `dist/`: Compiled JavaScript and type definitions.

## Scripts
- `npm run build`: Compiles TypeScript to ESM using `tsup`.
- `npm run publish`: Publishes the package to npm.

## Usage
The CLI can be run directly after installation:
```bash
npx @consensus/tools-mcp
```
