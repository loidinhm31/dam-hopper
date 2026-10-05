import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Editor, { type OnMount } from "@monaco-editor/react";
import type * as monacoNs from "monaco-editor";
import { EditorGitBlameGutter } from "@/components/organisms/EditorGitBlameGutter.js";
import { EditorGitBlameContextMenu } from "@/components/organisms/EditorGitBlameContextMenu.js";
import type { GitBlameResponse } from "@/api/client.js";
import "@/index.css";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const testBlameData: GitBlameResponse = {
  snapshotId: "browser-snap-01",
  modelVersion: 1,
  rootId: "repo-root-main",
  rootRelativePath: "src/sample.ts",
  baseCommitOid: "1234567890abcdef1234567890abcdef12345678",
  bufferLineCount: 6,
  status: "ready",
  ranges: [
    { startLine: 1, lineCount: 2, commitIndex: 0 },
    { startLine: 3, lineCount: 1, commitIndex: null }, // Uncommitted
    { startLine: 4, lineCount: 3, commitIndex: 1 },
  ],
  commits: [
    {
      hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      authorName: "Carol Developer",
      authorTimestamp: 1760010000,
      authorTimezoneOffsetMinutes: 0,
      subject: "init: header section",
    },
    {
      hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      authorName: "Dave Engineer",
      authorTimestamp: 1760020000,
      authorTimezoneOffsetMinutes: -240,
      subject: "feat: body implementation",
    },
  ],
};

const sampleCode = `// Line 1: Header
// Line 2: Author Carol
// Line 3: Modified line (uncommitted)
function calculateTotal() {
  const sum = 1 + 2;
  return sum;
}`;

interface BlameHarnessProps {
  wrapperWidth: number;
  onMountCapture?: (editor: monacoNs.editor.IStandaloneCodeEditor) => void;
  onRevealCommit?: (hash: string, rootId: string) => void;
}

function BlameBrowserHarness({
  wrapperWidth,
  onMountCapture,
  onRevealCommit,
}: BlameHarnessProps) {
  const [editor, setEditor] =
    React.useState<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const [contextMenuState, setContextMenuState] = React.useState<{
    x: number;
    y: number;
    lineNumber: number | null;
  } | null>(null);

  const handleMount: OnMount = React.useCallback(
    (ed) => {
      setEditor(ed);
      onMountCapture?.(ed);
    },
    [onMountCapture],
  );

  return (
    <div
      data-testid="blame-browser-wrapper"
      className="relative flex overflow-hidden border border-[var(--color-border)]"
      style={{ width: wrapperWidth, height: 400 }}
    >
      <EditorGitBlameGutter
        editor={editor}
        blameData={testBlameData}
        blameStatus="ready"
        wrapperWidth={wrapperWidth}
        onRevealCommit={onRevealCommit}
        onOpenContextMenu={setContextMenuState}
      />
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        <Editor
          height="100%"
          width="100%"
          language="typescript"
          value={sampleCode}
          theme="vs-dark"
          onMount={handleMount}
          options={{
            fontSize: 13,
            lineHeight: 20,
            lineNumbers: "on",
            folding: true,
            scrollBeyondLastLine: false,
            automaticLayout: false,
          }}
        />
      </div>

      {contextMenuState && (
        <EditorGitBlameContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          lineNumber={contextMenuState.lineNumber}
          blameEnabled={true}
          blameStatus="ready"
          blameData={testBlameData}
          onClose={() => setContextMenuState(null)}
          onToggleBlame={() => {}}
          onRefreshBlame={() => {}}
          onRevealCommit={onRevealCommit}
        />
      )}
    </div>
  );
}

describe("Real Monaco Git Blame browser regression", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("adjusts gutter column width and mode across 640px and 639px boundary", async () => {
    let editorInstance: monacoNs.editor.IStandaloneCodeEditor | null = null;

    await act(async () => {
      root.render(
        <BlameBrowserHarness
          wrapperWidth={800}
          onMountCapture={(ed) => {
            editorInstance = ed;
          }}
        />,
      );
    });

    // Wait for Monaco mount and rAF
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 150);
      await promise;
    });

    // Width 800px: normal mode (220px)
    const gutter800 = container.querySelector("[data-testid='editor-git-blame-gutter']");
    expect(gutter800).not.toBeNull();
    expect(gutter800?.getAttribute("data-blame-mode")).toBe("normal");
    const styleWidth800 = (gutter800 as HTMLElement).style.width;
    expect(styleWidth800).toBe("220px");

    // Re-render at 639px: compact mode (min(120, 639/3) = 120px)
    await act(async () => {
      root.render(
        <BlameBrowserHarness
          wrapperWidth={639}
          onMountCapture={(ed) => {
            editorInstance = ed;
          }}
        />,
      );
    });

    const gutter639 = container.querySelector("[data-testid='editor-git-blame-gutter']");
    expect(gutter639?.getAttribute("data-blame-mode")).toBe("compact");
    const styleWidth639 = (gutter639 as HTMLElement).style.width;
    expect(styleWidth639).toBe("120px");

    // Re-render at 300px: compact mode (min(120, 300/3) = 100px)
    await act(async () => {
      root.render(
        <BlameBrowserHarness
          wrapperWidth={300}
          onMountCapture={(ed) => {
            editorInstance = ed;
          }}
        />,
      );
    });

    const gutter300 = container.querySelector("[data-testid='editor-git-blame-gutter']");
    expect(gutter300?.getAttribute("data-blame-mode")).toBe("compact");
    const styleWidth300 = (gutter300 as HTMLElement).style.width;
    expect(styleWidth300).toBe("100px");
  });

  it("aligns visible rows with Monaco public line geometry within 1 CSS pixel", async () => {
    let editorInstance: monacoNs.editor.IStandaloneCodeEditor | null = null;

    await act(async () => {
      root.render(
        <BlameBrowserHarness
          wrapperWidth={700}
          onMountCapture={(ed) => {
            editorInstance = ed;
          }}
        />,
      );
    });

    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 200);
      await promise;
    });

    if (editorInstance) {
      const ed = editorInstance as monacoNs.editor.IStandaloneCodeEditor;
      const rows = container.querySelectorAll("[role='row']");

      for (let i = 0; i < rows.length; i++) {
        const rowEl = rows[i] as HTMLElement;
        const lineStr = rowEl.getAttribute("data-line");
        if (!lineStr) continue;
        const lineNumber = parseInt(lineStr, 10);

        const expectedTop = ed.getTopForLineNumber(lineNumber) - ed.getScrollTop();
        const actualTop = parseFloat(rowEl.style.top);

        // Alignment within 1 CSS pixel as mandated by A04 / contracts §6
        expect(Math.abs(actualTop - expectedTop)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("handles keyboard navigation and commit reveal from annotation row", async () => {
    const onRevealCommit = vi.fn();

    await act(async () => {
      root.render(
        <BlameBrowserHarness
          wrapperWidth={800}
          onRevealCommit={onRevealCommit}
        />,
      );
    });

    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 150);
      await promise;
    });

    const rows = container.querySelectorAll("[role='row']");
    if (rows.length > 0) {
      const firstRow = rows[0] as HTMLElement;

      // Pressing Enter on committed row triggers onRevealCommit
      act(() => {
        firstRow.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
          }),
        );
      });

      expect(onRevealCommit).toHaveBeenCalledWith(
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "repo-root-main",
      );
    }
  });
});
