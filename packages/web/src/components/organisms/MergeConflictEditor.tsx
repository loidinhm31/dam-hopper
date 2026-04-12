/**
 * MergeConflictEditor — 3-panel merge conflict resolution editor.
 *
 * Layout: Theirs (readonly) | Result (editable) | Ours (readonly)
 *
 * Conflict regions are parsed from the workdir conflict-marked content.
 * Accept theirs/ours does a targeted model edit in the result editor.
 * Mark Resolved → POST /api/git/:project/resolve.
 *
 * Lazy-imported from WorkspacePage.
 */
import "@/lib/monaco-setup.js";
import { Editor, type OnMount } from "@monaco-editor/react";
import type * as monacoNs from "monaco-editor";
import { useCallback, useEffect, useRef, useState, useMemo, useInsertionEffect } from "react";
import {
  X,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  GitMerge,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useGitConflicts, useGitFileDiff, useGitResolve } from "@/api/queries.js";
import {
  parseConflictRegions,
  acceptConflict,
  hasRemainingConflicts,
  hasMalformedConflicts,
  type ConflictRegion,
} from "@/lib/conflict-parser.js";

// Inject decoration CSS once — Monaco class names aren't Tailwind-aware
const CONFLICT_STYLES = `
.mc-conflict-marker { background: rgba(239, 68, 68, 0.15); }
.mc-conflict-ours   { background: rgba(34, 197, 94, 0.10); }
.mc-conflict-theirs { background: rgba(59, 130, 246, 0.10); }
.mc-conflict-sep    { background: rgba(245, 158, 11, 0.20); }
`;

function useConflictStyles() {
  useInsertionEffect(() => {
    const id = "mc-conflict-styles";
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id = id;
    el.textContent = CONFLICT_STYLES;
    document.head.appendChild(el);
  }, []);
}

interface Props {
  project: string;
  filePath: string;
  fileLanguage?: string;
  onClose: () => void;
  onResolved: () => void;
}

function buildDecorations(
  regions: ConflictRegion[],
  monaco: typeof monacoNs,
): monacoNs.editor.IModelDeltaDecoration[] {
  const dec: monacoNs.editor.IModelDeltaDecoration[] = [];

  for (const r of regions) {
    // <<<<<< marker line
    dec.push({
      range: new monaco.Range(r.startLine, 1, r.startLine, 1),
      options: { isWholeLine: true, className: "mc-conflict-marker", stickiness: 1 },
    });
    // ours lines
    if (r.separatorLine > r.startLine + 1) {
      dec.push({
        range: new monaco.Range(r.startLine + 1, 1, r.separatorLine - 1, 1),
        options: { isWholeLine: true, className: "mc-conflict-ours", stickiness: 1 },
      });
    }
    // ======= separator
    dec.push({
      range: new monaco.Range(r.separatorLine, 1, r.separatorLine, 1),
      options: { isWholeLine: true, className: "mc-conflict-sep", stickiness: 1 },
    });
    // theirs lines
    if (r.endLine > r.separatorLine + 1) {
      dec.push({
        range: new monaco.Range(r.separatorLine + 1, 1, r.endLine - 1, 1),
        options: { isWholeLine: true, className: "mc-conflict-theirs", stickiness: 1 },
      });
    }
    // >>>>>>> marker line
    dec.push({
      range: new monaco.Range(r.endLine, 1, r.endLine, 1),
      options: { isWholeLine: true, className: "mc-conflict-marker", stickiness: 1 },
    });
  }

  return dec;
}

