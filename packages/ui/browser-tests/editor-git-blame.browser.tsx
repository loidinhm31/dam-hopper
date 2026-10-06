import "@/lib/monaco-setup.js";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
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
      authorEmail: "carol@example.com",
      authorTimestamp: 1760010000,
      authorTimezoneOffsetMinutes: 0,
      subject: "init: header section",
    },
    {
      hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      authorName: "Dave Engineer",
      authorEmail: "dave@example.com",
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
  const [monacoInstance, setMonacoInstance] = React.useState<
    typeof monacoNs | null
  >(null);
  const [contextMenuState, setContextMenuState] = React.useState<{
    x: number;
    y: number;
    lineNumber: number | null;
  } | null>(null);

  const handleMount: OnMount = React.useCallback(
    (ed, monaco) => {
      ed.layout();
      setEditor(ed);
      setMonacoInstance(monaco);
      onMountCapture?.(ed);
    },
    [onMountCapture],
  );

  React.useEffect(() => {
    if (editor) {
      editor.layout();
    }
  }, [editor, wrapperWidth]);
  return (
    <div
      data-testid="blame-browser-wrapper"
      className="relative flex overflow-hidden border border-[var(--color-border)]"
      style={{ width: wrapperWidth, height: 400 }}
    >
      <EditorGitBlameGutter
        editor={editor}
        monaco={monacoInstance}
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
            automaticLayout: true,
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
async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 20,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });
  }
  throw new Error(`waitForCondition timed out after ${timeoutMs}ms`);
}

async function waitForEditor(
  getEditor: () => monacoNs.editor.IStandaloneCodeEditor | null,
  timeoutMs = 5000,
): Promise<monacoNs.editor.IStandaloneCodeEditor> {
  await waitForCondition(() => getEditor() !== null, timeoutMs);
  return getEditor()!;
}

async function waitForRows(
  container: HTMLElement,
  selector = "[role='row']",
  minCount = 1,
  timeoutMs = 5000,
): Promise<NodeListOf<Element>> {
  await waitForCondition(
    () => container.querySelectorAll(selector).length >= minCount,
    timeoutMs,
  );
  return container.querySelectorAll(selector);
}

describe("Real Monaco Git Blame browser regression", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    await loader.init();
  });

  beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "1000px";
    container.style.height = "600px";
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
    await act(async () => {
      root.render(<BlameBrowserHarness wrapperWidth={800} />);
    });

    // Wait for gutter to appear
    await waitForCondition(() => {
      const g = container.querySelector(
        "[data-testid='editor-git-blame-gutter']",
      );
      return g !== null;
    });

    // Width 800px: normal mode (220px)
    const gutter800 = container.querySelector(
      "[data-testid='editor-git-blame-gutter']",
    );
    expect(gutter800).not.toBeNull();
    expect(gutter800?.getAttribute("data-blame-mode")).toBe("normal");
    const styleWidth800 = (gutter800 as HTMLElement).style.width;
    expect(styleWidth800).toBe("220px");

    // Re-render at 639px: compact mode (min(120, 639/3) = 120px)
    await act(async () => {
      root.render(<BlameBrowserHarness wrapperWidth={639} />);
    });

    await waitForCondition(() => {
      const g = container.querySelector(
        "[data-testid='editor-git-blame-gutter']",
      );
      return g?.getAttribute("data-blame-mode") === "compact";
    });

    const gutter639 = container.querySelector(
      "[data-testid='editor-git-blame-gutter']",
    );
    expect(gutter639?.getAttribute("data-blame-mode")).toBe("compact");
    const styleWidth639 = (gutter639 as HTMLElement).style.width;
    expect(styleWidth639).toBe("120px");

    // Re-render at 300px: compact mode (min(120, 300/3) = 100px)
    await act(async () => {
      root.render(<BlameBrowserHarness wrapperWidth={300} />);
    });

    await waitForCondition(() => {
      const g = container.querySelector(
        "[data-testid='editor-git-blame-gutter']",
      );
      return (g as HTMLElement)?.style.width === "100px";
    });

    const gutter300 = container.querySelector(
      "[data-testid='editor-git-blame-gutter']",
    );
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

    const ed = await waitForEditor(() => editorInstance);
    expect(ed).not.toBeNull();

    // Wait for initial rows to be rendered
    await waitForRows(container, ".editor-blame-row[data-line]", 1);

    for (const lineHeight of [20, 31]) {
      await act(async () => {
        ed.updateOptions({ lineHeight });
        ed.layout();
      });

      // Wait for rows to update geometry to the new lineHeight
      await waitForCondition(() => {
        const row = container.querySelector(
          ".editor-blame-row[data-line='2']",
        ) as HTMLElement | null;
        if (!row) return false;
        return Math.abs(row.getBoundingClientRect().height - lineHeight) <= 0.5;
      });
      const committedRow = container.querySelector(
        ".editor-blame-row[data-line='2']",
      );
      expect(committedRow?.textContent).toContain("Carol Developer");
      const rows = container.querySelectorAll(".editor-blame-row[data-line]");
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const rowEl = row as HTMLElement;
        const lineNumber = Number(rowEl.dataset.line);
        const expectedTop =
          ed.getTopForLineNumber(lineNumber) - ed.getScrollTop();
        expect(rowEl.getBoundingClientRect().height).toBe(lineHeight);
        expect(
          Math.abs(parseFloat(rowEl.style.top) - expectedTop),
        ).toBeLessThanOrEqual(1);
      }
    }
  });

  it("handles keyboard navigation and commit reveal from annotation row", async () => {
    const onRevealCommit = vi.fn();
    let editorInstance: monacoNs.editor.IStandaloneCodeEditor | null = null;

    await act(async () => {
      root.render(
        <BlameBrowserHarness
          wrapperWidth={800}
          onMountCapture={(ed) => {
            editorInstance = ed;
          }}
          onRevealCommit={onRevealCommit}
        />,
      );
    });

    const ed = await waitForEditor(() => editorInstance);
    await act(async () => {
      ed.layout();
    });
    const rows = await waitForRows(container, "[role='row']", 3);

    expect(rows[0]?.textContent).toContain("Carol Developer");
    expect(rows[2]?.textContent).toContain("Uncommitted");
    const firstRow = rows[0] as HTMLElement;
    const uncommittedRow = rows[2] as HTMLElement;
    // Verify authorEmail in title/aria-label
    expect(firstRow.getAttribute("aria-label")).toContain("carol@example.com");

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

    // Mouse click on committed row triggers onRevealCommit
    onRevealCommit.mockClear();
    act(() => {
      firstRow.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          button: 0,
        }),
      );
    });
    expect(onRevealCommit).toHaveBeenCalledWith(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "repo-root-main",
    );

    // Mouse click on uncommitted row does NOT reveal
    onRevealCommit.mockClear();
    act(() => {
      uncommittedRow.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          button: 0,
        }),
      );
    });
    expect(onRevealCommit).not.toHaveBeenCalled();

    // Enter on uncommitted row does NOT reveal
    onRevealCommit.mockClear();
    act(() => {
      uncommittedRow.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }),
      );
    });
    expect(onRevealCommit).not.toHaveBeenCalled();
  });
});
