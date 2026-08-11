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
import { useCallback, useEffect, useRef } from "react";
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

interface MonacoHostProps {
  tabKey: string;
  path?: string;
  content: string;
  tier: FileTier;
  mime?: string;
  viewState?: unknown;
  onChange: (value: string) => void;
  onSave: () => void;
  onViewStateChange: (vs: unknown) => void;
  onEditorReady?: (
    editor: monacoNs.editor.IStandaloneCodeEditor | null,
  ) => void;
  /** Test-only seam for pinned-Monaco compatibility gates. */
  onMonacoReady?: (monaco: typeof monacoNs) => void;
  lineChanges?: GitLineChange[];
  onGitIndicatorClick?: () => void;
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
  onMonacoReady,
  lineChanges,
  onGitIndicatorClick,
}: MonacoHostProps) {
  const { isAndroidChromeNativeInputSuppressed } =
    useAndroidChromeInputPolicy();
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monacoNs | null>(null);
  const viewStateRef = useRef<unknown>(viewState);
  const lineChangesRef = useRef<GitLineChange[]>(lineChanges ?? []);
  const onGitIndicatorClickRef = useRef(onGitIndicatorClick);
  const gitDecorationIdsRef = useRef<string[]>([]);
  const wheelEnabledRef = useRef(
    useSettingsStore.getState().editorZoomWheelEnabled,
  );

  // Persist latest onSave ref so the Ctrl+S command always calls the current handler
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  });

  useEffect(() => {
    lineChangesRef.current = lineChanges ?? [];
    onGitIndicatorClickRef.current = onGitIndicatorClick;
  }, [lineChanges, onGitIndicatorClick]);

  // Persist latest viewState ref so blur handler always saves current state
  useEffect(() => {
    viewStateRef.current = viewState;
  });

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // Restore view state (cursor pos, folds, scroll)
      if (viewState) {
        editor.restoreViewState(
          viewState as monacoNs.editor.ICodeEditorViewState,
        );
      }

      if (isAndroidChromeNativeInputSuppressed) {
        editor.updateOptions({ readOnly: true });
        blurEditorSurface(editor);
      }

      // Ctrl+S / Cmd+S → save (use ref so the latest handleSave is always called)
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
        isAndroidChromeNativeInputSuppressed ? undefined : onSaveRef.current(),
      );

      editor.onMouseDown((event) => {
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

      onEditorReady?.(editor);
      onMonacoReady?.(monaco);

      // Persist view state on blur
      editor.onDidBlurEditorWidget(() => {
        const vs = editor.saveViewState();
        if (vs) onViewStateChange(vs);
      });

      // ResizeObserver layout — avoids automaticLayout's internal polling overhead.
      const editorDomNode = editor.getDomNode();
      const layoutContainer = editorDomNode?.parentElement;
      if (layoutContainer) {
        const ro = new ResizeObserver(() => {
          editor.layout();
        });
        ro.observe(layoutContainer);
        (editor as unknown as { _roCleanup?: () => void })._roCleanup = () =>
          ro.disconnect();
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
        (editor as unknown as { _wheelCleanup?: () => void })._wheelCleanup =
          () => {
            cleanupTextSearch();
            cleanupFilenameSearch();
            cleanupWheel();
          };
      }
    },
    // Re-run when the tab or platform policy changes; refs keep other callbacks current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAndroidChromeNativeInputSuppressed, tabKey],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({ readOnly: isAndroidChromeNativeInputSuppressed });
    if (isAndroidChromeNativeInputSuppressed) blurEditorSurface(editor);
  }, [isAndroidChromeNativeInputSuppressed]);

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
      onEditorReady?.(null);
      const ed = editorRef.current;
      if (ed) {
        ed.deltaDecorations(gitDecorationIdsRef.current, []);
        (ed as unknown as { _roCleanup?: () => void })._roCleanup?.();
        (ed as unknown as { _wheelCleanup?: () => void })._wheelCleanup?.();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDegraded = tier === "degraded";
  const language = mimeToMonacoLanguage(mime, path);
  const initialFontSize = useSettingsStore.getState().editorFontSize;

  return (
    <Editor
      value={content}
      language={language}
      theme="vs-dark"
      onChange={(val) => {
        if (!isAndroidChromeNativeInputSuppressed) onChange(val ?? "");
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
        readOnly: isAndroidChromeNativeInputSuppressed,
      }}
    />
  );
}
