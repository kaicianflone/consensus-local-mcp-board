import React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { PALETTE, NODE_COLORS, NODE_ICON_COLORS, type NodeType } from './NodePalette';
import { cn } from '../../lib/utils';

export type WorkflowNode = {
  id: string;
  type: NodeType;
  label: string;
  config: Record<string, any>;
};

interface SortableNodeProps {
  node: WorkflowNode;
  isSelected: boolean;
  isLast: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function SortableNode({ node, isSelected, isLast, onSelect, onDelete }: SortableNodeProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const paletteItem = PALETTE.find((p) => p.type === node.type);
  const Icon = paletteItem?.icon;

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'group relative flex items-center gap-2 rounded-lg border px-3 py-2.5 transition-all cursor-pointer',
          NODE_COLORS[node.type],
          isSelected && 'ring-1 ring-primary',
          isDragging && 'opacity-50 z-50'
        )}
        onClick={() => onSelect(node.id)}
      >
        <button
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {Icon && <Icon className={cn('h-4 w-4 shrink-0', NODE_ICON_COLORS[node.type])} />}

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{node.label}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span>{node.type}</span>
            {node.type === 'agent' && node.config?.model && (
              <span className="text-blue-400/80">{node.config.model}</span>
            )}
          </div>
          {node.type === 'agent' && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {node.config?.agentCount && (
                <span className="inline-flex items-center rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
                  {node.config.agentCount} agents
                </span>
              )}
              <span className="inline-flex items-center rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400/70">
                {node.config?.personaMode === 'manual' ? 'manual personas' : 'auto personas'}
              </span>
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.id);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {!isLast && (
        <div className="flex justify-center py-0.5">
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 rotate-90" />
        </div>
      )}
    </>
  );
}

interface NodeCanvasProps {
  nodes: WorkflowNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (nodes: WorkflowNode[]) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
}

export function NodeCanvas({ nodes, selectedId, onSelect, onDelete, onReorder, onDrop }: NodeCanvasProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = nodes.findIndex((n) => n.id === active.id);
      const newIndex = nodes.findIndex((n) => n.id === over.id);
      onReorder(arrayMove(nodes, oldIndex, newIndex));
    }
  }

  return (
    <Card
      className="min-h-[300px] h-full flex flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        e.currentTarget.classList.add('drag-over');
      }}
      onDragLeave={(e) => e.currentTarget.classList.remove('drag-over')}
      onDrop={(e) => {
        e.currentTarget.classList.remove('drag-over');
        onDrop(e);
      }}
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Flow Canvas</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto">
        {!nodes.length && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border border-dashed rounded-lg">
            <p className="text-sm">Drop nodes here or click from palette</p>
            <p className="text-xs mt-1">Build your workflow by adding nodes</p>
          </div>
        )}
        {nodes.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={nodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-0">
                {nodes.map((node, i) => (
                  <SortableNode
                    key={node.id}
                    node={node}
                    isSelected={selectedId === node.id}
                    isLast={i === nodes.length - 1}
                    onSelect={onSelect}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
    </Card>
  );
}
