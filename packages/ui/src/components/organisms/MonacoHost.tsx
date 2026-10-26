/**
 * MonacoHost — self-contained Monaco editor wrapper.
 *
 * This module is dynamically imported (lazy boundary in EditorTabs).
 * Importing monaco-setup here ensures workers are configured before
 * the Editor component mounts.
 *
 * Props mirror what EditorTabs passes down per tab.
 */
import "@/lib/monaco-setup.js";
import Editor, { type OnMount } from "@monaco-editor/react";
import type * as monacoNs from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FileTier } from "@/lib/file-tier.js";
import { useSettingsStore, clampFont } from "@/stores/settings.js";
import { useSearchUiStore } from "@/stores/search-ui.js";
import { mimeToMonacoLanguage } from "@/lib/mime-to-language.js";
import {
  addKeyboardShortcutListener,
  addWheelShortcutListener,
} from "@/hooks/use-shortcuts.js";
import { EDITOR_ZOOM_WHEEL_SHORTCUT } from "@/lib/shortcuts.js";
import type { GitLineChange } from "@/api/client.js";
import { useAndroidChromeInputPolicy } from "@/contexts/AndroidChromeInputPolicyContext.js";
import {
  findGitLineChangeAtLine,
  gitLineChangesToDecorationDescriptors,
} from "@/lib/git-line-decorations.js";
interface MonacoLifecycleExtension {
  _roCleanup?: () => void;
  _wheelCleanup?: () => void;
  _toggleBlameCleanup?: () => void;
}
import type { GitBlameResponse } from "@/api/client.js";
import { useEditorStore, type Tab } from "@/stores/editor.js";
import {
  useEditorGitBlame,
  type EditorGitBlameStatus,
} from "@/hooks/use-editor-git-blame.js";
import { EditorGitBlameGutter } from "./EditorGitBlameGutter.js";
import { EditorGitBlameContextMenu } from "./EditorGitBlameContextMenu.js";
import {
  isSupportedSemanticPath,
  defaultSemanticModelRegistry,
  monacoPositionToLsp,
  buildLocalModelUri,
  computeUtf8Sha256Hex,
} from "@/lib/semantic-model-uri.js";
import { useSemanticNavigationStore } from "@/stores/semantic-navigation.js";
interface MonacoHostProps {
  tabKey: string;
  path?: string;
  content: string;
  tier: FileTier;
  mime?: string;
  viewState?: unknown;
  onChange: (value: string) => void;
  onSave: () => void;
  onViewStateChange: (vs: unknown, targetKey?: string) => void;
  onEditorReady?: (
    editor: monacoNs.editor.IStandaloneCodeEditor | null,
  ) => void;
  lineChanges?: GitLineChange[];
  onGitIndicatorClick?: () => void;
  readOnly?: boolean;
  tab?: Tab | null;
  blameEnabled?: boolean;
  onToggleBlame?: (enabled?: boolean) => void;
  onRefreshBlame?: () => void;
  onRevealCommit?: (commitHash: string, rootId: string) => void;
  blameData?: GitBlameResponse | null;
  blameStatus?: EditorGitBlameStatus;
  unavailableReason?: string | null;
  isBusy?: boolean;
  sourceActive?: boolean;
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

export function MonacoHost({
  tabKey,
  path,
  content,
  tier,
  mime,
  viewState,
  onChange,
  onSave,
  onViewStateChange,
  onEditorReady,
  lineChanges,
  onGitIndicatorClick,
  readOnly = false,
  tab: tabProp,
  blameEnabled: blameEnabledProp,
  onToggleBlame,
  onRefreshBlame,
  onRevealCommit,
  blameData: blameDataProp,
  blameStatus: blameStatusProp,
  unavailableReason: unavailableReasonProp,
  isBusy: isBusyProp,
  sourceActive = true,
}: MonacoHostProps) {
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [wrapperWidth, setWrapperWidth] = useState<number>(0);
  const [editorInstance, setEditorInstance] =
    useState<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<typeof monacoNs | null>(
    null,
  );
  const [gutterContextMenu, setGutterContextMenu] = useState<{
    x: number;
    y: number;
    lineNumber: number | null;
    snapshotId?: string;
    modelVersion?: number;
  } | null>(null);

  const storeTab = useEditorStore(
    useCallback((s) => s.tabs.find((t) => t.key === tabKey) ?? null, [tabKey]),
  );
  const effectiveTab = tabProp !== undefined ? tabProp : storeTab;
  const effectiveBlameEnabled =
    blameEnabledProp ?? effectiveTab?.blameEnabled ?? false;

  const hookResult = useEditorGitBlame({
    tab: effectiveTab,
    editor: editorInstance,
    active: effectiveBlameEnabled && sourceActive,
  });

  const effectiveBlameData =
    blameDataProp !== undefined ? blameDataProp : hookResult.data;
  const effectiveBlameStatus =
    blameStatusProp !== undefined ? blameStatusProp : hookResult.status;
  const effectiveUnavailableReason =
    unavailableReasonProp !== undefined
      ? unavailableReasonProp
      : hookResult.unavailableReason;
  const effectiveIsBusy =
    isBusyProp !== undefined ? isBusyProp : hookResult.isBusy;

  const effectiveBlameDataRef = useRef(effectiveBlameData);
  const effectiveBlameStatusRef = useRef(effectiveBlameStatus);
  const onRevealCommitRef = useRef(onRevealCommit);
  const handleToggleBlameRef = useRef<
    ((enabled?: boolean) => void) | undefined
  >(undefined);

  const handleToggleBlame = useCallback(
    (enabled?: boolean) => {
      const next = enabled ?? !effectiveBlameEnabled;
      if (onToggleBlame) {
        onToggleBlame(next);
      } else {
        useEditorStore.getState().setBlameEnabled(tabKey, next);
      }
    },
    [effectiveBlameEnabled, onToggleBlame, tabKey],
  );

  const handleRefreshBlame = useCallback(() => {
    if (onRefreshBlame) {
      onRefreshBlame();
    } else {
      hookResult.refresh();
    }
  }, [onRefreshBlame, hookResult]);

  const tabProfileId = effectiveTab?.target?.profileId;
  const semanticEnabled = useSemanticNavigationStore(
    (s) => tabProfileId ? s.isSemanticEnabledForProfile(tabProfileId) : s.globalSemanticEnabled,
  );
  const clientStatuses = useSemanticNavigationStore((s) => s.clientStatuses);

  useEffect(() => {
    if (
      effectiveTab?.loading || effectiveTab?.hydrated ||
      !effectiveTab ||
      !effectiveTab.target?.profileId ||
      !isSupportedSemanticPath(effectiveTab.path)
      || !effectiveTab.semanticProvenance
    ) {
      return;
    }

    defaultSemanticModelRegistry.registerModel({
      tabKey,
      profileId: effectiveTab.target.profileId,
      project: effectiveTab.project,
      targetKey: effectiveTab.targetKey,
      relativePath: effectiveTab.path,
      provenance: effectiveTab.semanticProvenance,
    });

    const client = useSemanticNavigationStore
      .getState()
      .findClientForTab(tabKey);
    if (semanticEnabled && client?.canAccessModel(tabKey) && client.getStatus() === "ready") {
      void client.notifyDidOpen(tabKey, content);
    }
  }, [
    semanticEnabled,
    tabKey,
    effectiveTab?.path,
    effectiveTab?.project,
    effectiveTab?.targetKey,
    effectiveTab?.target?.profileId,
    effectiveTab?.semanticProvenance,
    effectiveTab?.loading,
    effectiveTab?.hydrated,
    clientStatuses,
  ]);

  const activeRevealIntent = useSemanticNavigationStore(
    (s) => s.activeRevealIntent,
  );
  useEffect(() => {
    const intent = activeRevealIntent;
    if (!intent || !effectiveTab || !editorInstance || !effectiveTab.target?.profileId ||
        intent.profileId !== effectiveTab.target.profileId || intent.project !== effectiveTab.project ||
        intent.targetKey !== effectiveTab.targetKey || intent.relativePath !== effectiveTab.path ||
        !/^[a-f0-9]{64}$/.test(intent.destinationContentSha256 ?? "")) return;
    const model = editorInstance.getModel();
    const registered = defaultSemanticModelRegistry.getByTabKey(tabKey);
    const client = useSemanticNavigationStore.getState().findClientForTab(tabKey);
    if (!model || !registered || !client?.canAccessModel(tabKey) || client.getStatus() !== "ready" ||
        model.uri.toString() !== monacoInstance?.Uri.parse(buildLocalModelUri(tabKey)).toString()) return;
    const modelVersion = model.getVersionId();
    const binding = registered.wireBinding;
    const wireVersion = binding?.wireVersion;
    let cancelled = false;
    void computeUtf8Sha256Hex(model.getValue()).then((hash) => {
      if (cancelled || model.isDisposed() || editorInstance.getModel() !== model ||
          model.getVersionId() !== modelVersion || hash !== intent.destinationContentSha256 ||
          defaultSemanticModelRegistry.getByTabKey(tabKey) !== registered ||
          registered.wireBinding !== binding || binding?.wireVersion !== wireVersion ||
          !client.canAccessModel(tabKey) || client.getStatus() !== "ready" || client.getTargetId() !== intent.targetId ||
          useSemanticNavigationStore.getState().findClientForTab(tabKey) !== client ||
          (intent.destinationVersion != null && registered.wireBinding?.wireVersion !== intent.destinationVersion) ||
          intent.isCurrent?.() === false ||
          useSemanticNavigationStore.getState().activeRevealIntent !== intent) return;
      const consumed = useSemanticNavigationStore.getState().consumeRevealIntent(
        effectiveTab.target.profileId!, effectiveTab.project, effectiveTab.targetKey, effectiveTab.path, intent,
      );
      if (consumed !== intent) return;
      editorInstance.revealRangeInCenter(intent.range);
      editorInstance.setSelection(intent.range);
      editorInstance.focus();
    });
    return () => { cancelled = true; };
  }, [activeRevealIntent, effectiveTab, editorInstance, monacoInstance, tabKey]);
  useEffect(() => {
    effectiveBlameDataRef.current = effectiveBlameData;
    effectiveBlameStatusRef.current = effectiveBlameStatus;
    onRevealCommitRef.current = onRevealCommit;
    handleToggleBlameRef.current = handleToggleBlame;
  });
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monacoNs | null>(null);
  const lineChangesRef = useRef<GitLineChange[]>(lineChanges ?? []);
  const onGitIndicatorClickRef = useRef(onGitIndicatorClick);
  const gitDecorationIdsRef = useRef<string[]>([]);
  const wheelEnabledRef = useRef(
    useSettingsStore.getState().editorZoomWheelEnabled,
  );
  const prevTabKeyRef = useRef(tabKey);
  const onViewStateChangeRef = useRef(onViewStateChange);
  const onEditorReadyRef = useRef(onEditorReady);

  // Persist latest onSave ref so the Ctrl+S command always calls the current handler
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
    onViewStateChangeRef.current = onViewStateChange;
    onEditorReadyRef.current = onEditorReady;
  });

  const handleRevealCommit = useCallback(
    (commitHash: string, rootId: string) => {
      if (!onRevealCommitRef.current) return;
      if (!effectiveBlameEnabled) return;

      const currentBlame = effectiveBlameDataRef.current;
      const currentStatus = effectiveBlameStatusRef.current;

      if (
        currentStatus !== "ready" ||
        !currentBlame ||
        currentBlame.status !== "ready"
      ) {
        return;
      }

      if (currentBlame.rootId !== rootId) {
        return;
      }

      const currentEditor = editorRef.current;
      const currentModel = currentEditor?.getModel();
      if (currentModel) {
        const currentVersion = currentModel.getVersionId();
        if (
          typeof currentBlame.modelVersion === "number" &&
          currentVersion !== currentBlame.modelVersion
        ) {
          return;
        }
      }

      onRevealCommitRef.current(commitHash, rootId);
    },
    [effectiveBlameEnabled],
  );

  useEffect(() => {
    lineChangesRef.current = lineChanges ?? [];
    onGitIndicatorClickRef.current = onGitIndicatorClick;
  }, [lineChanges, onGitIndicatorClick]);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      setEditorInstance(editor);
      setMonacoInstance(monaco);
      if (wrapperRef.current?.clientWidth) {
        setWrapperWidth(wrapperRef.current.clientWidth);
      }
      // Restore view state (cursor pos, folds, scroll)
      if (viewState) {
        editor.restoreViewState(
          viewState as monacoNs.editor.ICodeEditorViewState,
        );
      }

      if (isAndroidChromeNativeInputSuppressed || readOnly) {
        editor.updateOptions({ readOnly: true });
        if (isAndroidChromeNativeInputSuppressed) blurEditorSurface(editor);
      }

      // Ctrl+S / Cmd+S → save (use ref so the latest handleSave is always called)
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
        isAndroidChromeNativeInputSuppressed || readOnly
          ? undefined
          : onSaveRef.current(),
      );

      editor.onMouseDown((event) => {
        const isPrimary =
          event.event.leftButton || event.event.browserEvent?.button === 0;
        if (!isPrimary) return;

        const targetLine = event.target.position?.lineNumber;
        if (!targetLine) return;
        const targetType = event.target.type;
        const isGitGutterTarget =
          targetType === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
          targetType === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS;
        if (
          isGitGutterTarget &&
          findGitLineChangeAtLine(lineChangesRef.current, targetLine)
        ) {
          onGitIndicatorClickRef.current?.();
        }
      });

      if (typeof editor.onContextMenu === "function") {
        editor.onContextMenu((event) => {
          const targetType = event.target.type;
          if (
            targetType === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
          ) {
            event.event.preventDefault?.();
            event.event.stopPropagation?.();
            const targetLine = event.target.position?.lineNumber ?? null;
            const browserEvt = event.event.browserEvent;
            const clientX =
              browserEvt?.clientX ??
              (event.event as unknown as { posx?: number })?.posx ??
              0;
            const clientY =
              browserEvt?.clientY ??
              (event.event as unknown as { posy?: number })?.posy ??
              0;
            setGutterContextMenu({
              x: clientX,
              y: clientY,
              lineNumber: targetLine,
              snapshotId: effectiveBlameDataRef.current?.snapshotId,
              modelVersion: effectiveBlameDataRef.current?.modelVersion,
            });
          }
        });
      }

      let toggleBlameAction: { dispose: () => void } | undefined;
      if (typeof editor.addAction === "function") {
        toggleBlameAction = editor.addAction({
          id: "editor.action.toggleGitBlame",
          label: "Toggle Git Blame Annotations",
          keybindings: [],
          contextMenuGroupId: "navigation",
          contextMenuOrder: 1.5,
          run: () => {
            handleToggleBlameRef.current?.();
          },
        });
      }

      onEditorReady?.(editor);

      // Persist view state on blur
      editor.onDidBlurEditorWidget(() => {
        const vs = editor.saveViewState();
        if (vs) onViewStateChangeRef.current(vs, prevTabKeyRef.current);
      });

      // ResizeObserver layout — avoids automaticLayout's internal polling overhead.
      const wrapperEl = wrapperRef.current;
      const editorDomNode = editor.getDomNode();
      const layoutContainer = wrapperEl ?? editorDomNode?.parentElement;
      if (typeof ResizeObserver !== "undefined" && layoutContainer) {
        const ro = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const width = Math.round(entry.contentRect.width);
            if (width > 0) {
              setWrapperWidth(width);
            }
          }
          editor.layout();
        });
        ro.observe(layoutContainer);
        const edWithExt = editor as unknown as MonacoLifecycleExtension;
        edWithExt._roCleanup = () => {
          ro.disconnect();
          toggleBlameAction?.dispose();
        };
      }

      const domNode = editor.getDomNode();
      if (domNode) {
        const openContentSearch = () => {
          const sel = editor.getSelection();
          const text = sel
            ? (editor.getModel()?.getValueInRange(sel) ?? "")
            : "";
          useSearchUiStore.getState().openWith("content", text.trim());
        };
        const openFilenameSearch = () => {
          useSearchUiStore.getState().openWith("filename");
        };
        const cleanupTextSearch = addKeyboardShortcutListener(
          domNode,
          () => useSettingsStore.getState().searchTextShortcut,
          openContentSearch,
        );
        const cleanupFilenameSearch = addKeyboardShortcutListener(
          domNode,
          () => useSettingsStore.getState().searchFilenameShortcut,
          openFilenameSearch,
        );
        const cleanupWheel = addWheelShortcutListener(
          domNode,
          () => (wheelEnabledRef.current ? EDITOR_ZOOM_WHEEL_SHORTCUT : ""),
          (e) => {
            const delta = e.deltaY < 0 ? 1 : -1;
            const store = useSettingsStore.getState();
            store.saveDebounced({
              editorFontSize: clampFont(store.editorFontSize + delta),
            });
          },
        );
        // Cleanup stored on the editor instance for the unmount effect
        const edWithExt = editor as unknown as MonacoLifecycleExtension;
        edWithExt._wheelCleanup = () => {
          cleanupTextSearch();
          cleanupFilenameSearch();
          cleanupWheel();
        };
      }
    },
    // Re-run when the tab or platform policy changes; refs keep other callbacks current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAndroidChromeNativeInputSuppressed, readOnly, tabKey],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({
      readOnly: isAndroidChromeNativeInputSuppressed || readOnly,
    });
    if (isAndroidChromeNativeInputSuppressed) blurEditorSurface(editor);
  }, [isAndroidChromeNativeInputSuppressed, readOnly]);

  // Capture view state of previous tab when tabKey changes, before updating prevTabKeyRef
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && prevTabKeyRef.current !== tabKey) {
      const vs = editor.saveViewState();
      if (vs) {
        onViewStateChangeRef.current(vs, prevTabKeyRef.current);
      }
      prevTabKeyRef.current = tabKey;
    } else {
      prevTabKeyRef.current = tabKey;
    }
  }, [tabKey]);

  // Restore view state when switching tabs (content ref changes)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !viewState) return;
    editor.restoreViewState(viewState as monacoNs.editor.ICodeEditorViewState);
  }, [tabKey, viewState]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const decorations = gitLineChangesToDecorationDescriptors(lineChanges).map(
      (descriptor) => ({
        range: new monaco.Range(
          descriptor.startLineNumber,
          1,
          descriptor.endLineNumber,
          1,
        ),
        options: {
          isWholeLine: true,
          className: descriptor.className,
          glyphMarginClassName: descriptor.glyphMarginClassName,
          hoverMessage: { value: descriptor.hoverMessage },
          overviewRuler: {
            color: descriptor.overviewRulerColor,
            position: monaco.editor.OverviewRulerLane.Right,
          },
        },
      }),
    );
    gitDecorationIdsRef.current = editor.deltaDecorations(
      gitDecorationIdsRef.current,
      decorations,
    );
  }, [lineChanges, tabKey]);

  // Subscribe to settings store — update Monaco font + keep wheel flag in sync
  useEffect(() => {
    const unsub = useSettingsStore.subscribe((s) => {
      wheelEnabledRef.current = s.editorZoomWheelEnabled;
      editorRef.current?.updateOptions({ fontSize: s.editorFontSize });
    });
    return () => {
      unsub();
      setEditorInstance(null);
      onEditorReadyRef.current?.(null);
      const ed = editorRef.current;
      if (ed) {
        const vs =
          typeof ed.saveViewState === "function" ? ed.saveViewState() : null;
        if (vs) {
          onViewStateChangeRef.current(vs, prevTabKeyRef.current);
        }
        ed.deltaDecorations(gitDecorationIdsRef.current, []);
        const edWithExt = ed as unknown as MonacoLifecycleExtension;
        edWithExt._roCleanup?.();
        edWithExt._wheelCleanup?.();
      }
    };
  }, []);

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.layout();
    }
  }, [effectiveBlameEnabled, wrapperWidth]);

  const isDegraded = tier === "degraded";
  const language = mimeToMonacoLanguage(mime, path);
  const initialFontSize = useSettingsStore.getState().editorFontSize;

  return (
    <div
      ref={wrapperRef}
      className="monaco-host-wrapper relative flex h-full w-full overflow-hidden"
    >
      {effectiveBlameEnabled && (
        <EditorGitBlameGutter
          editor={editorInstance}
          monaco={monacoInstance ?? monacoRef.current}
          blameData={effectiveBlameData}
          blameStatus={effectiveBlameStatus}
          wrapperWidth={wrapperWidth}
          unavailableReason={effectiveUnavailableReason}
          isBusy={effectiveIsBusy}
          onRevealCommit={handleRevealCommit}
          onRefresh={handleRefreshBlame}
          onToggle={handleToggleBlame}
          onOpenContextMenu={setGutterContextMenu}
        />
      )}
      <div className="monaco-host-editor-container flex-1 min-w-0 h-full overflow-hidden">
        <Editor
          path={`inmemory://dam-hopper/${encodeURIComponent(tabKey)}`}
          keepCurrentModel={!!effectiveTab?.semanticProvenance && isSupportedSemanticPath(effectiveTab.path)}
          value={content}
          language={language}
          theme="vs-dark"
          onChange={(val, ev) => {
            if (!isAndroidChromeNativeInputSuppressed && !readOnly) {
              const newText = val ?? "";
              onChange(newText);
              if (effectiveTab && isSupportedSemanticPath(effectiveTab.path)) {
                const changes = (ev?.changes ?? []).map((change) => ({
                  range: {
                    start: monacoPositionToLsp({
                      lineNumber: change.range.startLineNumber,
                      column: change.range.startColumn,
                    }),
                    end: monacoPositionToLsp({
                      lineNumber: change.range.endLineNumber,
                      column: change.range.endColumn,
                    }),
                  },
                  rangeLength: change.rangeLength,
                  text: change.text,
                }));
                const client = useSemanticNavigationStore
                  .getState()
                  .findClientForTab(tabKey);
                if (semanticEnabled && effectiveTab.targetAvailable !== false && client?.canAccessModel(tabKey)) {
                  void client.notifyDidChange(tabKey, newText, changes.length > 0 ? changes : undefined);
                }
              }
            }
          }}
          onMount={handleMount}
          options={{
            fontSize: initialFontSize,
            fontFamily: "JetBrains Mono, Fira Code, Cascadia Code, monospace",
            lineNumbers: "on",
            glyphMargin: true,
            minimap: { enabled: !isDegraded },
            folding: !isDegraded,
            scrollBeyondLastLine: false,
            wordWrap: "off",
            renderWhitespace: "selection",
            tabSize: 2,
            automaticLayout: false,
            readOnly: isAndroidChromeNativeInputSuppressed || readOnly,
          }}
        />
      </div>

      {gutterContextMenu && (
        <EditorGitBlameContextMenu
          x={gutterContextMenu.x}
          y={gutterContextMenu.y}
          lineNumber={gutterContextMenu.lineNumber}
          blameEnabled={effectiveBlameEnabled}
          blameStatus={effectiveBlameStatus}
          blameData={effectiveBlameData}
          unavailableReason={effectiveUnavailableReason}
          isBusy={effectiveIsBusy}
          targetSnapshotId={gutterContextMenu.snapshotId}
          targetModelVersion={gutterContextMenu.modelVersion}
          onClose={() => setGutterContextMenu(null)}
          onToggleBlame={handleToggleBlame}
          onRefreshBlame={handleRefreshBlame}
          onRevealCommit={handleRevealCommit}
        />
      )}
    </div>
  );
}
