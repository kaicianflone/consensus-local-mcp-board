# local-mcp-board

Standalone local-first MCP + Board system for experimentation.

## Run

```bash
npm i
npm run dev
```

- API/MCP server: http://127.0.0.1:4010
- Web UI: http://127.0.0.1:5173

## Quick test

```bash
curl -X POST http://127.0.0.1:4010/api/mcp/evaluate \
  -H 'content-type: application/json' \
  -d '{"boardId":"default","action":{"type":"send_email","payload":{"to":"ext@example.com","body":"hello"}}}'
```
