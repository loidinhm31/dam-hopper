import { useState } from "react";
import { CornerDownRight, Play, StickyNote, Trash2 } from "lucide-react";
import type { ItemDto, ItemKind, ItemOverviewNodeDto, ItemStatus } from "@/api/workflow-dto-types.js";
import { Button } from "@/components/atoms/Button.js";
import { Input } from "@/components/ui/Input.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";

export interface WorkflowSelectedItemBarProps {
  selectedNode: ItemOverviewNodeDto;
  onStatusChange?: (item: ItemDto, status: ItemStatus) => void;
  onAddNote?: (itemId: string, noteBody: string) => void;
  onStartSession?: (itemId: string) => void;
  onDeleteItem?: (item: ItemDto) => void;
  onOpenQuickCapture?: (kind?: ItemKind, parentId?: string | null) => void;
}

export function WorkflowSelectedItemBar({
  selectedNode,
  onStatusChange,
  onAddNote,
  onStartSession,
  onDeleteItem,
  onOpenQuickCapture,
}: WorkflowSelectedItemBarProps) {
  const [newNoteBody, setNewNoteBody] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);

  const handleAddNoteSubmit = () => {
    if (!newNoteBody.trim()) return;
    onAddNote?.(selectedNode.item.id, newNoteBody.trim());
    setNewNoteBody("");
    setIsAddingNote(false);
  };

  return (
    <div className="flex shrink-0 flex-col gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="truncate font-semibold text-[var(--color-text)]">
          Selected: {selectedNode.item.title}
        </span>
        {onDeleteItem && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDeleteItem(selectedNode.item)}
            className="h-6 w-6 p-0 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15"
            title="Delete item"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {onStatusChange && (
          <Select
            value={selectedNode.item.status}
            onValueChange={(val) => onStatusChange(selectedNode.item, val as ItemStatus)}
          >
            <SelectTrigger className="h-7 text-xs w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="backlog">Backlog</SelectItem>
              <SelectItem value="next">Next</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="done">Done</SelectItem>
              <SelectItem value="canceled">Canceled</SelectItem>
            </SelectContent>
          </Select>
        )}

        {onStartSession && (
          <Button type="button" variant="secondary" size="sm" onClick={() => onStartSession(selectedNode.item.id)} className="h-7 text-xs">
            <Play className="h-3 w-3" />
            Session
          </Button>
        )}

        {onOpenQuickCapture && selectedNode.item.kind !== "task" && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onOpenQuickCapture(selectedNode.item.kind === "plan" ? "phase" : "task", selectedNode.item.id)}
            className="h-7 text-xs"
          >
            <CornerDownRight className="h-3 w-3" />
            Child
          </Button>
        )}

        {onAddNote && !isAddingNote && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setIsAddingNote(true)} className="h-7 text-xs ml-auto">
            <StickyNote className="h-3 w-3" />
            Note
          </Button>
        )}
      </div>

      {isAddingNote && (
        <div className="flex items-center gap-1.5 pt-1">
          <Input
            value={newNoteBody}
            onChange={(e) => setNewNoteBody(e.target.value)}
            placeholder="Next action or note..."
            className="h-7 text-xs"
            autoFocus
          />
          <Button type="button" variant="primary" size="sm" onClick={handleAddNoteSubmit} className="h-7 text-xs">
            Add
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setIsAddingNote(false)} className="h-7 text-xs">
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
