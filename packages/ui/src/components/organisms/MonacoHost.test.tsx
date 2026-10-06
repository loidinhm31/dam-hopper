// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonacoHost } from "./MonacoHost.js";

const mockPolicy = vi.hoisted(() => ({ enabled: false }));
let lastEditorProps: Record<string, unknown> | null = null;
let lastOnMount: ((editor: unknown, monaco: unknown) => void) | undefined;

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

vi.mock("@/lib/monaco-setup.js", () => ({}));

vi.mock("@/stores/settings.js", () => {
  const useSettingsStore = Object.assign(() => ({}), {
    getState: () => ({ editorFontSize: 13, editorZoomWheelEnabled: true }),
    subscribe: () => () => {},
  });
  return { useSettingsStore, clampFont: (value: number) => value };
});

vi.mock("@/hooks/use-shortcuts.js", () => ({
  addKeyboardShortcutListener: () => () => {},
  addWheelShortcutListener: () => () => {},
}));

vi.mock("@monaco-editor/react", () => ({
  default: (props: Record<string, unknown>) => {
    lastEditorProps = props;
    lastOnMount = props.onMount as typeof lastOnMount;
    return <div data-testid="monaco-editor" />;
  },
}));

describe("MonacoHost Android policy", () => {
  it("renders the regular editor read-only under Android policy", () => {
    mockPolicy.enabled = true;

    renderToStaticMarkup(
      <MonacoHost
        tabKey="tab-1"
        content="const answer = 42;"
        tier="normal"
        onChange={() => {}}
        onSave={() => {}}
        onViewStateChange={() => {}}
      />,
    );

    expect((lastEditorProps?.options as { readOnly?: boolean }).readOnly).toBe(
      true,
    );
    mockPolicy.enabled = false;
  });

  it("blurs an active editor surface when the policy blocks focus", () => {
    mockPolicy.enabled = true;

    renderToStaticMarkup(
      <MonacoHost
        tabKey="tab-2"
        content="const answer = 42;"
        tier="normal"
        onChange={() => {}}
        onSave={() => {}}
        onViewStateChange={() => {}}
      />,
    );

    const surface = document.createElement("div");
    const textarea = document.createElement("textarea");
    surface.append(textarea);
    document.body.append(surface);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    textarea.focus();

    const updateOptions = vi.fn();
    lastOnMount?.(
      {
        getDomNode: () => surface,
        updateOptions,
        addCommand: vi.fn(),
        onMouseDown: vi.fn(),
        onDidBlurEditorWidget: vi.fn(),
      },
      { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 1 } },
    );

    expect(updateOptions).toHaveBeenCalledWith({ readOnly: true });
    expect(document.activeElement).not.toBe(textarea);
    surface.remove();
    vi.unstubAllGlobals();
    mockPolicy.enabled = false;
  });
});

