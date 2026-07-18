import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/ContextMenu.js";
import "@/index.css";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EDGE_PADDING = 8;
const EDGE_TOLERANCE = 1;
const POINTER_TOLERANCE = 4;
const DESKTOP_ZOOMS = [0.8, 1, 1.25, 2] as const;

type MenuDefinition = {
  id: string;
  style: React.CSSProperties;
};

const menuDefinitions: MenuDefinition[] = [
  {
    id: "open-space",
    style: { left: "30vw", top: "30vh", width: 32, height: 32 },
  },
  {
    id: "top-edge",
    style: { left: "30vw", top: 2, width: 32, height: 12 },
  },
  {
    id: "left-edge",
    style: { left: 2, top: "40vh", width: 12, height: 32 },
  },
  {
    id: "right-edge",
    style: { right: 2, top: "40vh", width: 12, height: 32 },
  },
  {
    id: "bottom-edge",
    style: { left: "30vw", bottom: 2, width: 32, height: 12 },
  },
];

function ViewportContextMenuFixture() {
  const [expanded, setExpanded] = React.useState(false);
  const [actionCount, setActionCount] = React.useState(0);

  return (
    <main data-testid="fixture" style={{ minHeight: "100vh", position: "relative" }}>
      <div
        data-testid="filtered-panel"
        style={{
          backdropFilter: "blur(2px)",
          height: 120,
          left: 100,
          overflow: "hidden",
          position: "absolute",
          top: 100,
          width: 120,
        }}
      >
        <ContextMenu.Root>
          <ContextMenu.Trigger>
            <div
              data-testid="filtered-trigger"
              style={{ height: 32, margin: 20, width: 32 }}
            />
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenuContent data-testid="filtered-menu">
              <ContextMenuItem data-testid="filtered-action">
                Filtered panel action
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      </div>

      {menuDefinitions.map(({ id, style }) => (
        <ContextMenu.Root key={id}>
          <ContextMenu.Trigger>
            <button
              data-testid={`${id}-trigger`}
              style={{
                ...style,
                position: "fixed",
              }}
              type="button"
            >
              {id}
            </button>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenuContent
              data-menu-id={id}
              style={{ width: id === "open-space" && expanded ? 320 : 180 }}
            >
              <ContextMenuItem
                data-testid={`${id}-expand`}
                onSelect={(event) => {
                  event.preventDefault();
                  setExpanded(true);
                }}
              >
                Expand menu
              </ContextMenuItem>
              <ContextMenuItem
                data-testid={`${id}-action`}
                onSelect={() => setActionCount((count) => count + 1)}
              >
                Run action
              </ContextMenuItem>
              {expanded && id === "open-space" ? (
                <ContextMenuItem>Expanded content</ContextMenuItem>
              ) : null}
            </ContextMenuContent>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      ))}

      <output data-testid="action-count">{actionCount}</output>
      <button data-testid="outside" type="button">
        Outside
      </button>
    </main>
  );
}

