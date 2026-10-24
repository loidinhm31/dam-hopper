/**
 * MergeConflictEditor — 3-panel merge conflict resolution editor.
 *
 * Layout:
 * - Wide: Theirs (readonly) | Result (editable) | Ours (readonly) + optional Base
 * - Narrow: Tabbed pane selector [Theirs | Result* | Ours | Base]
 *
 * Bound to Phase 06 ConflictMergeModel and JointHistoryAuthority.
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
  CheckCircle2,
  GitMerge,
  Undo2,
  Redo2,
  Split,
  Layers,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useGitConflictFile, useGitFileDiff } from "@/api/queries.js";
import {
  useConflictResolver,
  type ConflictResolverHandle,
} from "@/hooks/use-conflict-resolver.js";
import {
  normalizeProjectTarget,
  projectTargetCacheKey,
  type ProjectTargetInput,
} from "@/api/client.js";
import { parseResultMarkerBlocks } from "@/lib/conflict-marker-parser.js";
import { useAndroidChromeInputPolicy } from "@/contexts/AndroidChromeInputPolicyContext.js";
import {
  injectConflictStylesOnce,
  buildResultDecorations,
  buildSourceDecorations,
} from "@/lib/conflict-editor-decorations.js";
import { ConflictRegionNav } from "./ConflictRegionNav.js";
import { extractModelDecisions } from "@/lib/conflict-merge-model.js";

interface Props {
  project: string;
  target?: ProjectTargetInput;
  targetAvailable?: boolean;
  filePath: string;
  fileLanguage?: string;
  root?: string;
  resolver?: ConflictResolverHandle;
  onClose: () => void;
  onResolved: () => void;
}

const resizeObserverCleanups = new WeakMap<
  monacoNs.editor.IStandaloneCodeEditor,
  () => void
>();

function blurEditorSurface(
  editor: monacoNs.editor.IStandaloneCodeEditor,
): void {
  const domNode = editor.getDomNode();
  const activeElement = domNode?.ownerDocument.activeElement;
  if (activeElement && domNode?.contains(activeElement)) {
    (activeElement as HTMLElement).blur();
  }
}

export function MergeConflictEditor({
  project: projectName,
  target,
  targetAvailable = true,
  filePath,
  fileLanguage,
  root,
  resolver: propResolver,
  onClose,
  onResolved,
}: Props) {
  const targetRef = normalizeProjectTarget(target ?? projectName);
  const targetKey = projectTargetCacheKey(targetRef);
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();

  useInsertionEffect(() => {
    injectConflictStylesOnce();
  }, []);

  const fallbackResolver = useConflictResolver(
    propResolver ? undefined : targetRef,
    propResolver ? undefined : root,
    { enabled: !propResolver },
  );
  const resolver = propResolver ?? fallbackResolver;
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
  const baseText = snapshot?.stages?.base?.textTokens?.join("") ?? "";
  const basePresent = Boolean(snapshot?.stages?.base);
  const language = fileLanguage ?? fileDiff?.language ?? "plaintext";

  const [resolveError, setResolveError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [selectedConflict, setSelectedConflict] = useState(0);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const draftKeyRef = useRef<string | null>(null);
  const [resultContent, setResultContent] = useState<string>("");
  const resultContentRef = useRef<string>("");
  const [isImportingRecovery, setIsImportingRecovery] = useState(false);

  // Responsive narrow layout state
  // Responsive narrow layout state with callback ref to guarantee observation
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const [activeNarrowPane, setActiveNarrowPane] = useState<
    "theirs" | "result" | "ours" | "base"
  >("result");
  const [showBaseInWide, setShowBaseInWide] = useState(false);
  const pendingRevealLineRef = useRef<number | null>(null);

  useEffect(() => {
    pendingRevealLineRef.current = null;
  }, [draftKey]);

  useEffect(() => {
    if (!containerNode) return;
    const updateWidth = (width: number) => {
      setIsNarrow(width < 768);
    };
    updateWidth(
      containerNode.getBoundingClientRect().width ||
        (typeof window !== "undefined" ? window.innerWidth : 1024),
    );

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        updateWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerNode);
    return () => observer.disconnect();
  }, [containerNode]);

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

  const parsedMarkers = useMemo(
    () => parseResultMarkerBlocks(resultContent),
    [resultContent],
  );
  const conflictRegions = parsedMarkers;
  const conflictMergeRegions = useMemo(() => {
    return activeDraft?.mergeModel?.regions.filter((r) => !r.stable) ?? [];
  }, [activeDraft?.mergeModel]);

  const conflictRegionsWithId = useMemo(() => {
    return parsedMarkers.map((m, i) => ({
      ...m,
      id: conflictMergeRegions[i]?.id ?? `conflict-${i + 1}`,
    }));
  }, [parsedMarkers, conflictMergeRegions]);

  const activeDraftRef = useRef(activeDraft);
  activeDraftRef.current = activeDraft;
  const conflictMergeRegionsRef = useRef(conflictMergeRegions);
  conflictMergeRegionsRef.current = conflictMergeRegions;
  const theirsMouseDownDisposableRef = useRef<monacoNs.IDisposable | null>(null);
  const oursMouseDownDisposableRef = useRef<monacoNs.IDisposable | null>(null);

  const navRegions = useMemo(() => {
    if (conflictMergeRegions.length > 0) {
      return conflictMergeRegions.map((r) => ({
        id: r.id,
        startLine: r.mapping.resultRange?.startLine ?? r.oursRange.startLine,
        endLine: r.mapping.resultRange?.endLine ?? r.oursRange.endLine,
      }));
    }
    return conflictRegions.map((r, i) => ({
      id: `conflict-${i + 1}`,
      startLine: r.startLine,
      endLine: r.endLine,
    }));
  }, [conflictMergeRegions, conflictRegions]);
  const isModelReady = activeDraft?.mergeModel
    ? activeDraft.mergeModel.readiness.isReady
    : parsedMarkers.length === 0;
  const allResolved = Boolean(activeDraft) && isModelReady;
  const isMalformed = useMemo(() => {
    if (!resultContent) return false;
    const lines = resultContent.split("\n");
    let opens = 0;
    let seps = 0;
    let closes = 0;
    for (const line of lines) {
      if (line.startsWith("<<<<<<<")) opens++;
      else if (line.startsWith("=======")) seps++;
      else if (line.startsWith(">>>>>>>")) closes++;
    }
    return opens !== closes || (opens > 0 && opens !== seps);
  }, [resultContent]);

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
  const baseEditorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(
    null,
  );
  const modelsRef = useRef<{
    theirs: monacoNs.editor.ITextModel | null;
    result: monacoNs.editor.ITextModel | null;
    ours: monacoNs.editor.ITextModel | null;
    base: monacoNs.editor.ITextModel | null;
  }>({ theirs: null, result: null, ours: null, base: null });
  const monacoRef = useRef<typeof monacoNs | null>(null);
  const isSyncing = useRef(false);
  const isApplyingDraftHistoryRef = useRef(false);
  const resultDecorationsCollection =
    useRef<monacoNs.editor.IEditorDecorationsCollection | null>(null);
  const theirsDecorationsCollection =
    useRef<monacoNs.editor.IEditorDecorationsCollection | null>(null);
  const oursDecorationsCollection =
    useRef<monacoNs.editor.IEditorDecorationsCollection | null>(null);
  const isGuardingCapacityRef = useRef(false);
  const currentSelectionRef = useRef("");
  currentSelectionRef.current = `${targetKey}:${filePath}:${root ?? ""}`;

  const syncScroll = useCallback((scrollTop: number, source: string) => {
    if (isSyncing.current) return;
    isSyncing.current = true;
    try {
      if (source !== "theirs") theirsEditorRef.current?.setScrollTop(scrollTop);
      if (source !== "result") resultEditorRef.current?.setScrollTop(scrollTop);
      if (source !== "ours") oursEditorRef.current?.setScrollTop(scrollTop);
      if (source !== "base") baseEditorRef.current?.setScrollTop(scrollTop);
    } finally {
      isSyncing.current = false;
    }
  }, []);

  function attachResizeObserver(editor: monacoNs.editor.IStandaloneCodeEditor) {
    const container = editor.getDomNode()?.parentElement;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      editor.layout();
    });
    ro.observe(container);
    resizeObserverCleanups.set(editor, () => ro.disconnect());
  }

  useEffect(() => {
    const handleLayoutChange = () => {
      theirsEditorRef.current?.layout();
      resultEditorRef.current?.layout();
      oursEditorRef.current?.layout();
      baseEditorRef.current?.layout();
    };
    window.addEventListener("workspace:layout-change", handleLayoutChange);
    return () => {
      window.removeEventListener("workspace:layout-change", handleLayoutChange);
    };
  }, []);

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
      for (const ref of [
        theirsEditorRef,
        resultEditorRef,
        oursEditorRef,
        baseEditorRef,
      ]) {
        const editor = ref.current;
        if (editor) {
          resizeObserverCleanups.get(editor)?.();
        }
      }
      const { theirs, result, ours, base } = models;
      requestAnimationFrame(() => {
        if (theirs && !theirs.isDisposed()) theirs.dispose();
        if (result && !result.isDisposed()) result.dispose();
        if (ours && !ours.isDisposed()) ours.dispose();
        if (base && !base.isDisposed()) base.dispose();
      });
    };
  }, []);

  // Apply decorations across editors
  const applyDecorations = useCallback(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    if (resultEditorRef.current) {
      const decisions = activeDraft?.mergeModel
        ? extractModelDecisions(activeDraft.mergeModel)
        : undefined;
      const decs = buildResultDecorations(
        conflictRegionsWithId,
        decisions,
        monaco,
      );
      if (resultDecorationsCollection.current) {
        resultDecorationsCollection.current.set(decs);
      } else {
        resultDecorationsCollection.current =
          resultEditorRef.current.createDecorationsCollection(decs);
      }
    }

    if (theirsEditorRef.current) {
      if (conflictMergeRegions.length > 0) {
        const theirsRanges = conflictMergeRegions.map((r) => ({
          regionId: r.id,
          startLine: r.theirsRange.startLine,
          endLine: r.theirsRange.endLine,
        }));
        const decs = buildSourceDecorations(theirsRanges, "theirs", monaco);
        if (theirsDecorationsCollection.current) {
          theirsDecorationsCollection.current.set(decs);
        } else {
          theirsDecorationsCollection.current =
            theirsEditorRef.current.createDecorationsCollection(decs);
        }
      } else if (theirsDecorationsCollection.current) {
        theirsDecorationsCollection.current.clear();
      }
    }

    if (oursEditorRef.current) {
      if (conflictMergeRegions.length > 0) {
        const oursRanges = conflictMergeRegions.map((r) => ({
          regionId: r.id,
          startLine: r.oursRange.startLine,
          endLine: r.oursRange.endLine,
        }));
        const decs = buildSourceDecorations(oursRanges, "ours", monaco);
        if (oursDecorationsCollection.current) {
          oursDecorationsCollection.current.set(decs);
        } else {
          oursDecorationsCollection.current =
            oursEditorRef.current.createDecorationsCollection(decs);
        }
      } else if (oursDecorationsCollection.current) {
        oursDecorationsCollection.current.clear();
      }
    }
  }, [activeDraft?.mergeModel, conflictMergeRegions, conflictRegionsWithId]);
  const handleTheirsMount: OnMount = useCallback(
    (editor, monaco) => {
      theirsEditorRef.current = editor;
      theirsDecorationsCollection.current = null;
      modelsRef.current.theirs = editor.getModel();
      editor.onDidChangeModel(() => {
        modelsRef.current.theirs = editor.getModel();
      });
      if (!monacoRef.current) monacoRef.current = monaco;
      editor.onDidScrollChange((e) => syncScroll(e.scrollTop, "theirs"));
      attachResizeObserver(editor);

      theirsMouseDownDisposableRef.current?.dispose();
      theirsMouseDownDisposableRef.current = editor.onMouseDown((e) => {
        if (
          isAndroidChromeNativeInputSuppressed ||
          !targetAvailable ||
          !activeDraftRef.current ||
          activeDraftRef.current.isRecovery
        ) {
          return;
        }
        if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
          const line = e.target.position?.lineNumber;
          if (line) {
            const region = conflictMergeRegionsRef.current.find(
              (r) => r.theirsRange.startLine <= line && line <= r.theirsRange.endLine,
            );
            if (region) {
              applyAcceptRef.current(region.id, "theirs");
            }
          }
        }
      });

      editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () =>
        handlePrevConflictRef.current(),
      );
      editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () =>
        handleNextConflictRef.current(),
      );

      applyDecorations();
    },
    [applyDecorations, isAndroidChromeNativeInputSuppressed, syncScroll, targetAvailable],
  );

  const handleResultMount: OnMount = useCallback(
    (editor, monaco) => {
      resultEditorRef.current = editor;
      resultDecorationsCollection.current = null;
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

      editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () =>
        handlePrevConflictRef.current(),
      );
      editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () =>
        handleNextConflictRef.current(),
      );

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

      editor.onDidScrollChange((e) => syncScroll(e.scrollTop, "result"));
      attachResizeObserver(editor);
      applyDecorations();

      if (pendingRevealLineRef.current !== null) {
        const line = pendingRevealLineRef.current;
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        if (!isAndroidChromeNativeInputSuppressed) {
          editor.focus();
        }
        pendingRevealLineRef.current = null;
      }
    },
    [
      activeDraft?.id,
      activeDraft?.isRecovery,
      applyDecorations,
      isAndroidChromeNativeInputSuppressed,
      resolver.redoDraft,
      resolver.undoDraft,
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
      oursDecorationsCollection.current = null;
      modelsRef.current.ours = editor.getModel();
      editor.onDidChangeModel(() => {
        modelsRef.current.ours = editor.getModel();
      });
      if (!monacoRef.current) monacoRef.current = monaco;
      editor.onDidScrollChange((e) => syncScroll(e.scrollTop, "ours"));
      attachResizeObserver(editor);

      oursMouseDownDisposableRef.current?.dispose();
      oursMouseDownDisposableRef.current = editor.onMouseDown((e) => {
        if (
          isAndroidChromeNativeInputSuppressed ||
          !targetAvailable ||
          !activeDraftRef.current ||
          activeDraftRef.current.isRecovery
        ) {
          return;
        }
        if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
          const line = e.target.position?.lineNumber;
          if (line) {
            const region = conflictMergeRegionsRef.current.find(
              (r) => r.oursRange.startLine <= line && line <= r.oursRange.endLine,
            );
            if (region) {
              applyAcceptRef.current(region.id, "ours");
            }
          }
        }
      });

      editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () =>
        handlePrevConflictRef.current(),
      );
      editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () =>
        handleNextConflictRef.current(),
      );

      applyDecorations();
    },
    [applyDecorations, isAndroidChromeNativeInputSuppressed, syncScroll, targetAvailable],
  );

  const handleBaseMount: OnMount = useCallback(
    (editor, monaco) => {
      baseEditorRef.current = editor;
      modelsRef.current.base = editor.getModel();
      editor.onDidChangeModel(() => {
        modelsRef.current.base = editor.getModel();
      });
      if (!monacoRef.current) monacoRef.current = monaco;
      editor.onDidScrollChange((e) => syncScroll(e.scrollTop, "base"));
      attachResizeObserver(editor);
    },
    [syncScroll],
  );


  useEffect(() => {
    applyDecorations();
  }, [applyDecorations, activeNarrowPane]);

  // Conflict navigation
  function navigateToConflict(index: number) {
    const region = navRegions[index];
    if (!region) return;
    setSelectedConflict(index);
    if (isNarrow) {
      pendingRevealLineRef.current = region.startLine;
      setActiveNarrowPane("result");
    }
    const editor = resultEditorRef.current;
    if (editor) {
      editor.revealLineInCenter(region.startLine);
      editor.setPosition({
        lineNumber: region.startLine,
        column: 1,
      });
      if (!isAndroidChromeNativeInputSuppressed) {
        editor.focus();
      }
      pendingRevealLineRef.current = null;
    }
    if (theirsEditorRef.current && conflictMergeRegions[index]) {
      const line = conflictMergeRegions[index].theirsRange.startLine;
      theirsEditorRef.current.revealLineInCenter(line);
      theirsEditorRef.current.setPosition({ lineNumber: line, column: 1 });
    }
    if (oursEditorRef.current && conflictMergeRegions[index]) {
      const line = conflictMergeRegions[index].oursRange.startLine;
      oursEditorRef.current.revealLineInCenter(line);
      oursEditorRef.current.setPosition({ lineNumber: line, column: 1 });
    }
  }

  const handlePrevConflict = useCallback(() => {
    if (navRegions.length === 0) return;
    const nextIdx =
      (selectedConflict - 1 + navRegions.length) % navRegions.length;
    navigateToConflict(nextIdx);
  }, [navRegions.length, selectedConflict]);

  const handleNextConflict = useCallback(() => {
    if (navRegions.length === 0) return;
    const nextIdx = (selectedConflict + 1) % navRegions.length;
    navigateToConflict(nextIdx);
  }, [navRegions.length, selectedConflict]);

  const handlePrevConflictRef = useRef(handlePrevConflict);
  handlePrevConflictRef.current = handlePrevConflict;
  const handleNextConflictRef = useRef(handleNextConflict);
  handleNextConflictRef.current = handleNextConflict;

  const applyAcceptRef = useRef(applyAccept);
  applyAcceptRef.current = applyAccept;
  // Model-bound Accept actions
  // Model-bound Accept actions keyed by exact regionId
  function applyAccept(regionId: string, side: "ours" | "theirs") {
    if (
      isAndroidChromeNativeInputSuppressed ||
      !targetAvailable ||
      !activeDraft ||
      activeDraft.isRecovery ||
      !draftKey
    ) {
      return;
    }
    if (activeDraft.mergeModel) {
      const outcome = resolver.acceptSide(draftKey, regionId, side);
      if (!outcome.success) {
        setResolveError(outcome.error ?? "Accept action failed");
        return;
      }
      const updated = resolver.getDraft(draftKey);
      const next = updated?.result ?? resultContentRef.current;
      resultContentRef.current = next;
      const editor = resultEditorRef.current;
      if (editor) {
        const model = editor.getModel();
        if (model && model.getValue() !== next) {
          isApplyingDraftHistoryRef.current = true;
          try {
            model.setValue(next);
          } finally {
            isApplyingDraftHistoryRef.current = false;
          }
        }
      }
      setResultContent(next);
      return;
    }
  }

  function applyAcceptBoth(
    regionId: string,
    order: "ours-then-theirs" | "theirs-then-ours",
  ) {
    if (
      isAndroidChromeNativeInputSuppressed ||
      !targetAvailable ||
      !activeDraft ||
      activeDraft.isRecovery ||
      !draftKey
    ) {
      return;
    }
    const outcome = resolver.acceptBoth(draftKey, regionId, order);
    if (!outcome.success) {
      setResolveError(outcome.error ?? "Accept both failed");
      return;
    }
    const updated = resolver.getDraft(draftKey);
    if (updated) {
      resultContentRef.current = updated.result;
      const editor = resultEditorRef.current;
      if (editor) {
        const model = editor.getModel();
        if (model && model.getValue() !== updated.result) {
          isApplyingDraftHistoryRef.current = true;
          try {
            model.setValue(updated.result);
          } finally {
            isApplyingDraftHistoryRef.current = false;
          }
        }
      }
      setResultContent(updated.result);
    }
  }

  function applyMarkReviewed(regionId: string) {
    if (!draftKey || !activeDraft) return;
    resolver.markReviewed(draftKey, regionId);
  }

  function acceptAll(side: "ours" | "theirs") {
    if (
      isAndroidChromeNativeInputSuppressed ||
      !targetAvailable ||
      !activeDraft ||
      activeDraft.isRecovery ||
      !draftKey
    ) {
      return;
    }
    const preview =
      side === "ours"
        ? resolver.previewAcceptAllOurs(draftKey)
        : resolver.previewAcceptAllTheirs(draftKey);
    if (preview) {
      const outcome = resolver.confirmWholeFileAction(draftKey, preview);
      if (!outcome.success) {
        setResolveError(outcome.error ?? "Whole file action failed");
        return;
      }
      const next = preview.previewText;
      resultContentRef.current = next;
      const model = resultEditorRef.current?.getModel();
      if (model) {
        isApplyingDraftHistoryRef.current = true;
        try {
          model.setValue(next);
        } finally {
          isApplyingDraftHistoryRef.current = false;
        }
      }
      setSelectedConflict(0);
      setResultContent(next);
      return;
    }
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

  const isBinaryConflict = Boolean(
    conflictEntry?.isBinary ||
      snapshot?.stages?.ours?.kind === "binary" ||
      snapshot?.stages?.theirs?.kind === "binary",
  );

  const isDeleteModifyConflict = Boolean(
    snapshot?.status === "modifyDelete" || snapshot?.status === "deleteModify",
  );

  const isUnsupportedConflict = Boolean(
    snapshot?.status === "unsupported" ||
      snapshot?.worktree?.kind === "symlink" ||
      snapshot?.worktree?.kind === "gitlink" ||
      snapshot?.unsupportedReason,
  );

  const handleBinaryChoice = async (side: "ours" | "theirs") => {
    if (!draftKey || isResolving || !targetAvailable) return;
    const sideLabel = side === "ours" ? "Ours (Stage 2)" : "Theirs (Stage 3)";
    if (
      !window.confirm(
        `Resolve binary conflict for ${filePath} by keeping ${sideLabel} and staging the file?`,
      )
    ) {
      return;
    }
    setIsResolving(true);
    setResolveError(null);
    try {
      const outcome = await resolver.applyIndexSide(draftKey, side);
      if (outcome.outcome === "applied") {
        onResolved();
      } else {
        const errorMsg =
          "error" in outcome
            ? outcome.error
            : "reason" in outcome
              ? outcome.reason
              : "Binary resolution failed";
        setResolveError(errorMsg);
      }
    } catch (err) {
      setResolveError(
        err instanceof Error ? err.message : "Binary resolution failed",
      );
    } finally {
      setIsResolving(false);
    }
  };
  const oursPresent = Boolean(
    snapshot?.stages?.ours && snapshot.stages.ours.kind !== "missing",
  );
  const theirsPresent = Boolean(
    snapshot?.stages?.theirs && snapshot.stages.theirs.kind !== "missing",
  );
  const modifiedSide: "ours" | "theirs" | null =
    oursPresent && !theirsPresent
      ? "ours"
      : theirsPresent && !oursPresent
        ? "theirs"
        : null;

  const handleKeepModified = async () => {
    if (!draftKey || isResolving || !targetAvailable || !modifiedSide) return;
    setIsResolving(true);
    setResolveError(null);
    try {
      const outcome = await resolver.applyIndexSide(draftKey, modifiedSide);
      if (outcome.outcome === "applied") {
        onResolved();
      } else {
        const errorMsg =
          "error" in outcome
            ? outcome.error
            : "reason" in outcome
              ? outcome.reason
              : "Resolution failed";
        setResolveError(errorMsg);
      }
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "Resolution failed");
    } finally {
      setIsResolving(false);
    }
  };

  const handleDeleteFile = async () => {
    if (!draftKey || isResolving || !targetAvailable) return;
    if (
      !window.confirm(
        `Delete ${filePath} from the working tree and index to resolve this conflict?`,
      )
    ) {
      return;
    }
    setIsResolving(true);
    setResolveError(null);
    try {
      const outcome = await resolver.applyDelete(draftKey);
      if (outcome.outcome === "applied") {
        onResolved();
      } else {
        const errorMsg =
          "error" in outcome
            ? outcome.error
            : "reason" in outcome
              ? outcome.reason
              : "Delete failed";
        setResolveError(errorMsg);
      }
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setIsResolving(false);
    }
  };

  const isLoading =
    snapshotLoading || diffLoading || (!conflictEntry && conflictsLoading);
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)] glass-card">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading conflict data…
      </div>
    );
  }

  if (
    !conflictFile ||
    (!snapshot?.worktree.exists && !isDeleteModifyConflict)
  ) {
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

  const theirsRole = activeDraft?.stageRoleLabels?.theirs ?? "theirs";
  const oursRole = activeDraft?.stageRoleLabels?.ours ?? "ours";
  const baseRole = activeDraft?.stageRoleLabels?.base ?? "base";
  const theirsOid = snapshot?.stages?.theirs?.oid ? snapshot.stages.theirs.oid.slice(0, 7) : "";
  const oursOid = snapshot?.stages?.ours?.oid ? snapshot.stages.ours.oid.slice(0, 7) : "";
  const baseOid = snapshot?.stages?.base?.oid ? snapshot.stages.base.oid.slice(0, 7) : "";

  const editorOptions: monacoNs.editor.IStandaloneEditorConstructionOptions = {
    fontSize: 12,
    fontFamily: "JetBrains Mono, Fira Code, Cascadia Code, monospace",
    minimap: { enabled: false },
    glyphMargin: true,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    lineNumbers: "on",
    wordWrap: "off",
    theme: "vs-dark",
    scrollbar: { vertical: "visible", horizontal: "auto" },
    renderValidationDecorations: "off",
  };

  return (
    <div
      ref={setContainerNode}
      className="h-full flex flex-col glass-card overflow-hidden"
    >
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

          {navRegions.length > 0 && (
            <div className="flex items-center gap-1 shrink-0 ml-2 border-l border-[var(--color-border)] pl-2">
              <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                {selectedConflict + 1}/{navRegions.length}
              </span>
              <button
                type="button"
                onClick={handlePrevConflict}
                disabled={navRegions.length <= 1}
                className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
                title="Previous conflict (Alt+Up)"
                aria-label="Previous conflict"
              >
                <ChevronUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={handleNextConflict}
                disabled={navRegions.length <= 1}
                className="p-0.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] disabled:opacity-30 disabled:pointer-events-none transition-colors"
                title="Next conflict (Alt+Down)"
                aria-label="Next conflict"
              >
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
          )}
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

          {basePresent && !isNarrow && (
            <button
              type="button"
              onClick={() => setShowBaseInWide((prev) => !prev)}
              title={showBaseInWide ? "Hide base comparison" : "Compare with ancestor base"}
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1",
                showBaseInWide
                  ? "border-purple-400/60 bg-purple-500/15 text-purple-300"
                  : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
              )}
            >
              <Layers className="h-3 w-3" />
              Base
            </button>
          )}

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


      </div>

      {/* Terminal handoff guidance banner */}
      {resolver.terminalHandoff && (
        <div
          role="alert"
          className="shrink-0 flex items-center justify-between gap-3 border-b border-blue-400/20 bg-blue-400/10 px-3 py-2 text-[11px] text-blue-300"
        >
          <span>
            Commit message editing required in Git&apos;s configured editor. Return to terminal in{" "}
            <strong>{resolver.terminalHandoff.worktreeRoot}</strong> to finish.
          </span>
          <button
            type="button"
            onClick={() =>
              resolver.terminalHandoff &&
              void resolver.refreshAfterTerminalReturn(resolver.terminalHandoff)
            }
            className="rounded border border-blue-300/40 px-2 py-1 hover:bg-blue-300/20"
          >
            Refresh status
          </button>
        </div>
      )}

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

      {/* Specialized conflict handling views (Unsupported, Binary, Modify/Delete) */}
      {isUnsupportedConflict ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
          <div className="rounded-full bg-amber-500/10 p-3 text-amber-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="space-y-1 max-w-md">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Unsupported Conflict
            </h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              {snapshot?.unsupportedReason ??
                "This conflict involves unsupported attributes, symlinks, gitlinks, or conversion policies."}
            </p>
            <p className="text-2xs text-[var(--color-text-muted)]">
              Automatic resolution is disabled for safety. Please resolve this
              conflict manually in the owning worktree terminal:
            </p>
            <p className="font-mono text-2xs bg-[var(--color-surface-2)] px-2 py-1 rounded border border-[var(--color-border)] select-all">
              {snapshot?.worktreeRoot ?? resolver.terminalHandoff?.worktreeRoot ?? projectName}
            </p>
          </div>
          <button
            type="button"
            onClick={() => resolver.refetchAll()}
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
          >
            Refresh after terminal resolution
          </button>
        </div>
      ) : isDeleteModifyConflict ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-4">
          <div className="rounded-full bg-amber-500/10 p-3 text-amber-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="space-y-1 max-w-md">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Modify / Delete Conflict
            </h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              {oursPresent
                ? "This file was modified on Ours (current HEAD) and deleted on Theirs (incoming)."
                : "This file was deleted on Ours (current HEAD) and modified on Theirs (incoming)."}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              disabled={isResolving || !targetAvailable || !modifiedSide}
              onClick={() => void handleKeepModified()}
              className="rounded bg-green-600 px-4 py-2 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
            >
              {isResolving
                ? "Resolving…"
                : `Keep modified version (${modifiedSide === "ours" ? "Ours" : modifiedSide === "theirs" ? "Theirs" : "Unknown"})`}
            </button>
            <button
              type="button"
              disabled={isResolving || !targetAvailable}
              onClick={() => void handleDeleteFile()}
              className="rounded border border-[var(--color-danger)] px-4 py-2 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 disabled:opacity-50"
            >
              {isResolving ? "Deleting…" : "Delete file"}
            </button>
          </div>
        </div>
      ) : isBinaryConflict ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-4">
          <div className="rounded-full bg-blue-500/10 p-3 text-blue-400">
            <Split className="h-6 w-6" />
          </div>
          <div className="space-y-1 max-w-md">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Binary File Conflict
            </h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              Binary files cannot be merged as text. Select which version to keep:
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
            <div className="flex-1 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 text-left space-y-2">
              <div className="text-xs font-semibold text-green-400">
                Ours (Stage 2)
              </div>
              <div className="text-2xs text-[var(--color-text-muted)] font-mono truncate">
                OID: {snapshot?.stages?.ours?.oid?.slice(0, 10) ?? "unknown"}
              </div>
              <div className="text-2xs text-[var(--color-text-muted)]">
                Size: {snapshot?.stages?.ours?.byteSize ?? 0} bytes
              </div>
              <button
                type="button"
                disabled={isResolving || !targetAvailable}
                onClick={() => void handleBinaryChoice("ours")}
                className="w-full rounded bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
              >
                {isResolving ? "Resolving…" : "Take Ours (Stage 2)"}
              </button>
            </div>

            <div className="flex-1 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 text-left space-y-2">
              <div className="text-xs font-semibold text-blue-400">
                Theirs (Stage 3)
              </div>
              <div className="text-2xs text-[var(--color-text-muted)] font-mono truncate">
                OID: {snapshot?.stages?.theirs?.oid?.slice(0, 10) ?? "unknown"}
              </div>
              <div className="text-2xs text-[var(--color-text-muted)]">
                Size: {snapshot?.stages?.theirs?.byteSize ?? 0} bytes
              </div>
              <button
                type="button"
                disabled={isResolving || !targetAvailable}
                onClick={() => void handleBinaryChoice("theirs")}
                className="w-full rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {isResolving ? "Resolving…" : "Take Theirs (Stage 3)"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Narrow pane switcher tabs */}
          {isNarrow ? (
        <div
          role="tablist"
          aria-label="Conflict editor panes"
          className="shrink-0 flex border-b border-[var(--color-border)] bg-[var(--color-surface)] text-[11px] font-medium"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeNarrowPane === "theirs"}
            onClick={() => setActiveNarrowPane("theirs")}
            className={cn(
              "flex-1 py-1.5 text-center border-b-2 transition-colors",
              activeNarrowPane === "theirs"
                ? "border-blue-400 text-blue-400 font-semibold bg-blue-400/10"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            Theirs {theirsOid && `(${theirsOid})`}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeNarrowPane === "result"}
            onClick={() => setActiveNarrowPane("result")}
            className={cn(
              "flex-1 py-1.5 text-center border-b-2 transition-colors",
              activeNarrowPane === "result"
                ? "border-amber-400 text-amber-400 font-semibold bg-amber-400/10"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            Result {allResolved ? "✓" : "*"}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeNarrowPane === "ours"}
            onClick={() => setActiveNarrowPane("ours")}
            className={cn(
              "flex-1 py-1.5 text-center border-b-2 transition-colors",
              activeNarrowPane === "ours"
                ? "border-green-400 text-green-400 font-semibold bg-green-400/10"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            Ours {oursOid && `(${oursOid})`}
          </button>
          {basePresent && (
            <button
              type="button"
              role="tab"
              aria-selected={activeNarrowPane === "base"}
              onClick={() => setActiveNarrowPane("base")}
              className={cn(
                "flex-1 py-1.5 text-center border-b-2 transition-colors",
                activeNarrowPane === "base"
                  ? "border-purple-400 text-purple-400 font-semibold bg-purple-400/10"
                  : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
              )}
            >
              Base {baseOid && `(${baseOid})`}
            </button>
          )}
        </div>
      ) : (
        /* Wide panel headers */
        <div
          className={cn(
            "shrink-0 grid border-b border-[var(--color-border)] text-[10px] font-medium",
            showBaseInWide ? "grid-cols-4" : "grid-cols-3",
          )}
        >
          {showBaseInWide && (
            <div className="px-3 py-1 text-purple-400 border-r border-[var(--color-border)] bg-purple-400/5">
              Base ({baseRole} {baseOid})
            </div>
          )}
          <div className="px-3 py-1 text-blue-400 border-r border-[var(--color-border)] bg-blue-400/5">
            Theirs ({theirsRole} {theirsOid})
          </div>
          <div className="px-3 py-1 text-amber-400 border-r border-[var(--color-border)] bg-amber-400/5">
            Result (editable)
          </div>
          <div className="px-3 py-1 text-green-400 bg-green-400/5">
            Ours ({oursRole} {oursOid})
          </div>
        </div>
      )}

      {/* Editor views */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {isNarrow ? (
          <div className="h-full w-full">
            {activeNarrowPane === "theirs" && (
              <Editor
                path={`inmemory://${projectName}/${filePath}/theirs`}
                height="100%"
                keepCurrentModel
                value={theirsText}
                language={language}
                theme="vs-dark"
                options={{ ...editorOptions, readOnly: true }}
                onMount={handleTheirsMount}
              />
            )}
            {activeNarrowPane === "result" && (
              <Editor
                path={`inmemory://${projectName}/${filePath}/result`}
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
            )}
            {activeNarrowPane === "ours" && (
              <Editor
                path={`inmemory://${projectName}/${filePath}/ours`}
                height="100%"
                keepCurrentModel
                value={oursText}
                language={language}
                theme="vs-dark"
                options={{ ...editorOptions, readOnly: true }}
                onMount={handleOursMount}
              />
            )}
            {activeNarrowPane === "base" && (
              <Editor
                path={`inmemory://${projectName}/${filePath}/base`}
                height="100%"
                keepCurrentModel
                value={baseText}
                language={language}
                theme="vs-dark"
                options={{ ...editorOptions, readOnly: true }}
                onMount={handleBaseMount}
              />
            )}
          </div>
        ) : (
          <div
            className={cn(
              "h-full grid divide-x divide-[var(--color-border)]",
              showBaseInWide ? "grid-cols-4" : "grid-cols-3",
            )}
          >
            {showBaseInWide && (
              <Editor
                path={`inmemory://${projectName}/${filePath}/base`}
                height="100%"
                keepCurrentModel
                value={baseText}
                language={language}
                theme="vs-dark"
                options={{ ...editorOptions, readOnly: true }}
                onMount={handleBaseMount}
              />
            )}
            <Editor
              path={`inmemory://${projectName}/${filePath}/theirs`}
              height="100%"
              keepCurrentModel
              value={theirsText}
              theme="vs-dark"
              options={{ ...editorOptions, readOnly: true }}
              onMount={handleTheirsMount}
            />
            <Editor
              path={`inmemory://${projectName}/${filePath}/result`}
              height="100%"
              keepCurrentModel
              value={resultContent}
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
            <Editor
              path={`inmemory://${projectName}/${filePath}/ours`}
              height="100%"
              keepCurrentModel
              value={oursText}
              theme="vs-dark"
              options={{ ...editorOptions, readOnly: true }}
              onMount={handleOursMount}
            />
          </div>
        )}
      </div>

      {/* Conflict navigation strip */}
      <ConflictRegionNav
        regions={navRegions}
        decisions={
          activeDraft?.mergeModel
            ? extractModelDecisions(activeDraft.mergeModel)
            : undefined
        }
        selectedIndex={selectedConflict}
        onSelectIndex={navigateToConflict}
        onAcceptSide={applyAccept}
        onAcceptBoth={applyAcceptBoth}
        onMarkReviewed={applyMarkReviewed}
        disabled={
          isAndroidChromeNativeInputSuppressed ||
          !targetAvailable ||
          Boolean(activeDraft?.isRecovery)
        }
      />

      {/* All resolved banner */}
      {allResolved && (
        <div className="shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 bg-[var(--color-success,#4caf50)]/10 border-t border-[var(--color-success,#4caf50)]/20 text-[var(--color-success,#4caf50)] text-[11px] relative z-10 pr-14">
          <CheckCircle2 className="h-3.5 w-3.5" />
          All conflicts resolved — click{" "}
          <strong className="mx-1">Mark Resolved</strong> to stage
        </div>
      )}
        </>
      )}
    </div>
  );
}
