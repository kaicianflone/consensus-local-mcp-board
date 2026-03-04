import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ArrowLeft, Copy, Clock, Shield, ChevronDown, ChevronUp } from 'lucide-react';
import { getRun } from '../lib/api';

export default function RunDetailPage() {
  const { runId = '' } = useParams();
  const [run, setRun] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [showRaw, setShowRaw] = useState(false);

  const load = async () => {
    try {
      const d = await getRun(runId);
      setRun(d.run);
      setEvents(d.events || []);
    } catch {}
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [runId]);

  const final = useMemo(() => events.find((e: any) => e.type === 'FINAL_DECISION'), [events]);
  const parsed = final ? JSON.parse(final.payload_json || '{}') : null;

  const correlations = useMemo(() => {
    const rows = events
      .map((e: any) => {
        let p: any = null;
        try { p = e.payload_json ? JSON.parse(e.payload_json) : null; } catch {}
        if (!p || (!p.external_run_id && !p.external_step_id && !p.engine)) return null;
        return {
          eventId: e.id,
          type: e.type,
          engine: p.engine || null,
          externalRunId: p.external_run_id || null,
          externalStepId: p.external_step_id || null,
        };
      })
      .filter(Boolean);
    const seen = new Set<string>();
    return rows.filter((r: any) => {
      const key = `${r.type}|${r.engine}|${r.externalRunId}|${r.externalStepId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [events]);

  const DECISION_COLORS: Record<string, string> = {
    ALLOW: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    BLOCK: 'bg-red-500/10 text-red-400 border-red-500/30',
    REWRITE: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    REQUIRE_HUMAN: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  };

  return (
    <div className="mx-auto max-w-screen-xl p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/boards">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
        </Link>
        <h1 className="text-xl font-semibold truncate">Run {runId}</h1>
      </div>

      {parsed && (
        <Card className={`border ${DECISION_COLORS[parsed.decision] || ''}`}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge className={DECISION_COLORS[parsed.decision]}>{parsed.decision}</Badge>
              <span className="font-medium">{parsed.reason}</span>
              <span className="text-xs text-muted-foreground">risk: {parsed.risk_score}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-xs ml-auto"
                onClick={() => final?.id && navigator.clipboard.writeText(final.id)}
              >
                <Copy className="h-3 w-3" /> Copy audit_id
              </Button>
            </div>
            {parsed.suggested_rewrite && (
              <pre className="mt-3 text-xs bg-background/50 border rounded-md p-3 overflow-auto">
                {JSON.stringify(parsed.suggested_rewrite, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      {correlations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-3.5 w-3.5" /> Correlation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {correlations.map((c: any) => (
                <div key={`${c.eventId}-${c.externalStepId || 'none'}`} className="flex items-center gap-2 py-1.5">
                  <Badge variant="outline" className="text-[10px]">{c.type}</Badge>
                  {c.engine && <Badge variant="secondary" className="text-[10px]">{c.engine}</Badge>}
                  {c.externalRunId && <span className="text-xs text-muted-foreground">run: {c.externalRunId}</span>}
                  {c.externalStepId && <span className="text-xs text-muted-foreground">step: {c.externalStepId}</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" /> Decision Trace
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {events.map((e: any) => (
              <div key={e.id} className="rounded-md border border-border/50 p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{e.type}</Badge>
                  <span className="text-[10px] text-muted-foreground">{e.id}</span>
                </div>
                <pre className="text-xs bg-background/50 border rounded p-2 overflow-auto max-h-40">
                  {e.payload_json}
                </pre>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Run JSON</CardTitle>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={() => setShowRaw(!showRaw)}>
              {showRaw ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showRaw ? 'Hide' : 'Show'}
            </Button>
          </div>
        </CardHeader>
        {showRaw && (
          <CardContent>
            <pre className="text-xs bg-background/50 border rounded-md p-3 overflow-auto max-h-80">
              {JSON.stringify(run, null, 2)}
            </pre>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
