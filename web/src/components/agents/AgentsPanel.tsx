import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Bot, Plus, Save, X, Pencil, UserPlus, Copy, MessageSquare, User } from 'lucide-react';
import { connectAgent, listAgents, listParticipants, createParticipant, updateParticipant, assignPolicy } from '../../lib/api';

const CHAT_ADAPTERS = [
  { value: '', label: 'None' },
  { value: 'slack', label: 'Slack' },
  { value: 'discord', label: 'Discord' },
  { value: 'teams', label: 'Teams' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'googlechat', label: 'Google Chat' },
];

interface AgentsPanelProps {
  boardId: string;
  workflowNodes?: any[];
}

export function AgentsPanel({ boardId, workflowNodes = [] }: AgentsPanelProps) {
  const [agents, setAgents] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [showAddHuman, setShowAddHuman] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [humanName, setHumanName] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [editingParticipant, setEditingParticipant] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, any>>({});

  // Extract virtual agents from workflow nodes (including groups)
  const virtualAgents = useMemo(() => {
    const list: any[] = [];
    workflowNodes.forEach(node => {
      if (node.type === 'agent') {
        list.push({
          id: node.id,
          name: node.label,
          personaNames: node.config?.personaNames || 'Default Persona',
          reputation: node.config?.reputation || 0.95,
          votingWeight: node.config?.votingWeight || 1.0,
          isVirtual: true
        });
      } else if (node.type === 'group' && Array.isArray(node.config?.children)) {
        node.config.children.forEach((child: any) => {
          if (child.type === 'agent') {
            list.push({
              id: child.id,
              name: child.label,
              personaNames: child.config?.personaNames || 'Default Persona',
              reputation: child.config?.reputation || 0.95,
              votingWeight: child.config?.votingWeight || 1.0,
              isVirtual: true
            });
          }
        });
      }
    });
    return list;
  }, [workflowNodes]);

  function parseMetadata(p: any): Record<string, any> {
    try {
      return JSON.parse(p.metadata_json || '{}');
    } catch {
      return {};
    }
  }

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

  async function handleAddHuman() {
    if (!humanName.trim()) return;
    try {
      await createParticipant({
        boardId,
        subjectType: 'human',
        subjectId: humanName.trim(),
        role: 'voter',
        weight: 1,
        reputation: 1.0,
      });
      setHumanName('');
      setShowAddHuman(false);
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
    const meta = parseMetadata(p);
    setEditingParticipant(p.id);
    setEditDraft({
      weight: p.weight,
      reputation: p.reputation,
      role: p.role || 'voter',
      chatAdapter: meta.chatAdapter || '',
      chatHandle: meta.chatHandle || '',
    });
  }

  async function saveEdit(id: string) {
    try {
      await updateParticipant(id, {
        weight: Number(editDraft.weight),
        reputation: Number(editDraft.reputation),
        metadata: {
          chatAdapter: editDraft.chatAdapter || '',
          chatHandle: editDraft.chatHandle || '',
        },
      });
      setEditingParticipant(null);
      await refresh();
    } catch {}
  }

  const humanParticipants = participants.filter(p => p.subject_type === 'human');
  const agentParticipants = participants.filter(p => p.subject_type === 'agent');

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Bot className="h-4 w-4" /> Agents & Participants
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowAddAgent(true)} className="gap-1.5 h-7 text-xs">
              <Bot className="h-3 w-3" /> +Agent
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowAddHuman(true)} className="gap-1.5 h-7 text-xs">
              <User className="h-3 w-3" /> +Human
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 flex-1 overflow-y-auto">
        {/* Humans Section */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <User className="h-3 w-3" /> Humans
          </div>
          {humanParticipants.length === 0 && <p className="text-[10px] text-muted-foreground pl-4">No human participants</p>}
          {humanParticipants.map((p) => (
            <ParticipantCard 
              key={p.id} 
              p={p} 
              editingParticipant={editingParticipant} 
              editDraft={editDraft} 
              setEditDraft={setEditDraft} 
              saveEdit={saveEdit} 
              startEdit={startEdit} 
              setEditingParticipant={setEditingParticipant}
              parseMetadata={parseMetadata}
            />
          ))}
        </div>

        {/* Agents Section */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Bot className="h-3 w-3" /> Agents
          </div>
          {agentParticipants.length === 0 && <p className="text-[10px] text-muted-foreground pl-4">No agent participants</p>}
          {agentParticipants.map((p) => (
            <ParticipantCard 
              key={p.id} 
              p={p} 
              editingParticipant={editingParticipant} 
              editDraft={editDraft} 
              setEditDraft={setEditDraft} 
              saveEdit={saveEdit} 
              startEdit={startEdit} 
              setEditingParticipant={setEditingParticipant}
              parseMetadata={parseMetadata}
            />
          ))}
          
          {/* Board Agents (Not yet participants) */}
          {agents.filter(a => !participants.some(p => p.subject_id === a.id)).length > 0 && (
            <div className="pt-2 border-t border-dashed">
              <div className="text-[10px] font-medium text-muted-foreground mb-1">Available to Add</div>
              {agents.filter(a => !participants.some(p => p.subject_id === a.id)).map((agent: any) => (
                <div key={agent.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md border border-border/50 bg-accent/30 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <Bot className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                    <span className="text-sm truncate">{agent.name}</span>
                  </div>
                  <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => handleAddParticipant(agent.id)}>
                    <UserPlus className="h-3 w-3" /> Add
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      <Dialog open={showAddAgent} onOpenChange={setShowAddAgent}>
        <DialogContent>
          <DialogHeader><DialogTitle>Connect New Agent</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="Agent Name" />
            {newApiKey && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="text-sm font-medium text-primary">API Key Created</div>
                <code className="text-xs bg-background px-2 py-1 rounded block truncate">{newApiKey}</code>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAddAgent(false)}>Close</Button>
              <Button onClick={handleAddAgent}>Connect</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddHuman} onOpenChange={setShowAddHuman}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Human Participant</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input value={humanName} onChange={(e) => setHumanName(e.target.value)} placeholder="Human Name or ID" />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAddHuman(false)}>Cancel</Button>
              <Button onClick={handleAddHuman}>Add</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ParticipantCard({ p, editingParticipant, editDraft, setEditDraft, saveEdit, startEdit, setEditingParticipant, parseMetadata }: any) {
  const meta = parseMetadata(p);
  return (
    <div className="rounded-md border border-border/50 px-2 py-1.5 bg-card/50">
      {editingParticipant === p.id ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input className="h-7 text-xs flex-1" type="number" step="0.1" value={editDraft.weight} onChange={(e) => setEditDraft({ ...editDraft, weight: e.target.value })} placeholder="Weight" />
            <Input className="h-7 text-xs flex-1" type="number" step="0.01" value={editDraft.reputation} onChange={(e) => setEditDraft({ ...editDraft, reputation: e.target.value })} placeholder="Reputation" />
          </div>
          <div className="flex gap-2">
            <Select className="h-7 text-xs flex-1" value={editDraft.chatAdapter} onChange={(e) => setEditDraft({ ...editDraft, chatAdapter: e.target.value })}>
              {CHAT_ADAPTERS.map((a) => <option key={a.value} value={a.value}>{a.label || 'Adapter'}</option>)}
            </Select>
            <Input className="h-7 text-xs flex-1" value={editDraft.chatHandle} onChange={(e) => setEditDraft({ ...editDraft, chatHandle: e.target.value })} placeholder="Handle" />
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" className="h-6 text-xs" onClick={() => saveEdit(p.id)}><Save className="h-3 w-3 mr-1" /> Save</Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditingParticipant(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-xs font-medium truncate">{p.subject_id}</span>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">w:{p.weight} r:{p.reputation}</span>
            {meta.chatAdapter && (
              <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 gap-1">
                <MessageSquare className="h-2.5 w-2.5" /> {meta.chatAdapter}
              </Badge>
            )}
          </div>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEdit(p)}><Pencil className="h-3 w-3" /></Button>
        </div>
      )}
    </div>
  );
}