describe("MonacoHost viewState lifecycle persistence", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("calls onViewStateChange with viewState and tabKey on editor blur", async () => {
    const onViewStateChange = vi.fn();
    const mockViewState = {
      cursorState: [{ position: { lineNumber: 10, column: 1 } }],
    };
    let blurHandler: (() => void) | undefined;

    await act(async () => {
      root.render(
        <MonacoHost
          tabKey="tab-blur"
          content="code"
          tier="normal"
          onChange={() => {}}
          onSave={() => {}}
          onViewStateChange={onViewStateChange}
        />,
      );
    });

    const mockEditor = {
      getDomNode: () => document.createElement("div"),
      restoreViewState: vi.fn(),
      saveViewState: vi.fn(() => mockViewState),
      updateOptions: vi.fn(),
      addCommand: vi.fn(),
      onMouseDown: vi.fn(),
      onDidBlurEditorWidget: (cb: () => void) => {
        blurHandler = cb;
      },
      deltaDecorations: vi.fn(() => []),
    };

    lastOnMount?.(mockEditor, { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 1 } });

    blurHandler?.();
    expect(onViewStateChange).toHaveBeenCalledWith(mockViewState, "tab-blur");
  });

  it("persists previous tab's viewState when tabKey changes", async () => {
    const onViewStateChange = vi.fn();
    const mockViewState1 = {
      cursorState: [{ position: { lineNumber: 50, column: 5 } }],
    };

    await act(async () => {
      root.render(
        <MonacoHost
          tabKey="tab-1"
          content="file 1"
          tier="normal"
          onChange={() => {}}
          onSave={() => {}}
          onViewStateChange={onViewStateChange}
        />,
      );
    });

    const mockEditor = {
      getDomNode: () => document.createElement("div"),
      restoreViewState: vi.fn(),
      saveViewState: vi.fn(() => mockViewState1),
      updateOptions: vi.fn(),
      addCommand: vi.fn(),
      onMouseDown: vi.fn(),
      onDidBlurEditorWidget: vi.fn(),
      deltaDecorations: vi.fn(() => []),
    };

    lastOnMount?.(mockEditor, { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 1 } });

    await act(async () => {
      root.render(
        <MonacoHost
          tabKey="tab-2"
          content="file 2"
          tier="normal"
          onChange={() => {}}
          onSave={() => {}}
          onViewStateChange={onViewStateChange}
        />,
      );
    });

    expect(onViewStateChange).toHaveBeenCalledWith(mockViewState1, "tab-1");
  });

  it("persists viewState on component unmount", async () => {
    const onViewStateChange = vi.fn();
    const mockViewState = {
      cursorState: [{ position: { lineNumber: 99, column: 1 } }],
    };

    await act(async () => {
      root.render(
        <MonacoHost
          tabKey="tab-unmount"
          content="unmount test"
          tier="normal"
          onChange={() => {}}
          onSave={() => {}}
          onViewStateChange={onViewStateChange}
        />,
      );
    });

    const mockEditor = {
      getDomNode: () => document.createElement("div"),
      restoreViewState: vi.fn(),
      saveViewState: vi.fn(() => mockViewState),
      updateOptions: vi.fn(),
      addCommand: vi.fn(),
      onMouseDown: vi.fn(),
      onDidBlurEditorWidget: vi.fn(),
      deltaDecorations: vi.fn(() => []),
    };

    lastOnMount?.(mockEditor, { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 1 } });

    await act(async () => {
      root.unmount();
    });

    expect(onViewStateChange).toHaveBeenCalledWith(
      mockViewState,
      "tab-unmount",
    );
  });
});

