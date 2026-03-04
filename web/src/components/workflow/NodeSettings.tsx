import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select } from '../ui/select';
import { Badge } from '../ui/badge';
import { Settings, Save, X, Plus, Trash2 } from 'lucide-react';
import type { WorkflowNode } from './NodeCanvas';
import { NODE_ICON_COLORS, PALETTE, type NodeType } from './NodePalette';

const CHAT_CHANNELS = [
  { id: 'slack', label: 'Slack' },
  { id: 'discord', label: 'Discord' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'signal', label: 'Signal' },
  { id: 'googlechat', label: 'Google Chat' },
  { id: 'irc', label: 'IRC' },
  { id: 'imessage', label: 'iMessage' },
];

const TRIGGER_SOURCES = [
  { id: 'github.pr.opened', label: 'GitHub PR Opened' },
  { id: 'github.pr.updated', label: 'GitHub PR Updated' },
  { id: 'github.pr.review_requested', label: 'GitHub PR Review Requested' },
  { id: 'chat.message', label: 'Chat Message' },
  { id: 'chat.mention', label: 'Chat Mention' },
  { id: 'chat.command', label: 'Chat Command' },
  { id: 'manual', label: 'Manual' },
  { id: 'webhook', label: 'Webhook' },
];

interface NodeSettingsProps {
  node: WorkflowNode | null;
  onUpdate: (id: string, config: Record<string, any>) => void;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">{children}</label>;
}

