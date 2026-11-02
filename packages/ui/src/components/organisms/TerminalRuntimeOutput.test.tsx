// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalRuntimeOutput } from "./TerminalRuntimeOutput.js";

const mockPolicy = vi.hoisted(() => ({ enabled: false }));
const mockSettings = vi.hoisted(() => ({
  customKeyboard: true,
  scrollButtonsEnabled: true,
}));
const mockViewport = vi.hoisted(() => ({ compact: true, coarse: true }));
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
vi.mock("@/lib/terminal-input-policy.js", () => ({
  syncTerminalInputSuppression: vi.fn(),
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
  getTerminal: () => ({ terminal: mockTerminal }),
  subscribeToRegistry: () => () => {},
}));
vi.mock("@/components/organisms/TerminalScrollButtons.js", () => ({
  TerminalScrollButtons: ({
    className,
    reserveAccessoryRail,
    accessoryPanelOpen,
  }: {
    className?: string;
    reserveAccessoryRail?: boolean;
    accessoryPanelOpen?: boolean;
  }) => (
    <div
      data-testid="terminal-scroll-buttons"
      data-class-name={className}
      data-reserve-accessory-rail={reserveAccessoryRail}
      data-accessory-panel-open={accessoryPanelOpen}
    />
  ),
}));
vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: () => ({
    get mobileCustomKeyboardEnabled() {
      return mockSettings.customKeyboard;
    },
    get terminalScrollButtonsEnabled() {
      return mockSettings.scrollButtonsEnabled;
    },
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
    mockSettings.scrollButtonsEnabled = true;
    mockViewport.compact = true;
    mockViewport.coarse = true;
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

  it("renders scroll controls in the terminal surface when active session is present", () => {
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
    expect(markup).toContain("bg-[var(--color-background)]");
  });

  it("does not mount scroll controls when disabled", () => {
    mockSettings.scrollButtonsEnabled = false;

    const markup = renderToStaticMarkup(
      <TerminalRuntimeOutput
        activeSessionId="session-1"
        mountedSessions={[
          { sessionId: "session-1", project: "demo", command: "shell" },
        ]}
        renderTerminals={false}
      />,
    );

    expect(markup).not.toContain('data-testid="terminal-scroll-buttons"');
  });

  it("does not mount controls without an active session", () => {
    const markup = renderToStaticMarkup(
      <TerminalRuntimeOutput
        activeSessionId={null}
        mountedSessions={[]}
        renderTerminals={false}
      />,
    );

    expect(markup).not.toContain('data-testid="mobile-terminal-accessory-bar"');
    expect(markup).not.toContain('data-testid="terminal-scroll-buttons"');
  });
});

