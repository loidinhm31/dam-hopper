import { beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_BRIDGE_VERSION } from "@dam-hopper/browser-bridge";

const { invoke, listen } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@dam-hopper/ui/api/server-config", () => ({
  getActiveProfileId: () => "profile-1",
}));

import {
  bridgeEventToHostEvent,
  errorMessage,
  getNativeBrowserDebugEnvironment,
  isNativeBrowserDebugEnabled,
  NativeBrowserDebugHost,
} from "./native-browser-debug-host";

const target = {
  url: "http://localhost:3000/",
  origin: "http://localhost:3000",
  source: "loopback" as const,
};
const profileId = "profile-1";
const sessionId = "session-1";

describe("native browser debug host adapter", () => {
  beforeEach(() => {
    invoke.mockReset();
    listen.mockReset();
  });

  it("normalizes a Rust-validated bridge-ready relay", () => {
    const event = bridgeEventToHostEvent(
      {
        label: "browser-debug",
        profileId,
        sessionId,
        generation: 2,
        origin: target.origin,
        data: {
          version: BROWSER_BRIDGE_VERSION,
          type: "dam-hopper:bridge-ready",
          nonce: "nonce",
          requestId: "request",
          capabilities: ["navigation", "console"],
        },
      },
      target,
      7,
      profileId,
      sessionId,
    );

    expect(event).toEqual({
      type: "ready",
      capabilities: ["picker", "navigation", "console"],
      generation: 7,
    });
  });

  it("fails closed for a wrong label, origin, or malformed payload", () => {
    const base = {
      label: "browser-debug",
      profileId,
      sessionId,
      generation: 2,
      origin: target.origin,
      data: {
        version: BROWSER_BRIDGE_VERSION,
        type: "dam-hopper:navigation",
        nonce: "nonce",
        requestId: "request",
        url: target.url,
      },
    };

    expect(
      bridgeEventToHostEvent(
        { ...base, label: "other" },
        target,
        1,
        profileId,
        sessionId,
      ),
    ).toBeNull();
    expect(
      bridgeEventToHostEvent(
        { ...base, origin: "https://other.example" },
        target,
        1,
        profileId,
        sessionId,
      ),
    ).toBeNull();
    expect(
      bridgeEventToHostEvent(
        { ...base, data: { ...base.data, url: "" } },
        target,
        1,
        profileId,
        sessionId,
      ),
    ).toBeNull();
  });

  it("normalizes selection and console events without exposing the envelope", () => {
    const selection = {
      version: 1,
      tag: "button",
      role: "button",
      accessibleName: "Save",
      text: "Save",
      attributes: {},
      locator: "button",
      bounds: { x: 1, y: 2, width: 3, height: 4 },
    } as const;
    const selectionEvent = bridgeEventToHostEvent(
      {
        label: "browser-debug",
        profileId,
        sessionId,
        generation: 0,
        origin: target.origin,
        data: {
          version: 1,
          type: "dam-hopper:selection",
          nonce: "nonce",
          requestId: "request",
          selection,
        },
      },
      target,
      1,
      profileId,
      sessionId,
    );
    const consoleEvent = bridgeEventToHostEvent(
      {
        label: "browser-debug",
        profileId,
        sessionId,
        generation: 0,
        origin: target.origin,
        data: {
          version: 1,
          type: "dam-hopper:console",
          nonce: "nonce",
          requestId: "request",
          level: "warn",
          message: "slow",
        },
      },
      target,
      1,
      profileId,
      sessionId,
    );

    expect(selectionEvent).toMatchObject({ type: "selection", selection });
    expect(consoleEvent).toEqual({
      type: "console",
      level: "warn",
      message: "slow",
      generation: 1,
    });
  });

  it("rejects relays from another profile or child session", () => {
    const relay = {
      label: "browser-debug",
      profileId,
      sessionId,
      generation: 0,
      origin: target.origin,
      data: {
        version: 1,
        type: "dam-hopper:navigation",
        nonce: "nonce",
        requestId: "request",
        url: target.url,
      },
    };

    expect(
      bridgeEventToHostEvent(
        { ...relay, profileId: "profile-2" },
        target,
        1,
        profileId,
        sessionId,
      ),
    ).toBeNull();
    expect(
      bridgeEventToHostEvent(
        { ...relay, sessionId: "session-2" },
        target,
        1,
        profileId,
        sessionId,
      ),
    ).toBeNull();
  });

  it("labels non-Windows builds as experimental", () => {
    expect(getNativeBrowserDebugEnvironment("linux")).toMatchObject({
      kind: "native",
      platform: "linux",
      experimental: true,
    });
    expect(getNativeBrowserDebugEnvironment("macos").experimental).toBe(true);
    expect(getNativeBrowserDebugEnvironment("windows").experimental).toBe(
      false,
    );
  });

  it("supports an explicit rollback flag while preserving the web adapter", () => {
    expect(isNativeBrowserDebugEnabled(undefined)).toBe(true);
    expect(isNativeBrowserDebugEnabled("1")).toBe(true);
    expect(isNativeBrowserDebugEnabled("0")).toBe(false);
    expect(isNativeBrowserDebugEnabled("false")).toBe(false);
    expect(getNativeBrowserDebugEnvironment("windows", false)).toEqual({
      kind: "web",
      platform: "windows",
      experimental: false,
    });
  });

  it("uses safe fallback text for non-Error invoke failures", () => {
    expect(errorMessage("invoke failed", "fallback")).toBe("fallback");
    expect(errorMessage(new Error("invoke failed"), "fallback")).toBe(
      "invoke failed",
    );
  });

  it("replays a validated ready relay that arrives before create resolves", async () => {
    let relayListener: ((event: { payload: unknown }) => void) | undefined;
    let resolveCreate:
      | ((state: {
          label: string;
          profileId: string;
          sessionId: string;
          committedUrl: string;
          committedOrigin: string;
          generation: number;
          visible: boolean;
          relayInstalled: boolean;
        }) => void)
      | undefined;

    listen.mockImplementation(async (event, listener) => {
      if (event === "browser-debug:relay") relayListener = listener;
      return () => undefined;
    });
    invoke.mockImplementation((command: string) => {
      if (command === "browser_debug_create") {
        return new Promise((resolve) => {
          resolveCreate = resolve;
        });
      }
      return Promise.resolve();
    });

    const host = new NativeBrowserDebugHost();
    const events: unknown[] = [];
    host.subscribe((event) => events.push(event));
    host.setTarget(target);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_debug_create",
        expect.anything(),
      ),
    );

    relayListener?.({
      payload: {
        label: "browser-debug",
        profileId,
        sessionId,
        generation: 0,
        origin: target.origin,
        data: {
          version: 1,
          type: "dam-hopper:bridge-ready",
          nonce: "nonce",
          requestId: "request",
          capabilities: ["navigation"],
        },
      },
    });
    relayListener?.({
      payload: {
        label: "browser-debug",
        profileId,
        sessionId,
        generation: 0,
        origin: target.origin,
        data: {
          version: 1,
          type: "dam-hopper:navigation",
          nonce: "nonce",
          requestId: "request",
          url: target.url,
        },
      },
    });
    resolveCreate?.({
      label: "browser-debug",
      profileId,
      sessionId,
      committedUrl: target.url,
      committedOrigin: target.origin,
      generation: 0,
      visible: true,
      relayInstalled: true,
    });

    await vi.waitFor(() =>
      expect(events).toContainEqual({
        type: "ready",
        capabilities: ["picker", "navigation"],
        generation: 1,
      }),
    );
    host.dispose();
  });

  it("keeps the child alive when only the native relay is unavailable", async () => {
    listen.mockResolvedValue(() => undefined);
    invoke.mockImplementation((command: string) => {
      if (command === "browser_debug_create") {
        return Promise.resolve({
          label: "browser-debug",
          profileId,
          sessionId,
          committedUrl: target.url,
          committedOrigin: target.origin,
          generation: 0,
          visible: true,
          relayInstalled: false,
        });
      }
      return Promise.resolve();
    });

    const host = new NativeBrowserDebugHost();
    const events: unknown[] = [];
    host.subscribe((event) => events.push(event));
    host.setTarget(target);

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_debug_set_bounds",
        expect.objectContaining({
          bounds: { top: 0, left: 0, width: 0, height: 0 },
        }),
      ),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "status",
        status: "unsupported",
        message: expect.stringContaining("viewport rendering and resizing"),
      }),
    );
    expect(
      invoke.mock.calls.filter(
        ([command]) => command === "browser_debug_destroy",
      ),
    ).toHaveLength(1);
    host.dispose();
  });
});
