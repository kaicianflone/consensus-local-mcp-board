// MCP server scaffold (local)
// Next step: wire @modelcontextprotocol/sdk tool transport and map tools -> engine/storage.
export const MCP_TOOLS = [
  'guard.evaluate',
  'guard.send_email',
  'guard.code_merge',
  'guard.publish',
  'guard.support_reply',
  'persona.generate',
  'persona.respawn',
  'board.list',
  'board.get',
  'run.get',
  'audit.search',
  'human.approve'
] as const;
