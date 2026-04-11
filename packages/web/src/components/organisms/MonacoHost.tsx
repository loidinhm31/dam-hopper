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
import { useSearchUiStore } from "@/stores/searchUi.js";
import { mimeToMonacoLanguage } from "@/lib/mime-to-language.js";

interface MonacoHostProps {
  tabKey: string;
  content: string;
  tier: FileTier;
  mime?: string;
  viewState?: unknown;
  onChange: (value: string) => void;
  onSave: () => void;
  onViewStateChange: (vs: unknown) => void;
  onEditorReady?: (editor: monacoNs.editor.IStandaloneCodeEditor | null) => void;
}


export function MonacoHost({
  tabKey,
  content,
  tier,
  mime,
  viewState,
  onChange,
  onSave,
  onViewStateChange,
  onEditorReady,
}: MonacoHostProps) {
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monacoNs | null>(null);
  const viewStateRef = useRef<unknown>(viewState);
  const wheelEnabledRef = useRef(useSettingsStore.getState().editorZoomWheelEnabled);

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
        editor.restoreViewState(viewState as monacoNs.editor.ICodeEditorViewState);
      }

      // Ctrl+S / Cmd+S → save
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => onSave(),
      );

      // Ctrl+Shift+F → open search panel with current selection as initial query
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
        () => {
          const sel = editor.getSelection();
          const text = sel ? (editor.getModel()?.getValueInRange(sel) ?? "") : "";
          useSearchUiStore.getState().openWith(text.trim());
        },
      );

      onEditorReady?.(editor);

      // Persist view state on blur
      editor.onDidBlurEditorWidget(() => {
        const vs = editor.saveViewState();
        if (vs) onViewStateChange(vs);
      });

      // Ctrl+Shift+Wheel → zoom editor font (custom handler; Monaco's mouseWheelZoom only handles Ctrl)
      const domNode = editor.getDomNode();
      if (domNode) {
        const handleWheel = (e: WheelEvent) => {
          if (!e.ctrlKey || !e.shiftKey || !wheelEnabledRef.current) return;
          e.preventDefault();
          const delta = e.deltaY < 0 ? 1 : -1;
          const store = useSettingsStore.getState();
          store.saveDebounced({ editorFontSize: clampFont(store.editorFontSize + delta) });
        };
        domNode.addEventListener("wheel", handleWheel, { passive: false });
        // Cleanup stored on the editor instance for the unmount effect
        (editor as unknown as { _wheelCleanup?: () => void })._wheelCleanup = () =>
          domNode.removeEventListener("wheel", handleWheel);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabKey], // re-run only when tab changes
  );

  // Restore view state when switching tabs (content ref changes)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !viewState) return;
    editor.restoreViewState(viewState as monacoNs.editor.ICodeEditorViewState);
  }, [tabKey, viewState]);

  // Subscribe to settings store — update Monaco font + keep wheel flag in sync
  useEffect(() => {
    const unsub = useSettingsStore.subscribe((s) => {
      wheelEnabledRef.current = s.editorZoomWheelEnabled;
      editorRef.current?.updateOptions({ fontSize: s.editorFontSize });
    });
    return () => {
      unsub();
      onEditorReady?.(null);
      // Clean up wheel listener attached in handleMount
      const ed = editorRef.current;
      if (ed) {
        (ed as unknown as { _wheelCleanup?: () => void })._wheelCleanup?.();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDegraded = tier === "degraded";
  const language = mimeToMonacoLanguage(mime);
  const initialFontSize = useSettingsStore.getState().editorFontSize;

  return (
    <Editor
      value={content}
      language={language}
      theme="vs-dark"
      onChange={(val) => onChange(val ?? "")}
      onMount={handleMount}
      options={{
        fontSize: initialFontSize,
        fontFamily: "JetBrains Mono, Fira Code, Cascadia Code, monospace",
        lineNumbers: "on",
        minimap: { enabled: !isDegraded },
        folding: !isDegraded,
        scrollBeyondLastLine: false,
        wordWrap: "off",
        renderWhitespace: "selection",
        tabSize: 2,
        automaticLayout: true,
        readOnly: false,
      }}
    />
  );
}
