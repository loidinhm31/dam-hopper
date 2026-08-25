// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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
