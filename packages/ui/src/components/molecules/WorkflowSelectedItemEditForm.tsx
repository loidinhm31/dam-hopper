import { useState } from "react";
import { Button } from "@/components/atoms/Button.js";
import { Input } from "@/components/ui/Input.js";
import { Label } from "@/components/ui/Label.js";
import { Textarea } from "@/components/ui/Textarea.js";

export interface WorkflowSelectedItemEditFormProps {
  initialTitle: string;
  initialSummary?: string | null;
  onSave: (updates: { title: string; summary: string | null }) => void;
  onCancel: () => void;
}

/**
 * Compact inline edit form for editing a selected workflow item's title and summary.
 */
export function WorkflowSelectedItemEditForm({
  initialTitle,
  initialSummary,
  onSave,
  onCancel,
}: WorkflowSelectedItemEditFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [summary, setSummary] = useState(initialSummary ?? "");

  const handleSave = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const trimmedSummary = summary.trim();
    onSave({
      title: trimmedTitle,
      summary: trimmedSummary ? trimmedSummary : null,
    });
  };

  return (
    <div className="flex flex-col gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="wf-edit-title" className="text-[11px]">
          Title *
        </Label>
        <Input
          id="wf-edit-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Item title..."
          className="h-7 text-xs"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSave();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="wf-edit-summary" className="text-[11px]">
          Summary
        </Label>
        <Textarea
          id="wf-edit-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Optional summary..."
          className="min-h-[48px] text-xs resize-y"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleSave();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        />
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-6 text-xs px-2"
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={!title.trim()}
          className="h-6 text-xs px-2.5"
        >
          Save
        </Button>
      </div>
    </div>
  );
}
