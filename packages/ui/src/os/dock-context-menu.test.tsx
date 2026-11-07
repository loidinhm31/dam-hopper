// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DockContextMenu } from "./dock-context-menu.js";
import { useWindowStore } from "./window-store.js";
import { createDefaultOsSession, minimizeWindow, openWindow } from "./window-ops.js";
import * as dockPins from "./dock-pins.js";
import * as actionExecutor from "./action-executor.js";

function openContextMenu(trigger: HTMLElement) {
  act(() => {
    trigger.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 50,
      }),
    );
  });
}

function clickElement(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("DockContextMenu", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    const session = createDefaultOsSession("d1", "Main");
    useWindowStore.setState({ session });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders trigger child and displays app name and open/pin items", () => {
    act(() => {
      root.render(
        <DockContextMenu appId="files" isPinned={true}>
          <button type="button" id="trigger-files">
            Files
          </button>
        </DockContextMenu>,
      );
    });

    const trigger = container.querySelector("#trigger-files") as HTMLElement;
    expect(trigger).not.toBeNull();
    openContextMenu(trigger);

    expect(document.body.textContent).toContain("Files");
    const openItem = document.body.querySelector(
      "[data-testid='dock-menu-open']",
    ) as HTMLElement;
    expect(openItem).not.toBeNull();
    expect(openItem.textContent).toContain("Open");

    const pinItem = document.body.querySelector(
      "[data-testid='dock-menu-toggle-pin']",
    ) as HTMLElement;
    expect(pinItem).not.toBeNull();
    expect(pinItem.textContent).toBe("Unpin from Dock");

    // New Window must NOT exist for files
    expect(
      document.body.querySelector("[data-testid='dock-menu-new-window']"),
    ).toBeNull();
  });

  it("displays 'New Window' only for supported apps (terminals, editor, browser)", () => {
    // Terminals
    act(() => {
      root.render(
        <DockContextMenu appId="terminals" isPinned={false}>
          <button type="button" id="trigger-term">
            Terminals
          </button>
        </DockContextMenu>,
      );
    });

    const trigger = container.querySelector("#trigger-term") as HTMLElement;
    openContextMenu(trigger);

    expect(
      document.body.querySelector("[data-testid='dock-menu-new-window']"),
    ).not.toBeNull();
    const pinItem = document.body.querySelector(
      "[data-testid='dock-menu-toggle-pin']",
    ) as HTMLElement;
    expect(pinItem.textContent).toBe("Pin to Dock");
  });

  it("displays 'Focus' and lists running windows when windows exist", () => {
    let session = useWindowStore.getState().session;
    session = openWindow(session, {
      id: "term-1",
      appId: "terminals",
      title: "Active Bash",
      ctx: { profileId: "p1" },
      mode: "tile",
    });
    session = openWindow(session, {
      id: "term-2",
      appId: "terminals",
      title: "Server Logs",
      ctx: { profileId: "p1" },
      mode: "float",
    });
    useWindowStore.setState({ session });

    act(() => {
      root.render(
        <DockContextMenu appId="terminals" isPinned={true}>
          <button type="button" id="trigger-term">
            Terminals
          </button>
        </DockContextMenu>,
      );
    });

    const trigger = container.querySelector("#trigger-term") as HTMLElement;
    openContextMenu(trigger);

    const openItem = document.body.querySelector(
      "[data-testid='dock-menu-open']",
    ) as HTMLElement;
    expect(openItem.textContent).toContain("Focus");

    expect(document.body.textContent).toContain("Running Windows (2)");
    expect(
      document.body.querySelector("[data-testid='dock-menu-instance-term-1']"),
    ).not.toBeNull();
    expect(
      document.body.querySelector("[data-testid='dock-menu-instance-term-2']"),
    ).not.toBeNull();
  });

  it("focuses, restores, and switches desktop when a running window item is clicked", () => {
    let session = useWindowStore.getState().session;
    session = {
      ...session,
      desktops: [
        session.desktops[0],
        {
          id: "d2",
          name: "Workspace 2",
          defaultCtx: { profileId: "p1" },
          tree: null,
          floatingWindowIds: [],
        },
      ],
    };
    session = openWindow(
      session,
      {
        id: "term-min",
        appId: "terminals",
        title: "Build Worker",
        ctx: { profileId: "p1" },
        mode: "float",
      },
      "d2",
    );
    session = {
      ...session,
      windows: {
        ...session.windows,
        "term-min": {
          ...session.windows["term-min"],
          minimized: true,
        },
      },
    };
    useWindowStore.setState({ session });

    const focusSpy = vi.spyOn(useWindowStore.getState(), "focusWindow");
    const restoreSpy = vi.spyOn(useWindowStore.getState(), "restoreWindow");
    const switchDesktopSpy = vi.spyOn(
      useWindowStore.getState(),
      "switchDesktop",
    );

    act(() => {
      root.render(
        <DockContextMenu appId="terminals" isPinned={true}>
          <button type="button" id="trigger-term">
            Terminals
          </button>
        </DockContextMenu>,
      );
    });

    const trigger = container.querySelector("#trigger-term") as HTMLElement;
    openContextMenu(trigger);

    const instanceItem = document.body.querySelector(
      "[data-testid='dock-menu-instance-term-min']",
    ) as HTMLElement;
    expect(instanceItem).not.toBeNull();
    clickElement(instanceItem);

    expect(switchDesktopSpy).toHaveBeenCalledWith("d2");
    expect(restoreSpy).toHaveBeenCalledWith("term-min");
    expect(focusSpy).toHaveBeenCalledWith("term-min");
  });

  it("toggles pin status on click without mutating window state", () => {
    let session = useWindowStore.getState().session;
    session = openWindow(session, {
      id: "term-1",
      appId: "terminals",
      title: "Bash",
      ctx: { profileId: "p1" },
      mode: "tile",
    });
    useWindowStore.setState({ session });

    const toggleSpy = vi.spyOn(dockPins, "toggleDockPin");

    act(() => {
      root.render(
        <DockContextMenu appId="terminals" isPinned={true}>
          <button type="button" id="trigger-term">
            Terminals
          </button>
        </DockContextMenu>,
      );
    });

    const trigger = container.querySelector("#trigger-term") as HTMLElement;
    openContextMenu(trigger);

    const toggleItem = document.body.querySelector(
      "[data-testid='dock-menu-toggle-pin']",
    ) as HTMLElement;
    clickElement(toggleItem);

    expect(toggleSpy).toHaveBeenCalledWith("terminals");
    expect(useWindowStore.getState().session.windows["term-1"]).toBeDefined();
  });

  it("executes open/focus action when Open is clicked", () => {
    const executeSpy = vi
      .spyOn(actionExecutor, "executeAction")
      .mockResolvedValue({ kind: "executed" });

    act(() => {
      root.render(
        <DockContextMenu appId="settings" isPinned={true}>
          <button type="button" id="trigger-settings">
            Settings
          </button>
        </DockContextMenu>,
      );
    });

    const trigger = container.querySelector("#trigger-settings") as HTMLElement;
    openContextMenu(trigger);

    const openItem = document.body.querySelector(
      "[data-testid='dock-menu-open']",
    ) as HTMLElement;
    clickElement(openItem);

    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "app.settings.open",
        context: expect.objectContaining({
          kind: "desktop",
          desktopId: "d1",
        }),
      }),
    );
  });

  it("executes new-window action when New Window is clicked", () => {
    const executeSpy = vi
      .spyOn(actionExecutor, "executeAction")
      .mockResolvedValue({ kind: "executed" });

    act(() => {
      root.render(
        <DockContextMenu appId="terminals" isPinned={true}>
          <button type="button" id="trigger-term">
            Terminals
          </button>
        </DockContextMenu>,
      );
    });

    const trigger = container.querySelector("#trigger-term") as HTMLElement;
    openContextMenu(trigger);

    const newItem = document.body.querySelector(
      "[data-testid='dock-menu-new-window']",
    ) as HTMLElement;
    clickElement(newItem);

    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "app.terminals.new-window",
        context: expect.objectContaining({
          kind: "desktop",
          desktopId: "d1",
        }),
      }),
    );
  });

  it("preserves captured context even if active desktop changes before Open/Focus is clicked", () => {
    let session = useWindowStore.getState().session;
    session = {
      ...session,
      desktops: [
        session.desktops[0],
        {
          id: "d2",
          name: "Workspace 2",
          defaultCtx: { profileId: "p2" },
          tree: null,
          floatingWindowIds: [],
        },
      ],
    };
    useWindowStore.setState({ session });

    const executeSpy = vi
      .spyOn(actionExecutor, "executeAction")
      .mockResolvedValue({ kind: "executed" });

    act(() => {
      root.render(
        <DockContextMenu appId="settings" isPinned={true}>
          <button type="button" id="trigger-settings">
            Settings
          </button>
        </DockContextMenu>,
      );
    });

    // Open context menu while active desktop is d1
    const trigger = container.querySelector("#trigger-settings") as HTMLElement;
    openContextMenu(trigger);

    // Now switch active desktop to d2 while menu remains open
    act(() => {
      useWindowStore.getState().switchDesktop("d2");
    });
    expect(useWindowStore.getState().session.activeDesktopId).toBe("d2");

    // Click Open/Focus
    const openItem = document.body.querySelector(
      "[data-testid='dock-menu-open']",
    ) as HTMLElement;
    clickElement(openItem);

    // Must be dispatched with captured desktopId "d1", NOT switched desktop "d2"
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "app.settings.open",
        context: expect.objectContaining({
          kind: "desktop",
          desktopId: "d1",
        }),
      }),
    );
  });

  it("restores and focuses a minimized tiled window across desktops", () => {
    let session = useWindowStore.getState().session;
    session = {
      ...session,
      desktops: [
        session.desktops[0],
        {
          id: "d2",
          name: "Workspace 2",
          defaultCtx: { profileId: "p1" },
          tree: null,
          floatingWindowIds: [],
        },
      ],
    };
    // Open window 1 on d2 (tiled)
    session = openWindow(
      session,
      {
        id: "term-tiled-1",
        appId: "terminals",
        title: "Tiled Terminal 1",
        ctx: { profileId: "p1" },
        mode: "tile",
      },
      "d2",
    );
    // Open window 2 on d2 (tiled) so d2.tree contains multiple items
    session = openWindow(
      session,
      {
        id: "term-tiled-2",
        appId: "terminals",
        title: "Tiled Terminal 2",
        ctx: { profileId: "p1" },
        mode: "tile",
      },
      "d2",
    );

    // Use the actual minimizeWindow operation to remove term-tiled-1 from d2.tree
    // and populate minimizedTileRestore while leaving term-tiled-2 in d2.tree
    session = minimizeWindow(session, "term-tiled-1");
    expect(session.windows["term-tiled-1"].minimized).toBe(true);
    useWindowStore.setState({ session });
    const focusSpy = vi.spyOn(useWindowStore.getState(), "focusWindow");
    const restoreSpy = vi.spyOn(useWindowStore.getState(), "restoreWindow");
    const switchDesktopSpy = vi.spyOn(
      useWindowStore.getState(),
      "switchDesktop",
    );

    act(() => {
      root.render(
        <DockContextMenu appId="terminals" isPinned={true}>
          <button type="button" id="trigger-term">
            Terminals
          </button>
        </DockContextMenu>,
      );
    });

    const trigger = container.querySelector("#trigger-term") as HTMLElement;
    openContextMenu(trigger);

    const instanceItem = document.body.querySelector(
      "[data-testid='dock-menu-instance-term-tiled-1']",
    ) as HTMLElement;
    expect(instanceItem).not.toBeNull();
    clickElement(instanceItem);

    expect(switchDesktopSpy).toHaveBeenCalledWith("d2");
    expect(restoreSpy).toHaveBeenCalledWith("term-tiled-1");
    expect(focusSpy).toHaveBeenCalledWith("term-tiled-1");

    // Assert real state after restore: term-tiled-1 is no longer minimized and is restored into d2
    const finalSession = useWindowStore.getState().session;
    expect(finalSession.windows["term-tiled-1"].minimized).toBe(false);
    expect(finalSession.activeDesktopId).toBe("d2");
  });
});
