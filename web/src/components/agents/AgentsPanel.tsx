import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Bot, Plus, Save, X, Pencil, UserPlus, Copy } from 'lucide-react';
import { connectAgent, listAgents, listParticipants, createParticipant, updateParticipant, assignPolicy } from '../../lib/api';

interface AgentsPanelProps {
  boardId: string;
}

export function AgentsPanel({ boardId }: AgentsPanelProps) {
  const [agents, setAgents] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [editingParticipant, setEditingParticipant] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, any>>({});

  async function refresh() {
    try {
      const a = await listAgents();
      setAgents(a.agents || []);
      const p = await listParticipants(boardId);
      setParticipants(p.participants || []);
    } catch {}
  }

  useEffect(() => { refresh(); }, [boardId]);

  async function handleAddAgent() {
    if (!agentName.trim()) return;
    try {
      const r = await connectAgent({
        name: agentName.trim(),
        scopes: ['guard.evaluate', 'workflow.run', 'human.approve'],
        boards: [boardId],
      });
      setNewApiKey(r.agent.apiKey);
      setAgentName('');
      await refresh();
    } catch {}
  }

  async function handleAddParticipant(agentId: string) {
    try {
      await createParticipant({
        boardId,
        subjectType: 'agent',
        subjectId: agentId,
        role: 'voter',
        weight: 1,
        reputation: 0.6,
      });
      await assignPolicy({
        boardId,
        policyId: 'default',
        participants: [agentId],
        weightingMode: 'hybrid',
        quorum: 0.6,
      });
      await refresh();
    } catch {}
  }

  function startEdit(p: any) {
    setEditingParticipant(p.id);
    setEditDraft({ weight: p.weight, reputation: p.reputation, role: p.role || 'voter' });
  }

  async function saveEdit(id: string) {
    try {
      await updateParticipant(id, { weight: Number(editDraft.weight), reputation: Number(editDraft.reputation) });
      setEditingParticipant(null);
      await refresh();
    } catch {}
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Bot className="h-4 w-4" /> Agents & Participants
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowAddAgent(true)} className="gap-1.5 h-7 text-xs">
            <Plus className="h-3 w-3" /> Add Agent
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 flex-1 overflow-y-auto">
        <div className="text-xs text-muted-foreground">
          {agents.length} agent{agents.length !== 1 ? 's' : ''} · {participants.length} participant{participants.length !== 1 ? 's' : ''}
        </div>

        {agents.map((agent: any) => {
          const isParticipant = participants.some((p: any) => p.subject_id === agent.id);
          return (
            <div key={agent.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md border border-border/50 bg-accent/30">
              <div className="flex items-center gap-2 min-w-0">
                <Bot className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span className="text-sm truncate">{agent.name}</span>
              </div>
              {!isParticipant && (
                <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => handleAddParticipant(agent.id)}>
                  <UserPlus className="h-3 w-3" /> Add
                </Button>
              )}
              {isParticipant && <Badge variant="secondary" className="text-[10px]">participant</Badge>}
            </div>
          );
        })}

        {participants.length > 0 && (
          <div className="pt-2 border-t space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Participants</div>
            {participants.map((p: any) => (
              <div key={p.id} className="rounded-md border border-border/50 px-2 py-1.5">
                {editingParticipant === p.id ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <label className="flex-1 space-y-1">
                        <span className="text-[10px] text-muted-foreground">Weight</span>
                        <Input className="h-7 text-xs" type="number" step="0.1" value={editDraft.weight} onChange={(e) => setEditDraft({ ...editDraft, weight: e.target.value })} />
                      </label>
                      <label className="flex-1 space-y-1">
                        <span className="text-[10px] text-muted-foreground">Reputation</span>
                        <Input className="h-7 text-xs" type="number" step="0.01" min="0" max="1" value={editDraft.reputation} onChange={(e) => setEditDraft({ ...editDraft, reputation: e.target.value })} />
                      </label>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" className="h-6 text-xs gap-1" onClick={() => saveEdit(p.id)}>
                        <Save className="h-3 w-3" /> Save
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => setEditingParticipant(null)}>
                        <X className="h-3 w-3" /> Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{p.subject_type}</Badge>
                      <span className="text-xs truncate">{p.subject_id}</span>
                      <span className="text-[10px] text-muted-foreground">w={p.weight} r={p.reputation}</span>
                    </div>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEdit(p)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={showAddAgent} onOpenChange={setShowAddAgent}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect New Agent</DialogTitle>
            <DialogDescription>Create a new agent with API access to the board.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm">Agent Name</span>
              <Input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="merge-agent-1" />
            </label>
            {newApiKey && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="text-sm font-medium text-primary">API Key Created</div>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-background px-2 py-1 rounded flex-1 truncate">{newApiKey}</code>
                  <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" onClick={() => navigator.clipboard.writeText(newApiKey)}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Copy this key now. It won't be shown again.</p>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setShowAddAgent(false); setNewApiKey(''); }}>Close</Button>
              <Button onClick={handleAddAgent} disabled={!agentName.trim()}>
                <Plus className="h-4 w-4 mr-1.5" /> Connect
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
