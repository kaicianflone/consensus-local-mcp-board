import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Any = any;
function App(){
  const [boards,setBoards]=useState<Any[]>([]);
  const [events,setEvents]=useState<Any[]>([]);
  useEffect(()=>{const t=setInterval(async()=>{
    const b=await fetch('http://127.0.0.1:4010/api/mcp/boards').then(r=>r.json()).catch(()=>({boards:[]}));
    setBoards(b.boards||[]);
    const e=await fetch('http://127.0.0.1:4010/api/mcp/events?limit=20').then(r=>r.json()).catch(()=>({events:[]}));
    setEvents(e.events||[]);
  },1000); return ()=>clearInterval(t)},[]);
  return <div style={{fontFamily:'sans-serif',padding:16}}><h2>Local Board</h2><h3>Boards</h3><pre>{JSON.stringify(boards,null,2)}</pre><h3>Events</h3><pre>{JSON.stringify(events,null,2)}</pre></div>
}
createRoot(document.getElementById('root')!).render(<App/>);
