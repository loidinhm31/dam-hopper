/**
 * Read-only Monaco DiffEditor wrapper for Session Changes review.
 * Fully capability-free: strictly displays immutable sessionStart vs current content.
 */

import "@/lib/monaco-setup";
import { DiffEditor, useMonaco } from "@monaco-editor/react";
import type * as monacoNs from "monaco-editor";
import React, { useEffect, useRef, useState } from "react";
import { SplitSquareHorizontal, AlignJustify, AlertCircle, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectionRef } from "@/api/ownership";
import type { FileDetail } from "@/api/session-changes-types";
import { buildSessionChangesModelUri } from "@/lib/session-changes-model-uri";

export interface ReadonlyMonacoDiffViewerProps {
  fileDetail: FileDetail;
  owner: ConnectionRef;
  terminalId: string;
  terminalIncarnation: string;
  ompSessionId: string;
  rootId?: string;
  renderSideBySide?: boolean;
  onToggleSideBySide?: () => void;
  className?: string;
}

export function ReadonlyMonacoDiffViewer({
  fileDetail,
  owner,
  terminalId,
  terminalIncarnation,
  ompSessionId,
  rootId = ".",
  renderSideBySide = true,
  onToggleSideBySide,
  className,
}: ReadonlyMonacoDiffViewerProps) {
  const monaco = useMonaco();
  const diffEditorRef = useRef<monacoNs.editor.IStandaloneDiffEditor | null>(null);
  const activeModelsRef = useRef<{
    original: monacoNs.editor.ITextModel | null;
    modified: monacoNs.editor.ITextModel | null;
  }>({ original: null, modified: null });

  const { file, original, current, serverEpoch, baselineId, comparisonRevision } =
    fileDetail;

  // Language resolution from file extension
  const getLanguage = (path: string): string => {
    const ext = path.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
      case "tsx":
        return "typescript";
      case "js":
      case "jsx":
        return "javascript";
      case "rs":
        return "rust";
      case "json":
        return "json";
      case "md":
        return "markdown";
      case "html":
        return "html";
      case "css":
        return "css";
      case "toml":
        return "toml";
      case "yaml":
      case "yml":
        return "yaml";
      default:
        return "plaintext";
    }
  };

  // Safe deferred model creation and disposal
  useEffect(() => {
    if (!monaco || !fileDetail.renderable) return;

    const language = getLanguage(file.path);

    const origUriStr = buildSessionChangesModelUri({
      profileId: owner.profileId,
      generation: owner.generation,
      terminalId,
      terminalIncarnation,
      ompSessionId,
      rootId,
      serverEpoch,
      baselineId,
      comparisonRevision,
      path: file.path,
      side: "original",
    });

    const currUriStr = buildSessionChangesModelUri({
      profileId: owner.profileId,
      generation: owner.generation,
      terminalId,
      terminalIncarnation,
      ompSessionId,
      rootId,
      serverEpoch,
      baselineId,
      comparisonRevision,
      path: file.path,
      side: "current",
    });

    const origUri = monaco.Uri.parse(origUriStr);
    const currUri = monaco.Uri.parse(currUriStr);

    // Dispose prior matching models if any to prevent URI collision error
    const existingOrig = monaco.editor.getModel(origUri);
    if (existingOrig) existingOrig.dispose();
    const existingCurr = monaco.editor.getModel(currUri);
    if (existingCurr) existingCurr.dispose();

    const origContent = original.content ?? "";
    const currContent = current.content ?? "";

    const origModel = monaco.editor.createModel(origContent, language, origUri);
    const currModel = monaco.editor.createModel(currContent, language, currUri);

    activeModelsRef.current = { original: origModel, modified: currModel };

    if (diffEditorRef.current) {
      diffEditorRef.current.setModel({
        original: origModel,
        modified: currModel,
      });
    }

    return () => {
      if (diffEditorRef.current) {
        diffEditorRef.current.setModel(null);
      }
      origModel.dispose();
      currModel.dispose();
      activeModelsRef.current = { original: null, modified: null };
    };
  }, [
    monaco,
    fileDetail.renderable,
    file.path,
    original.content,
    current.content,
    owner.profileId,
    owner.generation,
    terminalId,
    terminalIncarnation,
    ompSessionId,
    rootId,
    serverEpoch,
    baselineId,
    comparisonRevision,
  ]);

  const handleEditorMount = (
    editor: monacoNs.editor.IStandaloneDiffEditor,
  ) => {
    diffEditorRef.current = editor;
    if (activeModelsRef.current.original && activeModelsRef.current.modified) {
      editor.setModel({
        original: activeModelsRef.current.original,
        modified: activeModelsRef.current.modified,
      });
    }
  };

  // If not renderable (binary or unknown provenance)
  if (!fileDetail.renderable) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center p-8 text-center h-full bg-[var(--color-surface)] text-[var(--color-text-muted)]",
          className,
        )}
        data-testid="unrenderable-diff-placeholder"
      >
        <AlertCircle className="w-10 h-10 mb-3 text-amber-500 opacity-80" />
        <h4 className="text-sm font-semibold text-[var(--color-text)] mb-1">
          Diff Unavailable
        </h4>
        <p className="text-xs max-w-md">
          {file.change === "unknown"
            ? "Historical presence is unknown (file was excluded or unproven at session start). Cannot display text diff."
            : "Binary or non-UTF8 file content cannot be displayed in text viewer."}
        </p>
        {file.reasons.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3 justify-center">
            {file.reasons.map((r) => (
              <span
                key={r}
                className="px-2 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20"
              >
                {r}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col h-full w-full bg-[var(--color-surface-2)] overflow-hidden",
        className,
      )}
      data-testid="readonly-monaco-diff-viewer"
    >
      {/* Read-only toolbar */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-1)] text-xs text-[var(--color-text-muted)]">
        <div className="flex items-center gap-2 overflow-hidden truncate">
          <FileText className="w-3.5 h-3.5 shrink-0" />
          <span className="font-mono text-[var(--color-text)] truncate">
            {file.path}
          </span>
          <span className="px-1.5 py-0.2 rounded text-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] uppercase tracking-wider">
            {file.change}
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)] opacity-70">
            Read-only
          </span>
        </div>

        {onToggleSideBySide && (
          <button
            type="button"
            onClick={onToggleSideBySide}
            aria-label={
              renderSideBySide ? "Switch to inline diff" : "Switch to split diff"
            }
            title={
              renderSideBySide ? "Switch to inline diff" : "Switch to split diff"
            }
            className="p-1 rounded hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
          >
            {renderSideBySide ? (
              <AlignJustify className="w-3.5 h-3.5" />
            ) : (
              <SplitSquareHorizontal className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Monaco DiffEditor */}
      <div className="flex-1 min-h-0 relative">
        <DiffEditor
          height="100%"
          options={{
            readOnly: true,
            originalEditable: false,
            domReadOnly: true,
            renderSideBySide,
            useInlineViewWhenSpaceIsLimited: false,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: "on",
            renderWhitespace: "selection",
            folding: true,
            wordWrap: "off",
          }}
          onMount={handleEditorMount}
        />
      </div>
    </div>
  );
}
