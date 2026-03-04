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
import { GripVertical, Trash2, ChevronRight, Layers, Shield } from 'lucide-react';
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

function NodeContent({ node, isSelected, onSelect, onDelete, compact, width }: { node: WorkflowNode; isSelected: boolean; onSelect: (id: string) => void; onDelete: (id: string) => void; compact?: boolean; width?: number }) {
  const paletteItem = PALETTE.find((p) => p.type === node.type);
  const Icon = paletteItem?.icon;

  const showLabel = !compact || (node.type === 'agent' && width && width > 80);

  return (
    <div
      className={cn(
        'group relative flex transition-all cursor-pointer rounded-lg border px-3',
        compact ? 'py-2 flex-1 min-w-0 flex-col items-center justify-center text-center' : 'flex-row items-center gap-2 py-2.5',
        NODE_COLORS[node.type] || 'border-border/50 bg-card',
        isSelected && 'ring-1 ring-primary',
      )}
      onClick={(e) => { e.stopPropagation(); onSelect(node.id); }}
    >
      {Icon && <Icon className={cn('h-4 w-4 shrink-0', NODE_ICON_COLORS[node.type] || 'text-muted-foreground', compact && 'mb-1')} />}

      {showLabel && (
        <div className={cn('min-w-0', compact ? 'w-full' : 'flex-1')}>
          <div className={cn('font-medium text-sm', compact ? 'break-words leading-tight' : 'truncate')}>{node.label}</div>
          {!compact && (
            <div className="text-xs text-muted-foreground truncate uppercase">
              <span>{node.type === 'hitl' ? 'human approval' : node.type}</span>
            </div>
          )}
        </div>
      )}

      {!compact && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.id);
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

interface SortableNodeProps {
  node: WorkflowNode;
  isSelected: boolean;
  selectedId: string | null;
  isLast: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function SortableNode({ node, isSelected, selectedId, isLast, onSelect, onDelete, hideDelete }: SortableNodeProps & { hideDelete?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id });
  const [containerWidth, setContainerWidth] = React.useState(0);
  const resizeRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!resizeRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(resizeRef.current);
    return () => observer.disconnect();
  }, []);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (node.type === 'group') {
    const children: WorkflowNode[] = Array.isArray(node.config?.children) ? node.config.children : [];
    const childWidth = children.length > 0 ? (containerWidth - 16 - (children.length - 1) * 8) / children.length : 0;

    return (
      <>
        <div
          ref={(node) => {
            setNodeRef(node);
            (resizeRef as any).current = node;
          }}
          style={style}
          className={cn(
            'rounded-lg border-2 border-dashed transition-all',
            'border-cyan-500/30 bg-cyan-500/5',
            isSelected && 'ring-1 ring-primary',
            isDragging && 'opacity-50 z-50'
          )}
        >
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-cyan-500/20">
            <button
              className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <Layers className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-xs font-medium text-cyan-400">{node.label}</span>
            <span className="text-[10px] text-muted-foreground ml-auto">{children.length} parallel</span>
            {!hideDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(node.id);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
          <div className="flex gap-2 p-2">
            {children.map((child) => (
              <NodeContent
                key={child.id}
                node={child}
                isSelected={selectedId === child.id}
                onSelect={onSelect}
                onDelete={onDelete}
                compact
                width={childWidth}
              />
            ))}
            {children.length === 0 && (
              <div className="flex-1 flex items-center justify-center py-4 text-xs text-muted-foreground border border-dashed rounded-md">
                No children — configure in settings
              </div>
            )}
          </div>
        </div>

        {!isLast && (
          <div className="flex justify-center py-0.5">
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 rotate-90" />
          </div>
        )}
      </>
    );
  }

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
          <div className="text-xs text-muted-foreground truncate uppercase">
            <span>{node.type === 'hitl' ? 'human approval' : node.type}</span>
          </div>
        </div>

        {!hideDelete && (
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
        )}
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

  // Grouping logic for "Decision Firewall"
  const renderedItems: React.ReactNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const nextNode = nodes[i + 1];

    if (node.type === 'guard' && nextNode?.type === 'group' && nextNode.config?.linkedGuardId === node.id) {
      // It's a firewall pair
      renderedItems.push(
        <React.Fragment key={`firewall-${node.id}`}>
          <div className="p-3 border-2 border-emerald-500/20 bg-emerald-500/[0.02] rounded-xl space-y-2 relative group/firewall">
            <div className="flex items-center justify-between mb-1 px-1">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-500" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500/80">Decision Firewall</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/firewall:opacity-100 transition-opacity"
                onClick={() => {
                  onDelete(node.id);
                  onDelete(nextNode.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <SortableNode
              node={node}
              isSelected={selectedId === node.id}
              selectedId={selectedId}
              isLast={false}
              onSelect={onSelect}
              onDelete={onDelete}
              hideDelete
            />
            <SortableNode
              node={nextNode}
              isSelected={selectedId === nextNode.id}
              selectedId={selectedId}
              isLast={true}
              onSelect={onSelect}
              onDelete={onDelete}
              hideDelete
            />
          </div>
          {i + 1 < nodes.length - 1 && (
            <div className="flex justify-center py-0.5">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 rotate-90" />
            </div>
          )}
        </React.Fragment>
      );
      i++; // Skip next node
    } else {
      renderedItems.push(
        <SortableNode
          key={node.id}
          node={node}
          isSelected={selectedId === node.id}
          selectedId={selectedId}
          isLast={i === nodes.length - 1}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      );
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
        <CardTitle>Flow Canvas</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto scrollbar-custom">
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
                {renderedItems}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
    </Card>
  );
}
