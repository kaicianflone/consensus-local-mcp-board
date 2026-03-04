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
- **Geist** (sans-serif), **Geist Mono** (monospace), and **Geist Pixel** (header logo) fonts self-hosted from `geist` npm package (woff2 files in `web/public/fonts/`)
- shadcn/ui-style components (Radix UI primitives + class-variance-authority)
- Card titles use Vercel-style uppercase labels (11px, medium weight, wide tracking, muted color)
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
- Supported providers: GitHub, Slack, Teams, Google Chat, Discord, Telegram, OpenAI, Anthropic
- Chat adapter credential cards only appear after the adapter is installed
- API endpoints:
  - `GET /api/settings/credentials` — list (provider + keyName only, never values)
  - `POST /api/settings/credentials` — upsert `{provider, keyName, value}`
  - `DELETE /api/settings/credentials/:provider/:keyName` — delete
  - `GET /api/settings/credentials/:provider/status` — boolean flags per key

## Chat Adapters

- Settings page shows a "Chat Adapters" section at the top for installing platform adapters
- Supported: Slack, Microsoft Teams, Google Chat, Discord, Telegram
- Install/uninstall triggers `npm install chat @chat-adapter/<name>` server-side to ensure the base `chat` package is present.
- Adapter state tracked in credentials table (provider: 'adapter', keyName: adapter id)
- When an adapter is installed, its credential card (tokens, webhooks) appears below
- When uninstalled, credentials for that adapter are also removed
- API endpoints:
  - `GET /api/settings/adapters` — returns install status for each adapter
  - `POST /api/settings/adapters/install` — installs adapter package `{adapter: "slack"}`
  - `POST /api/settings/adapters/uninstall` — uninstalls adapter and cleans up credentials

## GitHub Webhook Integration

- Webhook receiver: `POST /api/webhooks/github`
- Verifies signatures using stored `github.webhook_secret` credential
- Maps GitHub events to trigger sources (e.g., `pull_request:opened` → `github.pr.opened`)
- Automatically matches and runs workflows whose trigger node source matches the incoming event
- Webhook URL displayed on Settings page with copy button

## Agent Types

The system supports two distinct agent types, both managed via the Agents & Participants panel:

### Internal Agents (AI SDK)
- Run locally on the server using Vercel AI SDK (`ai` + `@ai-sdk/openai`)
- Created via "+Agent → Internal" — user sets name, model, system prompt, temperature
- Stored as participants with `metadata_json` containing `{ agentType: 'internal', model, systemPrompt, temperature }`
- No API key — these execute directly when workflow agent nodes fire
- Per-agent model/temperature override: each internal agent can use a different model (e.g., one uses gpt-4o-mini, another gpt-4o)

### External Agents (API/Chat-SDK)
- Remote agents that connect via API key
- Created via "+Agent → External" — user sets name, chat adapter (Slack/Discord/Teams/etc.), and handle
- Generates an API key for the external system to call `POST /api/agent/trigger`
- Stored as participants with `metadata_json` containing `{ agentType: 'external', agentRegistryId, chatAdapter, chatHandle }`
- Chat adapter/handle enables HITL prompt delivery to the right person on the right platform

### N-LLM Agent Execution
- Agent nodes support **N parallel LLM evaluators** (configurable 1-10, default 3)
- `resolvePersonas()` reads participant metadata to get per-agent model/systemPrompt/temperature
- Votes are aggregated using reputation-weighted average risk before feeding into the guard node
- Guard nodes automatically detect upstream agent outputs and use their aggregated votes for consensus decisions
- **Persona modes**:
  - `auto` — picks from existing board participants (reading their internal agent config) or auto-creates from reviewer archetypes
  - `manual` — user specifies comma-separated persona names

## Parallel Group Nodes

- New `group` node type wraps multiple children that execute in parallel via `Promise.all`
- Canvas renders group nodes as a dashed cyan-bordered container with children displayed side-by-side horizontally
- Group settings panel allows adding/removing child nodes (agent, guard, hitl, action types)
- Clicking a child node within a group selects it for individual settings editing
- Template 1 uses a group node containing an Agent (3 N-LLM) + HITL (Consensus Vote) in parallel
- Node types: `trigger`, `agent`, `guard`, `hitl`, `group`, `action`
- Valid transitions include: `guard → group`, `group → hitl`, `group → action`, `group → guard`

## HITL Prompt Modes

HITL nodes support three prompt modes that control what response options are presented to the human reviewer:

- **Yes / No** (`yes-no`) — Binary approval. YES continues the workflow, NO blocks it. Default mode.
- **Approve / Reject / Revise** (`approve-reject-revise`) — Three-way decision. APPROVE (YES) continues, REJECT (NO) blocks, REVISE (REWRITE) sets status to `REVISION_REQUESTED` and records a `WORKFLOW_REVISION_REQUESTED` event.
- **Acknowledge** (`acknowledge`) — Single-button confirmation. The workflow pauses for awareness but the human can only acknowledge (ACK → YES).

The prompt mode flows from `node.config.promptMode` through the runner to `sendHitlPrompt` in the chat-sdk adapter, which formats the message with appropriate response instructions. The `/api/workflow-runs/:runId/approve` endpoint accepts `YES`, `NO`, or `REWRITE` decisions.

## Participant Chat Linking

- Agents & Participants panel supports linking participants to chat adapters (Slack, Discord, Teams, Telegram, Google Chat)
- Each participant can have a chat adapter and handle (e.g., Slack user ID) stored in their metadata
- When an HITL node fires, it looks up chat-linked participants and includes their adapter/handle in the prompt delivery
- Chat links appear as badges on participant cards in the panel

## Reputation & Slashing Settings

The Settings page (`/settings`) includes a "Reputation & Slashing" section with three configurable subsections:

### Reputation Faucet (consensus-tools)
- **Initial Reputation** — starting rep for new agents (default 0.5)
- **Min/Max Reputation** — bounds (0.0–1.0)
- **Drip Amount** — rep gained per trigger event (default 0.02)
- **Drip Trigger** — when rep is awarded (consensus_match, correct_vote, participation, per_round)
- **Decay Rate** — passive rep loss over time (default 0.01)
- **Decay Interval** — how often decay applies (per_round, per_day, per_workflow, none)

### Slash Rules (consensus-tools)
- Globally toggleable slashing system
- Five configurable rules with individual enable/disable and penalty amounts:
  - Consensus Disagreement (0.05), Low Confidence + Wrong (0.08), High Risk Miss (0.10), Response Timeout (0.03), Repeated Rewrite (0.04)
- Penalties are subtracted from agent reputation when violations occur

### Persona Engine (consensus-persona-engine)
- **Archetype Bonus** — extra rep for archetype-specialized agents
- **Diversity Weight** — bonus for varied persona mix in a round
- **Min Personas for Bonus** — minimum agent count to trigger diversity bonus

Config stored in `_internal_config` table as JSON. API endpoints:
- `GET /api/settings/reputation` — read current config
- `PUT /api/settings/reputation` — merge-update config

## Adapter Credential Resolution

- `ai-sdk.ts` uses Vercel AI SDK (`generateText` from `ai` package with `@ai-sdk/openai` provider), falls back to deterministic evaluation when no API key is available
- `chat-sdk.ts` checks stored Slack credentials before falling back to `CHAT_WEBHOOK_URL` / `CHAT_WEBHOOK_BEARER` env vars; supports targeted delivery via chat-linked participants

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
