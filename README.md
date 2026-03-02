# local-mcp-board

Standalone local-first MCP + Board system for experimentation and rapid app prototyping.

## What is included

- Local MCP server scaffold + tool wiring (`server/src/mcp/server.ts`)
- Typed tool registry (`server/src/tools/registry.ts`)
- Local append-only SQLite ledger (`boards`, `runs`, `events`)
- SQL migrations (`server/src/db/migrations`)
- HTTP API for local tooling/UI (`/api/mcp/*`)
- Vite UI with black/green theme and live polling:
  - `/local-board`
  - `/local-board/:boardId`
  - `/local-board/run/:runId`

## Run locally

```bash
npm i
npm run dev
```

- API: http://127.0.0.1:4010
- UI: http://127.0.0.1:5173/local-board

MCP (stdio mode):

```bash
npm run mcp:dev
```

## Example evaluate call

```bash
curl -X POST http://127.0.0.1:4010/api/mcp/evaluate \
  -H 'content-type: application/json' \
  -d '{
    "boardId":"default",
    "action":{"type":"send_email","payload":{"to":"ext@example.com","attachment":true,"body":"apiKey=abc"}}
  }'
```

## Notes

- Binds to localhost only (`127.0.0.1`) by default.
- Payloads are redacted before persistence for sensitive keys.
- Events are append-only (no updates).