export function NodeSettings({ node, onUpdate }: NodeSettingsProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, any>>({});

  useEffect(() => {
    if (node) {
      setDraft({ ...node.config });
      setEditing(false);
    }
  }, [node?.id]);

  if (!node) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Settings className="h-4 w-4" /> Node Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto">
          <p className="text-sm text-muted-foreground">Select a node to configure it.</p>
        </CardContent>
      </Card>
    );
  }

  function set(key: string, value: any) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    if (!editing) setEditing(true);
  }

  function handleSave() {
    onUpdate(node!.id, draft);
    setEditing(false);
  }

  function handleCancel() {
    setDraft({ ...node!.config });
    setEditing(false);
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Settings className="h-4 w-4" /> Node Settings
          </CardTitle>
          <Badge variant="secondary">{node.type}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 flex-1 overflow-y-auto">
        {node.type === 'trigger' && (
          <>
            <FieldLabel>
              Source
              <Select value={draft.source || 'manual'} onChange={(e) => set('source', e.target.value)}>
                {TRIGGER_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            </FieldLabel>
            {(draft.source || '').startsWith('github.') && (
              <>
                <FieldLabel>Provider <Input value={draft.provider || 'github-mcp'} onChange={(e) => set('provider', e.target.value)} /></FieldLabel>
                <FieldLabel>Repository <Input value={draft.repo || ''} onChange={(e) => set('repo', e.target.value)} placeholder="owner/repo" /></FieldLabel>
                <FieldLabel>Branch <Input value={draft.branch || 'main'} onChange={(e) => set('branch', e.target.value)} /></FieldLabel>
              </>
            )}
            {(draft.source || '').startsWith('chat.') && (
              <>
                <FieldLabel>
                  Channel
                  <Select value={draft.channel || 'slack'} onChange={(e) => set('channel', e.target.value)}>
                    {CHAT_CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </Select>
                </FieldLabel>
                <FieldLabel>
                  Chat Type
                  <Select value={draft.chatType || 'group'} onChange={(e) => set('chatType', e.target.value)}>
                    <option value="group">Group</option>
                    <option value="direct">Direct</option>
                    <option value="all">All</option>
                  </Select>
                </FieldLabel>
                <FieldLabel>Match Text <Input value={draft.matchText || ''} onChange={(e) => set('matchText', e.target.value)} placeholder="/merge or #deploy" /></FieldLabel>
                <FieldLabel>From Users <Input value={draft.fromUsers || ''} onChange={(e) => set('fromUsers', e.target.value)} placeholder="user1, user2" /></FieldLabel>
              </>
            )}
          </>
        )}

        {node.type === 'agent' && (
          <>
            <FieldLabel>Agent Count (N-LLM) <Input type="number" min="1" max="10" value={draft.agentCount ?? 3} onChange={(e) => set('agentCount', Number(e.target.value))} /></FieldLabel>
            <FieldLabel>Model <Input value={draft.model || ''} onChange={(e) => set('model', e.target.value)} placeholder="gpt-4o-mini" /></FieldLabel>
            <FieldLabel>
              System Prompt
              <textarea
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[60px] resize-y"
                value={draft.systemPrompt || ''}
                onChange={(e) => set('systemPrompt', e.target.value)}
                placeholder="You are a strict code reviewer..."
                rows={3}
              />
            </FieldLabel>
            <FieldLabel>Persona Names <Input value={draft.personaNames || ''} onChange={(e) => set('personaNames', e.target.value)} placeholder="security-reviewer, perf-analyst, code-quality" /></FieldLabel>
            <FieldLabel>Temperature <Input type="number" step="0.1" min="0" max="2" value={draft.temperature ?? 0} onChange={(e) => set('temperature', Number(e.target.value))} /></FieldLabel>
            <FieldLabel>
              Tool Access
              <Select value={draft.toolAccess || 'restricted'} onChange={(e) => set('toolAccess', e.target.value)}>
                <option value="restricted">Restricted</option>
                <option value="full">Full</option>
              </Select>
            </FieldLabel>
            
            {node.type === 'agent' && (
              <div className="mt-4 pt-4 border-t space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reputation & Voting</div>
                <FieldLabel>
                  Voting Weight
                  <Input 
                    type="number" 
                    step="0.1" 
                    min="0" 
                    max="10" 
                    value={draft.votingWeight ?? 1.0} 
                    onChange={(e) => set('votingWeight', Number(e.target.value))} 
                  />
                </FieldLabel>
                <FieldLabel>
                  Reputation (View Only)
                  <Input 
                    value={draft.reputation ?? '0.95'} 
                    disabled 
                    className="bg-muted/50 cursor-not-allowed"
                  />
                </FieldLabel>
              </div>
            )}
          </>
        )}

        {node.type === 'guard' && (
          <>
            <FieldLabel>
              Guard Type
              <Select value={draft.guardType || 'code_merge'} onChange={(e) => set('guardType', e.target.value)}>
                <option value="code_merge">Code Merge</option>
                <option value="send_email">Send Email</option>
                <option value="publish">Publish</option>
                <option value="support_reply">Support Reply</option>
                <option value="agent_action">Agent Action</option>
                <option value="deployment">Deployment</option>
                <option value="permission_escalation">Permission Escalation</option>
              </Select>
            </FieldLabel>
            <FieldLabel>Quorum <Input type="number" step="0.01" min="0" max="1" value={draft.quorum ?? 0.7} onChange={(e) => set('quorum', Number(e.target.value))} /></FieldLabel>
            <FieldLabel>Risk Threshold <Input type="number" step="0.01" min="0" max="1" value={draft.riskThreshold ?? 0.7} onChange={(e) => set('riskThreshold', Number(e.target.value))} /></FieldLabel>
            <FieldLabel>HITL Threshold <Input type="number" step="0.01" min="0" max="1" value={draft.hitlThreshold ?? 0.7} onChange={(e) => set('hitlThreshold', Number(e.target.value))} /></FieldLabel>
            <FieldLabel>Number of Reviewers <Input type="number" min="1" max="20" value={draft.numberOfReviewers ?? 3} onChange={(e) => set('numberOfReviewers', Number(e.target.value))} /></FieldLabel>
          </>
        )}

        {node.type === 'hitl' && (
          <>
            <FieldLabel>
              Channel
              <Select value={draft.channel || 'slack'} onChange={(e) => set('channel', e.target.value)}>
                {CHAT_CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
            </FieldLabel>
            <FieldLabel>
              Prompt Mode
              <Select value={draft.promptMode || 'yes-no'} onChange={(e) => set('promptMode', e.target.value)}>
                <option value="yes-no">Yes / No</option>
                <option value="weighted-vote">Weighted Vote</option>
              </Select>
            </FieldLabel>
            <FieldLabel>Required Votes <Input type="number" min="1" max="50" value={draft.requiredVotes ?? 2} onChange={(e) => set('requiredVotes', Number(e.target.value))} /></FieldLabel>
            <FieldLabel>Timeout (sec) <Input type="number" value={draft.timeoutSec ?? 900} onChange={(e) => set('timeoutSec', Number(e.target.value))} /></FieldLabel>
          </>
        )}

        {node.type === 'action' && (
          <>
            <FieldLabel>Action <Input value={draft.action || ''} onChange={(e) => set('action', e.target.value)} placeholder="github.merge_pr" /></FieldLabel>
          </>
        )}

        {node.type === 'group' && (
          <GroupChildrenEditor groupChildren={draft.children || []} onChange={(children) => set('children', children)} />
        )}

        {editing && (
          <div className="flex gap-2 pt-2 border-t">
            <Button size="sm" onClick={handleSave} className="gap-1.5">
              <Save className="h-3.5 w-3.5" /> Save
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCancel} className="gap-1.5">
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const GROUP_CHILD_TYPES: { type: NodeType; label: string }[] = [
  { type: 'agent', label: 'Agent' },
  { type: 'guard', label: 'Guard' },
  { type: 'hitl', label: 'HITL' },
  { type: 'action', label: 'Action' },
];

function childDefaults(type: NodeType): Record<string, any> {
  if (type === 'agent') return { model: 'gpt-4o-mini', temperature: 0, agentCount: 3, personaNames: '', systemPrompt: '' };
  if (type === 'hitl') return { channel: 'slack', promptMode: 'yes-no', requiredVotes: 2, timeoutSec: 900 };
  if (type === 'guard') return { guardType: 'code_merge', quorum: 0.7, riskThreshold: 0.7 };
  return { action: 'noop' };
}

function GroupChildrenEditor({ groupChildren, onChange }: { groupChildren: any[]; onChange: (children: any[]) => void }) {
  const [addType, setAddType] = useState<NodeType>('agent');

  function addChild() {
    const id = `${addType}-${Date.now().toString(36)}`;
    const labels: Record<string, string> = { agent: 'Agent', guard: 'Guard', hitl: 'HITL', action: 'Action' };
    onChange([...groupChildren, { id, type: addType, label: labels[addType] || addType, config: childDefaults(addType) }]);
  }

  function removeChild(id: string) {
    onChange(groupChildren.filter((c: any) => c.id !== id));
  }

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium text-muted-foreground">Parallel Children ({groupChildren.length})</div>
      {groupChildren.map((child: any) => {
        const paletteItem = PALETTE.find((p) => p.type === child.type);
        const Icon = paletteItem?.icon;
        return (
          <div key={child.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border/50 bg-accent/20">
            {Icon && <Icon className={`h-3.5 w-3.5 shrink-0 ${NODE_ICON_COLORS[child.type as NodeType] || ''}`} />}
            <span className="text-xs flex-1 truncate">{child.label}</span>
            <Badge variant="outline" className="text-[10px]">{child.type}</Badge>
            <Button size="icon" variant="ghost" className="h-5 w-5 text-destructive" onClick={() => removeChild(child.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        );
      })}
      <div className="flex gap-2">
        <Select value={addType} onChange={(e) => setAddType(e.target.value as NodeType)} className="flex-1">
          {GROUP_CHILD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
        </Select>
        <Button size="sm" variant="outline" className="gap-1 h-8 text-xs" onClick={addChild}>
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">Click a child on the canvas to edit its settings individually.</p>
    </div>
  );
}
