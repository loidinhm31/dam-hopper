// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dock } from "./Dock.js";
import { useWindowStore } from "./window-store.js";
import { useSettingsStore } from "@/stores/settings.js";
import { createDefaultOsSession, openWindow } from "./window-ops.js";
import * as dockPins from "./dock-pins.js";
import * as actionExecutor from "./action-executor.js";

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

function rightClickElement(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 50,
        clientY: 50,
      }),
    );
  });
}

describe("Dock", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    dockPins._reloadDockPinsFromStorageForTesting();
    useSettingsStore.setState({ dockPosition: "left" });
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
    useSettingsStore.setState({ dockPosition: "left" });
    vi.restoreAllMocks();
  });

  it("renders ordered pinned apps with 44px hit target buttons", () => {
    dockPins.setDockPins(["files", "terminals", "editor"]);

    act(() => {
      root.render(<Dock />);
    });

    const items = container.querySelectorAll("[data-testid^='dock-item-']");
    expect(items.length).toBe(3);
    // Verify exact rendered order
    const renderedIds = Array.from(items).map((el) =>
      el.getAttribute("data-testid")?.replace("dock-item-", ""),
    );
    expect(renderedIds).toEqual(["files", "terminals", "editor"]);

    const filesBtn = container.querySelector(
      "[data-testid='dock-item-files']",
    ) as HTMLElement;
    const termBtn = container.querySelector(
      "[data-testid='dock-item-terminals']",
    ) as HTMLElement;
    const editorBtn = container.querySelector(
      "[data-testid='dock-item-editor']",
    ) as HTMLElement;

    expect(filesBtn).not.toBeNull();
    expect(termBtn).not.toBeNull();
    expect(editorBtn).not.toBeNull();

    // Check hit target classes / attributes
    expect(filesBtn.className).toContain("w-[44px]");
    expect(filesBtn.className).toContain("h-[44px]");

    // Check SVG icon inside
    const svg = filesBtn.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("renders running-unpinned apps across desktops deduped after pinned apps", () => {
    // Only "files" is pinned
    dockPins.setDockPins(["files"]);

    let session = useWindowStore.getState().session;
    // Add two desktops
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
    // Window for "browser" on d1
    session = openWindow(
      session,
      {
        id: "w-browser",
        appId: "browser",
        title: "Browser",
        ctx: { profileId: "p1" },
        mode: "tile",
      },
      "d1",
    );
    // Window for "terminals" on d2
    session = openWindow(
      session,
      {
        id: "w-term",
        appId: "terminals",
        title: "Terminal",
        ctx: { profileId: "p1" },
        mode: "float",
      },
      "d2",
    );
    useWindowStore.setState({ session });

    act(() => {
      root.render(<Dock />);
    });

    // Pinned: files
    // Running unpinned: terminals, browser (rendered in manifest order: terminals before browser)
    const items = container.querySelectorAll("[data-testid^='dock-item-']");
    expect(items.length).toBe(3);

    // Pinned: files; Running unpinned in manifest order: terminals, then browser
    const renderedIds = Array.from(items).map((el) =>
      el.getAttribute("data-testid")?.replace("dock-item-", ""),
    );
    expect(renderedIds).toEqual(["files", "terminals", "browser"]);
  });

  it("deduplicates multiple running windows of the same app across multiple desktops", () => {
    // No pinned apps
    dockPins.setDockPins([]);

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

    // Open 3 terminals across d1 and d2
    session = openWindow(
      session,
      { id: "term-1", appId: "terminals", title: "T1", ctx: { profileId: "p1" }, mode: "tile" },
      "d1",
    );
    session = openWindow(
      session,
      { id: "term-2", appId: "terminals", title: "T2", ctx: { profileId: "p1" }, mode: "float" },
      "d1",
    );
    session = openWindow(
      session,
      { id: "term-3", appId: "terminals", title: "T3", ctx: { profileId: "p1" }, mode: "tile" },
      "d2",
    );

    // Open 2 browser windows on d2
    session = openWindow(
      session,
      { id: "browser-1", appId: "browser", title: "B1", ctx: { profileId: "p1" }, mode: "float" },
      "d2",
    );
    session = openWindow(
      session,
      { id: "browser-2", appId: "browser", title: "B2", ctx: { profileId: "p1" }, mode: "tile" },
      "d2",
    );
    useWindowStore.setState({ session });

    act(() => {
      root.render(<Dock />);
    });

    // Despite 5 windows total, exactly 2 deduped dock items appear
    const items = container.querySelectorAll("[data-testid^='dock-item-']");
    expect(items.length).toBe(2);

    const renderedIds = Array.from(items).map((el) =>
      el.getAttribute("data-testid")?.replace("dock-item-", ""),
    );
    expect(renderedIds).toEqual(["terminals", "browser"]);
  });

  it("preserves empty dock [] and only displays running apps or empty scroller", () => {
    dockPins.setDockPins([]);

    act(() => {
      root.render(<Dock />);
    });

    // No running windows and [] pins -> 0 app items, but Apps button exists
    const items = container.querySelectorAll("[data-testid^='dock-item-']");
    expect(items.length).toBe(0);

    const appsTrigger = container.querySelector(
      "[data-testid='dock-apps-trigger']",
    ) as HTMLElement;
    expect(appsTrigger).not.toBeNull();
  });

  it("displays running, focused, and minimized indicators correctly", () => {
    dockPins.setDockPins(["terminals", "editor"]);

    let session = useWindowStore.getState().session;
    // Window 1: terminals (focused on active desktop d1)
    session = openWindow(
      session,
      {
        id: "term-1",
        appId: "terminals",
        title: "Term 1",
        ctx: { profileId: "p1" },
        mode: "tile",
      },
      "d1",
    );
    // Window 2: editor (minimized on active desktop d1)
    session = openWindow(
      session,
      {
        id: "editor-1",
        appId: "editor",
        title: "Editor 1",
        ctx: { profileId: "p1" },
        mode: "float",
      },
      "d1",
    );
    session = {
      ...session,
      desktops: session.desktops.map((d) =>
        d.id === "d1" ? { ...d, focusedWindowId: "term-1" } : d,
      ),
      windows: {
        ...session.windows,
        "editor-1": {
          ...session.windows["editor-1"],
          minimized: true,
        },
      },
    };
    useWindowStore.setState({ session });

    act(() => {
      root.render(<Dock />);
    });

    // Running indicators exist for both
    expect(
      container.querySelector("[data-testid='dock-running-indicator-terminals']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='dock-running-indicator-editor']"),
    ).not.toBeNull();

    // Focus indicator on terminals
    const termBtn = container.querySelector(
      "[data-testid='dock-item-terminals']",
    ) as HTMLElement;
    expect(termBtn.getAttribute("aria-current")).toBe("true");

    // Minimized indicator on editor
    expect(
      container.querySelector("[data-testid='dock-minimized-indicator-editor']"),
    ).not.toBeNull();
  });

  it("launches app via onLaunchApp callback when prop is provided", () => {
    dockPins.setDockPins(["settings"]);
    const onLaunchMock = vi.fn();

    act(() => {
      root.render(<Dock onLaunchApp={onLaunchMock} />);
    });

    const btn = container.querySelector(
      "[data-testid='dock-item-settings']",
    ) as HTMLElement;
    clickElement(btn);

    expect(onLaunchMock).toHaveBeenCalledWith(
      "settings",
      expect.objectContaining({ kind: "desktop", desktopId: "d1" }),
    );
  });

  it("launches app via executeAction when onLaunchApp prop is omitted", () => {
    dockPins.setDockPins(["settings"]);
    const executeSpy = vi
      .spyOn(actionExecutor, "executeAction")
      .mockResolvedValue({ kind: "executed" });

    act(() => {
      root.render(<Dock />);
    });

    const btn = container.querySelector(
      "[data-testid='dock-item-settings']",
    ) as HTMLElement;
    clickElement(btn);

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

  it("tracks dockOuterSpacing dynamically in maxHeight style", () => {
    act(() => {
      root.render(<Dock />);
    });

    const panel = container.querySelector(
      "[data-testid='dock-panel']",
    ) as HTMLElement;
    // Default dockOuterSpacing is 12, so 2 * 12 = 24px
    expect(panel.style.maxHeight).toBe("calc(100% - 24px)");
  });

  it("opens context menu on right-click of a dock item", () => {
    dockPins.setDockPins(["files"]);

    act(() => {
      root.render(<Dock />);
    });

    const btn = container.querySelector(
      "[data-testid='dock-item-files']",
    ) as HTMLElement;
    rightClickElement(btn);

    expect(document.body.querySelector("[data-testid='dock-menu-open']")).not.toBeNull();
    expect(document.body.querySelector("[data-testid='dock-menu-toggle-pin']")).not.toBeNull();
  });

  it("permanent reachable Apps button toggles the applications catalog", () => {
    act(() => {
      root.render(<Dock />);
    });

    expect(document.body.querySelector("[data-testid='app-launcher-panel']")).toBeNull();

    const appsTrigger = container.querySelector(
      "[data-testid='dock-apps-trigger']",
    ) as HTMLElement;
    clickElement(appsTrigger);

    expect(document.body.querySelector("[data-testid='app-launcher-panel']")).not.toBeNull();
  });

  it("renders correctly in all 4 positions (left, right, top, bottom)", () => {
    dockPins.setDockPins(["terminals"]);
    let session = useWindowStore.getState().session;
    session = openWindow(
      session,
      {
        id: "term-1",
        appId: "terminals",
        title: "Terminal",
        ctx: { profileId: "p1" },
        mode: "tile",
      },
      "d1",
    );
    useWindowStore.setState({ session });

    // 1. Left
    act(() => {
      root.render(<Dock position="left" />);
    });
    const asideLeft = container.querySelector("aside") as HTMLElement;
    const panelLeft = container.querySelector("[data-testid='dock-panel']") as HTMLElement;
    const scrollerLeft = container.querySelector("[data-testid='dock-items-scroller']") as HTMLElement;
    const triggerWrapLeft = container.querySelector("[data-testid='dock-apps-trigger']")?.parentElement as HTMLElement;
    const indicatorLeft = container.querySelector("[data-testid='dock-running-indicator-terminals']") as HTMLElement;

    expect(asideLeft.getAttribute("data-dock-position")).toBe("left");
    expect(asideLeft.className).toContain("flex-col");
    expect(asideLeft.className).toContain("h-full");
    expect(panelLeft.className).toContain("flex-col");
    expect(panelLeft.style.maxHeight).toBe("calc(100% - 24px)");
    expect(panelLeft.style.maxWidth).toBe("");
    expect(scrollerLeft.className).toContain("overflow-y-auto");
    expect(scrollerLeft.className).toContain("flex-col");
    expect(triggerWrapLeft.className).toContain("border-t");
    expect(indicatorLeft.className).toContain("left-1");
    expect(indicatorLeft.className).toContain("top-1/2");

    // 2. Right
    act(() => {
      root.render(<Dock position="right" />);
    });
    const asideRight = container.querySelector("aside") as HTMLElement;
    const panelRight = container.querySelector("[data-testid='dock-panel']") as HTMLElement;
    const scrollerRight = container.querySelector("[data-testid='dock-items-scroller']") as HTMLElement;
    const triggerWrapRight = container.querySelector("[data-testid='dock-apps-trigger']")?.parentElement as HTMLElement;
    const indicatorRight = container.querySelector("[data-testid='dock-running-indicator-terminals']") as HTMLElement;

    expect(asideRight.getAttribute("data-dock-position")).toBe("right");
    expect(asideRight.className).toContain("flex-col");
    expect(asideRight.className).toContain("h-full");
    expect(panelRight.className).toContain("flex-col");
    expect(panelRight.style.maxHeight).toBe("calc(100% - 24px)");
    expect(panelRight.style.maxWidth).toBe("");
    expect(scrollerRight.className).toContain("overflow-y-auto");
    expect(scrollerRight.className).toContain("flex-col");
    expect(triggerWrapRight.className).toContain("border-t");
    expect(indicatorRight.className).toContain("right-1");
    expect(indicatorRight.className).toContain("top-1/2");

    // 3. Top
    act(() => {
      root.render(<Dock position="top" />);
    });
    const asideTop = container.querySelector("aside") as HTMLElement;
    const panelTop = container.querySelector("[data-testid='dock-panel']") as HTMLElement;
    const scrollerTop = container.querySelector("[data-testid='dock-items-scroller']") as HTMLElement;
    const triggerWrapTop = container.querySelector("[data-testid='dock-apps-trigger']")?.parentElement as HTMLElement;
    const indicatorTop = container.querySelector("[data-testid='dock-running-indicator-terminals']") as HTMLElement;

    expect(asideTop.getAttribute("data-dock-position")).toBe("top");
    expect(asideTop.className).toContain("flex-row");
    expect(asideTop.className).toContain("w-full");
    expect(panelTop.className).toContain("flex-row");
    expect(panelTop.style.maxWidth).toBe("calc(100% - 24px)");
    expect(panelTop.style.maxHeight).toBe("");
    expect(scrollerTop.className).toContain("overflow-x-auto");
    expect(scrollerTop.className).toContain("flex-row");
    expect(triggerWrapTop.className).toContain("border-l");
    expect(indicatorTop.className).toContain("top-1");
    expect(indicatorTop.className).toContain("left-1/2");

    // 4. Bottom
    act(() => {
      root.render(<Dock position="bottom" />);
    });
    const asideBottom = container.querySelector("aside") as HTMLElement;
    const panelBottom = container.querySelector("[data-testid='dock-panel']") as HTMLElement;
    const scrollerBottom = container.querySelector("[data-testid='dock-items-scroller']") as HTMLElement;
    const triggerWrapBottom = container.querySelector("[data-testid='dock-apps-trigger']")?.parentElement as HTMLElement;
    const indicatorBottom = container.querySelector("[data-testid='dock-running-indicator-terminals']") as HTMLElement;

    expect(asideBottom.getAttribute("data-dock-position")).toBe("bottom");
    expect(asideBottom.className).toContain("flex-row");
    expect(asideBottom.className).toContain("w-full");
    expect(panelBottom.className).toContain("flex-row");
    expect(panelBottom.style.maxWidth).toBe("calc(100% - 24px)");
    expect(panelBottom.style.maxHeight).toBe("");
    expect(scrollerBottom.className).toContain("overflow-x-auto");
    expect(scrollerBottom.className).toContain("flex-row");
    expect(triggerWrapBottom.className).toContain("border-l");
    expect(indicatorBottom.className).toContain("bottom-1");
    expect(indicatorBottom.className).toContain("left-1/2");
  });

  it("prioritizes explicit position prop over useSettingsStore value", () => {
    useSettingsStore.setState({ dockPosition: "right" });

    // When position prop is omitted, it reads from settings store
    act(() => {
      root.render(<Dock />);
    });
    expect(container.querySelector("aside")?.getAttribute("data-dock-position")).toBe("right");

    // When position prop is provided, it overrides settings store
    act(() => {
      root.render(<Dock position="top" />);
    });
    expect(container.querySelector("aside")?.getAttribute("data-dock-position")).toBe("top");
  });

  it("reactively updates orientation when settings store changes", () => {
    act(() => {
      root.render(<Dock />);
    });
    expect(container.querySelector("aside")?.getAttribute("data-dock-position")).toBe("left");

    act(() => {
      useSettingsStore.setState({ dockPosition: "bottom" });
    });
    expect(container.querySelector("aside")?.getAttribute("data-dock-position")).toBe("bottom");
    expect(container.querySelector("[data-testid='dock-panel']")?.className).toContain("flex-row");
  });

  it("handles live position prop transitions without stale styles", () => {
    act(() => {
      root.render(<Dock position="left" />);
    });
    const panel = container.querySelector("[data-testid='dock-panel']") as HTMLElement;
    expect(panel.style.maxHeight).toBe("calc(100% - 24px)");
    expect(panel.style.maxWidth).toBe("");

    act(() => {
      root.render(<Dock position="top" />);
    });
    expect(panel.style.maxWidth).toBe("calc(100% - 24px)");
    expect(panel.style.maxHeight).toBe("");

    act(() => {
      root.render(<Dock position="right" />);
    });
    expect(panel.style.maxHeight).toBe("calc(100% - 24px)");
    expect(panel.style.maxWidth).toBe("");

    act(() => {
      root.render(<Dock position="bottom" />);
    });
    expect(panel.style.maxWidth).toBe("calc(100% - 24px)");
    expect(panel.style.maxHeight).toBe("");
  });

  it("restores stored position when position prop is removed on rerender", () => {
    useSettingsStore.setState({ dockPosition: "right" });

    // Step 1: Render with override "top"
    act(() => {
      root.render(<Dock position="top" />);
    });
    let aside = container.querySelector("aside") as HTMLElement;
    let panel = container.querySelector("[data-testid='dock-panel']") as HTMLElement;
    expect(aside.getAttribute("data-dock-position")).toBe("top");
    expect(panel.style.maxWidth).toBe("calc(100% - 24px)");
    expect(panel.style.maxHeight).toBe("");

    // Step 2: Render without prop -> falls back to stored "right"
    act(() => {
      root.render(<Dock />);
    });
    aside = container.querySelector("aside") as HTMLElement;
    panel = container.querySelector("[data-testid='dock-panel']") as HTMLElement;
    expect(aside.getAttribute("data-dock-position")).toBe("right");
    expect(panel.style.maxHeight).toBe("calc(100% - 24px)");
    expect(panel.style.maxWidth).toBe("");
  });
});
