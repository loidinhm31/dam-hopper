import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  isNativeBrowserDebugPlatformSupported,
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

  afterEach(() => {
    vi.useRealTimers();
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
      capabilities: ["picker", "navigation"],
      generation: 7,
    });
  });

  it("accepts relay events from the current approved redirect origin", () => {
    const redirectedOrigin = "http://127.0.0.1:3000";
    const relay = {
      label: "browser-debug",
      profileId,
      sessionId,
      generation: 2,
      origin: redirectedOrigin,
      data: {
        version: BROWSER_BRIDGE_VERSION,
        type: "dam-hopper:navigation",
        nonce: "nonce",
        requestId: "request",
        url: `${redirectedOrigin}/login`,
      },
    };

    expect(
      bridgeEventToHostEvent(
        relay,
        target,
        2,
        profileId,
        sessionId,
        redirectedOrigin,
      ),
    ).toEqual({
      type: "navigation",
      url: `${redirectedOrigin}/login`,
      generation: 2,
    });
    expect(
      bridgeEventToHostEvent(relay, target, 2, profileId, sessionId),
    ).toBeNull();
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

  it("normalizes selection and filters unsupported native console events", () => {
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
    expect(consoleEvent).toBeNull();
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
    expect(isNativeBrowserDebugPlatformSupported("windows")).toBe(true);
    expect(isNativeBrowserDebugPlatformSupported("linux")).toBe(true);
    expect(isNativeBrowserDebugPlatformSupported("macos")).toBe(false);
    expect(isNativeBrowserDebugPlatformSupported("android")).toBe(false);
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

  it("destroys the child even when relay listeners cannot start", async () => {
    listen.mockRejectedValue(new Error("relay unavailable"));
    invoke.mockResolvedValue(undefined);

    const host = new NativeBrowserDebugHost();
    host.setTarget(target);

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_debug_destroy"),
    );
    expect(invoke).not.toHaveBeenCalledWith(
      "browser_debug_create",
      expect.anything(),
    );
    host.dispose();
  });

  it("retries child teardown before creating a replacement", async () => {
    const state = {
      label: "browser-debug",
      profileId,
      sessionId,
      committedUrl: target.url,
      committedOrigin: target.origin,
      generation: 0,
      visible: true,
      relayInstalled: true,
    } as const;
    let destroyAttempts = 0;
    listen.mockResolvedValue(() => undefined);
    invoke.mockImplementation((command: string) => {
      if (command === "browser_debug_destroy") {
        destroyAttempts += 1;
        return destroyAttempts === 1
          ? Promise.reject(new Error("child still closing"))
          : Promise.resolve();
      }
      return command === "browser_debug_create"
        ? Promise.resolve(state)
        : Promise.resolve();
    });

    const events: unknown[] = [];
    const host = new NativeBrowserDebugHost();
    host.subscribe((event) => events.push(event));
    host.setTarget(target);

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_debug_create",
        expect.anything(),
      ),
    );
    expect(destroyAttempts).toBe(2);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "status",
        status: "error",
        message: "child still closing",
      }),
    );
    host.dispose();
  });

  it("replays a validated ready relay that arrives before create resolves", async () => {
    let relayListener: ((event: { payload: unknown }) => void) | undefined;
    const create = Promise.withResolvers<{
      label: string;
      profileId: string;
      sessionId: string;
      committedUrl: string;
      committedOrigin: string;
      generation: number;
      visible: boolean;
      relayInstalled: boolean;
    }>();

    listen.mockImplementation(async (event, listener) => {
      if (event === "browser-debug:relay") relayListener = listener;
      return () => undefined;
    });
    invoke.mockImplementation((command: string) => {
      if (command === "browser_debug_create") return create.promise;
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
    create.resolve({
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

  it("applies the latest zoom after a pending child create", async () => {
    const create = Promise.withResolvers<{
      label: string;
      profileId: string;
      sessionId: string;
      committedUrl: string;
      committedOrigin: string;
      generation: number;
      visible: boolean;
      relayInstalled: boolean;
    }>();

    listen.mockResolvedValue(() => undefined);
    invoke.mockImplementation((command: string) => {
      if (command === "browser_debug_create") return create.promise;
      return Promise.resolve();
    });

    const host = new NativeBrowserDebugHost();
    host.setZoom(0.8);
    host.setTarget(target);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_debug_create",
        expect.objectContaining({
          input: expect.objectContaining({ zoom: 0.8 }),
        }),
      ),
    );
    host.setZoom(1);
    create.resolve({
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
      expect(invoke).toHaveBeenCalledWith("browser_debug_set_zoom", {
        zoom: 1,
      }),
    );
    host.dispose();
  });

  it("retries a failed startup zoom sync", async () => {
    const state = {
      label: "browser-debug",
      profileId,
      sessionId,
      committedUrl: target.url,
      committedOrigin: target.origin,
      generation: 0,
      visible: true,
      relayInstalled: true,
    } as const;
    const create = Promise.withResolvers<typeof state>();
    let rejectFirstZoom = true;

    listen.mockResolvedValue(() => undefined);
    invoke.mockImplementation(
      (command: string, payload?: { zoom?: number }) => {
        if (command === "browser_debug_create") return create.promise;
        if (
          command === "browser_debug_set_zoom" &&
          payload?.zoom === 1 &&
          rejectFirstZoom
        ) {
          rejectFirstZoom = false;
          return Promise.reject(new Error("zoom unavailable"));
        }
        return Promise.resolve();
      },
    );

    const host = new NativeBrowserDebugHost();
    host.setZoom(0.8);
    host.setTarget(target);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_debug_create",
        expect.objectContaining({
          input: expect.objectContaining({ zoom: 0.8 }),
        }),
      ),
    );
    host.setZoom(1);
    create.resolve(state);

    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(
          ([command, payload]) =>
            command === "browser_debug_set_zoom" && payload?.zoom === 1,
        ),
      ).toHaveLength(2),
    );
    host.dispose();
  });

  it("suppresses stale zoom startup errors after a newer request", async () => {
    const state = {
      label: "browser-debug",
      profileId,
      sessionId,
      committedUrl: target.url,
      committedOrigin: target.origin,
      generation: 0,
      visible: true,
      relayInstalled: true,
    } as const;
    const create = Promise.withResolvers<typeof state>();
    const initialZoom = Promise.withResolvers<void>();
    let deferInitialZoom = true;
    let relayListener: ((event: { payload: unknown }) => void) | undefined;

    listen.mockImplementation(async (event, listener) => {
      if (event === "browser-debug:relay") relayListener = listener;
      return () => undefined;
    });
    invoke.mockImplementation(
      (command: string, payload?: { zoom?: number }) => {
        if (command === "browser_debug_create") return create.promise;
        if (
          command === "browser_debug_set_zoom" &&
          payload?.zoom === 1 &&
          deferInitialZoom
        ) {
          deferInitialZoom = false;
          return initialZoom.promise;
        }
        return Promise.resolve();
      },
    );

    const events: unknown[] = [];
    const host = new NativeBrowserDebugHost();
    host.subscribe((event) => events.push(event));
    host.setZoom(0.8);
    host.setTarget(target);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_debug_create",
        expect.objectContaining({
          input: expect.objectContaining({ zoom: 0.8 }),
        }),
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
    host.setZoom(1);
    create.resolve(state);

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_debug_set_zoom", {
        zoom: 1,
      }),
    );
    host.setZoom(0.8);
    initialZoom.reject(new Error("stale zoom unavailable"));

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_debug_set_zoom", {
        zoom: 0.8,
      }),
    );
    await vi.waitFor(() =>
      expect(events).toContainEqual({
        type: "ready",
        capabilities: ["picker", "navigation"],
        generation: 1,
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "status",
        status: "error",
        message: "Native Browser Debug could not start.",
      }),
    );
    host.dispose();
  });

  it("mirrors app zoom changes into the native child", async () => {
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
          relayInstalled: true,
        });
      }
      return Promise.resolve();
    });

    const host = new NativeBrowserDebugHost();
    host.setTarget(target);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_debug_create",
        expect.objectContaining({
          input: expect.objectContaining({ zoom: 1 }),
        }),
      ),
    );

    host.setZoom(0.8);
    host.setZoom(0.8);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_debug_set_zoom", {
        zoom: 0.8,
      }),
    );
    expect(
      invoke.mock.calls.filter(
        ([command, payload]) =>
          command === "browser_debug_set_zoom" && payload?.zoom === 0.8,
      ),
    ).toHaveLength(1);
    host.dispose();
  });

  it("retries a failed zoom IPC for the same factor", async () => {
    listen.mockResolvedValue(() => undefined);
    let rejectNextZoom = true;
    invoke.mockImplementation(
      (command: string, payload?: { zoom?: number }) => {
        if (command === "browser_debug_create") {
          return Promise.resolve({
            label: "browser-debug",
            profileId,
            sessionId,
            committedUrl: target.url,
            committedOrigin: target.origin,
            generation: 0,
            visible: true,
            relayInstalled: true,
          });
        }
        if (
          command === "browser_debug_set_zoom" &&
          payload?.zoom === 0.8 &&
          rejectNextZoom
        ) {
          rejectNextZoom = false;
          return Promise.reject(new Error("zoom unavailable"));
        }
        return Promise.resolve();
      },
    );

    const host = new NativeBrowserDebugHost();
    host.setTarget(target);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_debug_create",
        expect.objectContaining({
          input: expect.objectContaining({ zoom: 1 }),
        }),
      ),
    );

    host.setZoom(0.8);
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(
          ([command, payload]) =>
            command === "browser_debug_set_zoom" && payload?.zoom === 0.8,
        ),
      ).toHaveLength(1),
    );
    host.setZoom(0.8);
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(
          ([command, payload]) =>
            command === "browser_debug_set_zoom" && payload?.zoom === 0.8,
        ),
      ).toHaveLength(2),
    );
    host.dispose();
  });

  it("retries a failed child create for the same target", async () => {
    const state = {
      label: "browser-debug",
      profileId,
      sessionId,
      committedUrl: target.url,
      committedOrigin: target.origin,
      generation: 0,
      visible: true,
      relayInstalled: true,
    } as const;
    let createAttempts = 0;

    listen.mockResolvedValue(() => undefined);
    invoke.mockImplementation((command: string) => {
      if (command === "browser_debug_create") {
        createAttempts += 1;
        return createAttempts === 1
          ? Promise.reject(new Error("child unavailable"))
          : Promise.resolve(state);
      }
      return Promise.resolve();
    });

    const events: unknown[] = [];
    const host = new NativeBrowserDebugHost();
    host.subscribe((event) => events.push(event));
    host.setTarget(target);
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "status",
          status: "error",
        }),
      ),
    );

    host.setTarget(target);
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(
          ([command]) => command === "browser_debug_create",
        ),
      ).toHaveLength(2),
    );
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_debug_set_bounds", {
        bounds: { top: 0, left: 0, width: 0, height: 0 },
      }),
    );
    host.dispose();
  });

  it("reapplies the latest zoom after a stale request settles", async () => {
    const state = {
      label: "browser-debug",
      profileId,
      sessionId,
      committedUrl: target.url,
      committedOrigin: target.origin,
      generation: 0,
      visible: true,
      relayInstalled: true,
    } as const;
    const create = Promise.withResolvers<typeof state>();
    const zoom2 = Promise.withResolvers<void>();
    let deferZoom2 = true;

    listen.mockResolvedValue(() => undefined);
    invoke.mockImplementation(
      (command: string, payload?: { zoom?: number }) => {
        if (command === "browser_debug_create") return create.promise;
        if (
          command === "browser_debug_set_zoom" &&
          payload?.zoom === 2 &&
          deferZoom2
        ) {
          deferZoom2 = false;
          return zoom2.promise;
        }
        return Promise.resolve();
      },
    );

    const host = new NativeBrowserDebugHost();
    host.setTarget(target);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "browser_debug_create",
        expect.objectContaining({
          input: expect.objectContaining({ zoom: 1 }),
        }),
      ),
    );
    create.resolve(state);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_debug_set_bounds", {
        bounds: { top: 0, left: 0, width: 0, height: 0 },
      }),
    );

    host.setZoom(2);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_debug_set_zoom", {
        zoom: 2,
      }),
    );
    host.setZoom(1);
    zoom2.resolve();
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_debug_set_zoom", {
        zoom: 1,
      }),
    );
    expect(
      invoke.mock.calls.filter(
        ([command, payload]) =>
          command === "browser_debug_set_zoom" && payload?.zoom === 1,
      ),
    ).toHaveLength(1);
    host.dispose();
  });

  it("reports a handshake timeout and permits an explicit same-target retry", async () => {
    vi.useFakeTimers();
    const state = {
      label: "browser-debug",
      profileId,
      sessionId,
      committedUrl: target.url,
      committedOrigin: target.origin,
      generation: 0,
      visible: true,
      relayInstalled: true,
    } as const;

    listen.mockResolvedValue(() => undefined);
    invoke.mockImplementation((command: string) =>
      command === "browser_debug_create"
        ? Promise.resolve(state)
        : Promise.resolve(),
    );

    const events: unknown[] = [];
    const host = new NativeBrowserDebugHost();
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
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events).toContainEqual({
      type: "status",
      status: "unsupported",
      message: expect.stringContaining("No native Browser Debug response"),
      code: "bridge-unavailable",
      generation: 1,
    });

    host.setTarget({ ...target });
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(
          ([command]) => command === "browser_debug_create",
        ),
      ).toHaveLength(2),
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
