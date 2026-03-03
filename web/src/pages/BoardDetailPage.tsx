import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getBoard, getEvents } from '../lib/api';
import { JsonPanel } from '../components/JsonPanel';

export default function BoardDetailPage(){
  const { boardId='' } = useParams();
  const [board,setBoard]=useState<any>(null);
  const [events,setEvents]=useState<any[]>([]);
  const load=async()=>{
    try {
      const b=await getBoard(boardId); setBoard(b.board);
      const e=await getEvents({boardId,limit:200}); setEvents(e.events||[]);
    } catch { /* noop during startup */ }
  };
  useEffect(()=>{load(); const t=setInterval(load,3000); return ()=>clearInterval(t);},[boardId]);
  return <div className='container'>
    <div className='row'><Link to='/boards'>← Back</Link><Link to='/'>Home</Link><Link to='/workflows'>Workflows</Link></div>
    <h2>Board {board?.name || boardId}</h2>
    <div className='card'><div className='small'>Runs</div>{(board?.runs||[]).map((r:any)=><div key={r.id} className='row'><span className='badge'>{r.status}</span><Link to={`/boards/run/${r.id}`}>{r.id}</Link></div>)}</div>
    <div className='card'><h3>Event Timeline</h3>{events.map((e:any)=><div key={e.id} className='card'><div className='row'><span className='badge'>{e.type}</span><span className='small'>{new Date(e.ts).toLocaleString()}</span><span className='small'>{e.id}</span></div></div>)}</div>
    <JsonPanel title='Raw board' value={board} />
  </div>
}
