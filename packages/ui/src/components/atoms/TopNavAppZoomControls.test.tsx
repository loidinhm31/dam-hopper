// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppZoomProvider } from "@/contexts/AppZoomContext.js";
import { APP_ZOOM_STORAGE_KEY } from "@/lib/app-zoom.js";
import { TopNavAppZoomControls } from "./TopNavAppZoomControls.js";

function createStorage(level = 100) {
  let value = JSON.stringify({ version: 1, zoom: level });
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, nextValue: string) => {
      value = nextValue;
    }),
  };
}

describe("TopNavAppZoomControls", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    document.documentElement.style.zoom = "";
    vi.unstubAllGlobals();
  });

  function render(level = 100) {
    const storage = createStorage(level);
    vi.stubGlobal("localStorage", storage);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <AppZoomProvider>
          <TopNavAppZoomControls />
        </AppZoomProvider>,
      );
    });
    return storage;
  }

  it("renders accessible shared controls with a dynamic level indicator", () => {
    render();

    expect(
      container?.querySelector("[data-testid=top-nav-app-zoom-controls]"),
    ).not.toBeNull();
    expect(
      container?.querySelector("[data-testid=top-nav-app-zoom-level]")
        ?.textContent,
    ).toBe("100%");
    expect(
      container?.querySelector<HTMLButtonElement>(
        "[data-testid=top-nav-app-zoom-decrease]",
      ),
    ).toMatchObject({ disabled: false });
    expect(
      container
        ?.querySelector<HTMLButtonElement>(
          "[data-testid=top-nav-app-zoom-increase]",
        )
        ?.getAttribute("aria-label"),
    ).toBe("Increase app layout zoom");
  });

  it("steps in both directions and persists the validated level", () => {
    const storage = render();
    const increase = container?.querySelector<HTMLButtonElement>(
      "[data-testid=top-nav-app-zoom-increase]",
    );
    const decrease = container?.querySelector<HTMLButtonElement>(
      "[data-testid=top-nav-app-zoom-decrease]",
    );

    act(() => increase?.click());
    expect(
      container?.querySelector("[data-testid=top-nav-app-zoom-level]")
        ?.textContent,
    ).toBe("110%");
    expect(document.documentElement.style.zoom).toBe("110%");
    expect(storage.setItem).toHaveBeenLastCalledWith(
      APP_ZOOM_STORAGE_KEY,
      JSON.stringify({ version: 1, zoom: 110 }),
    );

    act(() => decrease?.click());
    expect(
      container?.querySelector("[data-testid=top-nav-app-zoom-level]")
        ?.textContent,
    ).toBe("100%");
  });

  it("disables and saturates the controls at 50% and 120%", () => {
    render(50);
    const decrease = container?.querySelector<HTMLButtonElement>(
      "[data-testid=top-nav-app-zoom-decrease]",
    );
    expect(decrease?.disabled).toBe(true);
    act(() => decrease?.click());
    expect(document.documentElement.style.zoom).toBe("50%");

    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;

    render(120);
    const increase = container?.querySelector<HTMLButtonElement>(
      "[data-testid=top-nav-app-zoom-increase]",
    );
    expect(increase?.disabled).toBe(true);
    act(() => increase?.click());
    expect(document.documentElement.style.zoom).toBe("120%");
  });

  it("does not add a keyboard zoom shortcut", () => {
    render();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));

    expect(
      container?.querySelector("[data-testid=top-nav-app-zoom-level]")
        ?.textContent,
    ).toBe("100%");
  });
});
