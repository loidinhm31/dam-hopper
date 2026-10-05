import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as monacoNs from "monaco-editor";
import { Loader2 } from "lucide-react";
import type { GitBlameResponse } from "@/api/client.js";
import type { EditorGitBlameStatus } from "@/hooks/use-editor-git-blame.js";
import {
  computeBlameGutterLayout,
  computeVisibleBlameRows,
  type RenderedBlameRow,
} from "@/lib/editor-git-blame-gutter-layout.js";
import { EditorGitBlameRow } from "@/components/molecules/EditorGitBlameRow.js";
import { useBlameGutterWheelSync } from "@/hooks/use-blame-gutter-wheel-sync.js";

export {
  computeBlameGutterLayout,
  type BlameGutterLayout,
  type RenderedBlameRow,
} from "@/lib/editor-git-blame-gutter-layout.js";

export interface EditorGitBlameGutterProps {
  editor: monacoNs.editor.IStandaloneCodeEditor | null;
  blameData: GitBlameResponse | null;
  blameStatus: EditorGitBlameStatus;
  wrapperWidth: number;
  unavailableReason?: string | null;
  isBusy?: boolean;
  onRevealCommit?: (commitHash: string, rootId: string) => void;
  onRefresh?: () => void;
  onToggle?: (enabled?: boolean) => void;
  onOpenContextMenu?: (menuState: {
    x: number;
    y: number;
    lineNumber: number | null;
    snapshotId?: string;
    modelVersion?: number;
  }) => void;
}

export function EditorGitBlameGutter({
  editor,
  blameData,
  blameStatus,
  wrapperWidth,
  unavailableReason,
  onRevealCommit,
  onOpenContextMenu,
}: EditorGitBlameGutterProps) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const layout = computeBlameGutterLayout(wrapperWidth || 800);
  const [visibleRows, setVisibleRows] = useState<RenderedBlameRow[]>([]);
  const rafIdRef = useRef<number | null>(null);

  const updateVisibleRows = useCallback(() => {
    if (!editor || blameStatus !== "ready" || !blameData) {
      setVisibleRows([]);
      return;
    }
    const rows = computeVisibleBlameRows({ editor, blameData });
    setVisibleRows(rows);
  }, [editor, blameStatus, blameData]);

  const scheduleUpdate = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      updateVisibleRows();
    });
  }, [updateVisibleRows]);

  useEffect(() => {
    scheduleUpdate();
  }, [blameData, blameStatus, scheduleUpdate]);

  useEffect(() => {
    if (!editor) return;

    const disposables: Array<{ dispose: () => void }> = [];

    if (typeof editor.onDidScrollChange === "function") {
      disposables.push(editor.onDidScrollChange(() => scheduleUpdate()));
    }
    if (typeof editor.onDidChangeModel === "function") {
      disposables.push(editor.onDidChangeModel(() => scheduleUpdate()));
    }
    if (typeof editor.onDidChangeModelContent === "function") {
      disposables.push(editor.onDidChangeModelContent(() => scheduleUpdate()));
    }
    if (typeof editor.onDidChangeConfiguration === "function") {
      disposables.push(editor.onDidChangeConfiguration(() => scheduleUpdate()));
    }
    if (typeof editor.onDidLayoutChange === "function") {
      disposables.push(editor.onDidLayoutChange(() => scheduleUpdate()));
    }

    const editorWithHidden = editor as unknown as {
      onDidChangeHiddenAreas?: (cb: () => void) => { dispose: () => void };
    };
    if (typeof editorWithHidden.onDidChangeHiddenAreas === "function") {
      disposables.push(
        editorWithHidden.onDidChangeHiddenAreas(() => scheduleUpdate()),
      );
    }

    scheduleUpdate();

    return () => {
      for (const d of disposables) d.dispose();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [editor, scheduleUpdate]);

  // Synchronize wheel scrolling without page trap
  useBlameGutterWheelSync(gutterRef, editor);

  return (
    <div
      ref={gutterRef}
      data-testid="editor-git-blame-gutter"
      data-blame-mode={layout.mode}
      role="region"
      aria-label="Git Blame Annotations"
      className="editor-blame-gutter select-none shrink-0 overflow-hidden relative border-r border-[var(--color-border)]"
      style={{ width: layout.width }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenContextMenu?.({
          x: e.clientX,
          y: e.clientY,
          lineNumber: null,
          snapshotId: blameData?.snapshotId,
          modelVersion: blameData?.modelVersion,
        });
      }}
    >
      {blameStatus === "loading" || blameStatus === "waiting" ? (
        <div
          data-testid="editor-git-blame-loading"
          className="flex h-full items-center justify-center text-xs text-[var(--color-text-muted)]"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1 text-[var(--color-text-muted)]" />
          <span className="text-[10px]">Loading blame…</span>
        </div>
      ) : blameStatus === "unavailable" ? (
        <div
          data-testid="editor-git-blame-unavailable"
          className="p-2 text-[10px] text-[var(--color-text-muted)] italic truncate"
          title={unavailableReason ?? "Git blame unavailable for this file"}
        >
          {unavailableReason ?? "Blame unavailable"}
        </div>
      ) : blameStatus === "error" ? (
        <div
          data-testid="editor-git-blame-error"
          className="p-2 text-[10px] text-[var(--color-danger)] truncate"
          title="Failed to load Git blame annotations"
        >
          Failed to load blame
        </div>
      ) : blameStatus === "ready" && blameData ? (
        <div
          data-testid="editor-git-blame-rows-container"
          className="relative w-full h-full overflow-hidden"
        >
          {visibleRows.map((row) => (
            <EditorGitBlameRow
              key={`${blameData.snapshotId}:${row.lineNumber}`}
              row={row}
              layoutMode={layout.mode}
              rootId={blameData.rootId}
              snapshotId={blameData.snapshotId}
              modelVersion={blameData.modelVersion}
              onContextMenu={(e, line) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenContextMenu?.({
                  x: e.clientX,
                  y: e.clientY,
                  lineNumber: line,
                  snapshotId: blameData.snapshotId,
                  modelVersion: blameData.modelVersion,
                });
              }}
              onRevealCommit={onRevealCommit}
              onOpenContextMenu={onOpenContextMenu}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
