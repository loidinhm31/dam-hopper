import { useState, useCallback, type DragEvent, type ReactNode } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils.js";
import type { UploadProgress } from "@/hooks/useFsUpload.js";

interface Props {
  children: ReactNode;
  onDrop: (dir: string, files: File[]) => void;
  /** Current directory for dropped files (relative path from project root). */
  currentDir: string;
  progress: UploadProgress | null;
  className?: string;
}

/**
 * Wraps the file tree panel with drag-and-drop upload support.
 * A hidden file input enables click-triggered upload from the context menu.
 */
export function UploadDropzone({ children, onDrop, currentDir, progress, className }: Props) {
  const [dragging, setDragging] = useState(false);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onDrop(currentDir, files);
    },
    [currentDir, onDrop],
  );

  return (
    <div
      className={cn("relative h-full flex flex-col", className)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}

      {/* Drag overlay */}
      {dragging && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-sm border-2 border-dashed border-[var(--color-primary)] bg-[var(--color-primary)]/10 pointer-events-none">
          <Upload className="h-6 w-6 text-[var(--color-primary)]" />
          <span className="text-xs text-[var(--color-primary)] font-medium">Drop to upload</span>
        </div>
      )}

      {/* Upload progress bar */}
      {progress && !progress.done && (
        <div className="absolute bottom-0 left-0 right-0 z-10 bg-[var(--color-surface)] border-t border-[var(--color-border)] px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-[var(--color-text-muted)] truncate max-w-[140px]">
              {progress.filename}
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)]">{progress.pct}%</span>
          </div>
          <div className="h-1 bg-[var(--color-surface-2)] rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--color-primary)] transition-all duration-100"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Upload error toast */}
      {progress?.done && progress.error && (
        <div className="absolute bottom-2 left-2 right-2 z-10 rounded px-2 py-1.5 text-[10px] text-[var(--color-danger)] bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 truncate">
          Upload failed: {progress.error}
        </div>
      )}
    </div>
  );
}
