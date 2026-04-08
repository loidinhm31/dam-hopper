import { FileCode } from "lucide-react";
import type { FsArborNode } from "@/api/fs-types.js";

interface EditorPlaceholderProps {
  openFile?: FsArborNode | null;
}

/**
 * Placeholder editor pane — Phase 04 replaces this with Monaco + tabs.
 */
export function EditorPlaceholder({ openFile }: EditorPlaceholderProps) {
  return (
    <div className="h-full flex flex-col glass-card">
      {/* Tab bar stub */}
      {openFile && (
        <div className="shrink-0 flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
          <FileCode className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
          <span className="text-xs text-[var(--color-text)]">{openFile.name}</span>
          <span className="ml-1 text-[10px] text-[var(--color-text-muted)]">(read-only preview — editor in Phase 04)</span>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--color-text-muted)]">
        <FileCode className="h-12 w-12 opacity-20" />
        <p className="text-sm font-medium opacity-40">
          {openFile ? openFile.id : "Select a file to open"}
        </p>
        <p className="text-xs opacity-25">Monaco editor arrives in Phase 04</p>
      </div>
    </div>
  );
}
