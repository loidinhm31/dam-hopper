// @vitest-environment jsdom
import { act, type HTMLAttributes, type ReactNode } from "react";
import { DndContext } from "@dnd-kit/core";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneContainer } from "./PaneContainer.js";
import { terminalRegistry } from "@/lib/terminal-registry.js";

vi.mock("./TabBar.js", () => ({
  TabBar: () => <div data-testid="terminal-tab-bar" />,
}));

vi.mock("./TerminalDockPreview.js", () => ({
  TerminalDockPreview: () => null,
}));
const mockSettings = vi.hoisted(() => ({
  terminalCommitStatusEnabled: false,
  terminalScrollButtonsEnabled: false,
}));

vi.mock("@/stores/settings.js", () => ({
  useSettingsStore: (selector?: (state: typeof mockSettings) => unknown) =>
    selector ? selector(mockSettings) : mockSettings,
}));

vi.mock("./TerminalScrollButtons.js", () => ({
  TerminalScrollButtons: ({
    sessionId,
    reserveAccessoryRail,
    accessoryPanelOpen,
  }: {
    sessionId: string;
    reserveAccessoryRail?: boolean;
    accessoryPanelOpen?: boolean;
  }) => (
    <div
      data-testid="terminal-scroll-buttons"
      data-session-id={sessionId}
      data-reserve-accessory-rail={reserveAccessoryRail}
      data-accessory-panel-open={accessoryPanelOpen}
    />
  ),
}));

vi.mock("./MobileTerminalAccessoryBar.js", () => ({
  MobileTerminalAccessoryBar: ({
    sessionId,
    onPanelOpenChange,
  }: {
    sessionId: string;
    onPanelOpenChange?: (isOpen: boolean) => void;
  }) => (
    <div
      data-testid="pane-floating-terminal-controls"
      data-session-id={sessionId}
    >
      <button
        type="button"
        data-testid="pane-accessory-open"
        onClick={() => onPanelOpenChange?.(true)}
      >
        Open accessory
      </button>
      <button
        type="button"
        data-testid="pane-accessory-close"
        onClick={() => onPanelOpenChange?.(false)}
      >
        Close accessory
      </button>
    </div>
  ),
}));

vi.mock("@/lib/terminal-native-input-policy.js", () => ({
  syncNativeKeyboardSuppression: vi.fn(),
}));

