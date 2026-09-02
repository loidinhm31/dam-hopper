import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import type { ProjectTargetRef } from "@/api/client.js";
import type { ItemKind, ItemStatus } from "@/api/workflow-dto-types.js";
import { Button } from "@/components/atoms/Button.js";
import { Input } from "@/components/ui/Input.js";
import { Label } from "@/components/ui/Label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";

export interface WorkflowQuickCaptureProps {
  target: ProjectTargetRef;
  parentOptions?: Array<{ id: string; title: string; kind: ItemKind }>;
  initialParentId?: string | null;
  initialKind?: ItemKind;
  onSubmit: (item: {
    target: ProjectTargetRef;
    kind: ItemKind;
    title: string;
    summary?: string;
    status: ItemStatus;
    parentId?: string | null;
    startSessionImmediately?: boolean;
  }) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
}

export function WorkflowQuickCapture({
  target,
  parentOptions = [],
  initialParentId = null,
  initialKind = "plan",
  onSubmit,
  onCancel,
  isSubmitting = false,
}: WorkflowQuickCaptureProps) {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [kind, setKind] = useState<ItemKind>(initialKind);
  const [status, setStatus] = useState<ItemStatus>("backlog");
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [startSession, setStartSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required");
      return;
    }
    setError(null);
    try {
      await onSubmit({
        target,
        kind,
        title: trimmedTitle,
        summary: summary.trim() || undefined,
        status,
        parentId: parentId || null,
        startSessionImmediately: startSession,
      });
      setTitle("");
      setSummary("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create item");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs shadow-sm"
      aria-label="Create workflow item"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[var(--color-text)]">
          {kind === "plan" ? "New Plan" : kind === "phase" ? "New Phase" : "New Task"}
        </span>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} aria-label="Cancel" className="h-6 w-6 p-0">
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {error && <div className="rounded bg-[var(--color-danger)]/15 px-2 py-1 text-[var(--color-danger)]">{error}</div>}

      <div className="flex flex-col gap-1">
        <Label htmlFor="wf-cap-title" className="text-xs">Title *</Label>
        <Input
          id="wf-cap-title"
          placeholder="e.g. Authentication and profile refactor"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={isSubmitting}
          autoFocus
          className="h-8 text-xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="wf-cap-kind" className="text-xs">Kind</Label>
          <Select value={kind} onValueChange={(val) => setKind(val as ItemKind)} disabled={isSubmitting}>
            <SelectTrigger id="wf-cap-kind" className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="plan">Plan</SelectItem>
              <SelectItem value="phase">Phase</SelectItem>
              <SelectItem value="task">Task</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="wf-cap-status" className="text-xs">Status</Label>
          <Select value={status} onValueChange={(val) => setStatus(val as ItemStatus)} disabled={isSubmitting}>
            <SelectTrigger id="wf-cap-status" className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="backlog">Backlog</SelectItem>
              <SelectItem value="next">Next</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {parentOptions.length > 0 && kind !== "plan" && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="wf-cap-parent" className="text-xs">Parent</Label>
          <Select value={parentId ?? "none"} onValueChange={(val) => setParentId(val === "none" ? null : val)} disabled={isSubmitting}>
            <SelectTrigger id="wf-cap-parent" className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None (Standalone)</SelectItem>
              {parentOptions.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>{opt.kind}: {opt.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="wf-cap-summary" className="text-xs">Summary</Label>
        <Input
          id="wf-cap-summary"
          placeholder="Brief note (optional)"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          disabled={isSubmitting}
          className="h-8 text-xs"
        />
      </div>

      <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] cursor-pointer">
        <input
          type="checkbox"
          checked={startSession}
          onChange={(e) => setStartSession(e.target.checked)}
          disabled={isSubmitting}
          className="rounded border-[var(--color-border)]"
        />
        Start session immediately
      </label>

      <div className="flex items-center justify-end gap-2 pt-1">
        {onCancel && <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>}
        <Button type="submit" variant="primary" size="sm" loading={isSubmitting}>
          <Plus className="h-3.5 w-3.5" />
          Create
        </Button>
      </div>
    </form>
  );
}
