# consensus-local-mcp-board

A local MCP (Model Context Protocol) board system with a React frontend and Express backend. This Replit environment is configured as a **dev-only** setup for UX/UI iteration.

## Architecture

This is a monorepo with three workspaces:

- **`shared/`** — Shared TypeScript types and schemas (built first, used by server and web)
- **`server/`** — Express API server running on `localhost:4010`, using SQLite (`better-sqlite3`) for persistence
- **`web/`** — React + Vite frontend running on `0.0.0.0:5000`

## Development

Run everything with:

```bash
npm run dev
```

This concurrently:
1. Watches and rebuilds the `shared` package
2. Starts the backend server with `tsx watch` (hot reload)
3. Starts the Vite dev server

## Key Ports

- **Frontend (Vite)**: `0.0.0.0:5000` — user-facing web UI
- **Backend (Express)**: `localhost:4010` — REST API

## Vite Proxy

The Vite dev server proxies `/api/*` requests to the backend at `http://localhost:4010`, so the frontend can call `/api/...` directly without CORS issues.

## Database

SQLite via `better-sqlite3`. Migrations are in `server/src/db/migrations/`. The store is in `server/src/db/store.ts`.

## MCP Server

A stdio MCP server is available via `npm run mcp:dev` (not part of the main workflow).

## Notes

- This Replit is a dev environment for UI work only — no production deployment is configured here.
- Production builds and deployment are handled separately outside of Replit.