vi.mock("react-resizable-panels", () => ({
  Group: ({
    children,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) => (
    <div {...props}>{children}</div>
  ),
  Panel: ({
    children,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) => (
    <div {...props}>{children}</div>
  ),
  Separator: (props: HTMLAttributes<HTMLDivElement>) => (
    <div {...props} role="separator" aria-orientation="vertical" tabIndex={0} />
  ),
}));

const pane = {
  id: "pane:one",
  type: "pane" as const,
  sessionIds: ["shell:demo"],
  activeSessionId: "shell:demo",
};

const layout = {
  focusedPaneId: pane.id,
  getPanes: () => [pane],
  setFocusedPaneId: vi.fn(),
  setActiveSession: vi.fn(),
  splitPane: vi.fn(),
  closePane: vi.fn(),
};

describe("PaneContainer browser integration", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mockSettings.terminalScrollButtonsEnabled = false;
    layout.focusedPaneId = pane.id;
    layout.setFocusedPaneId.mockClear();
    layout.setActiveSession.mockClear();
    layout.splitPane.mockClear();
    layout.closePane.mockClear();
    terminalRegistry.clear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    terminalRegistry.clear();
    mockSettings.terminalScrollButtonsEnabled = false;
    vi.unstubAllGlobals();
    container.remove();
    document.body.innerHTML = "";
  });

  it("renders Browser beside the focused terminal pane and wires its close action", async () => {
    const onCloseBrowser = vi.fn();
    await act(async () => {
      root.render(
        <DndContext>
          <PaneContainer
            node={pane}
            layout={layout as never}
            mountedSessions={[]}
            openTabs={[{ sessionId: "shell:demo", label: "Demo shell" }]}
            onNewTerminal={vi.fn()}
            onSessionExit={vi.fn()}
            onSelectTab={vi.fn()}
            onCloseTab={vi.fn()}
            activeSessionId="shell:demo"
            browserOpen
            onCloseBrowser={onCloseBrowser}
            renderBrowserContent={(onClose) => (
              <button
                data-testid="embedded-browser"
                type="button"
                onClick={onClose}
              >
                Browser
              </button>
            )}
          />
        </DndContext>,
      );
    });

    expect(
      container.querySelector("[data-testid=terminal-browser-split]"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid=terminal-tab-bar]"),
    ).not.toBeNull();
    const outputHost = container.querySelector(
      "[data-testid=terminal-pane-output-host]",
    );
    expect(outputHost).not.toBeNull();
    expect(outputHost?.className).toContain("bg-[var(--color-background)]");
    expect(outputHost?.className).not.toContain("#0f172a");
    expect(
      outputHost?.parentElement?.querySelector(
        "[data-testid=pane-floating-terminal-controls]",
      ),
    ).not.toBeNull();
    expect(
      container
        .querySelector("[data-testid=terminal-browser-split]")
        ?.querySelector("[data-testid=pane-floating-terminal-controls]")
        ?.getAttribute("data-session-id"),
    ).toBe("shell:demo");
    const divider = container.querySelector('[role="separator"]');
    expect(divider?.getAttribute("aria-orientation")).toBe("vertical");
    expect(divider?.getAttribute("aria-label")).toBe(
      "Resize terminal and browser panels",
    );

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-testid=embedded-browser]")
        ?.click(),
    );
    expect(onCloseBrowser).toHaveBeenCalledOnce();
  });

  it("does not render the group in a pane that is not the global active target", async () => {
    await act(async () => {
      root.render(
        <DndContext>
          <PaneContainer
            node={pane}
            layout={layout as never}
            mountedSessions={[]}
            openTabs={[{ sessionId: "shell:demo", label: "Demo shell" }]}
            onNewTerminal={vi.fn()}
            onSessionExit={vi.fn()}
            onSelectTab={vi.fn()}
            onCloseTab={vi.fn()}
            activeSessionId="shell:other"
          />
        </DndContext>,
      );
    });

    expect(
      container.querySelector("[data-testid=pane-floating-terminal-controls]"),
    ).toBeNull();
  });
  it("retains external focus across callback churn and focuses semantic transitions", async () => {
    const firstTextarea = document.createElement("textarea");
    firstTextarea.className = "xterm-helper-textarea";
    document.body.append(firstTextarea);
    const firstFocus = vi.fn(() => firstTextarea.focus());
    const secondFocus = vi.fn();
    const attachCustomKeyEventHandler = vi.fn();
    const baseKeyEventHandler = vi.fn(() => true);
    terminalRegistry.set("shell:demo", {
      terminal: {
        focus: firstFocus,
        attachCustomKeyEventHandler,
      } as never,
      fitAddon: {} as never,
      findController: {} as never,
      baseKeyEventHandler,
    });
    terminalRegistry.set("shell:next", {
      terminal: {
        focus: secondFocus,
        attachCustomKeyEventHandler,
      } as never,
      fitAddon: {} as never,
      findController: {} as never,
      baseKeyEventHandler,
    });

    const renderPane = async (
      node: typeof pane,
      suppressTerminalFocus = false,
      onSelectTab = vi.fn(),
    ) => {
      await act(async () => {
        root.render(
          <DndContext>
            <PaneContainer
              node={node}
              layout={layout as never}
              mountedSessions={[]}
              openTabs={node.sessionIds.map((sessionId) => ({
                sessionId,
                label: sessionId,
              }))}
              onNewTerminal={vi.fn()}
              onSessionExit={vi.fn()}
              onSelectTab={onSelectTab}
              onCloseTab={vi.fn()}
              activeSessionId={node.activeSessionId}
              suppressTerminalFocus={suppressTerminalFocus}
            />
          </DndContext>,
        );
      });
    };

    await renderPane({
      ...pane,
      sessionIds: ["shell:demo", "shell:next"],
    });
    expect(firstFocus).toHaveBeenCalledOnce();

    const globalSearchInput = document.createElement("input");
    globalSearchInput.setAttribute("aria-label", "Global Search");
    document.body.append(globalSearchInput);
    globalSearchInput.focus();
    await renderPane(
      {
        ...pane,
        sessionIds: ["shell:demo", "shell:next"],
      },
      false,
      vi.fn(),
    );
    expect(document.activeElement).toBe(globalSearchInput);
    expect(firstFocus).toHaveBeenCalledOnce();

    layout.focusedPaneId = "pane:other";
    await renderPane({
      ...pane,
      sessionIds: ["shell:demo", "shell:next"],
    });
    layout.focusedPaneId = pane.id;
    await renderPane({
      ...pane,
      sessionIds: ["shell:demo", "shell:next"],
    });
    expect(firstFocus).toHaveBeenCalledTimes(2);

    await renderPane(
      {
        ...pane,
        sessionIds: ["shell:demo", "shell:next"],
        activeSessionId: "shell:next",
      },
      true,
    );
    expect(secondFocus).not.toHaveBeenCalled();
    await renderPane({
      ...pane,
      sessionIds: ["shell:demo", "shell:next"],
      activeSessionId: "shell:next",
    });
    expect(secondFocus).toHaveBeenCalledOnce();
    firstTextarea.remove();
    globalSearchInput.remove();
  });

  it("gates scroll controls to the global active session and mirrors accessory state", async () => {
    mockSettings.terminalScrollButtonsEnabled = true;
    const accessoryPane = {
      ...pane,
      sessionIds: ["shell:demo", "shell:next"],
    };
    const renderPane = async (
      node: typeof accessoryPane,
      activeSessionId: string | null,
    ) => {
      await act(async () => {
        root.render(
          <DndContext>
            <PaneContainer
              node={node}
              layout={layout as never}
              mountedSessions={[]}
              openTabs={node.sessionIds.map((sessionId) => ({
                sessionId,
                label: sessionId,
              }))}
              onNewTerminal={vi.fn()}
              onSessionExit={vi.fn()}
              onSelectTab={vi.fn()}
              onCloseTab={vi.fn()}
              activeSessionId={activeSessionId}
            />
          </DndContext>,
        );
      });
    };

    await renderPane(accessoryPane, "shell:demo");
    const scrollButtons = () =>
      container.querySelector("[data-testid=terminal-scroll-buttons]");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-testid=pane-accessory-open]")
        ?.click(),
    );
    expect(
      scrollButtons()?.getAttribute("data-accessory-panel-open"),
    ).toBe("true");
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>("[data-testid=pane-accessory-close]")
        ?.click(),
    );
    expect(
      scrollButtons()?.getAttribute("data-accessory-panel-open"),
    ).toBe("false");
    expect(
      container.querySelectorAll("[data-testid=terminal-scroll-buttons]"),
    ).toHaveLength(1);


    await renderPane(accessoryPane, "shell:other");
    expect(scrollButtons()).toBeNull();
    expect(
      container.querySelector("[data-testid=pane-floating-terminal-controls]"),
    ).toBeNull();

    await renderPane(
      { ...accessoryPane, activeSessionId: "shell:next" },
      "shell:next",
    );
    expect(scrollButtons()?.getAttribute("data-session-id")).toBe("shell:next");
    mockSettings.terminalScrollButtonsEnabled = false;
    await renderPane(
      { ...accessoryPane, activeSessionId: "shell:next" },
      "shell:next",
    );
    expect(scrollButtons()).toBeNull();
  });
});
