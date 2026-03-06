[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Local_Server-111111)](https://modelcontextprotocol.io/)
[![SQLite](https://img.shields.io/badge/SQLite-Append--Only-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Vite](https://img.shields.io/badge/Vite-React_UI-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

# consensus-local-mcp-board

Local-first MCP + Board runtime for consensus guard workflows.

---

## Table of Contents

- [What This Is](#what-this-is)
- [Quick Start](#quick-start)
- [Template 1: GitHub PR Merge Guard](#template-1-github-pr-merge-guard)
- [Architecture](#architecture)
- [Integrating External Agents](#integrating-external-agents)
- [Integrating Humans (HITL)](#integrating-humans-hitl)
- [UI Dashboard](#ui-dashboard)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Tool Matrix](#tool-matrix)
- [Safety and Reliability](#safety-and-reliability)
- [License](#license)

---

## What This Is

A local-first MCP server and Board runtime for building, testing, and running consensus guard workflows. It bridges the gap between [consensus-tools](https://github.com/kaicianflone/consensus-tools) (core primitives), [consensus-interact](https://github.com/kaicianflone/consensus-interact) (orchestration patterns), and the guard skills that enforce policy over agent actions.

Use it as a deterministic testing harness for guard behavior, a learning environment for MCP tool development, or a production-ready starter template for local governance applications with multi-agent review, weighted voting, human-in-the-loop approval, and an append-only audit ledger.

---

## Quick Start

### Prerequisites

- Node.js 20+ and npm 10+
- `gh` CLI (optional — required for GitHub PR trigger workflows)
- OpenAI API key (optional — falls back to deterministic heuristics without one)

### Setup

```bash
git clone https://github.com/kaicianflone/consensus-local-mcp-board.git
cd consensus-local-mcp-board
npm install
npm run start
```

This starts three workspaces concurrently:

| Service | URL |
|---|---|
| API server | `http://127.0.0.1:4010` |
| Web UI | `http://127.0.0.1:5173` |
| Shared types | (watch mode, auto-rebuilds) |

### MCP stdio mode

To connect as an MCP tool server via stdio (for use with Claude Desktop, OpenClaw, etc.):

```bash
npm run mcp:dev
```

### Smoke test

```bash
curl -X POST http://127.0.0.1:4010/api/mcp/evaluate \
  -H 'content-type: application/json' \
  -d '{
    "boardId": "default",
    "action": {
      "type": "send_email",
      "payload": {
        "to": "ext@example.com",
        "attachment": true,
        "body": "Here is the report"
      }
    }
  }'
```

Inspect results at `GET /api/mcp/boards` and `GET /api/mcp/events?limit=20`.

---

## Template 1: GitHub PR Merge Guard

The flagship workflow. A 5-node durable pipeline that fetches a GitHub PR, runs parallel AI reviews, resolves consensus through weighted voting, gates on human approval when risk is high, and merges only when everything passes.

### Pipeline

```text
+---------------------+
| 1. Trigger          |
| GitHub PR Opened    |
| (gh CLI: diff,      |
|  files, metadata)   |
+----------+----------+
           |
           v
+---------------------+
| 2. Parallel Review  |  3 agents run concurrently:
| (Group Node)        |
|  +---------------+  |  - security-reviewer
|  | Agent 1       |  |  - performance-analyst
|  +---------------+  |  - code-quality-reviewer
|  +---------------+  |
|  | Agent 2       |  |  Each produces a verdict:
|  +---------------+  |  vote (YES/NO/REWRITE),
|  +---------------+  |  risk score (0-1),
|  | Agent 3       |  |  rationale
|  +---------------+  |
+----------+----------+
           |
           v
+---------------------+
| 3. Code Merge Guard |  Weighted voting resolution:
| (Guard Node)        |  - reputation-modulated weights
|                     |  - combined risk scoring
|                     |  - quorum threshold check
+----------+----------+
           |
           v
+---------------------+
| 4. HITL Gate        |  Slack/Teams/Discord DM
| (Human Approval)    |  when risk > threshold.
|                     |  Reply YES / NO / REWRITE
+----------+----------+
           |
           v
+---------------------+
| 5. Action           |  Merge PR via gh CLI.
| (Merge PR)          |  Executes only if:
|                     |  guard passed + human approved
+---------------------+
```

### The 4-Outcome Decision Model

Every guard evaluation produces one of four decisions:

| Decision | Meaning | What happens |
|---|---|---|
| `ALLOW` | Risk acceptable, quorum met | Action proceeds |
| `BLOCK` | Risk exceeds threshold with NO votes, or risk > `blockAboveRisk` | Action is rejected, run terminates |
| `REWRITE` | High risk, majority REWRITE votes, zero NO votes | Pauses workflow with rewrite guidance for human review |
| `REQUIRE_HUMAN` | Weighted YES ratio below quorum | Pauses workflow, sends HITL approval prompt |

The decision logic (defined in `shared/src/index.ts`):

1. **Risk check** — If weighted combined risk > `riskThreshold`:
   - Any NO votes → `BLOCK`
   - Majority REWRITE votes (no NOs) → `REWRITE`
   - Otherwise → `BLOCK`
2. **Post-resolution escalation** — If decision is `REWRITE` and risk > `blockAboveRisk` → escalated to `BLOCK`
3. **Quorum check** — If weighted YES ratio < `quorum` → `REQUIRE_HUMAN`
4. **Pass** — Risk acceptable and quorum met → `ALLOW`

The `blockAboveRisk` threshold (default: `1.0` / disabled) is configurable per guard node. Template 1 sets it to `0.92` for code merge. This prevents extremely high-risk REWRITE-only scenarios from bypassing BLOCK.

### Weighting modes

Agent votes are weighted using one of three modes, configurable per policy assignment:

| Mode | Formula | Use case |
|---|---|---|
| `static` | raw weight | Manual override, equal voices |
| `reputation` | reputation / 100 | Ledger-driven, earned trust |
| `hybrid` | weight × (reputation / 100) | Default. Manual weight modulated by earned reputation |

### Configuring the template

The trigger node's `repo` and `branch` fields control which GitHub repository is monitored. Agent models, personas, quorum thresholds, and risk thresholds are all configurable per-node in the workflow definition or via the UI.

---

## Architecture

```text
web (Vite/React)
   | polls API (1-2s)
   v
server/api (Express + zod validation)
   |
   +---> workflows/runner.ts (durable workflow engine)
   |        |
   |        +---> adapters/ai-sdk.ts (OpenAI agent evaluation)
   |        +---> adapters/chat-sdk.ts (Slack/Teams/Discord/Telegram HITL)
   |        +---> adapters/consensus-tools.ts (board resolution + ledger)
   |
   +---> tools/registry.ts (MCP tool registry)
   |
   +---> db/store.ts (SQLite: boards, runs, events, participants, votes)
   |        |
   |        +---> db/credentials.ts (AES-256-GCM encrypted credential storage)
   |
   +---> engine/hitl-tracker.ts (pending approval timeout management)
```

### Repo layout

```text
consensus-local-mcp-board/
  package.json              # npm workspaces root
  shared/
    src/
      index.ts              # zod schemas, voting logic, decision model
  server/
    src/
      index.ts              # Express API routes, Template 1 definition
      workflows/
        runner.ts            # durable workflow execution engine
        guard-evaluate.ts    # guard evaluation pipeline
      adapters/
        ai-sdk.ts            # OpenAI agent integration (Vercel AI SDK)
        chat-sdk.ts          # Slack/Teams/Discord/Telegram/GChat HITL dispatch
        consensus-tools.ts   # board resolution, ledger I/O, reputation sync
      api/
        guard.evaluate.post.ts
        human.approve.post.ts
      db/
        store.ts             # SQLite schema + queries
        credentials.ts       # encrypted credential storage
      engine/
        hitl-tracker.ts      # HITL timeout tracking + auto-expiry
      tools/
        registry.ts          # MCP tool registry
      mcp/
        server.ts            # MCP stdio server
      utils/
        errors.ts
  web/
    src/
      pages/
        WorkflowsDashboard.tsx  # main workflow builder + run dashboard
      components/
        workflow/            # NodeCanvas, NodePalette, NodeSettings, EventTimeline
        agents/              # AgentsPanel
      lib/
        api.ts               # fetch wrappers for server endpoints
```

---

## Integrating External Agents

External agents connect via API key and can trigger workflows or invoke tools directly, scoped by permissions.

### 1. Register an agent

```bash
curl -X POST http://127.0.0.1:4010/api/agents/connect \
  -H 'content-type: application/json' \
  -d '{
    "name": "ci-bot",
    "scopes": ["workflow.run", "tool.*"],
    "boards": ["workflow-system"],
    "workflows": []
  }'
```

Response includes an `apiKey`. Store it securely.

### 2. Register agent participants on a board

```bash
curl -X POST http://127.0.0.1:4010/api/participants \
  -H 'content-type: application/json' \
  -d '{
    "boardId": "workflow-system",
    "subjectType": "agent",
    "subjectId": "security-reviewer",
    "role": "reviewer",
    "weight": 1,
    "reputation": 100,
    "metadata": {
      "model": "gpt-4o",
      "temperature": 0,
      "systemPrompt": "You are a security-focused code reviewer. Flag injection risks, auth bypasses, and secret exposure."
    }
  }'
```

### 3. Configure policy assignments

```bash
curl -X POST http://127.0.0.1:4010/api/policies/assign \
  -H 'content-type: application/json' \
  -d '{
    "boardId": "workflow-system",
    "policyId": "merge-default",
    "participants": ["security-reviewer", "performance-analyst", "code-quality-reviewer"],
    "weightingMode": "hybrid",
    "quorum": 0.6
  }'
```

### 4. Trigger via agent API

```bash
curl -X POST http://127.0.0.1:4010/api/agent/trigger \
  -H 'x-agent-key: <your-api-key>' \
  -H 'content-type: application/json' \
  -d '{ "workflowId": "<workflow-id>" }'
```

### Updating participant reputation and weight

```bash
curl -X PATCH http://127.0.0.1:4010/api/participants/<participant-id> \
  -H 'content-type: application/json' \
  -d '{ "reputation": 85, "weight": 2 }'
```

Reputation also updates automatically after each board resolution: agents whose verdicts aligned with the final decision receive ledger payouts; agents who opposed get slashed. The `hybrid` weighting mode makes this meaningful — earned reputation modulates the manual weight.

---

## Integrating Humans (HITL)

The HITL gate sends approval prompts via DM on Slack, Teams, Discord, Telegram, or Google Chat. Humans reply with YES, NO, or REWRITE. The system maps replies to workflow decisions and resumes execution.

### 1. Store bot tokens

```bash
# Slack
curl -X POST http://127.0.0.1:4010/api/settings/credentials \
  -H 'content-type: application/json' \
  -d '{ "provider": "slack", "keyName": "bot_token", "value": "xoxb-..." }'

# Discord
curl -X POST http://127.0.0.1:4010/api/settings/credentials \
  -H 'content-type: application/json' \
  -d '{ "provider": "discord", "keyName": "bot_token", "value": "..." }'

# Telegram
curl -X POST http://127.0.0.1:4010/api/settings/credentials \
  -H 'content-type: application/json' \
  -d '{ "provider": "telegram", "keyName": "bot_token", "value": "..." }'

# Teams (webhook URL)
curl -X POST http://127.0.0.1:4010/api/settings/credentials \
  -H 'content-type: application/json' \
  -d '{ "provider": "teams", "keyName": "webhook_url", "value": "https://..." }'
```

### 2. Register human participants with chat metadata

```bash
curl -X POST http://127.0.0.1:4010/api/participants \
  -H 'content-type: application/json' \
  -d '{
    "boardId": "workflow-system",
    "subjectType": "human",
    "subjectId": "kai",
    "role": "approver",
    "weight": 1,
    "metadata": {
      "chatAdapter": "slack",
      "chatHandle": "U0123456789"
    }
  }'
```

### 3. Set up inbound webhooks

Point your chat platform's webhook/events URL to the appropriate endpoint:

| Platform | Webhook URL |
|---|---|
| Slack Events API | `POST /api/webhooks/slack/events` |
| Teams Bot Framework | `POST /api/webhooks/teams/activity` |
| Discord Interactions | `POST /api/webhooks/discord/interactions` |
| Telegram | `POST /api/webhooks/telegram` |
| Generic / GChat | `POST /api/webhooks/chat/:adapter` |

### The approval flow

```text
1. Guard resolves REQUIRE_HUMAN (risk > threshold)
2. Workflow pauses, status = WAITING_HUMAN
3. DM sent to registered human participants via their chat adapter
4. Human replies: YES / NO / REWRITE (or approve/reject/revise)
5. Chat webhook receives reply → routes to human.approve
6. Workflow resumes:
   - YES  → continues to action node
   - NO   → run status = BLOCKED
   - REWRITE → run status = REVISION_REQUESTED
```

### Manual approval via API

If no chat adapter is configured, approve directly:

```bash
curl -X POST http://127.0.0.1:4010/api/workflow-runs/<runId>/approve \
  -H 'content-type: application/json' \
  -d '{ "decision": "YES", "approver": "kai" }'
```

### HITL prompt modes

| Mode | Behavior |
|---|---|
| `yes-no` | Reply YES or NO (default) |
| `approve-reject-revise` | Reply APPROVE, REJECT, or REVISE |
| `vote` | Multiple votes required (configurable `requiredVotes`) |
| `acknowledge` | Reply ACK to acknowledge |

### Timeout and auto-expiry

HITL nodes support `timeoutSec` (default 900 = 15 minutes). When the deadline approaches, a reminder DM is sent. On expiry, the system auto-resolves with the configured `autoDecisionOnExpiry` (default: `BLOCK`).

---

## UI Dashboard

The built-in web dashboard at `http://127.0.0.1:5173` provides real-time observability into workflows, runs, and events.

### What it shows

- **Workflow builder** — drag-and-drop node palette (trigger, agent, guard, HITL, group, action), visual canvas with node ordering, per-node configuration panel
- **Node settings** — model selection, persona assignment, guard type configuration, quorum/risk thresholds, HITL channel and timeout settings
- **Workflow runs** — status badges (COMPLETED, WAITING_HUMAN, BLOCKED, REVISION_REQUESTED), one-click approve/block for pending runs
- **Event timeline** — chronological append-only event stream with payload inspection (WORKFLOW_STARTED, NODE_EXECUTED, AGENT_VERDICT, RISK_SCORE, CONSENSUS_QUORUM, WAITING_HUMAN_APPROVAL, etc.)
- **Agents panel** — registered participants, reputation scores, weight assignments, model assignments
- **Board inspector** — board listing, per-board run history, event drill-down

### Forking and embedding

The UI is a standalone Vite/React app in `web/`. It has no server-side rendering — it polls the API via fetch calls defined in `web/src/lib/api.ts`. To embed in another app, copy the `web/` directory and point the API base URL at your server.

Key files:
- `web/src/pages/WorkflowsDashboard.tsx` — main dashboard
- `web/src/components/workflow/NodeCanvas.tsx` — visual workflow builder
- `web/src/components/workflow/NodeSettings.tsx` — per-node configuration
- `web/src/components/workflow/EventTimeline.tsx` — event stream viewer
- `web/src/components/agents/AgentsPanel.tsx` — participant management

---

## API Reference

### Workflows

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/workflows` | List all workflows (auto-creates Template 1 if none exist) |
| `POST` | `/api/workflows` | Create a workflow `{ name, definition }` |
| `GET` | `/api/workflows/:id` | Get workflow + run history |
| `PUT` | `/api/workflows/:id` | Update workflow name and/or definition |
| `POST` | `/api/workflows/:id/run` | Execute a workflow |
| `POST` | `/api/workflow-runs/:runId/approve` | Resume a paused workflow `{ decision: "YES"|"NO"|"REWRITE", approver }` |

### Guards

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/mcp/evaluate` | Generic guard evaluation `{ boardId, action: { type, payload } }` |
| `POST` | `/api/guard.evaluate` | Typed guard evaluation `{ runId, boardId, guardType, payload, policy, idempotencyKey }` |
| `POST` | `/api/human.approve` | Submit human approval `{ runId, replyText, approver, idempotencyKey }` |

### Participants

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/participants?boardId=...` | List participants for a board |
| `POST` | `/api/participants` | Create participant `{ boardId, subjectType, subjectId, role, weight, reputation, metadata }` |
| `PATCH` | `/api/participants/:id` | Update participant `{ reputation, weight, role, status, metadata }` |
| `DELETE` | `/api/participants/:id` | Delete participant |

### Agents

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/agents/connect` | Register agent `{ name, scopes, boards, workflows }` → returns `apiKey` |
| `GET` | `/api/agents` | List connected agents |
| `POST` | `/api/agent/trigger` | Agent-triggered execution (requires `x-agent-key` header) |

### Votes

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/votes` | Submit a vote `{ boardId, runId, participantId, decision, confidence, rationale, idempotencyKey }` |
| `GET` | `/api/votes/:runId` | Get votes + aggregate for a run |

### Policies

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/policies/assign` | Assign policy `{ boardId, policyId, participants, weightingMode, quorum }` |
| `GET` | `/api/policies/:boardId/:policyId` | Get policy assignment |

### Credentials

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/settings/credentials` | List stored credentials (provider + key name only, no values) |
| `POST` | `/api/settings/credentials` | Store/update credential `{ provider, keyName, value }` |
| `DELETE` | `/api/settings/credentials/:provider/:keyName` | Delete credential |
| `GET` | `/api/settings/credentials/:provider/status` | Check which keys are configured for a provider |

### Boards and Events

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/mcp/boards` | List all boards |
| `POST` | `/api/mcp/boards` | Create board `{ name }` |
| `GET` | `/api/mcp/boards/:id` | Get board + runs |
| `GET` | `/api/mcp/events` | List events `?boardId=&runId=&type=&limit=` |
| `DELETE` | `/api/mcp/events` | Delete events `?boardId=&runId=` |
| `GET` | `/api/mcp/events/run-ids` | List distinct run IDs |
| `GET` | `/api/mcp/audit/search` | Search events `?query=&limit=` |
| `GET` | `/api/mcp/runs/:id` | Get run + events |

### Reputation Settings

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/settings/reputation` | Get reputation/slashing config |
| `PUT` | `/api/settings/reputation` | Update reputation/slashing config |

### Chat Adapters

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/settings/adapters` | List installed chat adapters |
| `POST` | `/api/settings/adapters/install` | Install adapter `{ adapter: "slack"|"teams"|"discord"|"telegram"|"gchat" }` |
| `POST` | `/api/settings/adapters/uninstall` | Uninstall adapter |

### MCP Tools

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/mcp/tools` | List registered tool names |
| `POST` | `/api/mcp/tool/:name` | Invoke a tool by name |

### Webhooks (Inbound)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/webhooks/github` | GitHub webhook receiver (triggers matching workflows) |
| `POST` | `/api/webhooks/slack/events` | Slack Events API handler |
| `POST` | `/api/webhooks/teams/activity` | Teams Bot Framework activity handler |
| `POST` | `/api/webhooks/discord/interactions` | Discord interactions handler |
| `POST` | `/api/webhooks/telegram` | Telegram webhook handler |
| `POST` | `/api/webhooks/chat/:adapter` | Generic chat adapter inbound |
| `POST` | `/api/chat/human-approval-reply` | Direct human approval reply endpoint |

### HITL

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/hitl/pending` | List pending approval requests |

---

## Configuration

### Environment variables

| Variable | Description | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key for agent evaluations | (falls back to deterministic heuristics) |
| `AI_MODEL` | Default model for agent nodes | `gpt-4o-mini` |
| `CHAT_PROVIDER` | Chat dispatch mode: `webhook`, `stdout` | `webhook` |
| `SLACK_BOT_TOKEN` | Slack bot token (also settable via credentials API) | — |
| `DISCORD_BOT_TOKEN` | Discord bot token | — |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | — |
| `TEAMS_WEBHOOK_URL` | Teams incoming webhook URL | — |
| `GCHAT_WEBHOOK_URL` | Google Chat webhook URL | — |
| `CHAT_WEBHOOK_URL` | Generic webhook URL for HITL fallback | — |
| `CHAT_WEBHOOK_BEARER` | Bearer token for generic webhook | — |
| `CONSENSUS_TOOLS_BIN` | Path to consensus-tools CLI binary | (auto-detected) |
| `CREDENTIALS_SECRET` | Master secret for credential encryption | (auto-generated on first run) |
| `VERBOSE` | Enable verbose request logging (`1`) | — |

### .consensus/config.json

The server reads `.consensus/config.json` (searching up to 5 parent directories) for consensus-tools integration:

```json
{
  "board_mode": "local",
  "api_url": "http://127.0.0.1:4010",
  "boards": {
    "local": {
      "type": "local",
      "root": "~/.openclaw/workplace/consensus-board"
    }
  }
}
```

### Credential management via API

All secrets (API keys, bot tokens, webhook URLs) can be managed through the credentials API instead of environment variables. Credentials stored via API are encrypted at rest with AES-256-GCM and take precedence over environment variables.

```bash
# Store OpenAI key
curl -X POST http://127.0.0.1:4010/api/settings/credentials \
  -H 'content-type: application/json' \
  -d '{ "provider": "openai", "keyName": "api_key", "value": "sk-..." }'

# Store GitHub webhook secret
curl -X POST http://127.0.0.1:4010/api/settings/credentials \
  -H 'content-type: application/json' \
  -d '{ "provider": "github", "keyName": "webhook_secret", "value": "whsec_..." }'
```

### Reputation and slashing configuration

Configurable via `PUT /api/settings/reputation`:

- **Faucet** — initial reputation (100), drip amount on consensus match (+2), decay rate per round (-1)
- **Slashing rules** — consensus disagreement (-5), low-confidence wrong (-8), high-risk miss (-10), timeout (-3), repeated rewrite (-4). Each rule can be enabled/disabled individually
- **Persona bonuses** — archetype diversity bonus, minimum personas for bonus

---

## Tool Matrix

| Tool | Status | Description |
|---|---|---|
| `guard.evaluate` | Active | Generic guard entrypoint (routes by action type) |
| `guard.send_email` | Active | Email guard with allowlist/blocklist, attachment policy, secrets scanning |
| `guard.code_merge` | Active | Code merge guard with sensitive file patterns, protected branches |
| `guard.publish` | Active | Publish guard with profanity filter, PII detection, blocked words |
| `guard.support_reply` | Active | Support reply guard with escalation keywords, auto-escalate |
| `guard.agent_action` | Active | Agent action guard with tool allowlist/blocklist, irreversibility check |
| `guard.deployment` | Active | Deployment guard with environment-aware approval |
| `guard.permission_escalation` | Active | Permission escalation guard with break-glass and MFA support |
| `guard.policy.describe` | Active | Describe policy config schema for any guard type |
| `persona.generate` | Active | Generate persona set for a board |
| `persona.respawn` | Scaffold | Replace dead personas (scaffolded) |
| `board.list` | Active | List all boards (ledger-backed) |
| `board.get` | Active | Get board by ID (ledger-backed) |
| `run.get` | Active | Get run by ID (ledger-backed) |
| `audit.search` | Active | Search events by payload/type |
| `human.approve` | Active | Submit human approval decision |

---

## Safety and Reliability

- **Append-only events** — Event records are insert-only. No mutation after write. Full audit trail for every workflow execution, agent verdict, guard decision, and human approval.

- **Secret redaction** — Payload fields matching `authorization`, `cookie`, `set-cookie`, `apiKey`, `token`, `password`, `secret` are redacted before persistence.

- **Encrypted credentials** — All stored credentials (API keys, bot tokens) are encrypted with AES-256-GCM. The encryption key is either derived from `CREDENTIALS_SECRET` via scrypt or auto-generated and stored in the internal config table on first run.

- **Localhost-only binding** — The server binds to `127.0.0.1:4010` by default. No external network exposure unless explicitly proxied.

- **Typed contracts** — All API inputs and outputs are validated with zod schemas defined in `shared/src/index.ts`. Invalid payloads return structured error responses with error codes.

- **Idempotency keys** — Guard evaluations, votes, and human approvals accept idempotency keys to prevent duplicate processing.

- **Durable execution** — Workflow nodes use `"use step"` and `"use workflow"` directives (Vercel Workflow SDK) for automatic retries on transient failures and deterministic replay.

- **GitHub webhook verification** — When a `webhook_secret` credential is configured for the `github` provider, all inbound webhooks are verified via HMAC-SHA256 signature comparison using `crypto.timingSafeEqual`.

---

## License

MIT
