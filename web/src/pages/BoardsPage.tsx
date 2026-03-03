import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createBoard, getBoards } from '../lib/api';

export default function BoardsPage(){
  const [boards,setBoards]=useState<any[]>([]);
  const [name,setName]=useState('default');
  const load=async()=>{ try { const d=await getBoards(); setBoards(d.boards||[]); } catch { /* noop during startup */ } };
  useEffect(()=>{load(); const t=setInterval(load,3000); return ()=>clearInterval(t);},[]);
  return <div className='container'>
    <div className='row'><h2>Boards</h2><Link to='/'>Home</Link><Link to='/workflows'>Workflows</Link></div>
    <div className='card row'>
      <input value={name} onChange={e=>setName(e.target.value)} placeholder='board name'/>
      <button onClick={async()=>{ try { await createBoard(name); await load(); } catch {} }}>Create Board</button>
    </div>
    {boards.map((b:any)=><div key={b.id} className='card'>
      <div className='row'><span className='badge'>{b.id}</span><strong>{b.name}</strong><span className='small'>{new Date(b.created_at).toLocaleString()}</span></div>
      <Link to={`/boards/${b.id}`}>Open board →</Link>
    </div>)}
  </div>
}
