import { useEffect, useRef, useState } from "react";
import type * as monacoNs from "monaco-editor";

interface EditorStatusBarProps {
  editor: monacoNs.editor.IStandaloneCodeEditor | null;
  language: string;
}

export function EditorStatusBar({ editor, language }: EditorStatusBarProps) {
  const [position, setPosition] = useState({ line: 1, col: 1 });
  const [lineCount, setLineCount] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!editor) {
      setPosition({ line: 1, col: 1 });
      setLineCount(null);
      return;
    }

    // Seed initial values
    const pos = editor.getPosition();
    if (pos) setPosition({ line: pos.lineNumber, col: pos.column });
    setLineCount(editor.getModel()?.getLineCount() ?? null);

    const cursorDisposable = editor.onDidChangeCursorPosition((e) => {
      setPosition({ line: e.position.lineNumber, col: e.position.column });
    });

    const contentDisposable = editor.onDidChangeModelContent(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setLineCount(editor.getModel()?.getLineCount() ?? null);
      }, 150);
    });

    return () => {
      cursorDisposable.dispose();
      contentDisposable.dispose();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="shrink-0 h-[22px] flex items-center gap-3 px-3 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] text-[11px] text-[var(--color-text-muted)] select-none">
      <span>
        Ln {position.line}, Col {position.col}
      </span>
      {lineCount !== null && (
        <>
          <span className="opacity-40">•</span>
          <span>{lineCount} lines</span>
        </>
      )}
      <span className="opacity-40">•</span>
      <span>{language}</span>
    </div>
  );
}
