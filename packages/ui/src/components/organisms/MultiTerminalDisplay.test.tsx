// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MultiTerminalDisplay } from "./MultiTerminalDisplay.js";

const mockPolicy = vi.hoisted(() => ({ enabled: false }));
const mockSettings = vi.hoisted(() => ({ customKeyboard: true }));
const mockSplitProps = vi.hoisted(() => ({
  suppressTerminalFocus: undefined as boolean | undefined,
  activeSessionId: undefined as string | null | undefined,
}));
const mockLayout = vi.hoisted(() => ({
  root: {},
  focusedPaneId: "pane-1",
  getFirstPaneId: () => "pane-1",
  getPaneById: () => ({
    id: "pane-1",
    sessionIds: ["session-1", "session-2"],
  }),
  getPanes: () => [
    {
      id: "pane-1",
      sessionIds: ["session-1", "session-2"],
      activeSessionId: "session-1",
    },
  ],
  addSessionToPane: vi.fn(),
  pruneSessions: vi.fn(),
  setActiveSession: vi.fn(),
  setFocusedPaneId: vi.fn(),
}));

vi.mock("@/components/organisms/TerminalKeepAliveHost.js", () => ({
  TerminalKeepAliveHost: () => null,
}));
vi.mock("@/components/organisms/SplitLayout.js", () => ({
  SplitLayout: (props: {
    suppressTerminalFocus: boolean;
    activeSessionId: string | null;
  }) => {
    mockSplitProps.suppressTerminalFocus = props.suppressTerminalFocus;
    mockSplitProps.activeSessionId = props.activeSessionId;
    return (
      <div data-testid="split-layout">
        {props.activeSessionId ? (
          <div
            data-testid="pane-floating-terminal-controls"
            data-session-id={props.activeSessionId}
          />
        ) : null}
      </div>
    );
  },
}));
vi.mock("@/hooks/use-terminal-layout.js", () => ({
  collectPanes: () => [
    {
      id: "pane-1",
      sessionIds: ["session-1", "session-2"],
      activeSessionId: "session-1",
    },
  ],
  useTerminalLayout: () => mockLayout,
}));
vi.mock("@/hooks/use-compact-workspace.js", () => ({
  useCompactWorkspace: () => false,
}));
vi.mock("@/hooks/use-coarse-pointer.js", () => ({
  useCoarsePointer: () => false,
}));
vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (
    selector: (state: { mobileCustomKeyboardEnabled: boolean }) => unknown,
  ) => selector({ mobileCustomKeyboardEnabled: mockSettings.customKeyboard }),
}));
vi.mock("@/lib/terminal-fit-scheduler.js", () => ({
  fitAllTerminals: vi.fn(),
}));
vi.mock("@/lib/terminal-registry.js", () => ({
  terminalRegistry: { values: () => [] },
}));
vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

describe("MultiTerminalDisplay floating controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockPolicy.enabled = false;
    mockSettings.customKeyboard = true;
    mockSplitProps.suppressTerminalFocus = undefined;
    mockSplitProps.activeSessionId = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const sessions = [
    { sessionId: "session-1", project: "demo", command: "shell" },
    { sessionId: "session-2", project: "demo", command: "shell" },
  ];

  function renderDisplay(activeSessionId: string | null): void {
    act(() => {
      root.render(
        <MultiTerminalDisplay
          activeSessionId={activeSessionId}
          mountedSessions={sessions}
          openTabs={[]}
          renderTerminals={false}
        />,
      );
    });
  }

  it("mounts exactly one group and retargets it when the active split session changes", () => {
    renderDisplay("session-1");

    expect(
      container.querySelectorAll(
        "[data-testid=pane-floating-terminal-controls]",
      ),
    ).toHaveLength(1);
    expect(
      container
        .querySelector("[data-testid=pane-floating-terminal-controls]")
        ?.getAttribute("data-session-id"),
    ).toBe("session-1");
    expect(mockSplitProps.activeSessionId).toBe("session-1");

    renderDisplay("session-2");

    expect(
      container.querySelectorAll(
        "[data-testid=pane-floating-terminal-controls]",
      ),
    ).toHaveLength(1);
    expect(
      container
        .querySelector("[data-testid=pane-floating-terminal-controls]")
        ?.getAttribute("data-session-id"),
    ).toBe("session-2");
    expect(mockSplitProps.activeSessionId).toBe("session-2");
  });

  it("does not let desktop controls change terminal input suppression", () => {
    renderDisplay("session-1");
    expect(mockSplitProps.suppressTerminalFocus).toBe(false);
  });

  it("does not mount a group without an active session", () => {
    renderDisplay(null);
    expect(
      container.querySelector("[data-testid=pane-floating-terminal-controls]"),
    ).toBeNull();
  });
});
