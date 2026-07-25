import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserDebugKeepAliveHost } from "@/components/organisms/BrowserDebugKeepAliveHost.js";
import { BrowserDebugPanel } from "@/components/organisms/BrowserDebugPanel.js";
import type { BrowserDebugController } from "@/hooks/use-browser-debug.js";
import { getBrowserDebugViewportFrame } from "@/lib/browser-debug-keep-alive.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("browser debug keep-alive in Chromium", () => {
  it("keeps a loaded iframe in its stable host while its viewport frame changes", async () => {
    const parking = document.createElement("div");
    const viewport = document.createElement("div");
    const frame = document.createElement("iframe");
    let loadCount = 0;
    frame.addEventListener("load", () => {
      loadCount += 1;
    });
    frame.srcdoc = "<p>cooperative target</p>";
    parking.append(frame);
    document.body.append(parking, viewport);
    await new Promise<void>((resolve) =>
      frame.addEventListener("load", () => resolve(), { once: true }),
    );
    frame.contentDocument?.body.setAttribute("data-keep-alive-probe", "loaded-once");

    Object.defineProperty(viewport, "getBoundingClientRect", {
      value: () => new DOMRect(10, 20, 640, 480),
    });
    expect(getBrowserDebugViewportFrame(viewport)).toEqual({
      top: 20,
      left: 10,
      width: 640,
      height: 480,
    });
    expect(parking.querySelector("iframe")).toBe(frame);
    expect(frame.contentDocument?.body.getAttribute("data-keep-alive-probe")).toBe(
      "loaded-once",
    );
    expect(loadCount).toBe(1);

    expect(getBrowserDebugViewportFrame(null)).toBeNull();
    expect(parking.querySelector("iframe")).toBe(frame);
    expect(frame.contentDocument?.body.getAttribute("data-keep-alive-probe")).toBe(
      "loaded-once",
    );
    expect(loadCount).toBe(1);
  });

  it("keeps the same iframe when the active terminal changes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const viewportRef = { current: null as HTMLDivElement | null };
    const browser = {
      target: null,
      setSelection: vi.fn(),
      setPickerActive: vi.fn(),
      setError: vi.fn(),
      setBridgeStatus: vi.fn(),
    } as unknown as BrowserDebugController;
    const terminal = (sessionId: string, label: string) => ({
      sessionId,
      label,
      mounted: true,
      registered: true,
      alive: true,
      current: true,
    });
    const render = (activeTerminal: ReturnType<typeof terminal>) => (
      <>
        <BrowserDebugKeepAliveHost
          browser={browser}
          viewportRef={viewportRef}
          viewportVersion={1}
          isViewportVisible
        />
        <BrowserDebugPanel
          url="http://localhost:3000"
          bridgeStatus="idle"
          viewportRef={viewportRef}
          onUrlChange={vi.fn()}
          onNavigate={vi.fn()}
          terminalHandoff={{
            mode: "active",
            target: activeTerminal,
            targets: [activeTerminal],
            onPrepare: vi.fn(),
            onDiscard: vi.fn(),
            onInsert: vi.fn(),
          }}
        />
      </>
    );

    await act(async () => root.render(render(terminal("shell:one", "One"))));
    const iframe = container.querySelector("iframe");
    await act(async () => root.render(render(terminal("shell:two", "Two"))));

    expect(container.querySelector("iframe")).toBe(iframe);
    await act(async () => root.unmount());
  });
});
