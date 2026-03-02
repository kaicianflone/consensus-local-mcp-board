const API = 'http://127.0.0.1:4010/api/mcp';

export async function getBoards(){ return fetch(`${API}/boards`).then(r=>r.json()); }
export async function getBoard(id:string){ return fetch(`${API}/boards/${id}`).then(r=>r.json()); }
export async function getRun(id:string){ return fetch(`${API}/runs/${id}`).then(r=>r.json()); }
export async function getEvents(params: Record<string,string|number|undefined>){
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k,v])=>{ if(v!==undefined) q.set(k,String(v)); });
  return fetch(`${API}/events?${q.toString()}`).then(r=>r.json());
}
export async function evalAction(input:any){
  return fetch(`${API}/evaluate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}).then(r=>r.json());
}
export async function createBoard(name:string){
  return fetch(`${API}/boards`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name})}).then(r=>r.json());
}
