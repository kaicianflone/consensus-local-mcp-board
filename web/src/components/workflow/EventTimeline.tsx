import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Clock, Shield, Users, Zap, Info } from 'lucide-react';
import { Badge } from '../ui/badge';
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
  const [widths, setWidths] = useState({ time: 140, type: 120, duration: 80 });

  const handleMouseDown = (e: React.MouseEvent, column: keyof typeof widths) => {
    e.preventDefault();
    const startX = e.pageX;
    const startWidth = widths[column];
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(50, startWidth + (moveEvent.pageX - startX));
      setWidths(prev => ({ ...prev, [column]: newWidth }));
    };
    
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const ms = (date.getMilliseconds() / 10).toFixed(0).padStart(2, '0');
    return `${month} ${day} ${hours}:${minutes}:${seconds}.${ms}`;
  };

  const getRelativeTime = (ts: number) => {
    const diff = Date.now() - ts;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? '' : 's'} ago`;
  };

  const getTimeTooltip = (ts: number) => {
    const date = new Date(ts);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const local = date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hour12: true });
    const utc = date.toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hour12: true });
    return `${tz}\t${local}\nUTC\t${utc}\nRelative\t${getRelativeTime(ts)}`;
  };
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
        <div className="flex-1 overflow-y-auto scrollbar-custom">
          <table className="w-full text-left border-collapse table-fixed">
            <thead className="sticky top-0 bg-muted/50 backdrop-blur-sm z-10 border-b border-border/50">
              <tr>
                <th style={{ width: widths.time }} className="py-1.5 px-2 text-[10px] font-medium text-muted-foreground border-r border-border/20 relative group/header">
                  Time
                  <div 
                    onMouseDown={(e) => handleMouseDown(e, 'time')}
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/40 transition-colors z-20" 
                  />
                </th>
                <th style={{ width: widths.type }} className="py-1.5 px-2 text-[10px] font-medium text-muted-foreground border-r border-border/20 relative group/header">
                  Type
                  <div 
                    onMouseDown={(e) => handleMouseDown(e, 'type')}
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/40 transition-colors z-20" 
                  />
                </th>
                <th style={{ width: widths.duration }} className="py-1.5 px-2 text-[10px] font-medium text-muted-foreground border-r border-border/20 relative group/header">
                  Duration
                  <div 
                    onMouseDown={(e) => handleMouseDown(e, 'duration')}
                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/40 transition-colors z-20" 
                  />
                </th>
                <th className="py-1.5 px-2 text-[10px] font-medium text-muted-foreground border-r border-border/20">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {events.map((event: any) => {
                let payload: any = {};
                try { payload = event.payload_json ? JSON.parse(event.payload_json) : {}; } catch {}
                
                const summary = payload.step_label || payload.decision || payload.action || 'Completed';
                const fullInfo = JSON.stringify(payload, null, 2);
                const Icon = EVENT_ICONS[event.type] || Clock;
                const color = EVENT_COLORS[event.type] || 'text-muted-foreground';
                
                const duration = payload.duration_ms ? `${(payload.duration_ms / 1000).toFixed(2)}s` : '-';

                return (
                  <tr key={event.id} className="group hover:bg-accent/30 transition-colors border-b border-border/10 last:border-0">
                    <td className="py-1.5 px-2 text-[10px] text-muted-foreground whitespace-nowrap align-top font-mono border-r border-border/5 group/time relative">
                      <span className="cursor-help" title={getTimeTooltip(event.ts)}>
                        {formatTime(event.ts)}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 align-top border-r border-border/5">
                      <div className="flex items-center gap-1.5 overflow-hidden">
                        <Icon className={`h-3 w-3 shrink-0 ${color}`} />
                        <span className="text-[10px] font-medium truncate uppercase tracking-tight opacity-80">{event.type.replace('WORKFLOW_', '').replace('_EVALUATED', '')}</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2 align-top border-r border-border/5">
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {duration}
                      </span>
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