describe("viewport context menu in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;
  const originalZoom = document.documentElement.style.zoom;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.documentElement.style.zoom = originalZoom;
  });

  async function renderFixture() {
    await act(async () => root.render(<ViewportContextMenuFixture />));
  }

  async function openAt(testId: string, clientX: number, clientY: number) {
    const trigger = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX,
          clientY,
        }),
      );
    });
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    return document.querySelector<HTMLElement>('[role="menu"]')!;
  }

  function assertInsideViewport(menu: HTMLElement, visualScale = 1) {
    const rect = menu.getBoundingClientRect();
    const padding = EDGE_PADDING * visualScale;
    expect(rect.left).toBeGreaterThanOrEqual(padding - EDGE_TOLERANCE);
    expect(rect.top).toBeGreaterThanOrEqual(padding - EDGE_TOLERANCE);
    expect(rect.right).toBeLessThanOrEqual(
      window.innerWidth * visualScale - padding + EDGE_TOLERANCE,
    );
    expect(rect.bottom).toBeLessThanOrEqual(
      window.innerHeight * visualScale - padding + EDGE_TOLERANCE,
    );
  }

  it("portals through body and stays pointer-relative outside containing blocks", async () => {
    await renderFixture();
    const panel = document.querySelector<HTMLElement>('[data-testid="filtered-panel"]')!;
    const clickX = 140;
    const clickY = 140;
    const menu = await openAt("filtered-trigger", clickX, clickY);
    const wrapper = menu.closest<HTMLElement>("[data-radix-popper-content-wrapper]");
    const panelRect = panel.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    expect(wrapper?.parentElement).toBe(document.body);
    expect(menu.closest('[data-testid="filtered-panel"]')).toBeNull();
    expect(menuRect.left).toBeGreaterThanOrEqual(clickX - EDGE_TOLERANCE);
    expect(menuRect.top).toBeGreaterThanOrEqual(clickY - EDGE_TOLERANCE);
    expect(menuRect.right).toBeGreaterThan(panelRect.right);
  });

  it("opens at the pointer in open space", async () => {
    await renderFixture();
    const clickX = Math.round(window.innerWidth / 3);
    const clickY = Math.round(window.innerHeight / 3);
    const menu = await openAt("open-space-trigger", clickX, clickY);
    const rect = menu.getBoundingClientRect();

    expect(Math.abs(rect.left - clickX)).toBeLessThanOrEqual(POINTER_TOLERANCE);
    expect(Math.abs(rect.top - clickY)).toBeLessThanOrEqual(POINTER_TOLERANCE);
  });

  it("flips and shifts at each viewport edge", async () => {
    await renderFixture();
    const cases = [
      ["top-edge-trigger", 400, 12],
      ["left-edge-trigger", 12, 300],
      ["right-edge-trigger", window.innerWidth - 12, 300],
      ["bottom-edge-trigger", 400, window.innerHeight - 12],
    ] as const;

    for (const [testId, x, y] of cases) {
      const menu = await openAt(testId, x, y);
      assertInsideViewport(menu);
      expect(menu.getAttribute("data-side")).toBeTruthy();
      await act(async () => {
        document.dispatchEvent(new Event("scroll", { bubbles: true }));
      });
      await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    }
  });

  it("reanchors on a second right-click and repositions after dynamic resize", async () => {
    await renderFixture();
    const firstMenu = await openAt(
      "open-space-trigger",
      Math.round(window.innerWidth / 3),
      Math.round(window.innerHeight / 3),
    );
    const firstRect = firstMenu.getBoundingClientRect();

    const trigger = document.querySelector<HTMLElement>('[data-testid="open-space-trigger"]')!;
    const secondX = window.innerWidth - 24;
    const secondY = Math.round(window.innerHeight / 2);
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX: secondX,
          clientY: secondY,
        }),
      );
    });
    await vi.waitFor(() => {
      const rect = document.querySelector<HTMLElement>('[role="menu"]')?.getBoundingClientRect();
      expect(rect && Math.abs(rect.left - firstRect.left)).toBeGreaterThan(20);
      expect(rect && Math.abs(rect.top - firstRect.top)).toBeGreaterThan(20);
    });
    const secondMenu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const secondRect = secondMenu.getBoundingClientRect();
    expect(Math.abs(secondRect.left - firstRect.left)).toBeGreaterThan(20);
    expect(Math.abs(secondRect.top - firstRect.top)).toBeGreaterThan(20);

    const expand = document.querySelector<HTMLElement>('[data-testid="open-space-expand"]');
    await act(async () => expand?.click());
    await vi.waitFor(() => expect(secondMenu.getBoundingClientRect().width).toBeGreaterThan(300));
    await vi.waitFor(() => assertInsideViewport(secondMenu));
  });

  it("fires an action once and dismisses on Escape, outside pointer, and scroll", async () => {
    await renderFixture();
    const menu = await openAt("open-space-trigger", 320, 240);
    const action = menu.querySelector<HTMLElement>('[data-testid="open-space-action"]');
    await act(async () => action?.click());
    expect(document.querySelector('[data-testid="action-count"]')?.textContent).toBe("1");
    expect(document.querySelector('[role="menu"]')).toBeNull();

    const trigger = document.querySelector<HTMLElement>('[data-testid="open-space-trigger"]')!;
    trigger.focus();
    await openAt("open-space-trigger", 320, 240);
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    expect(document.activeElement).toBe(trigger);

    await openAt("open-space-trigger", 320, 240);
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="outside"]')?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());

    await openAt("open-space-trigger", 320, 240);
    await act(async () => document.dispatchEvent(new Event("scroll", { bubbles: true })));
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  });

  it("opens from the keyboard, focuses the first item, and supports roving navigation", async () => {
    await renderFixture();
    const trigger = document.querySelector<HTMLElement>('[data-testid="open-space-trigger"]')!;
    trigger.focus();
    await act(async () => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ContextMenu",
        }),
      );
    });
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    expect(document.activeElement?.textContent).toContain("Expand menu");

    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" }));
    });
    expect(document.activeElement?.textContent).toContain("Run action");
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" }));
    });
    expect(document.activeElement?.textContent).toContain("Expand menu");

    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  const cssZoomSupported =
    typeof CSS !== "undefined" && CSS.supports("zoom", "1");

  it.skipIf(!cssZoomSupported)("keeps edge placement valid at desktop zoom levels", async () => {
    for (const zoom of DESKTOP_ZOOMS) {
      document.documentElement.style.zoom = String(zoom);
      await renderFixture();
      const menu = await openAt(
        "right-edge-trigger",
        window.innerWidth - 12,
        Math.round(window.innerHeight / 2),
      );
      assertInsideViewport(menu, zoom);
      await act(async () => document.dispatchEvent(new Event("scroll", { bubbles: true })));
      await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
      await act(async () => root.render(<ViewportContextMenuFixture />));
    }
  });
});
