import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getRun } from '../lib/api';
import { JsonPanel } from '../components/JsonPanel';

export default function RunDetailPage(){
  const { runId='' } = useParams();
  const [run,setRun]=useState<any>(null);
  const [events,setEvents]=useState<any[]>([]);
  const load=async()=>{ try { const d=await getRun(runId); setRun(d.run); setEvents(d.events||[]); } catch { /* noop during startup */ } };
  useEffect(()=>{load(); const t=setInterval(load,3000); return ()=>clearInterval(t);},[runId]);
  const final = useMemo(()=>events.find((e:any)=>e.type==='FINAL_DECISION'),[events]);
  const parsed = final ? JSON.parse(final.payload_json || '{}') : null;
  async function copyAudit(){ if(final?.id) await navigator.clipboard.writeText(final.id); }
  return <div className='container'>
    <div className='row'><Link to='/boards'>← Back</Link><Link to='/'>Home</Link><Link to='/workflows'>Workflows</Link></div>
    <h2>Run {runId}</h2>
    {parsed && <div className='card'><div className='row'><span className='badge'>{parsed.decision}</span><strong>{parsed.reason}</strong><span className='small'>risk: {parsed.risk_score}</span><button onClick={copyAudit}>Copy audit_id</button></div>{parsed.suggested_rewrite && <pre>{JSON.stringify(parsed.suggested_rewrite,null,2)}</pre>}</div>}
    <div className='card'><h3>Decision Trace</h3>{events.map((e:any)=><div key={e.id} className='card'><div className='row'><span className='badge'>{e.type}</span><span className='small'>{e.id}</span></div><pre>{e.payload_json}</pre></div>)}</div>
    <JsonPanel title='Run JSON' value={run} />
  </div>
}
