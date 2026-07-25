// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useBrowserDebug,
  type BrowserDebugController,
} from "./use-browser-debug.js";
import type { TunnelInfo } from "@/api/client.js";

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
    localStorage.clear();
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
    localStorage.clear();
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

  it("keeps the full same-origin path in the address state", async () => {
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      latestRef.current?.setInputUrl("https://example.trycloudflare.com/settings?tab=debug");
    });
    await act(async () => latestRef.current?.navigate());

    expect(latestRef.current?.target?.url).toBe(
      "https://example.trycloudflare.com/settings?tab=debug",
    );
    expect(latestRef.current?.addressHistory).toContain(
      "https://example.trycloudflare.com/settings",
    );
    await act(async () =>
      latestRef.current?.syncCurrentUrl(
        "https://example.trycloudflare.com/settings/logs#latest",
      ),
    );
    expect(latestRef.current?.inputUrl).toBe(
      "https://example.trycloudflare.com/settings/logs#latest",
    );

    await act(async () =>
      latestRef.current?.syncCurrentUrl("https://untrusted.example.test/"),
    );
    expect(latestRef.current?.inputUrl).toBe(
      "https://example.trycloudflare.com/settings/logs#latest",
    );
  });

  it("navigates directly to a supplied ready tunnel URL without stale address state", async () => {
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      latestRef.current?.setInputUrl("https://stale.example.test");
    });

    let accepted = false;
    await act(async () => {
      accepted =
        latestRef.current?.navigateTo(
          "https://example.trycloudflare.com/dashboard?tab=ports",
        ) ?? false;
    });

    expect(accepted).toBe(true);
    expect(latestRef.current?.target).toMatchObject({
      url: "https://example.trycloudflare.com/dashboard?tab=ports",
      origin: "https://example.trycloudflare.com",
      source: "tunnel",
    });
    expect(latestRef.current?.inputUrl).toBe(
      "https://example.trycloudflare.com/dashboard?tab=ports",
    );
    expect(latestRef.current?.bridgeStatus).toBe("loading");
    expect(latestRef.current?.error).toBeNull();
  });

  it("accepts a ready tunnel snapshot before the hook tunnel cache loads", async () => {
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    const tunnel: TunnelInfo = {
      id: "tunnel-snapshot",
      port: 3000,
      label: "web",
      driver: "cloudflared",
      status: "ready",
      url: "https://snapshot.trycloudflare.com",
      startedAt: 1,
    };

    let accepted = false;
    await act(async () => {
      accepted =
        latestRef.current?.navigateTo(
          "https://snapshot.trycloudflare.com/dashboard",
          [tunnel],
        ) ?? false;
    });

    expect(accepted).toBe(true);
    expect(latestRef.current?.target?.url).toBe(
      "https://snapshot.trycloudflare.com/dashboard",
    );
  });

  it("rejects non-ready tunnel snapshots", async () => {
    await act(async () => {
      root.render(createElement(Harness));
      await Promise.resolve();
    });

    const tunnel: TunnelInfo = {
      id: "tunnel-snapshot",
      port: 3000,
      label: "web",
      driver: "cloudflared",
      status: "starting",
      url: "https://snapshot.trycloudflare.com",
      startedAt: 1,
    };

    let accepted = true;
    await act(async () => {
      accepted =
        latestRef.current?.navigateTo(
          "https://snapshot.trycloudflare.com/dashboard",
          [tunnel],
        ) ?? true;
    });

    expect(accepted).toBe(false);
    expect(latestRef.current?.target).toBeNull();
    expect(latestRef.current?.error).toContain("ready tunnel");
  });
});
