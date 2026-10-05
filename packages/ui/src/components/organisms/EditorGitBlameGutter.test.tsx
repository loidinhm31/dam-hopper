// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeBlameGutterLayout,
  computeVisibleBlameRows,
} from "@/lib/editor-git-blame-gutter-layout.js";
import { EditorGitBlameGutter } from "./EditorGitBlameGutter.js";
import { EditorGitBlameContextMenu } from "./EditorGitBlameContextMenu.js";
import type { GitBlameResponse } from "@/api/client.js";
import type * as monacoNs from "monaco-editor";

const mockBlameData: GitBlameResponse = {
  snapshotId: "snap-1234",
  modelVersion: 1,
  rootId: "vcs-root-1",
  rootRelativePath: "src/file.ts",
  baseCommitOid: "abcdef1234567890abcdef1234567890abcdef12",
  bufferLineCount: 3,
  status: "ready",
  ranges: [
    { startLine: 1, lineCount: 1, commitIndex: 0 },
    { startLine: 2, lineCount: 1, commitIndex: null }, // Uncommitted
    { startLine: 3, lineCount: 1, commitIndex: 1 },
  ],
  commits: [
    {
      hash: "1111111111111111111111111111111111111111",
      authorName: "Alice Smith",
      authorTimestamp: 1760000000,
      authorTimezoneOffsetMinutes: 120,
      subject: "feat: add first line",
    },
    {
      hash: "2222222222222222222222222222222222222222",
      authorName: "Bob Jones",
      authorTimestamp: 1760100000,
      authorTimezoneOffsetMinutes: -300,
      subject: "fix: update third line",
    },
  ],
};

function createMockEditor(overrides?: Partial<monacoNs.editor.IStandaloneCodeEditor>) {
  const visibleRanges = [
    {
      startLineNumber: 1,
      endLineNumber: 3,
      startColumn: 1,
      endColumn: 1,
    },
  ];

  return {
    getModel: () => ({
      getValue: () => "line 1\nline 2\nline 3",
      getLineCount: () => 3,
      getVersionId: () => 1,
    }),
    getVisibleRanges: () => visibleRanges,
    getScrollTop: () => 0,
    getScrollHeight: () => 300,
    getLayoutInfo: () => ({ height: 500, width: 800 }),
    getTopForLineNumber: (line: number) => (line - 1) * 20,
    getOption: () => 20, // lineHeight = 20
    setScrollTop: vi.fn(),
    onDidScrollChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeModel: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    onDidLayoutChange: vi.fn(() => ({ dispose: vi.fn() })),
    ...overrides,
  } as unknown as monacoNs.editor.IStandaloneCodeEditor;
}

