// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, useState, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DesktopCanvas } from "./DesktopCanvas.js";
import { useWindowStore } from "./window-store.js";
import {
  createDefaultOsSession,
  openWindow,
  maximizeWindow,
  updateFloatBounds,
  focusWindow,
  splitWindow,
} from "./window-ops.js";
import type { FloatBounds, OsWindow, WindowContext } from "./types.js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @ts-expect-error test environment flag for React act
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class MockResizeObserver {
  observe = () => {};
  unobserve = () => {};
  disconnect = () => {};
}
if (typeof window !== "undefined") {
  window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
}

const testCtx: WindowContext = {
  profileId: "default",
  projectId: "project-1",
};
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

describe("DesktopCanvas maximized presentation plane", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useWindowStore.setState({
      session: createDefaultOsSession("desk-1", "Main"),
      viewport: { width: 1200, height: 750 },
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function renderDesktop(renderApp?: (win: OsWindow) => React.ReactNode) {
    const desktop = useWindowStore.getState().session.desktops[0];
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DesktopCanvas
            desktop={desktop}
            renderApp={
              renderApp ??
              ((win) => (
                <div data-testid={`app-${win.id}`}>{win.title} App</div>
              ))
            }
          />
        </QueryClientProvider>,
      );
    });
  }

  it("reparents nested tiled window to canvas maximized plane and renders tile placeholder", () => {
    let session = useWindowStore.getState().session;
    session = openWindow(session, {
      id: "tile-win-1",
      appId: "editor",
      title: "My Editor",
      ctx: testCtx,
      mode: "tile",
    });
    session = openWindow(session, {
      id: "tile-win-2",
      appId: "terminals",
      title: "My Terminal",
      ctx: testCtx,
      mode: "tile",
    });
    session = splitWindow(session, "tile-win-1", "tile-win-2", "right");
    useWindowStore.setState({ session });
    renderDesktop();

    expect(
      container.querySelector('[data-testid="window-frame-tile-win-1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="window-frame-tile-win-2"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="tile-placeholder-tile-win-1"]'),
    ).toBeNull();

    // Maximize tile-win-1
    act(() => {
      useWindowStore.getState().toggleMaximizeWindow("tile-win-1");
    });
    renderDesktop();

    // 1. Maximized presentation plane exists at canvas work-area level
    const maxLayer = container.querySelector(
      '[data-testid="maximized-layer-desk-1"]',
    );
    expect(maxLayer).not.toBeNull();
    const maxSlot = container.querySelector(
      '[data-testid="maximized-slot-tile-win-1"]',
    );
    expect(maxSlot).not.toBeNull();
    expect(maxLayer?.contains(maxSlot!)).toBe(true);

    const frame = container.querySelector(
      '[data-testid="window-frame-tile-win-1"]',
    ) as HTMLElement;
    expect(maxSlot?.contains(frame)).toBe(true);

    // 2. Tile placeholder is rendered inside the tile pane
    const placeholder = container.querySelector(
      '[data-testid="tile-placeholder-tile-win-1"]',
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent).toContain("My Editor");
    expect(placeholder?.textContent).toContain("Maximized to canvas work area");

    // 3. Exclusive slot: tile-win-1 frame exists exactly once in DOM
    const frames = container.querySelectorAll(
      '[data-testid="window-frame-tile-win-1"]',
    );
    expect(frames.length).toBe(1);

    // 4. Inset 0 styling applied (not viewport fixed 100vw/100vh)
    expect(frame.style.position).toBe("absolute");
    expect(frame.style.width).toBe("100%");
    expect(frame.style.height).toBe("100%");
    expect(frame.getAttribute("data-os-presentation-kind")).toBe("maximized");

    // 5. Restore tiled window via placeholder restore button
    const restoreBtn = container.querySelector(
      '[data-testid="tile-placeholder-restore-tile-win-1"]',
    ) as HTMLElement;
    expect(restoreBtn).not.toBeNull();
    clickElement(restoreBtn);
    renderDesktop();

    // Placeholder is gone, window is back in tile layer
    expect(
      container.querySelector('[data-testid="tile-placeholder-tile-win-1"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="maximized-layer-desk-1"]'),
    ).toBeNull();
    const tileSlot = container.querySelector(
      '[data-testid="tile-slot-tile-win-1"]',
    );
    expect(tileSlot).not.toBeNull();
    expect(tileSlot?.contains(frame)).toBe(true);
  });

  it("maximizes and restores floating window while preserving exact saved floatBounds", () => {
    let session = useWindowStore.getState().session;
    const initialBounds: FloatBounds = {
      x: 180,
      y: 140,
      width: 550,
      height: 380,
    };
    session = openWindow(session, {
      id: "float-win-1",
      appId: "browser",
      title: "Preview",
      ctx: testCtx,
      mode: "float",
    });
    session = updateFloatBounds(session, "float-win-1", initialBounds);
    useWindowStore.setState({ session });

    renderDesktop();

    const floatSlot = container.querySelector(
      '[data-testid="float-slot-float-win-1"]',
    );
    const frame = container.querySelector(
      '[data-testid="window-frame-float-win-1"]',
    ) as HTMLElement;
    expect(floatSlot?.contains(frame)).toBe(true);

    // Maximize via header maximize button
    const maxBtn = container.querySelector(
      '[data-testid="window-maximize-btn-float-win-1"]',
    ) as HTMLElement;
    expect(maxBtn).not.toBeNull();
    clickElement(maxBtn);
    renderDesktop();

    // Frame is now in maximized slot
    const maxSlot = container.querySelector(
      '[data-testid="maximized-slot-float-win-1"]',
    );
    expect(maxSlot?.contains(frame)).toBe(true);

    // Saved floatBounds must be intact in session
    expect(
      useWindowStore.getState().session.windows["float-win-1"].floatBounds,
    ).toEqual(initialBounds);

    // Restore floating window via header restore button
    const restoreBtn = container.querySelector(
      '[data-testid="window-maximize-btn-float-win-1"]',
    ) as HTMLElement;
    expect(restoreBtn.getAttribute("aria-label")).toBe("Restore");
    clickElement(restoreBtn);
    renderDesktop();

    // Returned to float slot with preserved bounds
    const restoredFloatSlot = container.querySelector(
      '[data-testid="float-slot-float-win-1"]',
    );
    expect(restoredFloatSlot?.contains(frame)).toBe(true);
    expect(
      useWindowStore.getState().session.windows["float-win-1"].floatBounds,
    ).toEqual(initialBounds);
  });

  it("handles deterministic stacking between multiple maximized windows with focus on top", () => {
    let session = useWindowStore.getState().session;
    session = openWindow(session, {
      id: "win-1",
      appId: "editor",
      title: "Win 1",
      ctx: testCtx,
      mode: "tile",
    });
    session = openWindow(session, {
      id: "win-2",
      appId: "browser",
      title: "Win 2",
      ctx: testCtx,
      mode: "float",
    });
    session = maximizeWindow(session, "win-1");
    session = maximizeWindow(session, "win-2");
    session = focusWindow(session, "win-1");
    useWindowStore.setState({ session });

    renderDesktop();

    // win-1 is focused, so its slot should have higher z-index (50) than win-2 (40)
    const slot1 = container.querySelector(
      '[data-testid="maximized-slot-win-1"]',
    ) as HTMLElement;
    const slot2 = container.querySelector(
      '[data-testid="maximized-slot-win-2"]',
    ) as HTMLElement;
    expect(slot1.style.zIndex).toBe("50");
    expect(slot2.style.zIndex).toBe("40");

    // Focus win-2
    act(() => {
      useWindowStore.getState().focusWindow("win-2");
    });
    renderDesktop();

    // win-2 is now focused, so its slot receives z-index 50
    const updatedSlot2 = container.querySelector(
      '[data-testid="maximized-slot-win-2"]',
    ) as HTMLElement;
    expect(updatedSlot2.style.zIndex).toBe("50");
  });

  it("preserves React component instance, hooks, and state across maximize and restore (zero remounts)", () => {
    let mountCount = 0;
    let unmountCount = 0;

    function StatefulTestApp({ window: win }: { window: OsWindow }) {
      const [count, setCount] = useState(42);
      const [text, setText] = useState("draft content");

      useEffect(() => {
        mountCount++;
        return () => {
          unmountCount++;
        };
      }, []);

      return (
        <div data-testid={`stateful-app-${win.id}`}>
          <span data-testid="counter-val">{count}</span>
          <button
            data-testid="inc-btn"
            type="button"
            onClick={() => setCount((c) => c + 1)}
          >
            Increment
          </button>
          <button
            data-testid="edit-buffer-btn"
            type="button"
            onClick={() => setText("modified unsaved buffer")}
          >
            Edit
          </button>
          <span data-testid="input-val">{text}</span>
        </div>
      );
    }

    let session = useWindowStore.getState().session;
    session = openWindow(session, {
      id: "continuity-win",
      appId: "editor",
      title: "Continuity Editor",
      ctx: testCtx,
      mode: "tile",
    });
    useWindowStore.setState({ session });

    renderDesktop((win) => <StatefulTestApp window={win} />);

    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);
    const counterEl = container.querySelector(
      '[data-testid="counter-val"]',
    );
    expect(counterEl?.textContent).toBe("42");
    expect(
      container.querySelector('[data-testid="input-val"]')?.textContent,
    ).toBe("draft content");

    // Modify state before maximize
    const incBtn = container.querySelector(
      '[data-testid="inc-btn"]',
    ) as HTMLElement;
    clickElement(incBtn);

    const editBtn = container.querySelector(
      '[data-testid="edit-buffer-btn"]',
    ) as HTMLElement;
    clickElement(editBtn);

    expect(counterEl?.textContent).toBe("43");
    expect(
      container.querySelector('[data-testid="input-val"]')?.textContent,
    ).toBe("modified unsaved buffer");
    // Maximize window
    act(() => {
      useWindowStore.getState().toggleMaximizeWindow("continuity-win");
    });
    renderDesktop((win) => <StatefulTestApp window={win} />);

    // CRITICAL ACCEPTANCE CHECK: NO remount occurred!
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);

    // State is 100% preserved
    expect(
      container.querySelector('[data-testid="counter-val"]')?.textContent,
    ).toBe("43");
    expect(
      container.querySelector('[data-testid="input-val"]')?.textContent,
    ).toBe("modified unsaved buffer");

    // Restore window
    act(() => {
      useWindowStore.getState().toggleMaximizeWindow("continuity-win");
    });
    renderDesktop((win) => <StatefulTestApp window={win} />);

    // Still exactly 1 mount, 0 unmounts!
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);
    expect(
      container.querySelector('[data-testid="counter-val"]')?.textContent,
    ).toBe("43");
    expect(
      container.querySelector('[data-testid="input-val"]')?.textContent,
    ).toBe("modified unsaved buffer");
  });
});
