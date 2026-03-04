# Consensus MCP Server

Consensus.tools MCP Server packaged as an npm CLI.

## Structure
- `src/server.ts` — MCP server with guard tool registration
- `src/schemas.ts` — Zod schemas and shared types (Decision, GuardType, PolicyMetadata, etc.)
- `src/guards.ts` — Guard evaluation engine (send_email, code_merge, publish, support_reply, agent_action, deployment, permission_escalation)
- `src/voting.ts` — Weighted voting system (tally, quorum, decision computation)
- `src/agents.ts` — Agent registry (internal/external agents, scope validation)
- `src/index.ts` — Barrel export for all modules
- `bin/cli.js` — Executable CLI entry point
- `dist/` — Compiled JavaScript and type definitions

## Tests
- `tests/cli.test.ts` — MCP CLI and package configuration tests
- `tests/guards.test.ts` — Guard evaluation logic tests
- `tests/voting.test.ts` — Weighted voting system tests
- `tests/agents.test.ts` — Agent registry and scope validation tests

## Scripts
- `npm run build` — Compiles TypeScript to ESM using tsup
- `npm test` — Runs all tests with vitest
- `npm run test:watch` — Runs tests in watch mode

## Dependencies
- `@modelcontextprotocol/sdk` — MCP protocol SDK
- `zod` — Schema validation
- `vitest` — Test runner (dev)
- `tsup` — TypeScript bundler (dev)
- `typescript` — TypeScript compiler (dev)
