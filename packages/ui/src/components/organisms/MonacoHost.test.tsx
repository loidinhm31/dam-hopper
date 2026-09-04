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
