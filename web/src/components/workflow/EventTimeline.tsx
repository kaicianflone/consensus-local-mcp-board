import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Clock, AlertTriangle, CheckCircle, Shield, Users, Zap } from 'lucide-react';
import { getEvents } from '../../lib/api';

const EVENT_ICONS: Record<string, React.ElementType> = {
  GUARD_EVALUATED: Shield,
  FINAL_DECISION: CheckCircle,
  HUMAN_DECISION: Users,
  WORKFLOW_STARTED: Zap,
  WORKFLOW_STEP: Clock,
  WARNING: AlertTriangle,
};

const EVENT_COLORS: Record<string, string> = {
  GUARD_EVALUATED: 'text-emerald-400',
  FINAL_DECISION: 'text-blue-400',
  HUMAN_DECISION: 'text-purple-400',
  WORKFLOW_STARTED: 'text-amber-400',
  WORKFLOW_STEP: 'text-muted-foreground',
  WARNING: 'text-destructive',
};

export function EventTimeline() {
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const d = await getEvents({ limit: 30 });
        setEvents(d.events || []);
      } catch {}
    }
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Clock className="h-4 w-4" /> Event Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!events.length && (
          <p className="text-sm text-muted-foreground py-4 text-center">No events yet. Run a workflow to see activity.</p>
        )}
        <div className="space-y-1">
          {events.map((event) => {
            const Icon = EVENT_ICONS[event.type] || Clock;
            const color = EVENT_COLORS[event.type] || 'text-muted-foreground';
            let payload: any = null;
            try { payload = event.payload_json ? JSON.parse(event.payload_json) : null; } catch {}

            return (
              <div key={event.id} className="group flex gap-3 py-2 px-2 rounded-md hover:bg-accent/50 transition-colors">
                <div className="flex flex-col items-center">
                  <Icon className={`h-4 w-4 mt-0.5 ${color}`} />
                  <div className="w-px flex-1 bg-border mt-1" />
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {event.type}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(event.ts).toLocaleTimeString()}
                    </span>
                  </div>
                  {payload?.decision && (
                    <div className="text-xs text-muted-foreground truncate">
                      {payload.decision} — {payload.reason?.slice(0, 80)}
                    </div>
                  )}
                  {payload?.step_label && (
                    <div className="text-xs text-muted-foreground truncate">
                      {payload.step_label}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
