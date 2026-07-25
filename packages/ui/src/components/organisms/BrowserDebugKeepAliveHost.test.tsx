// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserDebugKeepAliveHost,
  type BrowserDebugKeepAliveHandle,
} from "./BrowserDebugKeepAliveHost.js";
import type { BrowserDebugController } from "@/hooks/use-browser-debug.js";

const target = {
  url: "http://localhost:3000",
  origin: "http://localhost:3000",
  source: "loopback" as const,
};

function controller(): BrowserDebugController {
  return {
    extensionPresence: "detected",
    inputUrl: target.url,
    target,
    bridgeStatus: "loading",
    selection: null,
    pickerActive: false,
    error: null,
    setInputUrl: vi.fn(),
    navigate: vi.fn(),
    setBridgeStatus: vi.fn(),
    setSelection: vi.fn(),
    setPickerActive: vi.fn(),
    setError: vi.fn(),
  };
}

describe("BrowserDebugKeepAliveHost", () => {
  let root: ReturnType<typeof createRoot> | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    vi.useRealTimers();
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("keeps the same iframe in its stable host across viewport transitions", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const viewport = document.createElement("div");
    document.body.appendChild(viewport);
    const viewportRef = { current: null as HTMLDivElement | null };
    const hostRef = { current: null as BrowserDebugKeepAliveHandle | null };
    root = createRoot(container);
    const browser = controller();

    await act(async () => {
      root?.render(
        <BrowserDebugKeepAliveHost
          ref={hostRef}
          browser={browser}
          viewportRef={viewportRef}
          viewportVersion={0}
          isViewportVisible
        />,
      );
    });
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.hasAttribute("sandbox")).toBe(false);

    viewportRef.current = viewport;
    await act(async () => {
      root?.render(
        <BrowserDebugKeepAliveHost
          ref={hostRef}
          browser={browser}
          viewportRef={viewportRef}
          viewportVersion={1}
          isViewportVisible
        />,
      );
    });
    expect(container.querySelector("iframe")).toBe(iframe);

    viewportRef.current = null;
    await act(async () => {
      root?.render(
        <BrowserDebugKeepAliveHost
          ref={hostRef}
          browser={browser}
          viewportRef={viewportRef}
          viewportVersion={2}
          isViewportVisible
        />,
      );
    });
    expect(container.querySelector("iframe")).toBe(iframe);
    viewport.remove();
  });

  it("invalidates selection state when the target document reloads", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const viewportRef = { current: null as HTMLDivElement | null };
    root = createRoot(container);
    const browser = controller();

    await act(async () => {
      root?.render(
        <BrowserDebugKeepAliveHost
          browser={browser}
          viewportRef={viewportRef}
          viewportVersion={0}
          isViewportVisible
        />,
      );
    });

    await act(async () => {
      container.querySelector("iframe")?.dispatchEvent(new Event("load"));
    });

    expect(browser.setSelection).toHaveBeenCalledWith(null);
    expect(browser.setPickerActive).toHaveBeenCalledWith(false);
    expect(browser.setError).toHaveBeenCalledWith(null);
  });

  it("keeps an uncooperative target visible after handshake timeout", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    const viewportRef = { current: null as HTMLDivElement | null };
    root = createRoot(container);
    const browser = controller();

    await act(async () => {
      root?.render(
        <BrowserDebugKeepAliveHost
          browser={browser}
          viewportRef={viewportRef}
          viewportVersion={0}
          isViewportVisible
        />,
      );
    });
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();

    await act(async () => {
      iframe?.dispatchEvent(new Event("load"));
      vi.advanceTimersByTime(5_000);
    });

    expect(iframe?.getAttribute("src")).toBe(target.url);
    expect(browser.setError).toHaveBeenCalledWith(
      expect.stringContaining("No Browser Debug response"),
    );
    expect(browser.setError).toHaveBeenCalledWith(
      expect.stringContaining("forward the target port over SSH"),
    );

    await act(async () => {
      iframe?.dispatchEvent(new Event("load"));
    });
    expect(browser.setError).toHaveBeenLastCalledWith(null);
  });

  it("hides the overlay while a compact Browser surface is inactive", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const viewportRef = { current: document.createElement("div") };
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <BrowserDebugKeepAliveHost
          browser={controller()}
          viewportRef={viewportRef}
          viewportVersion={1}
          isViewportVisible={false}
        />,
      );
    });

    const overlay = container.firstElementChild as HTMLElement | null;
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(overlay?.style.visibility).toBe("hidden");
    expect(overlay?.style.pointerEvents).toBe("none");
  });
});
