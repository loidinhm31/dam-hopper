// @vitest-environment jsdom
import { vi } from "vitest";

vi.hoisted(() => {
  if (
    typeof document !== "undefined" &&
    !("queryCommandSupported" in document)
  ) {
    (document as unknown as Record<string, unknown>).queryCommandSupported =
      () => false;
  }
  if (typeof window !== "undefined" && !window.CSS) {
    (window as unknown as Record<string, unknown>).CSS = {
      escape: (s: string) => s,
    };
  }
  if (typeof window !== "undefined" && !window.matchMedia) {
    (window as unknown as Record<string, unknown>).matchMedia = () => ({
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
});
vi.mock("@/lib/monaco-setup.js", () => ({}));
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MonacoHost } from "./MonacoHost.js";
import { defaultSemanticModelRegistry } from "@/lib/semantic-model-uri.js";
import { useSemanticNavigationStore } from "@/stores/semantic-navigation.js";
import type { Tab } from "@/stores/editor.js";
import type { SemanticClient } from "@/api/semantic-client.js";

let lastEditorProps: Record<string, unknown> | null = null;
let lastOnMount: ((editor: unknown, monaco: unknown) => void) | undefined;

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: false,
  }),
}));

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

describe("MonacoHost Semantic Integration", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let mockClient: Partial<SemanticClient>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    lastEditorProps = null;
    lastOnMount = undefined;
    defaultSemanticModelRegistry.clearAll();

    mockClient = {
      getStatus: vi.fn().mockReturnValue("ready"),
      notifyDidOpen: vi.fn().mockResolvedValue(undefined),
      notifyDidChange: vi.fn().mockResolvedValue(2),
      notifyDidClose: vi.fn(),
    };

    useSemanticNavigationStore.getState().disconnectAll();
    useSemanticNavigationStore.setState({
      globalSemanticEnabled: true,
      activeRevealIntent: null,
      clientStatuses: { "default::test-proj::gen_1": "ready" },
    });
    vi.spyOn(
      useSemanticNavigationStore.getState(),
      "getClient",
    ).mockReturnValue(mockClient as SemanticClient);
    vi.spyOn(
      useSemanticNavigationStore.getState(),
      "findClientForTab",
    ).mockReturnValue(mockClient as SemanticClient);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container?.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
    useSemanticNavigationStore.getState().disconnectAll();
  });

  it("registers model on mount, preserves on unmount, and consumes reveal intent", () => {
    const tabKey = "tab-main";
    const tab: Partial<Tab> = {
      key: tabKey,
      path: "src/index.ts",
      project: "test-proj",
      targetKey: "target-1",
      target: {
        project: "test-proj",
        profileId: "default",
      } as unknown as Tab["target"],
    };

    // Pre-seed a reveal intent
    useSemanticNavigationStore.getState().setRevealIntent({
      targetId: "target-1",
      profileId: "default",
      project: "test-proj",
      targetKey: "target-1",
      relativePath: "src/index.ts",
      range: {
        startLineNumber: 15,
        startColumn: 3,
        endLineNumber: 15,
        endColumn: 20,
      },
      createdAt: Date.now(),
    });

    act(() => {
      root?.render(
        <MonacoHost
          tabKey={tabKey}
          path="src/index.ts"
          content="const x = 42;\n"
          tier="normal"
          onChange={() => {}}
          onSave={() => {}}
          onViewStateChange={() => {}}
          tab={tab as Tab}
        />,
      );
    });

    const mockEditor = {
      restoreViewState: vi.fn(),
      saveViewState: vi.fn(),
      deltaDecorations: vi.fn().mockReturnValue([]),
      updateOptions: vi.fn(),
      addCommand: vi.fn(),
      addAction: vi.fn(),
      onMouseDown: vi.fn(),
      onContextMenu: vi.fn(),
      onKeyDown: vi.fn(),
      onDidBlurEditorWidget: vi.fn(),
      onDidChangeCursorPosition: vi.fn(),
      onDidScrollChange: vi.fn(),
      revealRangeInCenter: vi.fn(),
      setSelection: vi.fn(),
      focus: vi.fn(),
      getDomNode: vi.fn(() => document.createElement("div")),
      layout: vi.fn(),
    };
    const mockMonaco = {
      KeyMod: { CtrlCmd: 2048 },
      KeyCode: { KeyS: 49 },
      editor: { MouseTargetType: {} },
    };

    // Trigger mount
    act(() => {
      lastOnMount?.(mockEditor, mockMonaco);
    });

    // 1. Model is registered in defaultSemanticModelRegistry
    const registered = defaultSemanticModelRegistry.getByTabKey(tabKey);
    expect(registered).toBeDefined();
    expect(registered?.identity.relativePath).toBe("src/index.ts");

    // 2. Reveal intent was consumed and executed on editor
    expect(mockEditor.revealRangeInCenter).toHaveBeenCalledWith({
      startLineNumber: 15,
      startColumn: 3,
      endLineNumber: 15,
      endColumn: 20,
    });
    expect(mockEditor.setSelection).toHaveBeenCalledWith({
      startLineNumber: 15,
      startColumn: 3,
      endLineNumber: 15,
      endColumn: 20,
    });
    expect(mockEditor.focus).toHaveBeenCalled();
    expect(useSemanticNavigationStore.getState().activeRevealIntent).toBeNull();

    // 3. Unmount (e.g. switching tabs)
    act(() => {
      root?.unmount();
      root = null;
    });

    // Registered model must STILL be in registry (dirty-buffer / overlay preservation)!
    const preserved = defaultSemanticModelRegistry.getByTabKey(tabKey);
    expect(preserved).toBeDefined();
  });

  it("routes edits to the replacement client after reconnect without stale reference", () => {
    const tabKey = "tab-main";
    const tab: Partial<Tab> = {
      key: tabKey,
      path: "src/index.ts",
      project: "test-proj",
      targetKey: "target-1",
      target: {
        project: "test-proj",
        profileId: "default",
      } as unknown as Tab["target"],
    };

    act(() => {
      root?.render(
        <MonacoHost
          tabKey={tabKey}
          path="src/index.ts"
          content="const x = 42;\n"
          tier="normal"
          onChange={() => {}}
          onSave={() => {}}
          onViewStateChange={() => {}}
          tab={tab as Tab}
        />,
      );
    });

    const mockMonaco = {
      KeyMod: { CtrlCmd: 2048 },
      KeyCode: { KeyS: 49 },
      editor: { MouseTargetType: {} },
    };

    act(() => {
      lastOnMount?.(
        {
          restoreViewState: vi.fn(),
          saveViewState: vi.fn(),
          deltaDecorations: vi.fn().mockReturnValue([]),
          updateOptions: vi.fn(),
          addCommand: vi.fn(),
          addAction: vi.fn(),
          onMouseDown: vi.fn(),
          onContextMenu: vi.fn(),
          onKeyDown: vi.fn(),
          onDidBlurEditorWidget: vi.fn(),
          onDidChangeCursorPosition: vi.fn(),
          onDidScrollChange: vi.fn(),
          revealRangeInCenter: vi.fn(),
          setSelection: vi.fn(),
          focus: vi.fn(),
          getDomNode: vi.fn(() => document.createElement("div")),
          layout: vi.fn(),
        },
        mockMonaco,
      );
    });

    const onChangeFn = lastEditorProps?.onChange as (
      val: string,
      ev: {
        changes: Array<{
          range: {
            startLineNumber: number;
            startColumn: number;
            endLineNumber: number;
            endColumn: number;
          };
          rangeLength: number;
          text: string;
        }>;
      },
    ) => void;
    expect(onChangeFn).toBeDefined();

    act(() => {
      onChangeFn("const x = 43;\n", {
        changes: [
          {
            range: {
              startLineNumber: 1,
              startColumn: 11,
              endLineNumber: 1,
              endColumn: 13,
            },
            rangeLength: 2,
            text: "43",
          },
        ],
      });
    });

    expect(mockClient.notifyDidChange).toHaveBeenCalled();

    // Reconnect simulation: replacement client is created
    const replacementClient: Partial<SemanticClient> = {
      getStatus: vi.fn().mockReturnValue("ready"),
      notifyDidOpen: vi.fn().mockResolvedValue(undefined),
      notifyDidChange: vi.fn().mockResolvedValue(2),
      notifyDidClose: vi.fn(),
    };

    vi.spyOn(
      useSemanticNavigationStore.getState(),
      "findClientForTab",
    ).mockReturnValue(replacementClient as SemanticClient);

    act(() => {
      onChangeFn("const x = 44;\n", {
        changes: [
          {
            range: {
              startLineNumber: 1,
              startColumn: 11,
              endLineNumber: 1,
              endColumn: 13,
            },
            rangeLength: 2,
            text: "44",
          },
        ],
      });
    });

    expect(replacementClient.notifyDidChange).toHaveBeenCalled();
  });
});
