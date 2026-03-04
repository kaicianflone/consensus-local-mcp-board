import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Clock, Shield, Users, Zap, Info } from 'lucide-react';
import { getEvents } from '../../lib/api';

const EVENT_ICONS: Record<string, React.ElementType> = {
  GUARD_EVALUATED: Shield,
  FINAL_DECISION: Zap,
  HUMAN_DECISION: Users,
  WORKFLOW_STARTED: Zap,
  WORKFLOW_STEP: Clock,
};

const EVENT_COLORS: Record<string, string> = {
  GUARD_EVALUATED: 'text-emerald-500',
  FINAL_DECISION: 'text-emerald-500',
  HUMAN_DECISION: 'text-emerald-500',
  WORKFLOW_STARTED: 'text-emerald-500',
  WORKFLOW_STEP: 'text-emerald-500',
};

export function EventTimeline() {
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const d = await getEvents({ limit: 50 });
        setEvents(d.events || []);
      } catch {}
    }
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5" /> Event Log
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <table className="w-full text-left border-collapse table-fixed">
            <thead className="sticky top-0 bg-muted/50 backdrop-blur-sm z-10 border-b border-border/50">
              <tr>
                <th className="py-1.5 px-2 text-[10px] font-medium text-muted-foreground w-16">Time</th>
                <th className="py-1.5 px-2 text-[10px] font-medium text-muted-foreground w-20">Event</th>
                <th className="py-1.5 px-2 text-[10px] font-medium text-muted-foreground">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {events.map((event) => {
                const Icon = EVENT_ICONS[event.type] || Clock;
                const color = EVENT_COLORS[event.type] || 'text-muted-foreground';
                let payload: any = {};
                try { payload = event.payload_json ? JSON.parse(event.payload_json) : {}; } catch {}

                const summary = payload.step_label || payload.decision || payload.action || 'Completed';
                const fullInfo = JSON.stringify(payload, null, 2);

                return (
                  <tr key={event.id} className="group hover:bg-accent/30 transition-colors border-b border-border/10 last:border-0">
                    <td className="py-1.5 px-2 text-[10px] text-muted-foreground whitespace-nowrap align-top font-mono">
                      {new Date(event.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="py-1.5 px-2 align-top">
                      <div className="flex items-center gap-1.5">
                        <Icon className={`h-3 w-3 shrink-0 ${color}`} />
                        <span className="text-[10px] font-medium truncate uppercase tracking-tight opacity-80">{event.type.replace('WORKFLOW_', '').replace('_EVALUATED', '')}</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2 align-top relative group/cell">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-foreground/90 truncate font-medium">{summary}</span>
                        <div className="opacity-0 group-hover/cell:opacity-100 transition-opacity">
                           <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                        </div>
                      </div>
                      {/* Detailed info on hover - fixed positioning and styling */}
                      <div className="fixed hidden group-hover/cell:block z-[9999] bg-[#030712] text-popover-foreground border border-border shadow-2xl rounded-md p-3 max-w-sm break-words pointer-events-none text-[10px] font-mono whitespace-pre-wrap right-6 top-1/4 max-h-[60vh] overflow-y-auto shadow-emerald-500/10">
                        <div className="font-bold border-b border-border mb-2 pb-1 text-emerald-500 flex items-center gap-2">
                          <Info className="h-3 w-3" /> Raw Event Data
                        </div>
                        {fullInfo}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!events.length && (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-[10px] text-muted-foreground">
                    No events recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
