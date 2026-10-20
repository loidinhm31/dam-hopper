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
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  useInsertionEffect,
} from "react";
import {
  X,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  GitMerge,
  Undo2,
  Redo2,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useGitConflictFile, useGitFileDiff } from "@/api/queries.js";
import { useConflictResolver } from "@/hooks/use-conflict-resolver.js";
import {
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
} from "@/api/client.js";
import {
  parseConflictRegions,
  acceptConflict,
  hasRemainingConflicts,
  hasMalformedConflicts,
  type ConflictRegion,
} from "@/lib/conflict-parser.js";
import { useAndroidChromeInputPolicy } from "@/contexts/AndroidChromeInputPolicyContext.js";

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
  target?: ProjectTargetInput;
  targetAvailable?: boolean;
  filePath: string;
  fileLanguage?: string;
  root?: string;
  onClose: () => void;
  onResolved: () => void;
}

function blurEditorSurface(
  editor: monacoNs.editor.IStandaloneCodeEditor,
): void {
  const domNode = editor.getDomNode();
  const activeElement = domNode?.ownerDocument.activeElement;
  if (activeElement && domNode?.contains(activeElement)) {
    (activeElement as HTMLElement).blur();
  }
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
      options: {
        isWholeLine: true,
        className: "mc-conflict-marker",
        stickiness: 1,
      },
    });
    // ours lines
    if (r.separatorLine > r.startLine + 1) {
      dec.push({
        range: new monaco.Range(r.startLine + 1, 1, r.separatorLine - 1, 1),
        options: {
          isWholeLine: true,
          className: "mc-conflict-ours",
          stickiness: 1,
        },
      });
    }
    // ======= separator
    dec.push({
      range: new monaco.Range(r.separatorLine, 1, r.separatorLine, 1),
      options: {
        isWholeLine: true,
        className: "mc-conflict-sep",
        stickiness: 1,
      },
    });
    // theirs lines
    if (r.endLine > r.separatorLine + 1) {
      dec.push({
        range: new monaco.Range(r.separatorLine + 1, 1, r.endLine - 1, 1),
        options: {
          isWholeLine: true,
          className: "mc-conflict-theirs",
          stickiness: 1,
        },
      });
    }
    // >>>>>>> marker line
    dec.push({
      range: new monaco.Range(r.endLine, 1, r.endLine, 1),
      options: {
        isWholeLine: true,
        className: "mc-conflict-marker",
        stickiness: 1,
      },
    });
  }

  return dec;
}

