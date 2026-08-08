// @vitest-environment jsdom
import { act, type HTMLAttributes, type ReactNode } from "react";
import { DndContext } from "@dnd-kit/core";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneContainer } from "./PaneContainer.js";

vi.mock("./TabBar.js", () => ({
  TabBar: () => <div data-testid="terminal-tab-bar" />,
}));

vi.mock("./TerminalDockPreview.js", () => ({
  TerminalDockPreview: () => null,
}));

vi.mock("./MobileTerminalAccessoryBar.js", () => ({
  MobileTerminalAccessoryBar: ({ sessionId }: { sessionId: string }) => (
    <div
      data-testid="pane-floating-terminal-controls"
      data-session-id={sessionId}
    />
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
    vi.unstubAllGlobals();
    container.remove();
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
});
