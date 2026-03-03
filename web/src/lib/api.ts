const MCP_API = 'http://127.0.0.1:4010/api/mcp';
const API = 'http://127.0.0.1:4010/api';

async function j(r: Response) {
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

export async function getBoards(){ return fetch(`${MCP_API}/boards`).then(j); }
export async function getBoard(id:string){ return fetch(`${MCP_API}/boards/${id}`).then(j); }
export async function getRun(id:string){ return fetch(`${MCP_API}/runs/${id}`).then(j); }
export async function getEvents(params: Record<string,string|number|undefined>){
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k,v])=>{ if(v!==undefined) q.set(k,String(v)); });
  return fetch(`${MCP_API}/events?${q.toString()}`).then(j);
}
export async function evalAction(input:any){
  return fetch(`${MCP_API}/evaluate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}).then(j);
}
export async function createBoard(name:string){
  return fetch(`${MCP_API}/boards`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})}).then(j);
}

export async function getWorkflows(){ return fetch(`${API}/workflows`).then(j); }
export async function createWorkflow(name:string, definition:any){ return fetch(`${API}/workflows`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ name, definition }) }).then(j); }
export async function updateWorkflow(id:string, patch:any){ return fetch(`${API}/workflows/${id}`, { method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify(patch) }).then(j); }
export async function runWorkflow(id:string){ return fetch(`${API}/workflows/${id}/run`, { method:'POST' }).then(j); }
export async function approveWorkflowRun(runId:string, decision:'YES'|'NO', approver='human'){ return fetch(`${API}/workflow-runs/${runId}/approve`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ decision, approver }) }).then(j); }
export async function getWorkflow(id:string){ return fetch(`${API}/workflows/${id}`).then(j); }

export async function connectAgent(input:{name:string;scopes?:string[];boards?:string[];workflows?:string[]}){ return fetch(`${API}/agents/connect`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}).then(j); }
export async function listAgents(){ return fetch(`${API}/agents`).then(j); }
export async function createParticipant(input:any){ return fetch(`${API}/participants`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}).then(j); }
export async function listParticipants(boardId:string){ return fetch(`${API}/participants?boardId=${encodeURIComponent(boardId)}`).then(j); }
export async function updateParticipant(id:string, patch:any){ return fetch(`${API}/participants/${id}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(patch)}).then(j); }
export async function assignPolicy(input:any){ return fetch(`${API}/policies/assign`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}).then(j); }
export async function submitConsensusVote(input:any){ return fetch(`${API}/votes`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}).then(j); }
