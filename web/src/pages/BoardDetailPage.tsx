import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ArrowLeft, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { getBoard, getEvents } from '../lib/api';

export default function BoardDetailPage() {
  const { boardId = '' } = useParams();
  const [board, setBoard] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [showRaw, setShowRaw] = useState(false);

  const load = async () => {
    try {
      const b = await getBoard(boardId);
      setBoard(b.board);
      const e = await getEvents({ boardId, limit: 200 });
      setEvents(e.events || []);
    } catch {}
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [boardId]);

  return (
    <div className="mx-auto max-w-screen-xl p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/boards">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Boards
          </Button>
        </Link>
        <h1 className="text-xl font-semibold">{board?.name || boardId}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Runs</CardTitle>
          </CardHeader>
          <CardContent>
            {!(board?.runs || []).length && (
              <p className="text-sm text-muted-foreground py-4 text-center">No runs for this board.</p>
            )}
            <div className="space-y-2">
              {(board?.runs || []).map((r: any) => (
                <div key={r.id} className="flex items-center gap-2 py-1.5 px-2 rounded-md border border-border/50 hover:bg-accent/30 transition-colors">
                  <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                  <Link to={`/boards/run/${r.id}`} className="text-sm text-primary hover:underline truncate">
                    {r.id}
                  </Link>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" /> Event Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!events.length && (
              <p className="text-sm text-muted-foreground py-4 text-center">No events yet.</p>
            )}
            <div className="space-y-1">
              {events.map((e: any) => (
                <div key={e.id} className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-accent/30 transition-colors">
                  <Badge variant="outline" className="text-[10px] shrink-0">{e.type}</Badge>
                  <span className="text-xs text-muted-foreground">{new Date(e.ts).toLocaleString()}</span>
                  <span className="text-[10px] text-muted-foreground/50 truncate">{e.id}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Raw Board Data</CardTitle>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5" onClick={() => setShowRaw(!showRaw)}>
              {showRaw ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {showRaw ? 'Hide' : 'Show'}
            </Button>
          </div>
        </CardHeader>
        {showRaw && (
          <CardContent>
            <pre className="text-xs bg-background/50 border rounded-md p-3 overflow-auto max-h-80">
              {JSON.stringify(board, null, 2)}
            </pre>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
