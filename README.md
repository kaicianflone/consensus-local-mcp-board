[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Local_Server-111111)](https://modelcontextprotocol.io/)
[![SQLite](https://img.shields.io/badge/SQLite-Append--Only-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Vite](https://img.shields.io/badge/Vite-React_UI-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

# consensus-local-mcp-board

Local-first MCP runtime for multi-agent consensus guard workflows — AI code review, weighted voting, HITL approval gates, and full observability on SQLite.

---

## Quick Start

```bash
git clone https://github.com/kaicianflone/consensus-local-mcp-board.git
cd consensus-local-mcp-board
npm install
npm run start
```

| Service | URL |
|---|---|
| API | `http://127.0.0.1:4010` |
| UI | `http://127.0.0.1:5000` |

MCP stdio mode (Claude Desktop, OpenClaw, etc.):

```bash
npm run mcp:dev
```

**Prerequisites:** Node.js 20+, npm 10+. Optional: `gh` CLI (for GitHub PR triggers), OpenAI API key (falls back to deterministic heuristics without one).

---

## Supported Models

Any model accessible via the OpenAI or Anthropic SDKs works. The UI dropdown includes:

| Provider | Model | ID | Notes |
|---|---|---|---|
| OpenAI | GPT-5.4 | `gpt-5.4` | **Default.** Most capable for professional work |
| OpenAI | GPT-5.4 Pro | `gpt-5.4-pro` | Smarter, more precise responses |
| OpenAI | GPT-5.2 | `gpt-5.2` | Previous frontier model |
| OpenAI | GPT-5.1 | `gpt-5.1` | Best for coding and agentic tasks |
| OpenAI | GPT-5 | `gpt-5` | Reasoning model |
| OpenAI | GPT-5 Mini | `gpt-5-mini` | Faster, cost-efficient |
| OpenAI | GPT-5 Nano | `gpt-5-nano` | Fastest, most cost-efficient |
| OpenAI | GPT-5.3 Codex | `gpt-5.3-codex` | Most capable agentic coding model |
| Anthropic | Claude Opus 4.6 | `claude-opus-4-6` | Most intelligent for agents and coding |
| Anthropic | Claude Sonnet 4.6 | `claude-sonnet-4-6` | Best speed/intelligence balance |
| Anthropic | Claude Haiku 4.5 | `claude-haiku-4-5` | Fastest, near-frontier intelligence |

Configure per-agent in the workflow definition or via the UI. Set `AI_MODEL` env var or store via `POST /api/settings/credentials` to change the default.

---

## Template 1: GitHub PR Merge Guard

The flagship workflow. Fetches a GitHub PR, runs 3 parallel AI reviews, resolves consensus through weighted voting, gates on human approval when risk is high, and merges only when everything passes.

```text
┌─────────────────────┐
│ 1. Trigger          │  Fetches PR diff, files, metadata via gh CLI
│    GitHub PR Opened │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 2. Parallel Review  │  3 agents run concurrently:
│    (Group Node)     │  • security-reviewer
│                     │  • performance-analyst
│                     │  • code-quality-reviewer
│                     │  Each returns: vote, risk score, rationale
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 3. Code Merge Guard │  Weighted voting resolution:
│    (Guard Node)     │  • reputation-modulated weights
│                     │  • combined risk scoring
│                     │  • quorum threshold check
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 4. HITL Gate        │  Slack / Teams / Discord DM
│    (Human Approval) │  when risk > threshold
│                     │  Reply: YES / NO / REWRITE
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 5. Action           │  Merge PR. Executes only if
│    (Merge PR)       │  guard passed + human approved
└─────────────────────┘
```

### Decision Model

Every guard evaluation produces one of four decisions:

| Decision | When | Result |
|---|---|---|
| `ALLOW` | Risk acceptable, quorum met | Action proceeds |
| `BLOCK` | Any NO votes with high risk, or risk > `blockAboveRisk` | Rejected |
| `REWRITE` | High risk, majority REWRITE votes, zero NOs | Paused with rewrite guidance |
| `REQUIRE_HUMAN` | Weighted YES ratio below quorum | Paused, HITL approval prompt sent |

The logic:

1. **Risk > threshold?**
   - Any NO → `BLOCK`
   - Majority REWRITE (no NOs) → `REWRITE`
   - Otherwise → `BLOCK`
2. **REWRITE + risk > `blockAboveRisk`?** → escalated to `BLOCK`
3. **YES ratio < quorum?** → `REQUIRE_HUMAN`
4. **Otherwise** → `ALLOW`

`blockAboveRisk` is configurable per guard node (default `1.0` / disabled). Template 1 sets `0.92`.

### Weighting Modes

| Mode | Formula | Use case |
|---|---|---|
| `static` | raw weight | Equal voices |
| `reputation` | reputation / 100 | Ledger-driven trust |
| `hybrid` | weight × (reputation / 100) | **Default.** Manual weight modulated by earned reputation |

---

## Architecture

```text
web (Vite/React)
   │ polls API (1-2s)
   ▼
server/api (Express + zod)
   │
   ├──▶ workflows/runner.ts       Durable workflow engine
   │      ├──▶ adapters/ai-sdk.ts       OpenAI agent evaluation
   │      ├──▶ adapters/chat-sdk.ts     Slack/Teams/Discord/Telegram HITL
   │      └──▶ adapters/consensus-tools  Board resolution + ledger
   │
   ├──▶ tools/registry.ts         MCP tool registry
   ├──▶ db/store.ts               SQLite (boards, runs, events, participants)
   │      └──▶ db/credentials.ts  AES-256-GCM encrypted credentials
   └──▶ engine/hitl-tracker.ts    Approval timeout management
```

```text
consensus-local-mcp-board/
  shared/src/index.ts         Zod schemas, voting logic, decision model
  server/src/
    index.ts                  API routes, Template 1 definition
    workflows/runner.ts       Workflow execution engine
    adapters/                 ai-sdk, chat-sdk, consensus-tools
    db/                       SQLite store, encrypted credentials
    tools/registry.ts         MCP tool registry
    mcp/server.ts             MCP stdio server
  web/src/
    pages/                    WorkflowsDashboard
    components/workflow/      NodeCanvas, NodeSettings, EventTimeline
    components/agents/        AgentsPanel
```

---

<details>
<summary><strong>Integrating External Agents</strong></summary>

### Register an agent

```bash
curl -X POST http://127.0.0.1:4010/api/agents/connect \
  -H 'content-type: application/json' \
  -d '{
    "name": "ci-bot",
    "scopes": ["workflow.run", "tool.*"],
    "boards": ["workflow-system"]
  }'
```

Response includes an `apiKey`. Store it securely.

### Register agent participants

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
      "model": "gpt-5.4",
      "systemPrompt": "You are a security-focused code reviewer."
    }
  }'
```

### Trigger via agent API

```bash
curl -X POST http://127.0.0.1:4010/api/agent/trigger \
  -H 'x-agent-key: <your-api-key>' \
  -H 'content-type: application/json' \
  -d '{ "workflowId": "<workflow-id>" }'
```

Reputation updates automatically after each resolution: aligned verdicts earn payouts, opposed verdicts get slashed. The `hybrid` weighting mode makes earned reputation meaningful.

</details>

<details>
<summary><strong>Integrating Humans (HITL)</strong></summary>

### Store bot tokens

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

# Teams
curl -X POST http://127.0.0.1:4010/api/settings/credentials \
  -H 'content-type: application/json' \
  -d '{ "provider": "teams", "keyName": "webhook_url", "value": "https://..." }'
```

### Register human participants with chat metadata

```bash
curl -X POST http://127.0.0.1:4010/api/participants \
  -H 'content-type: application/json' \
  -d '{
    "boardId": "workflow-system",
    "subjectType": "human",
    "subjectId": "kai",
    "role": "approver",
    "weight": 1,
    "metadata": { "chatAdapter": "slack", "chatHandle": "U0123456789" }
  }'
```

### Approval flow

1. Guard resolves → risk > threshold → workflow pauses
2. DM sent to registered humans via their chat adapter
3. Human replies: YES / NO / REWRITE
4. Workflow resumes accordingly

### Manual approval (no chat adapter)

```bash
curl -X POST http://127.0.0.1:4010/api/workflow-runs/<runId>/approve \
  -H 'content-type: application/json' \
  -d '{ "decision": "YES", "approver": "kai" }'
```

### Prompt modes

| Mode | Behavior |
|---|---|
| `yes-no` | YES or NO (default) |
| `approve-reject-revise` | APPROVE, REJECT, or REVISE |
| `vote` | Multiple votes required (configurable) |
| `acknowledge` | ACK to acknowledge |

HITL nodes support `timeoutSec` (default 900). On expiry, auto-resolves with `autoDecisionOnExpiry` (default: `BLOCK`).

</details>

<details>
<summary><strong>UI Dashboard</strong></summary>

The web UI at `http://127.0.0.1:5000` provides real-time observability.

**What it shows:**
- **Workflow builder** — drag-and-drop nodes (trigger, agent, guard, HITL, group, action), visual canvas, per-node config
- **Node settings** — model selection, persona assignment, guard thresholds, HITL channel/timeout
- **Workflow runs** — status badges, one-click approve/block for pending runs
- **Event timeline** — chronological append-only stream (WORKFLOW_STARTED, AGENT_VERDICT, RISK_SCORE, CONSENSUS_QUORUM, etc.)
- **Agents panel** — participants, reputation scores, weight assignments
- **Board inspector** — board listing, run history, event drill-down

### Forking / embedding

The UI is a standalone Vite/React app in `web/`. It polls the API via `web/src/lib/api.ts`. To embed: copy `web/`, point the API base URL at your server.

Key files: `WorkflowsDashboard.tsx`, `NodeCanvas.tsx`, `NodeSettings.tsx`, `EventTimeline.tsx`, `AgentsPanel.tsx`.

</details>

<details>
<summary><strong>API Reference</strong></summary>

### Workflows

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/workflows` | List workflows (auto-creates Template 1 if empty) |
| `POST` | `/api/workflows` | Create workflow `{ name, definition }` |
| `GET` | `/api/workflows/:id` | Get workflow + run history |
| `PUT` | `/api/workflows/:id` | Update workflow |
| `POST` | `/api/workflows/:id/run` | Execute workflow |
| `POST` | `/api/workflow-runs/:runId/approve` | Resume paused workflow `{ decision, approver }` |

### Guards

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/mcp/evaluate` | Generic guard evaluation `{ boardId, action }` |
| `POST` | `/api/guard.evaluate` | Typed guard evaluation `{ runId, boardId, guardType, payload, policy }` |
| `POST` | `/api/human.approve` | Human approval `{ runId, replyText, approver }` |

### Participants

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/participants?boardId=...` | List participants |
| `POST` | `/api/participants` | Create participant |
| `PATCH` | `/api/participants/:id` | Update participant |
| `DELETE` | `/api/participants/:id` | Delete participant |

### Agents

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/agents/connect` | Register agent → returns `apiKey` |
| `GET` | `/api/agents` | List agents |
| `POST` | `/api/agent/trigger` | Agent-triggered execution (requires `x-agent-key`) |

### Votes + Policies

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/votes` | Submit vote |
| `GET` | `/api/votes/:runId` | Get votes + aggregate |
| `POST` | `/api/policies/assign` | Assign policy to board |
| `GET` | `/api/policies/:boardId/:policyId` | Get policy assignment |

### Credentials

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/settings/credentials` | List credentials (no values) |
| `POST` | `/api/settings/credentials` | Store credential `{ provider, keyName, value }` |
| `DELETE` | `/api/settings/credentials/:provider/:keyName` | Delete credential |
| `GET` | `/api/settings/credentials/:provider/status` | Check provider status |

### Boards + Events

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/mcp/boards` | List boards |
| `GET` | `/api/mcp/events` | List events `?boardId=&runId=&type=&limit=` |
| `DELETE` | `/api/mcp/events` | Delete events `?boardId=&runId=` |
| `GET` | `/api/mcp/runs/:id` | Get run + events |
| `GET` | `/api/mcp/audit/search` | Search events `?query=` |

### Webhooks (Inbound)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/webhooks/github` | GitHub webhook (triggers matching workflows) |
| `POST` | `/api/webhooks/slack/events` | Slack Events API |
| `POST` | `/api/webhooks/teams/activity` | Teams Bot Framework |
| `POST` | `/api/webhooks/discord/interactions` | Discord interactions |
| `POST` | `/api/webhooks/telegram` | Telegram updates |
| `POST` | `/api/webhooks/chat/:adapter` | Generic chat adapter |

### MCP Tools

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/mcp/tools` | List tool names |
| `POST` | `/api/mcp/tool/:name` | Invoke tool |

</details>

<details>
<summary><strong>Configuration</strong></summary>

### Environment variables

| Variable | Description | Default |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API key | (deterministic fallback) |
| `AI_MODEL` | Default agent model | `gpt-5.4` |
| `CHAT_PROVIDER` | Chat dispatch: `webhook` or `stdout` | `webhook` |
| `SLACK_BOT_TOKEN` | Slack bot token | — |
| `DISCORD_BOT_TOKEN` | Discord bot token | — |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | — |
| `TEAMS_WEBHOOK_URL` | Teams webhook URL | — |
| `GCHAT_WEBHOOK_URL` | Google Chat webhook URL | — |
| `CREDENTIALS_SECRET` | Master encryption key | (auto-generated) |
| `VERBOSE` | Verbose logging (`1`) | — |

All secrets can also be stored via `POST /api/settings/credentials` (encrypted at rest, takes precedence over env vars).

### .consensus/config.json

```json
{
  "board_mode": "local",
  "api_url": "http://127.0.0.1:4010"
}
```

</details>

---

## Tool Matrix

| Tool | Status | Description |
|---|---|---|
| `guard.evaluate` | ✅ | Generic guard entrypoint |
| `guard.code_merge` | ✅ | Sensitive files, protected branches, CI checks |
| `guard.send_email` | ✅ | Allowlist/blocklist, attachment policy, secrets scanning |
| `guard.publish` | ✅ | Profanity filter, PII detection, blocked words |
| `guard.support_reply` | ✅ | Escalation keywords, auto-escalate |
| `guard.agent_action` | ✅ | Tool allowlist/blocklist, irreversibility check |
| `guard.deployment` | ✅ | Environment-aware approval gates |
| `guard.permission_escalation` | ✅ | Break-glass, MFA support |
| `guard.policy.describe` | ✅ | Describe policy schema for any guard type |
| `persona.generate` | ✅ | Generate persona set for a board |
| `board.list` / `board.get` | ✅ | Ledger-backed board queries |
| `run.get` | ✅ | Ledger-backed run queries |
| `audit.search` | ✅ | Search events by payload/type |
| `human.approve` | ✅ | Submit human approval decision |

---

## Safety

- **Append-only events** — no mutation after write. Full audit trail.
- **Secret redaction** — sensitive fields (`apiKey`, `token`, `password`, `secret`, `authorization`, `cookie`) redacted before persistence.
- **Encrypted credentials** — AES-256-GCM. Key derived from `CREDENTIALS_SECRET` via scrypt or auto-generated on first run.
- **Localhost-only** — binds to `127.0.0.1:4010`. No external exposure unless explicitly proxied.
- **Typed contracts** — all API I/O validated with zod. Invalid payloads return structured errors.
- **Idempotency keys** — guard evaluations, votes, and approvals prevent duplicate processing.
- **GitHub webhook verification** — HMAC-SHA256 signature verification via `crypto.timingSafeEqual`.

---

## License

MIT
