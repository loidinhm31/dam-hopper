import { X, FileCode } from "lucide-react";
import { cn } from "@/lib/utils.js";

interface EditorTabProps {
  name: string;
  active: boolean;
  dirty: boolean;
  onClick: () => void;
  onClose: () => void;
}

export function EditorTab({ name, active, dirty, onClick, onClose }: EditorTabProps) {
  return (
    <div
      role="tab"
      aria-selected={active}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1 text-xs cursor-pointer select-none shrink-0",
        "border-r border-[var(--color-border)] transition-colors",
        active
          ? "bg-[var(--color-surface)] text-[var(--color-text)] border-b-2 border-b-[var(--color-primary)]"
          : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]",
      )}
      onClick={onClick}
    >
      <FileCode className="h-3.5 w-3.5 shrink-0" />
      <span className="max-w-[140px] truncate">{name}</span>
      {dirty && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)] shrink-0"
          title="Unsaved changes"
        />
      )}
      <button
        type="button"
        className={cn(
          "ml-0.5 rounded-sm p-0.5 shrink-0 transition-colors",
          "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
        )}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={`Close ${name}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
