import React, { useMemo, useState } from 'react';

type NodeType = 'trigger' | 'agent' | 'guard' | 'hitl' | 'action';

type WorkflowNode = {
  id: string;
  type: NodeType;
  label: string;
  config: Record<string, any>;
};

const PALETTE: { type: NodeType; label: string }[] = [
  { type: 'trigger', label: 'Trigger' },
  { type: 'agent', label: 'Agent (ai-sdk)' },
  { type: 'guard', label: 'Guard (consensus)' },
  { type: 'hitl', label: 'HITL (chat-sdk)' },
  { type: 'action', label: 'Action' }
];

function defaults(type: NodeType) {
  if (type === 'agent') return { model: 'gpt-4o-mini', temperature: 0, toolAccess: 'restricted' };
  if (type === 'guard') return { guardType: 'code_merge', quorum: 0.7, riskThreshold: 0.7, hitlThreshold: 0.7, assignedAgents: ['default-agent'], weights: { security: 0.5, reliability: 0.3, performance: 0.2 } };
  if (type === 'hitl') return { channel: 'whatsapp', promptMode: 'yes-no', timeoutSec: 900 };
  if (type === 'trigger') return { mode: 'manual' };
  return { action: 'noop' };
}

export default function WorkflowsPage() {
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) || null, [nodes, selectedId]);

  function addNode(type: NodeType) {
    const id = `${type}-${Date.now().toString(36)}`;
    setNodes((prev) => [...prev, { id, type, label: PALETTE.find((p) => p.type === type)?.label || type, config: defaults(type) }]);
    setSelectedId(id);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const type = e.dataTransfer.getData('node-type') as NodeType;
    if (!type) return;
    addNode(type);
  }

  function updateConfig(key: string, value: any) {
    if (!selected) return;
    setNodes((prev) => prev.map((n) => (n.id === selected.id ? { ...n, config: { ...n.config, [key]: value } } : n)));
  }

  return (
    <div className='container'>
      <div className='row' style={{ justifyContent: 'space-between' }}>
        <h2>Workflows</h2>
        <div className='small'>Drag nodes into canvas. Runs will map to workflow observability timelines.</div>
      </div>

      <div className='grid workflows'>
        <div className='card'>
          <h3>Palette</h3>
          {PALETTE.map((p) => (
            <div
              key={p.type}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('node-type', p.type)}
              className='card node-item'
              onClick={() => addNode(p.type)}
            >
              {p.label}
            </div>
          ))}
        </div>

        <div className='card canvas' onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
          <h3>Canvas</h3>
          {!nodes.length && <p className='small'>Drop nodes here to build your flow.</p>}
          {nodes.map((n) => (
            <button key={n.id} className={`node-chip ${selectedId === n.id ? 'active' : ''}`} onClick={() => setSelectedId(n.id)}>
              {n.label}
            </button>
          ))}
        </div>

        <div className='card'>
          <h3>Node Settings</h3>
          {!selected && <p className='small'>Select a node to edit.</p>}
          {selected && (
            <>
              <div className='small'>Type: {selected.type}</div>
              {selected.type === 'guard' && (
                <div className='stack'>
                  <label>Guard Type <input value={selected.config.guardType} onChange={(e) => updateConfig('guardType', e.target.value)} /></label>
                  <label>Quorum <input type='number' step='0.01' value={selected.config.quorum} onChange={(e) => updateConfig('quorum', Number(e.target.value))} /></label>
                  <label>Risk Threshold <input type='number' step='0.01' value={selected.config.riskThreshold} onChange={(e) => updateConfig('riskThreshold', Number(e.target.value))} /></label>
                  <label>HITL Threshold <input type='number' step='0.01' value={selected.config.hitlThreshold} onChange={(e) => updateConfig('hitlThreshold', Number(e.target.value))} /></label>
                  <label>Assigned Agents <input value={selected.config.assignedAgents.join(',')} onChange={(e) => updateConfig('assignedAgents', e.target.value.split(',').map((s:string) => s.trim()).filter(Boolean))} /></label>
                </div>
              )}
              {selected.type === 'agent' && (
                <div className='stack'>
                  <label>Model <input value={selected.config.model} onChange={(e) => updateConfig('model', e.target.value)} /></label>
                  <label>Temperature <input type='number' step='0.1' value={selected.config.temperature} onChange={(e) => updateConfig('temperature', Number(e.target.value))} /></label>
                </div>
              )}
              {selected.type === 'hitl' && (
                <div className='stack'>
                  <label>Channel <input value={selected.config.channel} onChange={(e) => updateConfig('channel', e.target.value)} /></label>
                  <label>Timeout (sec) <input type='number' value={selected.config.timeoutSec} onChange={(e) => updateConfig('timeoutSec', Number(e.target.value))} /></label>
                </div>
              )}

              <h4>Config JSON</h4>
              <pre>{JSON.stringify(selected.config, null, 2)}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
