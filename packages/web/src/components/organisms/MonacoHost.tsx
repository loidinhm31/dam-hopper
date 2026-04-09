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

interface MonacoHostProps {
  tabKey: string;
  content: string;
  tier: FileTier;
  mime?: string;
  viewState?: unknown;
  onChange: (value: string) => void;
  onSave: () => void;
  onViewStateChange: (vs: unknown) => void;
}

function mimeToLanguage(mime?: string, _tier?: FileTier): string {
  if (!mime) return "plaintext";
  if (mime.includes("typescript") || mime.includes("tsx")) return "typescript";
  if (mime.includes("javascript") || mime.includes("jsx")) return "javascript";
  if (mime.includes("json")) return "json";
  if (mime.includes("html")) return "html";
  if (mime.includes("css")) return "css";
  if (mime.includes("xml")) return "xml";
  if (mime.includes("markdown")) return "markdown";
  if (mime.includes("rust")) return "rust";
  if (mime.includes("python")) return "python";
  if (mime.includes("yaml")) return "yaml";
  if (mime.includes("toml")) return "toml";
  return "plaintext";
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
}: MonacoHostProps) {
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monacoNs | null>(null);
  const viewStateRef = useRef<unknown>(viewState);

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

      // Persist view state on blur
      editor.onDidBlurEditorWidget(() => {
        const vs = editor.saveViewState();
        if (vs) onViewStateChange(vs);
      });
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

  const isDegraded = tier === "degraded";
  const language = mimeToLanguage(mime);

  return (
    <Editor
      value={content}
      language={language}
      theme="vs-dark"
      onChange={(val) => onChange(val ?? "")}
      onMount={handleMount}
      options={{
        fontSize: 13,
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
