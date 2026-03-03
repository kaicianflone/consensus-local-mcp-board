import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { NodePalette, type NodeType } from '../components/workflow/NodePalette';
import { NodeCanvas, type WorkflowNode } from '../components/workflow/NodeCanvas';
import { NodeSettings } from '../components/workflow/NodeSettings';
import { EventTimeline } from '../components/workflow/EventTimeline';
import { AgentsPanel } from '../components/agents/AgentsPanel';
import {
  getWorkflows, getWorkflow, createWorkflow, updateWorkflow,
  runWorkflow, approveWorkflowRun
} from '../lib/api';
import {
  Play, Save, FolderOpen, Plus, ChevronDown,
  CheckCircle, Clock, AlertTriangle, LayoutGrid
} from 'lucide-react';

function defaults(type: NodeType): Record<string, any> {
  if (type === 'agent') return { model: 'gpt-4o-mini', temperature: 0, toolAccess: 'restricted' };
  if (type === 'guard') return { guardType: 'code_merge', quorum: 0.7, riskThreshold: 0.7, hitlThreshold: 0.7, policyBinding: 'explicit', assignedAgents: ['default-agent'], weights: { security: 0.5, reliability: 0.3, performance: 0.2 } };
  if (type === 'hitl') return { channel: 'slack', promptMode: 'yes-no', timeoutSec: 900, weightMode: 'weighted', requiredVotes: 2 };
  if (type === 'trigger') return { source: 'github.pr.opened', provider: 'github-mcp', repo: '', branch: 'main', channel: 'slack', chatType: 'group', matchText: '', fromUsers: '' };
  return { action: 'noop' };
}

const STATUS_ICON: Record<string, React.ElementType> = {
  COMPLETED: CheckCircle,
  WAITING_HUMAN: Clock,
  FAILED: AlertTriangle,
};

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: 'text-emerald-400',
  WAITING_HUMAN: 'text-amber-400',
  FAILED: 'text-destructive',
};

export default function WorkflowsDashboard() {
  const [name, setName] = useState('workflow-1');
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [saved, setSaved] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [boardId] = useState('workflow-system');
  const [showSaved, setShowSaved] = useState(false);

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) || null, [nodes, selectedId]);

  async function refreshList() {
    try {
      const d = await getWorkflows();
      const items = d.workflows || [];
      setSaved(items);
      if (!workflowId && items.length) {
        await loadWorkflow(items[0].id);
      }
    } catch {}
  }

  useEffect(() => { refreshList(); }, []);

  async function loadWorkflow(id: string) {
    const d = await getWorkflow(id);
    const def = JSON.parse(d.workflow.definition_json || '{}');
    setWorkflowId(id);
    setName(d.workflow.name);
    setNodes(def.nodes || []);
    setRuns(d.runs || []);
    setSelectedId(null);
    setShowSaved(false);
  }

  function addNode(type: NodeType) {
    const id = `${type}-${Date.now().toString(36)}`;
    const labels: Record<NodeType, string> = {
      trigger: 'Trigger',
      agent: 'Agent (ai-sdk)',
      guard: 'Guard (consensus)',
      hitl: 'HITL (chat-sdk)',
      action: 'Action',
    };
    setNodes((prev) => [...prev, { id, type, label: labels[type], config: defaults(type) }]);
    setSelectedId(id);
  }

  function deleteNode(id: string) {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function handleUpdateConfig(id: string, config: Record<string, any>) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, config } : n)));
  }

  async function saveWorkflow() {
    const definition = { boardId, nodes };
    if (!workflowId) {
      const out = await createWorkflow(name, definition);
      setWorkflowId(out.workflow.id);
    } else {
      await updateWorkflow(workflowId, { name, definition });
    }
    await refreshList();
  }

  async function executeWorkflow() {
    if (!workflowId) return;
    await runWorkflow(workflowId);
    await loadWorkflow(workflowId);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const type = e.dataTransfer.getData('node-type') as NodeType;
    if (!type) return;
    addNode(type);
  }

  return (
    <div className="mx-auto max-w-screen-2xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <LayoutGrid className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold">Workflow Dashboard</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workflow name"
            className="w-48 h-8 text-sm"
          />
          <Button size="sm" variant="outline" onClick={saveWorkflow} className="gap-1.5">
            <Save className="h-3.5 w-3.5" /> Save
          </Button>
          <Button size="sm" onClick={executeWorkflow} disabled={!workflowId} className="gap-1.5">
            <Play className="h-3.5 w-3.5" /> Run
          </Button>
          <div className="relative">
            <Button size="sm" variant="outline" onClick={() => setShowSaved(!showSaved)} className="gap-1.5">
              <FolderOpen className="h-3.5 w-3.5" /> Load
              <ChevronDown className="h-3 w-3" />
            </Button>
            {showSaved && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-card border rounded-lg shadow-lg z-30 py-1">
                {saved.map((w: any) => (
                  <button
                    key={w.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors truncate"
                    onClick={() => loadWorkflow(w.id)}
                  >
                    {w.name}
                  </button>
                ))}
                {!saved.length && <div className="px-3 py-2 text-sm text-muted-foreground">No saved workflows</div>}
              </div>
            )}
          </div>
          {workflowId && (
            <Badge variant="secondary" className="text-xs">
              {workflowId}
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-2">
          <NodePalette onAdd={addNode} />
        </div>

        <div className="lg:col-span-4">
          <NodeCanvas
            nodes={nodes}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDelete={deleteNode}
            onReorder={setNodes}
            onDrop={onDrop}
          />
        </div>

        <div className="lg:col-span-3">
          <NodeSettings node={selected} onUpdate={handleUpdateConfig} />
        </div>

        <div className="lg:col-span-3">
          <EventTimeline />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Play className="h-4 w-4" /> Workflow Runs
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!runs.length && (
                <p className="text-sm text-muted-foreground py-4 text-center">No runs yet. Save and run your workflow.</p>
              )}
              <div className="space-y-2">
                {runs.map((r: any) => {
                  const StatusIcon = STATUS_ICON[r.status] || Clock;
                  const statusColor = STATUS_COLOR[r.status] || 'text-muted-foreground';
                  return (
                    <div key={r.id} className="flex items-center justify-between gap-2 py-2 px-3 rounded-md border border-border/50 hover:bg-accent/30 transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <StatusIcon className={`h-4 w-4 shrink-0 ${statusColor}`} />
                        <Badge variant="outline" className="text-[10px] shrink-0">{r.status}</Badge>
                        <Badge variant="secondary" className="text-[10px] shrink-0">{r.engine || 'local'}</Badge>
                        <Link to={`/boards/run/${r.run_id}`} className="text-sm text-primary hover:underline truncate">
                          {r.run_id}
                        </Link>
                      </div>
                      {r.status === 'WAITING_HUMAN' && (
                        <div className="flex gap-1.5 shrink-0">
                          <Button
                            size="sm"
                            className="h-6 text-xs"
                            onClick={async () => { await approveWorkflowRun(r.run_id, 'YES', 'human'); await loadWorkflow(workflowId!); }}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-6 text-xs"
                            onClick={async () => { await approveWorkflowRun(r.run_id, 'NO', 'human'); await loadWorkflow(workflowId!); }}
                          >
                            Block
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-6">
          <AgentsPanel boardId={boardId} />
        </div>
      </div>
    </div>
  );
}
