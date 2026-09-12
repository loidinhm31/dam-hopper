import { Trash2 } from "lucide-react";
import type { NoteDto } from "@/api/workflow-dto-types.js";
import { Button } from "@/components/atoms/Button.js";

export interface WorkflowSelectedItemNotesListProps {
  notes: NoteDto[];
  onDeleteNote?: (note: NoteDto) => void;
}

/**
 * Scrollable list of existing notes on a selected workflow item.
 */
export function WorkflowSelectedItemNotesList({
  notes,
  onDeleteNote,
}: WorkflowSelectedItemNotesListProps) {
  if (notes.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 pt-1 border-t border-[var(--color-border)]/60">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
        Notes ({notes.length})
      </span>
      <div className="flex max-h-[100px] flex-col gap-1 overflow-y-auto pr-0.5">
        {notes.map((note) => (
          <div
            key={note.id}
            className="group/note flex items-start justify-between gap-1.5 rounded bg-[var(--color-surface)]/70 px-2 py-1 border border-[var(--color-border)]/40 text-[11px]"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="whitespace-pre-wrap break-words text-[11px] text-[var(--color-text)]">
                {note.body}
              </span>
              <time dateTime={note.createdAt} className="text-[9px] text-[var(--color-text-muted)]">
                {new Date(note.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </time>
            </div>
            {onDeleteNote && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onDeleteNote(note)}
                className="h-5 w-5 p-0 shrink-0 opacity-80 hover:opacity-100 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
                title="Delete note"
                aria-label="Delete note"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
