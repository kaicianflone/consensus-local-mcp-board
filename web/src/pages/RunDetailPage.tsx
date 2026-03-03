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
  const correlations = useMemo(() => {
    const rows = events
      .map((e:any) => {
        let p: any = null;
        try { p = e.payload_json ? JSON.parse(e.payload_json) : null; } catch {}
        if (!p) return null;
        if (!p.external_run_id && !p.external_step_id && !p.engine) return null;
        return {
          eventId: e.id,
          type: e.type,
          engine: p.engine || null,
          externalRunId: p.external_run_id || null,
          externalStepId: p.external_step_id || null
        };
      })
      .filter(Boolean);
    const seen = new Set<string>();
    return rows.filter((r:any) => {
      const key = `${r.type}|${r.engine}|${r.externalRunId}|${r.externalStepId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [events]);
  async function copyAudit(){ if(final?.id) await navigator.clipboard.writeText(final.id); }
  return <div className='container'>
    <div className='row'><Link to='/boards'>← Back</Link><Link to='/'>Home</Link><Link to='/workflows'>Workflows</Link></div>
    <h2>Run {runId}</h2>
    {parsed && <div className='card'><div className='row'><span className='badge'>{parsed.decision}</span><strong>{parsed.reason}</strong><span className='small'>risk: {parsed.risk_score}</span><button onClick={copyAudit}>Copy audit_id</button></div>{parsed.suggested_rewrite && <pre>{JSON.stringify(parsed.suggested_rewrite,null,2)}</pre>}</div>}
    {correlations.length > 0 && (
      <div className='card'>
        <h3>Correlation</h3>
        {correlations.map((c:any)=><div key={`${c.eventId}-${c.externalStepId||'none'}`} className='row'>
          <span className='badge'>{c.type}</span>
          {c.engine ? <span className='badge'>{c.engine}</span> : null}
          {c.externalRunId ? <span className='small'>run: {c.externalRunId}</span> : null}
          {c.externalStepId ? <span className='small'>step: {c.externalStepId}</span> : null}
        </div>)}
      </div>
    )}
    <div className='card'><h3>Decision Trace</h3>{events.map((e:any)=><div key={e.id} className='card'><div className='row'><span className='badge'>{e.type}</span><span className='small'>{e.id}</span></div><pre>{e.payload_json}</pre></div>)}</div>
    <JsonPanel title='Run JSON' value={run} />
  </div>
}
