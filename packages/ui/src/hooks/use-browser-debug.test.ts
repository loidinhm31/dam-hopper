// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserDebug, type BrowserDebugController } from "./use-browser-debug.js";

const { listTunnels, eventListeners } = vi.hoisted(() => ({
  listTunnels: vi.fn(),
  eventListeners: new Map<string, () => void>(),
}));

vi.mock("@/api/client.js", () => ({
  api: { tunnels: { list: listTunnels } },
}));

vi.mock("@/api/transport.js", () => ({
  getTransport: () => ({
    onEvent: (event: string, listener: () => void) => {
      eventListeners.set(event, listener);
      return () => eventListeners.delete(event);
    },
  }),
}));

vi.mock("./use-browser-extension-presence.js", () => ({
  useBrowserExtensionPresence: () => "detected",
}));

describe("useBrowserDebug tunnel lifecycle", () => {
  let root: Root;
  let container: HTMLDivElement;
  const latestRef = { current: null as BrowserDebugController | null };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    listTunnels.mockResolvedValueOnce([
      {
        id: "tunnel-1",
        port: 3000,
        label: "web",
        driver: "cloudflared",
        status: "ready",
        url: "https://example.trycloudflare.com",
        startedAt: 0,
      },
    ]).mockResolvedValue([]);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    latestRef.current = null;
    eventListeners.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function Harness() {
    const value = useBrowserDebug();
    useEffect(() => {
      latestRef.current = value;
    }, [value]);
    return null;
  }

  it("invalidates a selected tunnel and its semantic selection when it stops", async () => {
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      latestRef.current?.setInputUrl("https://example.trycloudflare.com");
    });
    await act(async () => {
      latestRef.current?.navigate();
    });
    expect(latestRef.current?.target?.source).toBe("tunnel");

    await act(async () => {
      latestRef.current?.setSelection({
        version: 1,
        tag: "button",
        role: "button",
        accessibleName: "Save",
        text: "Save",
        attributes: {},
        locator: "button",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
      });
      eventListeners.get("tunnel:stopped")?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latestRef.current?.target).toBeNull();
    expect(latestRef.current?.selection).toBeNull();
    expect(latestRef.current?.pickerActive).toBe(false);
    expect(latestRef.current?.bridgeStatus).toBe("error");
    expect(latestRef.current?.error).toContain("no longer ready");
  });
});
