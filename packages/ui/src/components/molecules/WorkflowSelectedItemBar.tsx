import { useState } from "react";
import { CornerDownRight, Pencil, Play, StickyNote, Trash2 } from "lucide-react";
import type { ItemDto, ItemKind, ItemOverviewNodeDto, ItemStatus, NoteDto } from "@/api/workflow-dto-types.js";
import { Button } from "@/components/atoms/Button.js";
import { Textarea } from "@/components/ui/Textarea.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select.js";
import { WorkflowSelectedItemEditForm } from "./WorkflowSelectedItemEditForm.js";
import { WorkflowSelectedItemNotesList } from "./WorkflowSelectedItemNotesList.js";

export interface WorkflowSelectedItemBarProps {
  selectedNode: ItemOverviewNodeDto;
  onStatusChange?: (item: ItemDto, status: ItemStatus) => void;
  onAddNote?: (itemId: string, noteBody: string) => void;
  onDeleteNote?: (note: NoteDto) => void;
  onStartSession?: (itemId: string) => void;
  onDeleteItem?: (item: ItemDto) => void;
  onEditItem?: (item: ItemDto, updates: { title?: string; summary?: string | null }) => void;
  onOpenQuickCapture?: (kind?: ItemKind, parentId?: string | null) => void;
}

export function WorkflowSelectedItemBar({
  selectedNode, onStatusChange, onAddNote, onDeleteNote,
  onStartSession, onDeleteItem, onEditItem, onOpenQuickCapture,
}: WorkflowSelectedItemBarProps) {
  const [newNoteBody, setNewNoteBody] = useState("");
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [isEditingItem, setIsEditingItem] = useState(false);

  const handleAddNoteSubmit = () => {
    if (!newNoteBody.trim()) return;
    onAddNote?.(selectedNode.item.id, newNoteBody.trim());
    setNewNoteBody("");
    setIsAddingNote(false);
  };

  return (
    <div className="flex shrink-0 flex-col gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-2 text-xs">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate font-semibold text-[var(--color-text)]">
          Selected: {selectedNode.item.title}
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          {onEditItem && !isEditingItem && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsAddingNote(false);
                setIsEditingItem(true);
              }}
              className="h-6 w-6 p-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              title="Edit item"
              aria-label="Edit item"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {onDeleteItem && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDeleteItem(selectedNode.item)}
              className="h-6 w-6 p-0 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15"
              title="Delete item"
              aria-label="Delete item"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {isEditingItem && (
        <WorkflowSelectedItemEditForm
          key={selectedNode.item.id}
          initialTitle={selectedNode.item.title}
          initialSummary={selectedNode.item.summary}
          onSave={(updates) => {
            onEditItem?.(selectedNode.item, updates);
            setIsEditingItem(false);
          }}
          onCancel={() => setIsEditingItem(false)}
        />
      )}

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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setIsEditingItem(false);
              setIsAddingNote(true);
            }}
            className="h-7 text-xs ml-auto"
          >
            <StickyNote className="h-3 w-3" />
            Note
          </Button>
        )}
      </div>

      {isAddingNote && (
        <div className="flex flex-col gap-1.5 pt-1">
          <Textarea
            value={newNoteBody}
            onChange={(e) => setNewNoteBody(e.target.value)}
            placeholder="Next action or note..."
            aria-label="Note content"
            className="min-h-[52px] text-xs resize-y"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleAddNoteSubmit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setIsAddingNote(false);
              }
            }}
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsAddingNote(false)}
              className="h-6 text-xs px-2"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleAddNoteSubmit}
              disabled={!newNoteBody.trim()}
              className="h-6 text-xs px-2.5"
            >
              Add
            </Button>
          </div>
        </div>
      )}

      <WorkflowSelectedItemNotesList
        notes={selectedNode.notes}
        onDeleteNote={onDeleteNote}
      />
    </div>
  );
}