export function MergeConflictEditor({
  project,
  filePath,
  fileLanguage,
  onClose,
  onResolved,
}: Props) {
  useConflictStyles();

  const { data: conflicts, isLoading: conflictsLoading } = useGitConflicts(project);
  const { data: fileDiff, isLoading: diffLoading } = useGitFileDiff(project, filePath);
  const resolveMutation = useGitResolve(project);

  const conflictFile = conflicts?.find((c) => c.path === filePath);

  // Workdir content with conflict markers — from fileDiff.modified
  const workdirContent = fileDiff?.modified ?? "";
  const language = fileLanguage ?? fileDiff?.language ?? "plaintext";

  const [resolveError, setResolveError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [selectedConflict, setSelectedConflict] = useState(0);

  // Track current result content for conflict region parsing
  const [resultContent, setResultContent] = useState<string>("");
  const resultContentRef = useRef<string>("");

  // Initialize result content when workdir content loads
  const initialized = useRef(false);
  useEffect(() => {
    if (workdirContent && !initialized.current) {
      initialized.current = true;
      resultContentRef.current = workdirContent;
      setResultContent(workdirContent);
    }
  }, [workdirContent]);

  // Reset when file changes
  useEffect(() => {
    initialized.current = false;
    setResultContent("");
    resultContentRef.current = "";
    setResolveError(null);
    setSelectedConflict(0);
  }, [filePath]);

  const conflictRegions = useMemo(
    () => parseConflictRegions(resultContent),
    [resultContent],
  );

  const allResolved = resultContent !== "" && !hasRemainingConflicts(resultContent);
  const isMalformed = resultContent !== "" && hasMalformedConflicts(resultContent);

  // ── Editor refs ──────────────────────────────────────────────────────────────

  const theirsEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const resultEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const oursEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const modelsRef = useRef<{
    theirs: monacoNs.editor.ITextModel | null;
    result: monacoNs.editor.ITextModel | null;
    ours: monacoNs.editor.ITextModel | null;
  }>({ theirs: null, result: null, ours: null });
  const monacoRef = useRef<typeof monacoNs | null>(null);
  const isSyncing = useRef(false);
  const decorationCollection = useRef<monacoNs.editor.IEditorDecorationsCollection | null>(null);

  const syncScroll = useCallback((scrollTop: number) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    theirsEditorRef.current?.setScrollTop(scrollTop);
    resultEditorRef.current?.setScrollTop(scrollTop);
    oursEditorRef.current?.setScrollTop(scrollTop);
    isSyncing.current = false;
  }, []);

  function attachResizeObserver(editor: monacoNs.editor.IStandaloneCodeEditor) {
    const container = editor.getDomNode()?.parentElement;
    if (!container) return;
    const ro = new ResizeObserver(() => { editor.layout(); });
    ro.observe(container);
    (editor as unknown as { _roCleanup?: () => void })._roCleanup = () => ro.disconnect();
  }

  useEffect(() => {
    return () => {
      for (const ref of [theirsEditorRef, resultEditorRef, oursEditorRef]) {
        (ref.current as unknown as { _roCleanup?: () => void } | null)?._roCleanup?.();
      }
      // Defer model disposal so Monaco's own editor cleanup runs first.
      const { theirs, result, ours } = modelsRef.current;
      requestAnimationFrame(() => {
        if (theirs && !theirs.isDisposed()) theirs.dispose();
        if (result && !result.isDisposed()) result.dispose();
        if (ours && !ours.isDisposed()) ours.dispose();
      });
    };
  }, []);

  const handleTheirsMount: OnMount = useCallback((editor, monaco) => {
    theirsEditorRef.current = editor;
    modelsRef.current.theirs = editor.getModel();
    editor.onDidChangeModel(() => { modelsRef.current.theirs = editor.getModel(); });

    if (!monacoRef.current) monacoRef.current = monaco;
    editor.onDidScrollChange((e) => {
      if (!isSyncing.current) syncScroll(e.scrollTop);
    });
    attachResizeObserver(editor);
  }, [syncScroll]);

  const handleResultMount: OnMount = useCallback((editor, monaco) => {
    resultEditorRef.current = editor;
    modelsRef.current.result = editor.getModel();
    editor.onDidChangeModel(() => { modelsRef.current.result = editor.getModel(); });

    if (!monacoRef.current) monacoRef.current = monaco;

    // Track content changes
    editor.onDidChangeModelContent(() => {
      const value = editor.getValue();
      resultContentRef.current = value;
      setResultContent(value);
    });

    editor.onDidScrollChange((e) => {
      if (!isSyncing.current) syncScroll(e.scrollTop);
    });
    attachResizeObserver(editor);
  }, [syncScroll]);

  const handleOursMount: OnMount = useCallback((editor, monaco) => {
    oursEditorRef.current = editor;
    modelsRef.current.ours = editor.getModel();
    editor.onDidChangeModel(() => { modelsRef.current.ours = editor.getModel(); });

    if (!monacoRef.current) monacoRef.current = monaco;
    editor.onDidScrollChange((e) => {
      if (!isSyncing.current) syncScroll(e.scrollTop);
    });
    attachResizeObserver(editor);
  }, [syncScroll]);

  // Apply decorations to result editor when conflict regions change
  useEffect(() => {
    const editor = resultEditorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const decs = buildDecorations(conflictRegions, monaco);
    if (decorationCollection.current) {
      decorationCollection.current.set(decs);
    } else {
      decorationCollection.current = editor.createDecorationsCollection(decs);
    }
  }, [conflictRegions]);

  // Cleanup Monaco references on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      decorationCollection.current?.clear();
      decorationCollection.current = null;
      theirsEditorRef.current = null;
      resultEditorRef.current = null;
      oursEditorRef.current = null;
      monacoRef.current = null;
    };
  }, []);

  // ── Conflict navigation ──────────────────────────────────────────────────────

  function navigateToConflict(index: number) {
    const regions = parseConflictRegions(resultContentRef.current);
    const region = regions[index];
    if (!region) return;
    setSelectedConflict(index);
    resultEditorRef.current?.revealLineInCenter(region.startLine);
    resultEditorRef.current?.setPosition({ lineNumber: region.startLine, column: 1 });
    resultEditorRef.current?.focus();
  }

  // ── Accept actions ───────────────────────────────────────────────────────────

  function applyAccept(regionIndex: number, side: "ours" | "theirs") {
    const regions = parseConflictRegions(resultContentRef.current);
    const region = regions[regionIndex];
    if (!region) return;

    const next = acceptConflict(resultContentRef.current, region, side);
    resultContentRef.current = next;

    // Use applyEdits to replace full content — preserves cursor position and undo stack
    const editor = resultEditorRef.current;
    if (editor) {
      const model = editor.getModel();
      if (model) {
        model.applyEdits([{ range: model.getFullModelRange(), text: next }]);
        // Navigate to the next unresolved conflict
        const newRegions = parseConflictRegions(next);
        const nextConflict = newRegions[regionIndex] ?? newRegions[regionIndex - 1];
        if (nextConflict) {
          editor.revealLineInCenter(nextConflict.startLine);
          setSelectedConflict(Math.min(regionIndex, newRegions.length - 1));
        } else {
          setSelectedConflict(0);
        }
      }
    }
    setResultContent(next);
  }

  function acceptAll(side: "ours" | "theirs") {
    let content = resultContentRef.current;
    // Accept from last to first to preserve line numbers for earlier conflicts
    const regions = parseConflictRegions(content);
    for (let i = regions.length - 1; i >= 0; i--) {
      content = acceptConflict(content, regions[i], side);
    }
    resultContentRef.current = content;
    const model = resultEditorRef.current?.getModel();
    if (model) {
      model.applyEdits([{ range: model.getFullModelRange(), text: content }]);
    }
    setSelectedConflict(0);
    setResultContent(content);
  }

  // ── Resolve ──────────────────────────────────────────────────────────────────

  async function handleMarkResolved() {
    if (!allResolved) return;
    setIsResolving(true);
    setResolveError(null);
    try {
      await resolveMutation.mutateAsync({ path: filePath, content: resultContentRef.current });
      onResolved();
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : "Resolve failed");
    } finally {
      setIsResolving(false);
    }
  }

  // ── Loading / error states ───────────────────────────────────────────────────

  const isLoading = conflictsLoading || diffLoading;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)] glass-card">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading conflict data…
      </div>
    );
  }

  if (!conflictFile || workdirContent === "") {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-[var(--color-danger)] glass-card">
        <AlertTriangle className="h-4 w-4" />
        No conflict data for {filePath}
      </div>
    );
  }

  const fileName = filePath.split("/").pop() ?? filePath;
  const dirPath = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";

  const editorOptions: monacoNs.editor.IStandaloneEditorConstructionOptions = {
    fontSize: 12,
    fontFamily: "JetBrains Mono, Fira Code, Cascadia Code, monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    lineNumbers: "on",
    wordWrap: "off",
    theme: "vs-dark",
    scrollbar: { vertical: "visible", horizontal: "auto" },
    renderValidationDecorations: "off",
  };

  return (
    <div className="h-full flex flex-col glass-card overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <GitMerge className="h-3.5 w-3.5 text-amber-400 shrink-0" />

        <div className="flex items-baseline gap-1 min-w-0 flex-1">
          {dirPath && (
            <span className="text-[11px] text-[var(--color-text-muted)] truncate">{dirPath}/</span>
          )}
          <span className="text-[11px] font-semibold text-[var(--color-text)] truncate">{fileName}</span>
          <span className="text-[10px] text-amber-400 shrink-0 ml-1">
            {conflictRegions.length > 0
              ? `${conflictRegions.length} conflict${conflictRegions.length > 1 ? "s" : ""}`
              : allResolved
              ? "resolved"
              : ""}
          </span>
        </div>

        {/* Bulk actions */}
        <div className="shrink-0 flex items-center gap-1">
          <button
            onClick={() => acceptAll("theirs")}
            disabled={conflictRegions.length === 0}
            title="Accept all incoming (theirs)"
            className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-blue-400 hover:border-blue-400/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            All Theirs
          </button>
          <button
            onClick={() => acceptAll("ours")}
            disabled={conflictRegions.length === 0}
            title="Accept all current (ours)"
            className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-green-400 hover:border-green-400/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            All Ours
          </button>
          <button
            onClick={() => void handleMarkResolved()}
            disabled={!allResolved || isResolving}
            title={allResolved ? "Write resolved content and stage file" : "Resolve all conflicts first"}
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1",
              allResolved && !isResolving
                ? "border-[var(--color-success,#4caf50)]/40 text-[var(--color-success,#4caf50)] hover:bg-[var(--color-success,#4caf50)]/10"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] opacity-40 cursor-not-allowed",
            )}
          >
            {isResolving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3 w-3" />
            )}
            Mark Resolved
          </button>
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Resolve error */}
      {resolveError && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20 text-[var(--color-danger)] text-[11px]">
          <span>{resolveError}</span>
          <button onClick={() => setResolveError(null)}>
            <X className="h-3 w-3 opacity-60 hover:opacity-100" />
          </button>
        </div>
      )}

      {/* Malformed conflict warning */}
      {isMalformed && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-amber-400/10 border-b border-amber-400/20 text-amber-400 text-[11px]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Malformed conflict markers detected — some conflict blocks may not display correctly. Manual editing recommended.
        </div>
      )}

      {/* Panel headers */}
      <div className="shrink-0 grid grid-cols-3 border-b border-[var(--color-border)] text-[10px] font-medium">
        <div className="px-3 py-1 text-blue-400 border-r border-[var(--color-border)] bg-blue-400/5">
          Theirs (incoming)
        </div>
        <div className="px-3 py-1 text-amber-400 border-r border-[var(--color-border)] bg-amber-400/5">
          Result (editable)
        </div>
        <div className="px-3 py-1 text-green-400 bg-green-400/5">
          Ours (current)
        </div>
      </div>

      {/* 3 editors */}
      <div className="flex-1 min-h-0 grid grid-cols-3 divide-x divide-[var(--color-border)]">
        {/* Theirs */}
        <Editor
          height="100%"
          keepCurrentModel
          value={conflictFile.theirs ?? ""}
          language={language}
          theme="vs-dark"
          options={{ ...editorOptions, readOnly: true }}
          onMount={handleTheirsMount}
        />

        {/* Result (editable, workdir content) */}
        <Editor
          height="100%"
          keepCurrentModel
          defaultValue={workdirContent}
          language={language}
          theme="vs-dark"
          options={editorOptions}
          onMount={handleResultMount}
        />

        {/* Ours */}
        <Editor
          height="100%"
          keepCurrentModel
          value={conflictFile.ours ?? ""}
          language={language}
          theme="vs-dark"
          options={{ ...editorOptions, readOnly: true }}
          onMount={handleOursMount}
        />
      </div>

      {/* Conflict navigation strip */}
      {conflictRegions.length > 0 && (
        <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]">
          <div className="flex items-center gap-1 px-2 py-1 overflow-x-auto">
            <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 mr-1">
              Conflicts:
            </span>

            {conflictRegions.map((region, i) => (
              <ConflictBlock
                key={region.startLine}
                index={i}
                isSelected={selectedConflict === i}
                onNavigate={() => navigateToConflict(i)}
                onAcceptOurs={() => applyAccept(i, "ours")}
                onAcceptTheirs={() => applyAccept(i, "theirs")}
              />
            ))}

            <div className="ml-auto shrink-0 flex items-center gap-1">
              <button
                onClick={() => navigateToConflict(Math.max(0, selectedConflict - 1))}
                disabled={selectedConflict === 0}
                className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => navigateToConflict(Math.min(conflictRegions.length - 1, selectedConflict + 1))}
                disabled={selectedConflict >= conflictRegions.length - 1}
                className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* All resolved banner */}
      {allResolved && (
        <div className="shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 bg-[var(--color-success,#4caf50)]/10 border-t border-[var(--color-success,#4caf50)]/20 text-[var(--color-success,#4caf50)] text-[11px]">
          <CheckCircle2 className="h-3.5 w-3.5" />
          All conflicts resolved — click <strong className="mx-1">Mark Resolved</strong> to stage
        </div>
      )}
    </div>
  );
}

interface ConflictBlockProps {
  index: number;
  isSelected: boolean;
  onNavigate: () => void;
  onAcceptOurs: () => void;
  onAcceptTheirs: () => void;
}

function ConflictBlock({
  index,
  isSelected,
  onNavigate,
  onAcceptOurs,
  onAcceptTheirs,
}: ConflictBlockProps) {
  return (
    <div
      className={cn(
        "shrink-0 flex items-center gap-0.5 rounded px-1 py-0.5 border text-[10px] cursor-pointer transition-colors",
        isSelected
          ? "border-amber-400/40 bg-amber-400/10 text-amber-400"
          : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]/40 hover:text-[var(--color-text)]",
      )}
      onClick={onNavigate}
      title={`Jump to conflict ${index + 1}`}
    >
      <span className="font-mono font-semibold w-4 text-center">{index + 1}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onAcceptTheirs(); }}
        title="Accept theirs (incoming)"
        className="px-1 rounded text-blue-400 hover:bg-blue-400/10 transition-colors"
      >
        ←T
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onAcceptOurs(); }}
        title="Accept ours (current HEAD)"
        className="px-1 rounded text-green-400 hover:bg-green-400/10 transition-colors"
      >
        O→
      </button>
    </div>
  );
}
