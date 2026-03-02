# consensus-local-mcp-board

[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Local_Server-111111)](https://modelcontextprotocol.io/)
[![SQLite](https://img.shields.io/badge/SQLite-Append--Only-003B57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Vite](https://img.shields.io/badge/Vite-React_UI-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

Local-first **MCP + Board runtime** for the Consensus ecosystem.

It gives you a lightweight way to run guard-style decisions on localhost, write an append-only ledger, and inspect Boards / Runs / Events in real time—without hosted dependencies.

---

## Why this repo exists

`consensus-local-mcp-board` is a practical bridge between:

- **consensus-tools** (core primitives)
- **consensus-interact** (workflow/orchestration patterns)
- guard + persona skills (policy/evaluation behavior)

Use it as:

1. A local MCP learning environment
2. A deterministic testing harness for guard behavior
3. A reusable starter template for future local governance apps

---

## Core capabilities

- **Local MCP server** with preloaded tool registry
- **Append-only SQLite ledger** (`boards`, `runs`, `events`)
- **Typed API + zod validation** for deterministic requests/responses
- **Live observability UI** for board and run traces
- **Safety defaults**
  - localhost-only bind (`127.0.0.1`)
  - payload secret redaction before persistence
  - structured error responses

---

## Architecture

```text
web (Vite/React)
   ↓ polling (1-2s)
server/api (Express + zod)
   ↓
engine (evaluate pipeline)
   ↓ append-only
sqlite ledger (boards/runs/events)
   ↓
mcp tool registry (local stdio)
```

### Repo layout

```text
consensus-local-mcp-board/
  server/
    src/
      api/
      db/
        migrations/
      engine/
      mcp/
      tools/
      utils/
  shared/
    src/   # zod schemas + shared TS contracts
  web/
    src/   # local-board pages + components
```

---

## Tool matrix (current)

| Tool | Status | Notes |
|---|---|---|
| `guard.evaluate` | ✅ | Generic guard entrypoint |
| `guard.send_email` | ✅ | Stub policy logic |
| `guard.code_merge` | ✅ | Stub policy logic |
| `guard.publish` | ✅ | Stub policy logic |
| `guard.support_reply` | ✅ | Stub policy logic |
| `persona.generate` | ✅ | Local deterministic scaffold |
| `persona.respawn` | ✅ | Scaffolded |
| `board.list` | ✅ | Ledger-backed |
| `board.get` | ✅ | Ledger-backed |
| `run.get` | ✅ | Ledger-backed |
| `audit.search` | ✅ | Event payload/type search |
| `human.approve` | 🧱 | Scaffolding response |

---

## Ecosystem alignment matrix

| Ecosystem package | Relationship in this repo |
|---|---|
| `consensus-tools` | Conceptual alignment for board/ledger primitives |
| `consensus-interact` | Compatible orchestration shape for future swap-in |
| `consensus-guard-core` | Contract-compatible guard flow design |
| Guard skills (`send-email`, `code-merge`, `publish`, `support-reply`) | Mirrored as MCP tool entrypoints |
| Persona skills (`generator`, `respawn`) | Mirrored as MCP tool entrypoints |

---

## Installation

### Prerequisites

- Node.js 20+ (recommended)
- npm 10+

### Setup

```bash
git clone https://github.com/kaicianflone/consensus-local-mcp-board.git
cd consensus-local-mcp-board
npm install
```

---

## Run locally

```bash
npm run dev
```

Endpoints:

- API: `http://127.0.0.1:4010`
- UI: `http://127.0.0.1:5173/local-board`

MCP stdio mode:

```bash
npm run mcp:dev
```

---

## Quick smoke test

Create/evaluate action:

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
        "body": "apiKey=abc"
      }
    }
  }'
```

Then inspect:

- `GET /api/mcp/boards`
- `GET /api/mcp/events?limit=20`

---

## Safety + reliability

- **Append-only events**: no event mutation, inserts only
- **Secret redaction on write** for keys:
  - `authorization`, `cookie`, `set-cookie`, `apiKey`, `token`, `password`, `secret`
- **Local-only networking** by default
- **Typed contracts** via `zod` in shared schema layer

---

## Current scope vs future upgrades

### In scope (v1/v2 local foundation)
- deterministic stub guard logic
- local board/run/event observability
- MCP tool registry and local execution path

### Next upgrades
- swap stubs for real consensus policy engines
- richer persona-vote simulation and scoring
- optional SSE stream mode for UI
- package-level CI + release verification badges

---

## License

MIT
