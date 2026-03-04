import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from '../ui/dialog';
import {
  Play, Save, FilePlus, FolderOpen, Pencil, Copy,
  ChevronDown, Check, X, Workflow
} from 'lucide-react';

interface WorkflowToolbarProps {
  name: string;
  workflowId: string | null;
  saved: any[];
  onNameChange: (name: string) => void;
  onSave: () => Promise<void>;
  onSaveAs: (newName: string) => Promise<void>;
  onNew: () => void;
  onRun: () => Promise<void>;
  onLoad: (id: string) => Promise<void>;
}

export function WorkflowToolbar({
  name, workflowId, saved,
  onNameChange, onSave, onSaveAs, onNew, onRun, onLoad,
}: WorkflowToolbarProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(name);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');
  const [showLoad, setShowLoad] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const loadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renaming]);

  useEffect(() => {
    setRenameValue(name);
  }, [name]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (loadRef.current && !loadRef.current.contains(e.target as Node)) {
        setShowLoad(false);
      }
    }
    if (showLoad) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showLoad]);

  function handleRenameConfirm() {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== name) {
      onNameChange(trimmed);
    }
    setRenaming(false);
  }

  function handleRenameKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleRenameConfirm();
    if (e.key === 'Escape') { setRenameValue(name); setRenaming(false); }
  }

  async function handleSaveAs() {
    const trimmed = saveAsName.trim();
    if (!trimmed) return;
    await onSaveAs(trimmed);
    setShowSaveAs(false);
    setSaveAsName('');
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
        <div className="flex items-center gap-3 min-w-0">
          <Workflow className="h-4 w-4 text-primary shrink-0" />

          {renaming ? (
            <div className="flex items-center gap-1.5">
              <Input
                ref={renameRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={handleRenameConfirm}
                className="h-7 w-52 text-sm"
              />
              <Button size="icon" variant="ghost" className="h-7 w-7 text-primary" onClick={handleRenameConfirm}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setRenameValue(name); setRenaming(false); }}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <button
              className="group flex items-center gap-2 min-w-0 hover:text-primary transition-colors"
              onClick={() => setRenaming(true)}
            >
              <span className="font-medium text-sm truncate max-w-[240px]">{name}</span>
              <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          )}

          {workflowId && (
            <Badge variant="outline" className="text-[10px] font-mono shrink-0 hidden sm:inline-flex">
              {workflowId.slice(0, 12)}...
            </Badge>
          )}
          {!workflowId && (
            <Badge variant="secondary" className="text-[10px] shrink-0">unsaved</Badge>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 h-7 text-xs"
            onClick={onNew}
          >
            <FilePlus className="h-3.5 w-3.5" /> New
          </Button>

          <Separator orientation="vertical" className="h-5 mx-0.5" />

          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 h-7 text-xs"
            onClick={onSave}
          >
            <Save className="h-3.5 w-3.5" /> Save
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 h-7 text-xs"
            onClick={() => { setSaveAsName(name + ' (copy)'); setShowSaveAs(true); }}
          >
            <Copy className="h-3.5 w-3.5" /> Save As
          </Button>

          <Separator orientation="vertical" className="h-5 mx-0.5" />

          <div className="relative" ref={loadRef}>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 h-7 text-xs"
              onClick={() => setShowLoad(!showLoad)}
            >
              <FolderOpen className="h-3.5 w-3.5" /> Open
              <ChevronDown className="h-3 w-3" />
            </Button>

            {showLoad && (
              <div className="absolute right-0 top-full mt-1 w-72 bg-card border rounded-lg shadow-xl z-40 py-1 max-h-64 overflow-y-auto">
                <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Saved Workflows
                </div>
                {saved.map((w: any) => (
                  <button
                    key={w.id}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between gap-2 ${w.id === workflowId ? 'bg-accent/50' : ''}`}
                    onClick={() => onLoad(w.id)}
                  >
                    <span className="truncate">{w.name}</span>
                    {w.id === workflowId && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </button>
                ))}
                {!saved.length && (
                  <div className="px-3 py-3 text-sm text-muted-foreground text-center">
                    No saved workflows yet
                  </div>
                )}
              </div>
            )}
          </div>

          <Separator orientation="vertical" className="h-5 mx-0.5" />

          <Button
            size="sm"
            className="gap-1.5 h-7 text-xs"
            onClick={onRun}
            disabled={!workflowId}
          >
            <Play className="h-3.5 w-3.5" /> Run
          </Button>
        </div>
      </div>

      <Dialog open={showSaveAs} onOpenChange={setShowSaveAs}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Workflow As</DialogTitle>
            <DialogDescription>Create a new copy of this workflow with a different name.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Workflow Name</span>
              <Input
                value={saveAsName}
                onChange={(e) => setSaveAsName(e.target.value)}
                placeholder="My workflow"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveAs(); }}
                autoFocus
              />
            </label>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowSaveAs(false)}>Cancel</Button>
              <Button onClick={handleSaveAs} disabled={!saveAsName.trim()} className="gap-1.5">
                <Copy className="h-4 w-4" /> Save Copy
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
