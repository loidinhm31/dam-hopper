import type { ReactNode } from "react";
import { Plus, ListFilter } from "lucide-react";
import type {
  ItemDto,
  ItemKind,
  ItemOverviewNodeDto,
  ItemStatus,
  NoteDto,
} from "@/api/workflow-dto-types.js";
import { Button } from "@/components/atoms/Button.js";
import { flattenOverviewNodes } from "@/api/workflow-selectors.js";
import { WorkflowItemRow } from "./WorkflowItemRow.js";
import { WorkflowSelectedItemBar } from "./WorkflowSelectedItemBar.js";

export interface WorkflowItemListProps {
  plans: ItemOverviewNodeDto[];
  standaloneTasks: ItemOverviewNodeDto[];
  selectedItemId?: string | null;
  onSelectItem: (item: ItemDto | null) => void;
  onStatusChange?: (item: ItemDto, status: ItemStatus) => void;
  onAddNote?: (itemId: string, noteBody: string) => void;
  onDeleteNote?: (note: NoteDto) => Promise<unknown> | void;
  onStartSession?: (itemId: string) => void;
  onDeleteItem?: (item: ItemDto) => void;
  onEditItem?: (
    item: ItemDto,
    updates: { title?: string; summary?: string | null },
  ) => Promise<unknown> | void;
  onOpenQuickCapture?: (kind?: ItemKind, parentId?: string | null) => void;
  emptyState?: ReactNode;
}

export function WorkflowItemList({
  plans,
  standaloneTasks,
  selectedItemId,
  onSelectItem,
  onStatusChange,
  onAddNote,
  onDeleteNote,
  onStartSession,
  onDeleteItem,
  onEditItem,
  onOpenQuickCapture,
  emptyState,
}: WorkflowItemListProps) {
  const allEmpty = plans.length === 0 && standaloneTasks.length === 0;
  const allNodes = flattenOverviewNodes([...plans, ...standaloneTasks]);
  const selectedNode = allNodes.find((n) => n.item.id === selectedItemId);

  const renderNodes = (nodes: ItemOverviewNodeDto[], depth = 0): ReactNode => {
    return nodes.map((node) => (
      <div key={node.item.id} className="flex flex-col gap-0.5">
        <WorkflowItemRow
          node={node}
          depth={depth}
          isSelected={selectedItemId === node.item.id}
          onSelect={(item) => onSelectItem(selectedItemId === item.id ? null : item)}
          onStatusChange={onStatusChange}
        />
        {node.children && node.children.length > 0 && renderNodes(node.children, depth + 1)}
      </div>
    ));
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden text-xs">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--color-text)]">
          <ListFilter className="h-4 w-4 text-[var(--color-primary)]" />
          <span>Plans & Tasks</span>
        </div>
        {onOpenQuickCapture && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => onOpenQuickCapture("plan", null)}
            className="h-7 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            New Plan
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        {allEmpty ? (
          emptyState ?? (
            <div className="flex flex-col items-center justify-center p-6 text-center text-xs text-[var(--color-text-muted)]">
              <p>No plans or tasks tracked yet.</p>
              {onOpenQuickCapture && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenQuickCapture("plan", null)}
                  className="mt-3"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create First Plan
                </Button>
              )}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-2">
            {plans.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Plans ({plans.length})
                </span>
                {renderNodes(plans, 0)}
              </div>
            )}

            {standaloneTasks.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  Standalone Tasks ({standaloneTasks.length})
                </span>
                {renderNodes(standaloneTasks, 0)}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedNode && (
        <WorkflowSelectedItemBar
          selectedNode={selectedNode}
          onStatusChange={onStatusChange}
          onAddNote={onAddNote}
          onDeleteNote={onDeleteNote}
          onStartSession={onStartSession}
          onDeleteItem={onDeleteItem}
          onEditItem={onEditItem}
          onOpenQuickCapture={onOpenQuickCapture}
        />
      )}
    </div>
  );
}
