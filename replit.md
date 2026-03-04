# Consensus Local MCP Board

Local-first MCP + Board runtime for the Consensus ecosystem. Provides guard-style decisions, an append-only ledger, and a real-time observability UI.

## Architecture (Monorepo)
- `server/` — Express API (port 4010), SQLite DB, evaluation engine, MCP tool registry
- `web/` — Vite/React UI (port 5000) for workflow visualization, boards, and event timeline
- `shared/` — Zod schemas and TypeScript contracts shared between server and web
- `src/` — Core MCP modules (guards, voting, agents, schemas) for the npm CLI package
- `bin/cli.js` — Executable MCP CLI entry point (stdio)
- `tests/` — Vitest test suites for guards, voting, agents, and CLI

## Scripts
- `npm run dev:ui` — Starts server + web UI + shared watcher (concurrently)
- `npm run dev` — Same as dev:ui
- `npm run mcp:dev` — Starts MCP server in stdio mode
- `npm run build` — Builds all workspaces (shared → server → web)
- `npm test` — Runs vitest test suite (78 tests)
- `npm run test:watch` — Runs tests in watch mode

## Workflow
- **Start application** runs `npm run dev:ui` — serves the web UI on port 5000, API on port 4010

## Key Dependencies
- `@modelcontextprotocol/sdk` — MCP protocol SDK
- `zod` — Schema validation
- `express` — API server
- `better-sqlite3` — Append-only ledger
- `vite` + `react` — Observability UI
- `vitest` — Test runner
- `concurrently` — Multi-process dev runner
