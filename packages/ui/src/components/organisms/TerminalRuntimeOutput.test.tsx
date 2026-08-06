// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalRuntimeOutput } from "./TerminalRuntimeOutput.js";

const mockPolicy = vi.hoisted(() => ({ enabled: false }));
const mockSettings = vi.hoisted(() => ({ customKeyboard: true }));
const mockTerminal = vi.hoisted(() => ({
  focus: vi.fn(),
  options: { disableStdin: false },
  textarea: null,
}));
let renderedHostProps: Record<string, unknown> | null = null;

vi.mock("@/components/organisms/TerminalKeepAliveHost.js", () => ({
  TerminalKeepAliveHost: (props: Record<string, unknown>) => {
    renderedHostProps = props;
    return null;
  },
}));
vi.mock("@/lib/terminal-native-input-policy.js", () => ({
  syncNativeKeyboardSuppression: vi.fn(),
}));
vi.mock("@/lib/terminal-host-attachment.js", () => ({
  attachTerminalsToHost: vi.fn(),
}));
vi.mock("@/lib/terminal-fit-scheduler.js", () => ({
  cancelScheduledTerminalFit: vi.fn(),
  scheduleTerminalFit: vi.fn(),
}));
vi.mock("@/lib/terminal-registry.js", () => ({
  terminalRegistry: {
    get: () => ({ terminal: mockTerminal }),
  },
  subscribeToRegistry: () => () => {},
}));
vi.mock("@/components/organisms/TerminalScrollButtons.js", () => ({
  TerminalScrollButtons: ({ className }: { className?: string }) => (
    <div data-testid="terminal-scroll-buttons" data-class-name={className} />
  ),
}));
vi.mock("@/hooks/use-compact-workspace.js", () => ({
  useCompactWorkspace: () => true,
}));
vi.mock("@/hooks/use-coarse-pointer.js", () => ({
  useCoarsePointer: () => true,
}));
vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: () => ({
    get mobileCustomKeyboardEnabled() {
      return mockSettings.customKeyboard;
    },
    terminalScrollButtonsEnabled: true,
  }),
}));
vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

describe("TerminalRuntimeOutput", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    renderedHostProps = null;
    mockPolicy.enabled = false;
    mockSettings.customKeyboard = true;
    mockTerminal.focus.mockClear();
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

  it("keeps the scroll control above the compact mobile accessory bar", () => {
    const markup = renderToStaticMarkup(
      <TerminalRuntimeOutput
        activeSessionId="session-1"
        mountedSessions={[
          { sessionId: "session-1", project: "demo", command: "shell" },
        ]}
        renderTerminals={false}
      />,
    );

    expect(markup).toContain('data-testid="terminal-scroll-buttons"');
    expect(markup).toContain('data-class-name="bottom-2"');
  });

  it("forces the accessory and suppresses the hidden host on Android policy", () => {
    mockPolicy.enabled = true;
    mockSettings.customKeyboard = false;

    const markup = renderToStaticMarkup(
      <TerminalRuntimeOutput
        activeSessionId="session-1"
        mountedSessions={[
          { sessionId: "session-1", project: "demo", command: "shell" },
        ]}
        renderTerminals
      />,
    );

    expect(markup).toContain('aria-label="Open custom terminal keyboard"');
    expect(renderedHostProps).toEqual(
      expect.objectContaining({
        suppressAutoFocus: true,
        suppressNativeKeyboard: true,
      }),
    );
  });

  it("does not focus the terminal when the output surface is clicked under policy", async () => {
    mockPolicy.enabled = true;

    await act(async () => {
      root.render(
        <TerminalRuntimeOutput
          activeSessionId="session-1"
          mountedSessions={[
            { sessionId: "session-1", project: "demo", command: "shell" },
          ]}
          renderTerminals={false}
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLElement>(
          "[data-testid=terminal-runtime-output-host]",
        )
        ?.click();
    });

    expect(mockTerminal.focus).not.toHaveBeenCalled();
  });
});
