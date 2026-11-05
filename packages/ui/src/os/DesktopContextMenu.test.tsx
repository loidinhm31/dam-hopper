// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopContextMenu } from "./DesktopContextMenu.js";
import { useWindowStore } from "./window-store.js";
import { createDefaultOsSession } from "./window-ops.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import {
  ShellInputProvider,
  useShellInputContext,
} from "./shell-input-context.js";
import { executeAction } from "./action-executor.js";
import * as connectionsApi from "@/api/connections.js";
import {
  dismissContextMenu,
  isContextMenuOpen,
} from "@/lib/context-menu-coordinator.js";

vi.mock("./action-executor.js", () => ({
  executeAction: vi.fn().mockResolvedValue({ kind: "executed" }),
}));

describe("DesktopContextMenu (C8)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useWindowStore.getState().setSession(createDefaultOsSession());
    useCognitoModeStore.getState().reset();
    vi.clearAllMocks();
    dismissContextMenu();

    vi.spyOn(connectionsApi, "getConnectionSnapshot").mockImplementation(
      (profileId: string) => ({
        status: "connected",
        serverUrl: "http://localhost:3000",
        owner: { profileId, generation: 1 },
      }),
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.querySelectorAll("[data-radix-portal]").forEach((el) => el.remove());
    dismissContextMenu();
    vi.restoreAllMocks();
  });

  it("renders dedicated focusable background trigger and opens on keyboard Shift+F10", async () => {
    await act(async () => {
      root.render(<DesktopContextMenu desktopId="desktop-1" />);
    });

    const trigger = container.querySelector(
      '[data-testid="desktop-context-trigger-desktop-1"]',
    ) as HTMLElement;
    expect(trigger).not.toBeNull();
    expect(trigger.tabIndex).toBe(0);
    expect(trigger.getAttribute("role")).toBe("region");
    expect(trigger.getAttribute("aria-label")).toContain("Desktop desktop-1");

    // Focus trigger and dispatch keyboard Shift+F10
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await act(async () => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "F10",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const menu = document.querySelector('[data-testid="desktop-context-menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.getAttribute("data-os-menu-portal")).toBe("os-desktop");
  });

  it("opens on keyboard ContextMenu key when focused", async () => {
    await act(async () => {
      root.render(<DesktopContextMenu desktopId="desktop-1" />);
    });

    const trigger = container.querySelector(
      '[data-testid="desktop-context-trigger-desktop-1"]',
    ) as HTMLElement;

    trigger.focus();

    await act(async () => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ContextMenu",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const menu = document.querySelector('[data-testid="desktop-context-menu"]');
    expect(menu).not.toBeNull();
  });

  it("captures immutable context at open and executes New Terminal with C12 payload", async () => {
    const mutableOwner = { profileId: "profile-a", generation: 1 };
    const getContext = vi.fn().mockReturnValue({
      desktopId: "desktop-1",
      owner: mutableOwner,
      target: { kind: "workspace", profileId: "profile-a" },
      cwd: "/home/user/project",
      directoryKind: "explicit-folder",
    });

    await act(async () => {
      root.render(
        <DesktopContextMenu desktopId="desktop-1" getContext={getContext} />,
      );
    });

    const trigger = container.querySelector(
      '[data-testid="desktop-context-trigger-desktop-1"]',
    ) as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });

    expect(getContext).toHaveBeenCalled();

    // Mutating external source object must NOT corrupt captured snapshot
    mutableOwner.generation = 999;

    const terminalItem = document.querySelector(
      '[data-testid="desktop-menu-item-terminal"]',
    ) as HTMLElement;
    expect(terminalItem).not.toBeNull();

    await act(async () => {
      terminalItem.click();
    });

    expect(executeAction).toHaveBeenCalledWith({
      id: "app.terminals.new-window",
      context: {
        kind: "desktop",
        desktopId: "desktop-1",
        owner: { profileId: "profile-a", generation: 1 },
        target: { kind: "workspace", profileId: "profile-a" },
        windowContext: undefined,
      },
      terminalCreate: {
        target: { kind: "workspace", profileId: "profile-a" },
        cwd: "/home/user/project",
        directoryKind: "explicit-folder",
        owner: { profileId: "profile-a", generation: 1 },
        destinationDesktopId: "desktop-1",
        windowContext: { profileId: "profile-a" },
      },
    });
  });

  it("revalidates context on selection and rejects stale connection without fallback B", async () => {
    const noticeHandler = vi.fn();
    const getContext = vi.fn().mockReturnValue({
      desktopId: "desktop-1",
      owner: { profileId: "profile-a", generation: 1 },
      target: { kind: "workspace", profileId: "profile-a" },
    });

    await act(async () => {
      root.render(
        <DesktopContextMenu
          desktopId="desktop-1"
          getContext={getContext}
          onNotice={noticeHandler}
        />
      );
    });

    const trigger = container.querySelector(
      '[data-testid="desktop-context-trigger-desktop-1"]',
    ) as HTMLElement;

    // 1. Open context menu with generation 1
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });

    // 2. Connection generation increments (reconnected while menu was open)
    vi.spyOn(connectionsApi, "getConnectionSnapshot").mockImplementation(
      (profileId: string) => ({
        status: "connected",
        serverUrl: "http://localhost:3000",
        owner: { profileId, generation: 2 },
      }),
    );

    // 3. User clicks New Terminal
    const terminalItem = document.querySelector(
      '[data-testid="desktop-menu-item-terminal"]',
    ) as HTMLElement;

    await act(async () => {
      terminalItem.click();
    });

    // Must block execution and surface notice
    expect(executeAction).not.toHaveBeenCalled();
    expect(noticeHandler).toHaveBeenCalledWith(
      expect.stringContaining("reconnected"),
    );
  });

  it("revalidates context on selection and rejects disconnected profile without fallback", async () => {
    const noticeHandler = vi.fn();
    const getContext = vi.fn().mockReturnValue({
      desktopId: "desktop-1",
      owner: { profileId: "profile-a", generation: 1 },
    });

    await act(async () => {
      root.render(
        <DesktopContextMenu
          desktopId="desktop-1"
          getContext={getContext}
          onNotice={noticeHandler}
        />
      );
    });

    const trigger = container.querySelector(
      '[data-testid="desktop-context-trigger-desktop-1"]',
    ) as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });

    // Profile disconnects
    vi.spyOn(connectionsApi, "getConnectionSnapshot").mockImplementation(
      () => null,
    );

    const terminalItem = document.querySelector(
      '[data-testid="desktop-menu-item-terminal"]',
    ) as HTMLElement;

    await act(async () => {
      terminalItem.click();
    });

    expect(executeAction).not.toHaveBeenCalled();
    expect(noticeHandler).toHaveBeenCalledWith(
      expect.stringContaining("no longer connected"),
    );
  });

  it("fails closed when opening without connected owner", async () => {
    const noticeHandler = vi.fn();
    const getContext = vi.fn().mockReturnValue({
      desktopId: "desktop-1",
      owner: null,
    });

    await act(async () => {
      root.render(
        <DesktopContextMenu
          desktopId="desktop-1"
          getContext={getContext}
          onNotice={noticeHandler}
        />
      );
    });

    const trigger = container.querySelector(
      '[data-testid="desktop-context-trigger-desktop-1"]',
    ) as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });

    const terminalItem = document.querySelector(
      '[data-testid="desktop-menu-item-terminal"]',
    ) as HTMLElement;

    await act(async () => {
      terminalItem.click();
    });

    expect(executeAction).not.toHaveBeenCalled();
    expect(noticeHandler).toHaveBeenCalledWith(
      expect.stringContaining("requires an active profile connection"),
    );
  });

  it("revalidates context and rejects when destination desktop was removed", async () => {
    const noticeHandler = vi.fn();
    const getContext = vi.fn().mockReturnValue({
      desktopId: "desktop-transient",
      owner: { profileId: "profile-a", generation: 1 },
    });

    await act(async () => {
      root.render(
        <DesktopContextMenu
          desktopId="desktop-transient"
          getContext={getContext}
          onNotice={noticeHandler}
        />
      );
    });

    const trigger = container.querySelector(
      '[data-testid="desktop-context-trigger-desktop-transient"]',
    ) as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });

    const terminalItem = document.querySelector(
      '[data-testid="desktop-menu-item-terminal"]',
    ) as HTMLElement;

    await act(async () => {
      terminalItem.click();
    });

    expect(executeAction).not.toHaveBeenCalled();
    expect(noticeHandler).toHaveBeenCalledWith(
      expect.stringContaining("no longer exists"),
    );
  });

  it("does not open context menu when a modal is active in ShellInputContext", async () => {
    let unregisterModal: (() => void) | undefined;

    function ModalAttacher() {
      const shell = useShellInputContext();
      return (
        <button
          data-testid="open-modal-button"
          onClick={() => {
            unregisterModal = shell.registerModalMount("confirm-dialog");
          }}
        >
          Open Modal
        </button>
      );
    }

    await act(async () => {
      root.render(
        <ShellInputProvider>
          <ModalAttacher />
          <DesktopContextMenu desktopId="desktop-1" />
        </ShellInputProvider>,
      );
    });

    // Register active modal (depth = 1)
    const openModalBtn = container.querySelector(
      '[data-testid="open-modal-button"]',
    ) as HTMLElement;
    await act(async () => {
      openModalBtn.click();
    });

    const trigger = container.querySelector(
      '[data-testid="desktop-context-trigger-desktop-1"]',
    ) as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });

    // Menu must NOT open while modal is mounted
    const menu = document.querySelector('[data-testid="desktop-context-menu"]');
    expect(menu).toBeNull();

    // After modal unmounts, background menu becomes reachable again
    await act(async () => {
      unregisterModal?.();
    });

    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });

    expect(
      document.querySelector('[data-testid="desktop-context-menu"]'),
    ).not.toBeNull();
  });

  it("dismisses open context menu synchronously when Cognito mode activates", async () => {
    await act(async () => {
      root.render(<DesktopContextMenu desktopId="desktop-1" />);
    });

    const trigger = container.querySelector(
      '[data-testid="desktop-context-trigger-desktop-1"]',
    ) as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });

    expect(isContextMenuOpen()).toBe(true);

    // Toggle Cognito mode
    act(() => {
      useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");
    });

    expect(isContextMenuOpen()).toBe(false);
  });

  it("descendant exclusion: ignores right-clicks inside windows or dialogs without suppressing child event", async () => {
    await act(async () => {
      root.render(
        <DesktopContextMenu desktopId="desktop-1">
          <div data-window-id="win-1" className="window-frame">
            <div className="xterm" data-testid="terminal-content">
              Terminal content
            </div>
          </div>
        </DesktopContextMenu>,
      );
    });

    const terminalContent = container.querySelector(
      '[data-testid="terminal-content"]',
    ) as HTMLElement;

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 50,
      clientY: 50,
    });

    await act(async () => {
      terminalContent.dispatchEvent(event);
    });

    // Desktop context menu must not open
    const menu = document.querySelector('[data-testid="desktop-context-menu"]');
    expect(menu).toBeNull();
    // Event must remain unsuppressed for the child
    expect(event.defaultPrevented).toBe(false);
  });

  it("executes Desktop Appearance with appearance settingsSection", async () => {
    await act(async () => {
      root.render(<DesktopContextMenu desktopId="desktop-1" />);
    });

    const trigger = container.querySelector(
      '[data-testid="desktop-context-trigger-desktop-1"]',
    ) as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });

    const appearanceItem = document.querySelector(
      '[data-testid="desktop-menu-item-appearance"]',
    ) as HTMLElement;
    expect(appearanceItem).not.toBeNull();

    await act(async () => {
      appearanceItem.click();
    });

    expect(executeAction).toHaveBeenCalledWith({
      id: "app.settings.open",
      context: {
        kind: "desktop",
        desktopId: "desktop-1",
        owner: null,
      },
      settingsSection: "appearance",
    });
  });

  it("executes Command Palette action", async () => {
    const paletteHandler = vi.fn();

    await act(async () => {
      root.render(
        <DesktopContextMenu
          desktopId="desktop-1"
          onOpenPalette={paletteHandler}
        />,
      );
    });

    const trigger = container.querySelector(
      '[data-testid="desktop-context-trigger-desktop-1"]',
    ) as HTMLElement;

    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });

    const paletteItem = document.querySelector(
      '[data-testid="desktop-menu-item-palette"]',
    ) as HTMLElement;

    await act(async () => {
      paletteItem.click();
    });

    expect(paletteHandler).toHaveBeenCalled();
    expect(executeAction).toHaveBeenCalledWith({
      id: "os.palette",
      context: {
        kind: "desktop",
        desktopId: "desktop-1",
        owner: null,
      },
    });
  });
});
