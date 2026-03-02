import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createBoard, getBoards } from '../lib/api';

export default function BoardsPage(){
  const [boards,setBoards]=useState<any[]>([]);
  const [name,setName]=useState('default');
  const load=()=>getBoards().then(d=>setBoards(d.boards||[]));
  useEffect(()=>{load(); const t=setInterval(load,1500); return ()=>clearInterval(t);},[]);
  return <div className='container'>
    <h2>Local Board</h2>
    <div className='card row'>
      <input value={name} onChange={e=>setName(e.target.value)} placeholder='board name'/>
      <button onClick={async()=>{await createBoard(name); load();}}>Create Board</button>
    </div>
    {boards.map((b:any)=><div key={b.id} className='card'>
      <div className='row'><span className='badge'>{b.id}</span><strong>{b.name}</strong><span className='small'>{new Date(b.created_at).toLocaleString()}</span></div>
      <Link to={`/local-board/${b.id}`}>Open board →</Link>
    </div>)}
  </div>
}