describe("EditorGitBlame layout & calculations", () => {
  it("computes normal layout for wrapperWidth >= 640px", () => {
    expect(computeBlameGutterLayout(640)).toEqual({ width: 220, mode: "normal" });
    expect(computeBlameGutterLayout(800)).toEqual({ width: 220, mode: "normal" });
    expect(computeBlameGutterLayout(1920)).toEqual({ width: 220, mode: "normal" });
  });

  it("computes compact layout for wrapperWidth < 640px bounded by min(120, wrapperWidth / 3)", () => {
    // 639 / 3 = 213 -> capped at 120
    expect(computeBlameGutterLayout(639)).toEqual({ width: 120, mode: "compact" });
    expect(computeBlameGutterLayout(500)).toEqual({ width: 120, mode: "compact" });
    // 300 / 3 = 100
    expect(computeBlameGutterLayout(300)).toEqual({ width: 100, mode: "compact" });
    // 150 / 3 = 50
    expect(computeBlameGutterLayout(150)).toEqual({ width: 50, mode: "compact" });
    // 0 -> min 1
    expect(computeBlameGutterLayout(0)).toEqual({ width: 1, mode: "compact" });
  });

  it("computes visible blame rows with correct committed and uncommitted attribution", () => {
    const editor = createMockEditor();
    const rows = computeVisibleBlameRows({ editor, blameData: mockBlameData });

    expect(rows).toHaveLength(3);

    // Line 1: Committed (Alice Smith)
    expect(rows[0].lineNumber).toBe(1);
    expect(rows[0].top).toBe(0);
    expect(rows[0].height).toBe(20);
    expect(rows[0].isUncommitted).toBe(false);
    expect(rows[0].displayAuthor).toBe("Alice Smith");
    expect(rows[0].commit?.hash).toBe("1111111111111111111111111111111111111111");
    expect(rows[0].hoverMetadata).toContain("Alice Smith");
    expect(rows[0].hoverMetadata).toContain("feat: add first line");

    // Line 2: Uncommitted (no fabricated commit or link)
    expect(rows[1].lineNumber).toBe(2);
    expect(rows[1].top).toBe(20);
    expect(rows[1].isUncommitted).toBe(true);
    expect(rows[1].displayAuthor).toBe("Uncommitted");
    expect(rows[1].displayDate).toBe("");
    expect(rows[1].commit).toBeNull();
    expect(rows[1].hoverMetadata).toBe("Line 2: Uncommitted changes");

    // Line 3: Committed (Bob Jones)
    expect(rows[2].lineNumber).toBe(3);
    expect(rows[2].top).toBe(40);
    expect(rows[2].isUncommitted).toBe(false);
    expect(rows[2].displayAuthor).toBe("Bob Jones");
    expect(rows[2].commit?.hash).toBe("2222222222222222222222222222222222222222");
    expect(rows[2].hoverMetadata).toContain("Bob Jones");
  });

  it("returns empty rows if editor has no model or lines are outside viewport", () => {
    const editorNoModel = createMockEditor({ getModel: () => null });
    expect(computeVisibleBlameRows({ editor: editorNoModel, blameData: mockBlameData })).toEqual([]);

    // Lines outside viewport
    const editorFarAway = createMockEditor({
      getTopForLineNumber: () => 10000,
      getLayoutInfo: () => ({ height: 500, width: 800 }),
    });
    expect(computeVisibleBlameRows({ editor: editorFarAway, blameData: mockBlameData })).toEqual([]);
  });
});

describe("EditorGitBlameGutter component states", () => {
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

  it("renders loading state with spinner when loading or waiting", () => {
    act(() => {
      root.render(
        <EditorGitBlameGutter
          editor={null}
          blameData={null}
          blameStatus="loading"
          wrapperWidth={800}
        />,
      );
    });

    const loadingEl = container.querySelector("[data-testid='editor-git-blame-loading']");
    expect(loadingEl).not.toBeNull();
    expect(loadingEl?.textContent).toContain("Loading blame…");
  });

  it("renders unavailable state with explanatory reason", () => {
    act(() => {
      root.render(
        <EditorGitBlameGutter
          editor={null}
          blameData={null}
          blameStatus="unavailable"
          unavailableReason="Not a Git repository"
          wrapperWidth={800}
        />,
      );
    });

    const unavailEl = container.querySelector("[data-testid='editor-git-blame-unavailable']");
    expect(unavailEl).not.toBeNull();
    expect(unavailEl?.textContent).toContain("Not a Git repository");
  });

  it("renders error state when blame encounters error", () => {
    act(() => {
      root.render(
        <EditorGitBlameGutter
          editor={null}
          blameData={null}
          blameStatus="error"
          wrapperWidth={800}
        />,
      );
    });

    const errorEl = container.querySelector("[data-testid='editor-git-blame-error']");
    expect(errorEl).not.toBeNull();
    expect(errorEl?.textContent).toContain("Failed to load blame");
  });

  it("renders rows and handles context menu and keyboard interaction in ready state", async () => {
    const editor = createMockEditor();
    const onOpenContextMenu = vi.fn();
    const onRevealCommit = vi.fn();

    await act(async () => {
      root.render(
        <EditorGitBlameGutter
          editor={editor}
          blameData={mockBlameData}
          blameStatus="ready"
          wrapperWidth={800}
          onOpenContextMenu={onOpenContextMenu}
          onRevealCommit={onRevealCommit}
        />,
      );
    });

    // Wait for rAF update
    await act(async () => {
      const { promise, resolve } = Promise.withResolvers<void>();
      requestAnimationFrame(() => resolve());
      await promise;
    });

    const rows = container.querySelectorAll("[role='row']");
    expect(rows.length).toBe(3);

    // Row 1: Alice Smith
    expect(rows[0].textContent).toContain("Alice Smith");
    expect(rows[0].getAttribute("aria-label")).toContain("Alice Smith");

    // Row 2: Uncommitted
    expect(rows[1].textContent).toContain("Uncommitted");
    expect(rows[1].getAttribute("data-uncommitted")).toBe("true");

    // Right-click on row 1 triggers onOpenContextMenu with lineNumber: 1
    act(() => {
      rows[0].dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 100,
          clientY: 50,
        }),
      );
    });
    expect(onOpenContextMenu).toHaveBeenCalledWith({
      x: 100,
      y: 50,
      lineNumber: 1,
      snapshotId: "snap-1234",
      modelVersion: 1,
    });

    // Press Enter on row 1 (committed) calls onRevealCommit
    act(() => {
      rows[0].dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }),
      );
    });
    expect(onRevealCommit).toHaveBeenCalledWith(
      "1111111111111111111111111111111111111111",
      "vcs-root-1",
    );

    // Press Enter on row 2 (uncommitted) does NOT call onRevealCommit
    onRevealCommit.mockClear();
    act(() => {
      rows[1].dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }),
      );
    });
    expect(onRevealCommit).not.toHaveBeenCalled();
  });
});