export function MergeConflictEditor({
  project: projectName,
  target,
  targetAvailable = true,
  filePath,
  fileLanguage,
  root,
  onClose,
  onResolved,
}: Props) {
  const targetRef = normalizeProjectTarget(target ?? projectName);
  const targetKey = projectTargetCacheKey(targetRef);
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();
  useConflictStyles();

  const resolver = useConflictResolver(targetRef, root);
  const conflicts = resolver.conflicts;
  const conflictsLoading = resolver.isLoading;
  const conflictEntry = conflicts.find((c) => c.path === filePath);
  const { data: snapshot, isLoading: snapshotLoading } = useGitConflictFile(
    targetRef,
    conflictEntry?.conflictId ?? "",
    root,
  );
  const { data: fileDiff, isLoading: diffLoading } = useGitFileDiff(
    targetRef,
    filePath,
  );

  const conflictFile = conflictEntry;
  const theirsText = snapshot?.stages?.theirs?.textTokens?.join("") ?? "";
  const oursText = snapshot?.stages?.ours?.textTokens?.join("") ?? "";
  const workdirContent = snapshot?.worktree.textTokens?.join("") ?? "";
  const language = fileLanguage ?? fileDiff?.language ?? "plaintext";

  const [resolveError, setResolveError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [selectedConflict, setSelectedConflict] = useState(0);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const draftKeyRef = useRef<string | null>(null);
  const [resultContent, setResultContent] = useState<string>("");
  const resultContentRef = useRef<string>("");
  const [isImportingRecovery, setIsImportingRecovery] = useState(false);

  useEffect(() => {
    setDraftKey(null);
    draftKeyRef.current = null;
    setResultContent("");
    resultContentRef.current = "";
    setResolveError(null);
    setSelectedConflict(0);
  }, [filePath, root, targetKey]);

  useEffect(() => {
    if (!snapshot) return;
    let cancelled = false;
    void resolver
      .loadConflictDraft(snapshot.conflictId, snapshot)
      .then((draft) => {
        if (cancelled) return;
        setDraftKey(draft.id);
        draftKeyRef.current = draft.id;
        resultContentRef.current = draft.result;
        setResultContent(draft.result);
        const model = resultEditorRef.current?.getModel();
        if (model && model.getValue() !== draft.result) {
          model.setValue(draft.result);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setResolveError(
            error instanceof Error
              ? error.message
              : "Conflict draft could not be loaded",
          );
        }
      });
    return () => {
      cancelled = true;
      resolver.cancelPendingDraftLoads();
    };
  }, [snapshot, resolver.cancelPendingDraftLoads, resolver.loadConflictDraft]);
  const draftCandidate =
    resolver.drafts.find((draft) => draft.id === draftKey) ??
    resolver.activeDraft;
  const scope = resolver.currentScope;
  const activeDraft =
    draftCandidate &&
    scope &&
    snapshot &&
    draftCandidate.scope.profileId === scope.profileId &&
    draftCandidate.scope.generation === scope.generation &&
    draftCandidate.scope.serverUrl === scope.serverUrl &&
    (draftCandidate.scope.configuredRoot ?? "") ===
      (scope.configuredRoot ?? "") &&
    draftCandidate.scope.project === scope.project &&
    (draftCandidate.scope.worktreePath ?? "") === (scope.worktreePath ?? "") &&
    (draftCandidate.scope.root ?? "") === (scope.root ?? "") &&
    draftCandidate.target.conflictId === snapshot.conflictId &&
    draftCandidate.target.path === filePath &&
    draftCandidate.target.snapshotVersion === snapshot.snapshotVersion
      ? draftCandidate
      : null;
  const recoveryDrafts = useMemo(() => {
    const scope = resolver.currentScope;
    if (!scope || !activeDraft) return [];
    return resolver.drafts.filter(
      (draft) =>
        draft.isRecovery &&
        draft.scope.profileId === scope.profileId &&
        draft.scope.serverUrl === scope.serverUrl &&
        draft.scope.project === scope.project &&
        (draft.scope.worktreePath ?? "") === (scope.worktreePath ?? "") &&
        (draft.scope.root ?? "") === (scope.root ?? "") &&
        draft.target.path === filePath &&
        draft.authority.repositoryRoot ===
          activeDraft.authority.repositoryRoot &&
        draft.authority.worktreeRoot === activeDraft.authority.worktreeRoot,
    );
  }, [resolver.currentScope, resolver.drafts, activeDraft, filePath]);

  const conflictRegions = useMemo(
    () => parseConflictRegions(resultContent),
    [resultContent],
  );

  const allResolved =
    Boolean(activeDraft) && !hasRemainingConflicts(resultContent);
  const isMalformed =
    resultContent !== "" && hasMalformedConflicts(resultContent);

  // ── Editor refs ──────────────────────────────────────────────────────────────

  const theirsEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(
    null,
  );
  const resultEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(
    null,
  );
  const oursEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(
    null,
  );
  const modelsRef = useRef<{
    theirs: monacoNs.editor.ITextModel | null;
    result: monacoNs.editor.ITextModel | null;
    ours: monacoNs.editor.ITextModel | null;
  }>({ theirs: null, result: null, ours: null });
  const monacoRef = useRef<typeof monacoNs | null>(null);
  const isSyncing = useRef(false);
  const isApplyingDraftHistoryRef = useRef(false);
  const decorationCollection =
    useRef<monacoNs.editor.IEditorDecorationsCollection | null>(null);
  const isGuardingCapacityRef = useRef(false);
  const currentSelectionRef = useRef("");
  currentSelectionRef.current = `${targetKey}:${filePath}:${root ?? ""}`;

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
    const ro = new ResizeObserver(() => {
      editor.layout();
    });
    ro.observe(container);
    (editor as unknown as { _roCleanup?: () => void })._roCleanup = () =>
      ro.disconnect();
  }
  function restoreDraftHistory(apply: (key: string) => string | null) {
    const key = draftKeyRef.current;
    const editor = resultEditorRef.current;
    const model = editor?.getModel();
    if (!key || !editor || !model) return;
    const value = apply(key);
    if (value === null || value === model.getValue()) return;

    isApplyingDraftHistoryRef.current = true;
    try {
      model.setValue(value);
      resultContentRef.current = value;
      setResultContent(value);
    } finally {
      isApplyingDraftHistoryRef.current = false;
    }
  }

  useEffect(() => {
    const models = modelsRef.current;
    return () => {
      for (const ref of [theirsEditorRef, resultEditorRef, oursEditorRef]) {
        (
          ref.current as unknown as { _roCleanup?: () => void } | null
        )?._roCleanup?.();
      }
      // Defer model disposal so Monaco's own editor cleanup runs first.
      const { theirs, result, ours } = models;
      requestAnimationFrame(() => {
        if (theirs && !theirs.isDisposed()) theirs.dispose();
        if (result && !result.isDisposed()) result.dispose();
        if (ours && !ours.isDisposed()) ours.dispose();
      });
    };
  }, []);

  const handleTheirsMount: OnMount = useCallback(
    (editor, monaco) => {
      theirsEditorRef.current = editor;
      modelsRef.current.theirs = editor.getModel();
      editor.onDidChangeModel(() => {
        modelsRef.current.theirs = editor.getModel();
      });

      if (!monacoRef.current) monacoRef.current = monaco;
      editor.onDidScrollChange((e) => {
        if (!isSyncing.current) syncScroll(e.scrollTop);
      });
      attachResizeObserver(editor);
    },
    [syncScroll],
  );

  const handleResultMount: OnMount = useCallback(
    (editor, monaco) => {
      resultEditorRef.current = editor;
      modelsRef.current.result = editor.getModel();
      if (
        isAndroidChromeNativeInputSuppressed ||
        !targetAvailable ||
        !activeDraft ||
        activeDraft.isRecovery
      ) {
        editor.updateOptions({ readOnly: true });
        if (isAndroidChromeNativeInputSuppressed) blurEditorSurface(editor);
      }
      editor.onDidChangeModel(() => {
        modelsRef.current.result = editor.getModel();
      });

      if (!monacoRef.current) monacoRef.current = monaco;

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () =>
        restoreDraftHistory(resolver.undoDraft),
      );
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
        () => restoreDraftHistory(resolver.redoDraft),
      );
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () =>
        restoreDraftHistory(resolver.redoDraft),
      );

      // Track content changes
      editor.onDidChangeModelContent(() => {
        const value = editor.getValue();
        if (
          isApplyingDraftHistoryRef.current ||
          isGuardingCapacityRef.current
        ) {
          resultContentRef.current = value;
          setResultContent(value);
          return;
        }
        const previous = resultContentRef.current;
        const currentDraftKey = draftKeyRef.current;
        const update = currentDraftKey
          ? resolver.updateDraftResult(currentDraftKey, value)
          : { success: false, error: "Conflict draft is still loading" };
        if (!update.success) {
          setResolveError(update.error ?? "Draft capacity exceeded");
          const model = editor.getModel();
          if (model) {
            isGuardingCapacityRef.current = true;
            try {
              editor.executeEdits("capacity-guard", [
                { range: model.getFullModelRange(), text: previous },
              ]);
            } finally {
              isGuardingCapacityRef.current = false;
            }
          }
          return;
        }
        resultContentRef.current = value;
        setResultContent(value);
      });

      editor.onDidScrollChange((e) => {
        if (!isSyncing.current) syncScroll(e.scrollTop);
      });
      attachResizeObserver(editor);
    },
    [
      activeDraft?.id,
      activeDraft?.isRecovery,
      isAndroidChromeNativeInputSuppressed,
      resolver.updateDraftResult,
      syncScroll,
      targetAvailable,
    ],
  );

  useEffect(() => {
    const editor = resultEditorRef.current;
    if (!editor) return;
    editor.updateOptions({
      readOnly:
        isAndroidChromeNativeInputSuppressed ||
        !targetAvailable ||
        !activeDraft ||
        Boolean(activeDraft.isRecovery),
    });
    if (isAndroidChromeNativeInputSuppressed) blurEditorSurface(editor);
  }, [
    activeDraft?.id,
    activeDraft?.isRecovery,
    isAndroidChromeNativeInputSuppressed,
    targetAvailable,
  ]);

  const handleOursMount: OnMount = useCallback(
    (editor, monaco) => {
      oursEditorRef.current = editor;
      modelsRef.current.ours = editor.getModel();
      editor.onDidChangeModel(() => {
        modelsRef.current.ours = editor.getModel();
      });

      if (!monacoRef.current) monacoRef.current = monaco;
      editor.onDidScrollChange((e) => {
        if (!isSyncing.current) syncScroll(e.scrollTop);
      });
      attachResizeObserver(editor);
    },
    [syncScroll],
  );

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
    resultEditorRef.current?.setPosition({
      lineNumber: region.startLine,
      column: 1,
    });
    if (!isAndroidChromeNativeInputSuppressed) {
      resultEditorRef.current?.focus();
    }
  }

  // ── Accept actions ───────────────────────────────────────────────────────────

  function applyAccept(regionIndex: number, side: "ours" | "theirs") {
    if (
      isAndroidChromeNativeInputSuppressed ||
      !targetAvailable ||
      !activeDraft ||
      activeDraft.isRecovery
    ) {
      return;
    }
    const currentDraftKey = draftKeyRef.current;
    if (!currentDraftKey) {
      setResolveError("Conflict draft is still loading");
      return;
    }
    const regions = parseConflictRegions(resultContentRef.current);
    const region = regions[regionIndex];
    if (!region) return;

    const next = acceptConflict(resultContentRef.current, region, side);
    const update = resolver.updateDraftResult(currentDraftKey, next);
    if (!update.success) {
      setResolveError(update.error ?? "Draft capacity exceeded");
      return;
    }

    resultContentRef.current = next;
    const editor = resultEditorRef.current;
    if (editor) {
      const model = editor.getModel();
      if (model) {
        isApplyingDraftHistoryRef.current = true;
        try {
          model.applyEdits([{ range: model.getFullModelRange(), text: next }]);
        } finally {
          isApplyingDraftHistoryRef.current = false;
        }
        const newRegions = parseConflictRegions(next);
        const nextConflict =
          newRegions[regionIndex] ?? newRegions[regionIndex - 1];
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
    if (
      isAndroidChromeNativeInputSuppressed ||
      !targetAvailable ||
      !activeDraft ||
      activeDraft.isRecovery
    ) {
      return;
    }
    const currentDraftKey = draftKeyRef.current;
    if (!currentDraftKey) {
      setResolveError("Conflict draft is still loading");
      return;
    }
    let content = resultContentRef.current;
    const regions = parseConflictRegions(content);
    for (let i = regions.length - 1; i >= 0; i--) {
      content = acceptConflict(content, regions[i], side);
    }
    const update = resolver.updateDraftResult(currentDraftKey, content);
    if (!update.success) {
      setResolveError(update.error ?? "Draft capacity exceeded");
      return;
    }

    resultContentRef.current = content;
    const model = resultEditorRef.current?.getModel();
    if (model) {
      isApplyingDraftHistoryRef.current = true;
      try {
        model.applyEdits([{ range: model.getFullModelRange(), text: content }]);
      } finally {
        isApplyingDraftHistoryRef.current = false;
      }
    }
    setSelectedConflict(0);
    setResultContent(content);
  }

  async function handleImportRecovery(recoveryKey: string) {
    const capturedSelection = currentSelectionRef.current;
    setIsImportingRecovery(true);
    setResolveError(null);
    try {
      const draft = await resolver.importRecoveryDraft(recoveryKey);
      if (currentSelectionRef.current !== capturedSelection) return;
      setDraftKey(draft.id);
      draftKeyRef.current = draft.id;
      resultContentRef.current = draft.result;
      setResultContent(draft.result);
      const model = resultEditorRef.current?.getModel();
      if (model && model.getValue() !== draft.result) {
        model.setValue(draft.result);
      }
    } catch (error) {
      setResolveError(
        error instanceof Error
          ? error.message
          : "Recovery text could not be imported",
      );
    } finally {
      setIsImportingRecovery(false);
    }
  }

  async function handleConfirmFreshReview() {
    if (!draftKey) {
      setResolveError("Fresh-snapshot review could not be confirmed");
      return;
    }
    const capturedSelection = currentSelectionRef.current;
    try {
      await resolver.confirmFreshReview(draftKey);
      if (currentSelectionRef.current !== capturedSelection) return;
      setResolveError(null);
    } catch (error) {
      setResolveError(
        error instanceof Error
          ? error.message
          : "Fresh-snapshot review could not be confirmed",
      );
    }
  }

  function handleDiscardRecovery(recoveryKey: string) {
    if (!window.confirm("Discard this saved conflict recovery text?")) return;
    if (!resolver.discardDraft(recoveryKey, true)) {
      setResolveError("Recovery text could not be discarded");
      return;
    }
    if (recoveryKey === draftKey) onClose();
  }

  // ── Resolve ──────────────────────────────────────────────────────────────────

  async function handleMarkResolved() {
    if (
      !allResolved ||
      isAndroidChromeNativeInputSuppressed ||
      !targetAvailable
    ) {
      return;
    }
    if (!draftKey) {
      setResolveError("Conflict draft is not loaded");
      return;
    }
    if (!activeDraft) {
      setResolveError("Conflict draft is no longer available");
      return;
    }
    if (
      activeDraft.isRecovery ||
      activeDraft.requiresReview ||
      activeDraft.isApplied
    ) {
      setResolveError(
        "Import and review the draft against a fresh snapshot before Apply",
      );
      return;
    }
    const capturedSelection = currentSelectionRef.current;
    setIsResolving(true);
    setResolveError(null);
    try {
      const outcome = await resolver.applyDraft(draftKey);
      if (currentSelectionRef.current !== capturedSelection) return;
      if (outcome.outcome === "applied") {
        const currentDraft = resolver.getDraft(draftKey);
        if (
          currentDraft?.isDirty ||
          currentDraft?.isRecovery ||
          currentDraft?.requiresReview
        ) {
          setResolveError(
            "The submitted revision was staged; newer local edits remain in recovery and were not applied",
          );
        } else {
          onResolved();
        }
      } else {
        const errorReason =
          outcome.outcome === "stale" ||
          outcome.outcome === "unsupported" ||
          outcome.outcome === "busy"
            ? outcome.reason
            : outcome.error;
        setResolveError(
          `Resolution rejected (${outcome.outcome}): ${errorReason}`,
        );
      }
    } catch (error) {
      setResolveError(
        error instanceof Error ? error.message : "Resolve failed",
      );
    } finally {
      setIsResolving(false);
    }
  }

  // ── Loading / error states ───────────────────────────────────────────────────

  const isLoading = conflictsLoading || snapshotLoading || diffLoading;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)] glass-card">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading conflict data…
      </div>
    );
  }

  if (!conflictFile || !snapshot?.worktree.exists) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-[var(--color-danger)] glass-card">
        <AlertTriangle className="h-4 w-4" />
        No conflict data for {filePath}
      </div>
    );
  }

  const fileName = filePath.split("/").pop() ?? filePath;
  const dirPath = filePath.includes("/")
    ? filePath.slice(0, filePath.lastIndexOf("/"))
    : "";

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
            <span className="text-[11px] text-[var(--color-text-muted)] truncate">
              {dirPath}/
            </span>
          )}
          <span className="text-[11px] font-semibold text-[var(--color-text)] truncate">
            {fileName}
          </span>
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
            type="button"
            aria-label="Undo conflict draft edit"
            title="Undo conflict draft edit"
            disabled={
              !activeDraft ||
              activeDraft.history.past.length === 0 ||
              isAndroidChromeNativeInputSuppressed ||
              !targetAvailable
            }
            onClick={() => restoreDraftHistory(resolver.undoDraft)}
            className="rounded border border-[var(--color-border)] p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30"
          >
            <Undo2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label="Redo conflict draft edit"
            title="Redo conflict draft edit"
            disabled={
              !activeDraft ||
              activeDraft.history.future.length === 0 ||
              isAndroidChromeNativeInputSuppressed ||
              !targetAvailable
            }
            onClick={() => restoreDraftHistory(resolver.redoDraft)}
            className="rounded border border-[var(--color-border)] p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30"
          >
            <Redo2 className="h-3 w-3" />
          </button>
          <button
            onClick={() => acceptAll("theirs")}
            disabled={
              isAndroidChromeNativeInputSuppressed ||
              !targetAvailable ||
              Boolean(activeDraft?.isRecovery) ||
              conflictRegions.length === 0
            }
            title="Accept all incoming (theirs)"
            className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-blue-400 hover:border-blue-400/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            All Theirs
          </button>
          <button
            onClick={() => acceptAll("ours")}
            disabled={
              isAndroidChromeNativeInputSuppressed ||
              !targetAvailable ||
              Boolean(activeDraft?.isRecovery) ||
              conflictRegions.length === 0
            }
            title="Accept all current (ours)"
            className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-green-400 hover:border-green-400/40 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            All Ours
          </button>
          <button
            onClick={() => void handleMarkResolved()}
            disabled={
              isAndroidChromeNativeInputSuppressed ||
              !targetAvailable ||
              !allResolved ||
              isResolving ||
              Boolean(
                activeDraft?.isRecovery ||
                activeDraft?.requiresReview ||
                activeDraft?.isApplied,
              )
            }
            title={
              activeDraft?.isApplied
                ? "Already applied; refresh and review a fresh snapshot before another Apply"
                : activeDraft?.isRecovery
                  ? "Import recovery against a fresh snapshot before editing"
                  : activeDraft?.requiresReview
                    ? "Confirm fresh-snapshot review before Apply"
                    : isAndroidChromeNativeInputSuppressed
                      ? "Unavailable on Android Chrome: result is read-only"
                      : allResolved
                        ? "Write resolved content and stage file"
                        : "Resolve all conflicts first"
            }
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1",
              allResolved &&
                !isResolving &&
                !activeDraft?.isRecovery &&
                !activeDraft?.requiresReview
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
          aria-label="Close merge conflict editor"
          className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {isAndroidChromeNativeInputSuppressed && (
        <p
          role="note"
          className="shrink-0 border-b border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-[11px] text-amber-300"
        >
          Text editing is unavailable on Android Chrome. Accept, apply, and
          resolve actions are disabled; use a desktop browser to edit this
          conflict.
        </p>
      )}

      {!targetAvailable && (
        <p
          role="alert"
          className="shrink-0 border-b border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-[11px] text-amber-300"
        >
          This worktree is unavailable. Conflict edits and resolution are
          disabled until the target returns.
        </p>
      )}
      {resolver.inventoryError && (
        <p
          role="alert"
          className="shrink-0 border-b border-red-400/20 bg-red-400/10 px-3 py-1.5 text-[11px] text-red-300"
        >
          Conflict inventory unavailable: {resolver.inventoryError}
        </p>
      )}
      {resolver.refreshError && (
        <p
          role="alert"
          className="shrink-0 border-b border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-[11px] text-amber-300"
        >
          Apply outcome is retained. Authoritative refresh failed:{" "}
          {resolver.refreshError}
        </p>
      )}
      {recoveryDrafts.map((draft) => (
        <div
          key={draft.id}
          role="alert"
          className="shrink-0 flex items-center justify-between gap-3 border-b border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300"
        >
          <span className="min-w-0">
            Saved recovery for {draft.target.path}. This text is memory-only and
            is not sent to the server or worktree.{" "}
            {draft.recoveryReason ??
              "Import only after checking the fresh conflict."}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={isImportingRecovery || isResolving || !targetAvailable}
              onClick={() => void handleImportRecovery(draft.id)}
              className="rounded border border-amber-300/40 px-2 py-1 disabled:opacity-50"
            >
              {isImportingRecovery
                ? "Refreshing…"
                : "Refresh and import for review"}
            </button>
            <button
              type="button"
              onClick={() => handleDiscardRecovery(draft.id)}
              className="rounded border border-amber-300/40 px-2 py-1"
            >
              Discard saved text
            </button>
          </div>
        </div>
      ))}

      {activeDraft?.requiresReview && (
        <div
          role="note"
          className="shrink-0 flex items-center justify-between gap-3 border-b border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300"
        >
          <span>
            Recovery text was imported from an earlier snapshot. Compare it with
            the fresh stages before confirming review and applying.
          </span>
          <button
            type="button"
            disabled={isResolving || !targetAvailable}
            onClick={() => void handleConfirmFreshReview()}
          >
            Confirm fresh review
          </button>
        </div>
      )}

      {/* Resolve error */}
      {resolveError && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20 text-[var(--color-danger)] text-[11px]">
          <span>{resolveError}</span>
          <button
            type="button"
            aria-label="Dismiss resolve error"
            onClick={() => setResolveError(null)}
          >
            <X className="h-3 w-3 opacity-60 hover:opacity-100" />
          </button>
        </div>
      )}

      {/* Malformed conflict warning */}
      {isMalformed && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-amber-400/10 border-b border-amber-400/20 text-amber-400 text-[11px]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Malformed conflict markers detected — some conflict blocks may not
          display correctly. Manual editing recommended.
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
          value={theirsText}
          language={language}
          theme="vs-dark"
          options={{ ...editorOptions, readOnly: true }}
          onMount={handleTheirsMount}
        />

        {/* Result (editable, workdir content) */}
        <Editor
          height="100%"
          keepCurrentModel
          value={resultContent}
          language={language}
          theme="vs-dark"
          options={{
            contextmenu: false,
            ...editorOptions,
            readOnly:
              isAndroidChromeNativeInputSuppressed ||
              !targetAvailable ||
              !activeDraft ||
              Boolean(activeDraft.isRecovery),
          }}
          onMount={handleResultMount}
        />

        {/* Ours */}
        <Editor
          height="100%"
          keepCurrentModel
          value={oursText}
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
                actionsDisabled={
                  isAndroidChromeNativeInputSuppressed ||
                  !targetAvailable ||
                  Boolean(activeDraft?.isRecovery)
                }
              />
            ))}

            <div className="ml-auto shrink-0 flex items-center gap-1">
              <button
                type="button"
                aria-label="Previous conflict"
                onClick={() =>
                  navigateToConflict(Math.max(0, selectedConflict - 1))
                }
                disabled={selectedConflict === 0}
                className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label="Next conflict"
                onClick={() =>
                  navigateToConflict(
                    Math.min(conflictRegions.length - 1, selectedConflict + 1),
                  )
                }
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
          All conflicts resolved — click{" "}
          <strong className="mx-1">Mark Resolved</strong> to stage
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
  actionsDisabled: boolean;
}

export function ConflictBlock({
  index,
  isSelected,
  onNavigate,
  onAcceptOurs,
  onAcceptTheirs,
  actionsDisabled,
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
      <span className="font-mono font-semibold w-4 text-center">
        {index + 1}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAcceptTheirs();
        }}
        disabled={actionsDisabled}
        title={
          actionsDisabled
            ? "Unavailable on Android Chrome: result is read-only"
            : "Accept theirs (incoming)"
        }
        className="px-1 rounded text-blue-400 hover:bg-blue-400/10 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
      >
        ←T
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onAcceptOurs();
        }}
        disabled={actionsDisabled}
        title={
          actionsDisabled
            ? "Unavailable on Android Chrome: result is read-only"
            : "Accept ours (current HEAD)"
        }
        className="px-1 rounded text-green-400 hover:bg-green-400/10 transition-colors disabled:cursor-not-allowed disabled:opacity-30"
      >
        O→
      </button>
    </div>
  );
}