describe("MonacoHost Git Blame and input guards", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      setTimeout(() => callback(0), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("guards Git line indicator clicks to primary mouse button only", async () => {
    const onGitIndicatorClick = vi.fn();
    let mouseDownHandler: ((event: unknown) => void) | undefined;

    await act(async () => {
      root.render(
        <MonacoHost
          tabKey="tab-mouse-guard"
          content="hello world"
          tier="normal"
          onChange={() => {}}
          onSave={() => {}}
          onViewStateChange={() => {}}
          onGitIndicatorClick={onGitIndicatorClick}
          lineChanges={[{ line: 5, length: 1, type: "modified" }]}
        />,
      );
    });

    const mockEditor = {
      getDomNode: () => document.createElement("div"),
      restoreViewState: vi.fn(),
      updateOptions: vi.fn(),
      addCommand: vi.fn(),
      onMouseDown: vi.fn((fn: (event: unknown) => void) => {
        mouseDownHandler = fn;
      }),
      onContextMenu: vi.fn(),
      addAction: vi.fn(),
      onDidBlurEditorWidget: vi.fn(),
      deltaDecorations: vi.fn(() => []),
    };

    lastOnMount?.(mockEditor, {
      KeyMod: { CtrlCmd: 1 },
      KeyCode: { KeyS: 1 },
      editor: {
        MouseTargetType: {
          GUTTER_GLYPH_MARGIN: 2,
          GUTTER_LINE_DECORATIONS: 3,
          GUTTER_LINE_NUMBERS: 4,
        },
      },
    });

    expect(mouseDownHandler).toBeDefined();

    // Right-click on line 5 glyph margin (button: 2, leftButton: false)
    mouseDownHandler?.({
      event: { leftButton: false, browserEvent: { button: 2 } },
      target: { position: { lineNumber: 5 }, type: 2 },
    });
    expect(onGitIndicatorClick).not.toHaveBeenCalled();

    // Left-click on line 5 glyph margin (button: 0, leftButton: true)
    mouseDownHandler?.({
      event: { leftButton: true, browserEvent: { button: 0 } },
      target: { position: { lineNumber: 5 }, type: 2 },
    });
    expect(onGitIndicatorClick).toHaveBeenCalledTimes(1);
  });

  it("renders EditorGitBlameGutter when blameEnabled is true", async () => {
    await act(async () => {
      root.render(
        <MonacoHost
          tabKey="tab-blame-gutter"
          content="hello"
          tier="normal"
          blameEnabled={true}
          blameStatus="loading"
          onChange={() => {}}
          onSave={() => {}}
          onViewStateChange={() => {}}
        />,
      );
    });

    const gutterEl = container.querySelector(
      "[data-testid='editor-git-blame-gutter']",
    );
    expect(gutterEl).not.toBeNull();
    const loadingEl = container.querySelector(
      "[data-testid='editor-git-blame-loading']",
    );
    expect(loadingEl).not.toBeNull();
  });

  it("handleRevealCommit dispatches only when model version, rootId, and ready status match", async () => {
    const onRevealCommit = vi.fn();
    const mockBlameData = {
      snapshotId: "snap-valid",
      modelVersion: 3,
      rootId: "vcs-root-main",
      rootRelativePath: "file.ts",
      baseCommitOid: "1111111111111111111111111111111111111111",
      bufferLineCount: 1,
      status: "ready" as const,
      ranges: [{ startLine: 1, lineCount: 1, commitIndex: 0 }],
      commits: [
        {
          hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          authorName: "Alice Dev",
          authorEmail: "alice@example.com",
          authorTimestamp: 1760000000,
          authorTimezoneOffsetMinutes: 0,
          subject: "feat: valid commit",
        },
      ],
    };

    await act(async () => {
      root.render(
        <MonacoHost
          tabKey="tab-reveal-guard"
          content="test line"
          tier="normal"
          blameEnabled={true}
          blameStatus="ready"
          blameData={mockBlameData}
          onRevealCommit={onRevealCommit}
          onChange={() => {}}
          onSave={() => {}}
          onViewStateChange={() => {}}
        />,
      );
    });

    let currentVersionId = 3;
    const mockEditor = {
      getDomNode: () => document.createElement("div"),
      getModel: () => ({
        getVersionId: () => currentVersionId,
        getValue: () => "test line",
        getLineCount: () => 1,
      }),
      restoreViewState: vi.fn(),
      updateOptions: vi.fn(),
      addCommand: vi.fn(),
      onMouseDown: vi.fn(),
      onContextMenu: vi.fn(),
      addAction: vi.fn(),
      onDidBlurEditorWidget: vi.fn(),
      deltaDecorations: vi.fn(() => []),
      getVisibleRanges: () => [{ startLineNumber: 1, endLineNumber: 1 }],
      getScrollTop: () => 0,
      getScrollHeight: () => 100,
      getLayoutInfo: () => ({ height: 200, width: 600 }),
      getTopForLineNumber: () => 0,
      getOption: () => 19,
    };

    await act(async () => {
      lastOnMount?.(mockEditor, {
        KeyMod: { CtrlCmd: 1 },
        KeyCode: { KeyS: 1 },
        editor: { MouseTargetType: {}, EditorOption: { lineHeight: 0 } },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Bounded row element rendered in gutter
    const rowEl = container.querySelector("[role='row']");
    expect(rowEl).not.toBeNull();

    // 1. Successful reveal when model version matches
    act(() => {
      rowEl?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0 }),
      );
    });
    expect(onRevealCommit).toHaveBeenCalledWith(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "vcs-root-main",
    );

    // 2. Reject reveal if model was modified (dirty buffer drift: version changed to 4)
    onRevealCommit.mockClear();
    currentVersionId = 4;
    act(() => {
      rowEl?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, button: 0 }),
      );
    });
    expect(onRevealCommit).not.toHaveBeenCalled();
  });
});
