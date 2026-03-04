# consensus-local-mcp-board

A local MCP (Model Context Protocol) board system with a React frontend and Express backend. This Replit environment is configured as a **dev-only** setup for UX/UI iteration.

## Architecture

This is a monorepo with three workspaces:

- **`shared/`** — Shared TypeScript types and schemas (built first, used by server and web)
- **`server/`** — Express API server running on `localhost:4010`, using SQLite (`better-sqlite3`) for persistence
- **`web/`** — React + Vite frontend running on `0.0.0.0:5000`

## Frontend Stack

- React 18 + TypeScript + Vite
- Tailwind CSS 3 with CSS variables for theming (dark mode)
- shadcn/ui-style components (Radix UI primitives + class-variance-authority)
- @dnd-kit for drag-and-drop sortable workflow nodes
- lucide-react for icons

## UI Structure

- **`web/src/components/ui/`** — Base UI components (Button, Card, Input, Select, Badge, Dialog, Separator)
- **`web/src/components/layout/`** — Header with nav (includes Settings gear icon)
- **`web/src/components/workflow/`** — NodePalette, NodeCanvas (drag/drop/reorder), NodeSettings (edit/save/cancel), EventTimeline, WorkflowToolbar
- **`web/src/components/agents/`** — AgentsPanel (add/edit/cancel/save agents & participants)
- **`web/src/pages/`** — WorkflowsDashboard (home), SettingsPage, BoardsPage, BoardDetailPage, RunDetailPage

## Settings & Credentials

- **Settings page** (`/settings`) accessible via gear icon in header
- Credentials stored encrypted server-side in SQLite (`credentials` table)
- Encryption: AES-256-GCM with secret from `CREDENTIALS_SECRET` env var (or auto-generated for dev)
- Credential store: `server/src/db/credentials.ts` (encrypt/decrypt/CRUD)
- Supported providers: GitHub, Slack, OpenAI, Anthropic
- API endpoints:
  - `GET /api/settings/credentials` — list (provider + keyName only, never values)
  - `POST /api/settings/credentials` — upsert `{provider, keyName, value}`
  - `DELETE /api/settings/credentials/:provider/:keyName` — delete
  - `GET /api/settings/credentials/:provider/status` — boolean flags per key

## GitHub Webhook Integration

- Webhook receiver: `POST /api/webhooks/github`
- Verifies signatures using stored `github.webhook_secret` credential
- Maps GitHub events to trigger sources (e.g., `pull_request:opened` → `github.pr.opened`)
- Automatically matches and runs workflows whose trigger node source matches the incoming event
- Webhook URL displayed on Settings page with copy button

## Adapter Credential Resolution

- `ai-sdk.ts` checks stored OpenAI credentials before falling back to `OPENAI_API_KEY` env var
- `chat-sdk.ts` checks stored Slack credentials before falling back to `CHAT_WEBHOOK_URL` / `CHAT_WEBHOOK_BEARER` env vars

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

SQLite via `better-sqlite3`. Migrations are in `server/src/db/migrations/` (001 through 005). The store is in `server/src/db/store.ts`. Credentials module in `server/src/db/credentials.ts`.

## Notes

- This Replit is a dev environment for UI work only — no production deployment is configured here.
- Production builds and deployment are handled separately outside of Replit.