describe("EditorGitBlameContextMenu component", () => {
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

  it("renders toggle action and handles commit reveal for committed lines", () => {
    const onToggleBlame = vi.fn();
    const onRefreshBlame = vi.fn();
    const onRevealCommit = vi.fn();
    const onClose = vi.fn();

    act(() => {
      root.render(
        <EditorGitBlameContextMenu
          x={100}
          y={200}
          lineNumber={1}
          blameEnabled={true}
          blameStatus="ready"
          blameData={mockBlameData}
          onClose={onClose}
          onToggleBlame={onToggleBlame}
          onRefreshBlame={onRefreshBlame}
          onRevealCommit={onRevealCommit}
        />,
      );
    });

    const menu = document.body.querySelector("[data-testid='editor-git-blame-menu']");
    expect(menu).not.toBeNull();

    const toggleItem = document.body.querySelector("[data-testid='editor-git-blame-menu-toggle']");
    expect(toggleItem?.textContent).toContain("Hide Git Blame Annotations");

    const refreshItem = document.body.querySelector("[data-testid='editor-git-blame-menu-refresh']");
    expect(refreshItem?.textContent).toContain("Refresh Annotations");

    const revealItem = document.body.querySelector("[data-testid='editor-git-blame-menu-reveal']");
    expect(revealItem?.textContent).toContain("Show Commit in Git");
    expect(revealItem?.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("disables Show Commit in Git for uncommitted line", () => {
    act(() => {
      root.render(
        <EditorGitBlameContextMenu
          x={100}
          y={200}
          lineNumber={2} // line 2 is uncommitted
          blameEnabled={true}
          blameStatus="ready"
          blameData={mockBlameData}
          onClose={() => {}}
          onToggleBlame={() => {}}
          onRefreshBlame={() => {}}
        />,
      );
    });

    const revealItem = document.body.querySelector("[data-testid='editor-git-blame-menu-reveal']");
    expect(revealItem).not.toBeNull();
    expect(revealItem?.getAttribute("aria-disabled")).toBe("true");
    expect(revealItem?.getAttribute("title")).toBe("Uncommitted changes");
  });

  it("disables Show Commit in Git when buffer snapshot ID changed", () => {
    act(() => {
      root.render(
        <EditorGitBlameContextMenu
          x={100}
          y={200}
          lineNumber={1}
          blameEnabled={true}
          blameStatus="ready"
          blameData={mockBlameData}
          targetSnapshotId="stale-old-snapshot"
          onClose={() => {}}
          onToggleBlame={() => {}}
          onRefreshBlame={() => {}}
        />,
      );
    });

    const revealItem = document.body.querySelector("[data-testid='editor-git-blame-menu-reveal']");
    expect(revealItem).not.toBeNull();
    expect(revealItem?.getAttribute("aria-disabled")).toBe("true");
    expect(revealItem?.getAttribute("title")).toBe("Buffer changed; refresh annotations");
  });
});
