/**
 * DiffViewer — Monaco DiffEditor wrapper for git change review.
 *
 * Features:
 * - Side-by-side / inline toggle
 * - Per-hunk revert via Monaco's built-in gutter icons
 * - Prev/next hunk navigation (Alt+↑/↓)
 * - Save modified content back to disk via fsRead mtime → fsWriteFile (Ctrl+S)
 * - Handles new files (original = "") and deleted files (modified = "")
 *
 * Lazy-imported from WorkspacePage — monaco-setup workers already configured.
 */
import "@/lib/monaco-setup.js";
import { DiffEditor } from "@monaco-editor/react";
import type * as monacoNs from "monaco-editor";
import { useCallback, useRef, useState, useEffect } from "react";
import {
  X,
  SplitSquareHorizontal,
  AlignJustify,
  ChevronUp,
  ChevronDown,
  Save,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils.js";
import { useGitFileDiff, useGitCommitFileDiff } from "@/api/queries.js";
import { getTransport } from "@/api/transport.js";
import type { WsTransport } from "@/api/ws-transport.js";

function transport(): WsTransport {
  return getTransport() as WsTransport;
}

interface DiffViewerProps {
  project: string;
  filePath: string;
  fileStatus: string;
  additions: number;
  deletions: number;
  commitHash?: string;
  onClose: () => void;
}

type SaveState = "idle" | "saving" | "error";

function statusLabel(status: string): string {
  switch (status) {
    case "added": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    case "copied": return "C";
    case "conflicted": return "!";
    default: return "M";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "added": return "text-[var(--color-success,#4caf50)]";
    case "deleted": return "text-[var(--color-danger)]";
    case "conflicted": return "text-amber-400";
    default: return "text-[var(--color-primary)]";
  }
}

export function DiffViewer({
  project,
  filePath,
  fileStatus,
  additions,
  deletions,
  commitHash,
  onClose,
}: DiffViewerProps) {
  const localDiff = useGitFileDiff(project, commitHash ? "" : filePath);
  const commitDiff = useGitCommitFileDiff(project, commitHash ?? "", commitHash ? filePath : "");

  const { data, isLoading, isError } = commitHash ? commitDiff : localDiff;
  const [sideBySide, setSideBySide] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const diffEditorRef = useRef<monacoNs.editor.IStandaloneDiffEditor | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  // Saved model refs so we can dispose them ourselves (keepCurrentModels=true).
  const modelsRef = useRef<{
    original: monacoNs.editor.ITextModel | null;
    modified: monacoNs.editor.ITextModel | null;
  }>({ original: null, modified: null });
  // Snapshot of content at last load/save — source of truth for dirty detection.
  // Avoids false-dirty when data refetches between an edit and a save.
  const savedContentRef = useRef<string>("");
  const qc = useQueryClient();

  const isDeleted = fileStatus === "deleted";
  const isAdded = fileStatus === "added";

  // Reset state when file selection changes
  useEffect(() => {
    setIsDirty(false);
    setSaveState("idle");
    setSaveError(null);
  }, [filePath]);

  // Auto-dismiss save error after 5 s
  useEffect(() => {
    if (saveState !== "error") return;
    const t = setTimeout(() => {
      setSaveState("idle");
      setSaveError(null);
    }, 5_000);
    return () => clearTimeout(t);
  }, [saveState]);

  // Keyboard shortcuts: Alt+↑/↓ for hunk nav, Ctrl+S for save
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.altKey && e.key === "ArrowUp") {
        e.preventDefault();
        navigateHunk("prev");
      } else if (e.altKey && e.key === "ArrowDown") {
        e.preventDefault();
        navigateHunk("next");
      } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isDirty, saveState]); // re-bind when save eligibility changes

  // Dispose models and ResizeObserver when the component unmounts.
  // keepCurrentModels=true prevents @monaco-editor/react from disposing models that
  // Monaco's DiffEditorWidget may have already disposed, which causes the
  // "TextModel got disposed before DiffEditorWidget model got reset" crash.
  useEffect(() => {
    return () => {
      const editor = diffEditorRef.current;
      if (editor) {
        (editor as unknown as { _roCleanup?: () => void })._roCleanup?.();
      }
      // Defer model disposal so Monaco's own editor cleanup runs first.
      const { original, modified } = modelsRef.current;
      requestAnimationFrame(() => {
        if (original && !original.isDisposed()) original.dispose();
        if (modified && !modified.isDisposed()) modified.dispose();
      });
    };
  }, []);

  const handleMount = useCallback(
    (editor: monacoNs.editor.IStandaloneDiffEditor) => {
      diffEditorRef.current = editor;
      const modifiedEditor = editor.getModifiedEditor();

      // Save model refs for manual disposal on unmount.
      const model = editor.getModel();
      if (model) {
        modelsRef.current.original = model.original;
        modelsRef.current.modified = model.modified;
      }

      // Update model refs if they change (e.g. via props)
      editor.onDidChangeModel(() => {
        const newModel = editor.getModel();
        if (newModel) {
          modelsRef.current.original = newModel.original;
          modelsRef.current.modified = newModel.modified;
        }
      });

      // Capture baseline on mount — this is the working-copy content from the API
      savedContentRef.current = modifiedEditor.getValue();

      modifiedEditor.onDidChangeModelContent(() => {
        const current = modifiedEditor.getValue();
        setIsDirty(current !== savedContentRef.current);
      });

      // Manual ResizeObserver layout instead of automaticLayout polling.
      const container = editorContainerRef.current;
      if (container) {
        const ro = new ResizeObserver(() => { editor.layout(); });
        ro.observe(container);
        (editor as unknown as { _roCleanup?: () => void })._roCleanup = () => ro.disconnect();
      }
    },
    [],
  );

  function navigateHunk(direction: "prev" | "next") {
    const editor = diffEditorRef.current;
    if (!editor) return;
    const changes = editor.getLineChanges();
    if (!changes || changes.length === 0) return;
    const modEditor = editor.getModifiedEditor();
    const pos = modEditor.getPosition();
    const currentLine = pos?.lineNumber ?? 0;

    let target: monacoNs.editor.ILineChange | undefined;
    if (direction === "next") {
      target = changes.find((c) => {
        const line = c.modifiedStartLineNumber || c.modifiedEndLineNumber;
        return line > currentLine;
      });
      if (!target) target = changes[0]; // wrap around
    } else {
      const before = [...changes].reverse().find((c) => {
        const line = c.modifiedStartLineNumber || c.modifiedEndLineNumber;
        return line < currentLine;
      });
      target = before ?? changes[changes.length - 1]; // wrap around
    }

    if (!target) return;
    const line = target.modifiedStartLineNumber || target.modifiedEndLineNumber;
    if (!line) return;
    modEditor.revealLineInCenter(line, 0);
    modEditor.setPosition({ lineNumber: line, column: 1 });
    modEditor.focus();
  }

  async function handleSave() {
    const editor = diffEditorRef.current;
    if (!editor || !isDirty || saveState === "saving") return;
    const content = editor.getModifiedEditor().getValue();
    setSaveState("saving");
    setSaveError(null);
    try {
      // Stat the file to get current mtime — server rejects stale writes
      const readResult = await transport().fsRead(project, filePath, { offset: 0, len: 0 });
      if (!readResult.ok && readResult.code !== "TOO_LARGE") {
        throw new Error((readResult as { message?: string }).message ?? "Failed to read file");
      }
      const mtime = (readResult as { mtime: number }).mtime;
      const writeResult = await transport().fsWriteFile(project, filePath, content, mtime);
      if (!writeResult.ok) {
        if ("conflict" in writeResult && writeResult.conflict) {
          throw new Error("File modified externally — reload the diff");
        }
        throw new Error(("error" in writeResult ? writeResult.error : undefined) ?? "Write failed");
      }
      // Update snapshot so dirty state resets correctly
      savedContentRef.current = content;
      setSaveState("idle");
      setIsDirty(false);
      void qc.invalidateQueries({ queryKey: ["git-diff", project] });
      void qc.invalidateQueries({ queryKey: ["git-file-diff", project, filePath] });
    } catch (e) {
      setSaveState("error");
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  const fileName = filePath.split("/").pop() ?? filePath;
  const dirPath = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)] glass-card">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading diff…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-[var(--color-danger)] glass-card">
        <AlertTriangle className="h-4 w-4" />
        Failed to load diff
      </div>
    );
  }

  if (data.isBinary) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-[var(--color-text-muted)] glass-card">
        Binary file — diff not available
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col glass-card overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        {/* File status badge */}
        <span className={cn("text-[11px] font-bold shrink-0", statusColor(fileStatus))}>
          {statusLabel(fileStatus)}
        </span>

        {/* File path */}
        <div className="flex items-baseline gap-1 min-w-0 flex-1">
          {dirPath && (
            <span className="text-[11px] text-[var(--color-text-muted)] truncate">{dirPath}/</span>
          )}
          <span className="text-[11px] font-semibold text-[var(--color-text)] truncate">{fileName}</span>
        </div>

        {/* Diff stats */}
        {(additions > 0 || deletions > 0) && (
          <div className="shrink-0 flex items-center gap-1.5 text-[10px] font-mono">
            {additions > 0 && (
              <span className="text-[var(--color-success,#4caf50)]">+{additions}</span>
            )}
            {deletions > 0 && (
              <span className="text-[var(--color-danger)]">-{deletions}</span>
            )}
          </div>
        )}

        <div className="shrink-0 flex items-center gap-0.5">
          {/* Hunk navigation */}
          <button
            onClick={() => navigateHunk("prev")}
            title="Previous hunk (Alt+↑)"
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => navigateHunk("next")}
            title="Next hunk (Alt+↓)"
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>

          {/* View toggle */}
          <button
            onClick={() => setSideBySide((v) => !v)}
            title={sideBySide ? "Switch to inline view" : "Switch to side-by-side"}
            className={cn(
              "p-1 rounded transition-colors",
              sideBySide
                ? "text-[var(--color-primary)] bg-[var(--color-primary)]/10"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]",
            )}
          >
            {sideBySide ? (
              <SplitSquareHorizontal className="h-3.5 w-3.5" />
            ) : (
              <AlignJustify className="h-3.5 w-3.5" />
            )}
          </button>

          {/* Save — hidden for deleted files or historical commits */}
          {!isDeleted && !commitHash && (
            <button
              onClick={() => void handleSave()}
              disabled={!isDirty || saveState === "saving"}
              title="Save to disk (Ctrl+S)"
              className={cn(
                "p-1 rounded transition-colors",
                isDirty && saveState !== "saving"
                  ? "text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10"
                  : "text-[var(--color-text-muted)] opacity-40 cursor-not-allowed",
              )}
            >
              {saveState === "saving" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
            </button>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            title="Close diff viewer"
            className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Save error banner — auto-dismisses after 5 s */}
      {saveState === "error" && saveError && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20 text-[var(--color-danger)] text-[11px]">
          <span>{saveError}</span>
          <button
            onClick={() => { setSaveState("idle"); setSaveError(null); }}
            className="opacity-60 hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Monaco DiffEditor */}
      <div ref={editorContainerRef} className="flex-1 min-h-0 overflow-hidden">
        <DiffEditor
          height="100%"
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          original={data.original ?? ""}
          modified={isDeleted ? "" : (data.modified ?? "")}
          language={data.language}
          theme="vs-dark"
          onMount={handleMount}
          options={{
            renderSideBySide: sideBySide,
            originalEditable: false,
            readOnly: isDeleted || isAdded || !!commitHash,
            renderMarginRevertIcon: !commitHash,
            hideUnchangedRegions: { enabled: false },
            diffAlgorithm: "advanced",
            fontSize: 13,
            fontFamily: "JetBrains Mono, Fira Code, Cascadia Code, monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            lineNumbers: "on",
            wordWrap: "off",
            renderValidationDecorations: "off",
          }}
        />
      </div>
    </div>
  );
}
