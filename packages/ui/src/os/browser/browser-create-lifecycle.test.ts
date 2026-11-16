// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearInFlightCreatesForTesting,
  dispatchBrowserCreateIntent,
} from "./browser-create-lifecycle.js";
import { loadBrowserRecoveryDisk } from "./browser-recovery-store.js";
import type { BrowserOwnerScope } from "./browser-tab-types.js";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import type { ConnectionRef } from "@/api/ownership.js";
import * as client from "@/api/browser-host-client.js";
import * as ownerScopeModule from "./browser-owner-scope.js";

describe("browser-create-lifecycle", () => {
  const sampleOwner: ConnectionRef = { profileId: "p1", generation: 1 };
  const sampleScope: BrowserOwnerScope = {
    profileId: "p1",
    endpoint: "https://hub.example.com",
    principal: "alice",
    namespace: "prod",
  };

  beforeEach(() => {
    localStorage.clear();
    clearInFlightCreatesForTesting();
    vi.clearAllMocks();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_name: string, _opts: unknown, callback: () => Promise<unknown>) => callback(),
      },
    });
    vi.spyOn(ownerScopeModule, "isCapturedBrowserOwnerCurrent").mockReturnValue(true);
    vi.spyOn(client, "closeBrowserSession").mockResolvedValue(undefined);
    vi.spyOn(client, "getBrowserSession").mockResolvedValue({
      browserSessionId: "dummy",
      browserIncarnation: "1",
      profileEpoch: "1",
      navigationRevision: "1",
      viewportEpoch: "1",
      url: "https://example.com",
      title: "Title",
      status: "running",
      geometry: { cssWidth: 1280, cssHeight: 800, offsetTop: 0, scrollX: 0, scrollY: 0, pageScale: 1, visualOffsetX: 0, visualOffsetY: 0, dpr: 1 },
      inputAvailable: true,
    });
  });

  it("reuses in-flight promise for concurrent submissions to the same tab", async () => {
    const { promise: postPromise, resolve: resolvePost } = Promise.withResolvers<BrowserSessionDto>();
    const createSpy = vi.spyOn(client, "createBrowserSession").mockImplementation(() => postPromise);

    const call1 = dispatchBrowserCreateIntent({
      owner: sampleOwner,
      scope: sampleScope,
      windowId: "w1",
      tabId: "t1",
      actionSequence: 1,
      url: "https://example.com/one",
      isTabCurrent: () => true,
    });

    const call2 = dispatchBrowserCreateIntent({
      owner: sampleOwner,
      scope: sampleScope,
      windowId: "w1",
      tabId: "t1",
      actionSequence: 1,
      url: "https://example.com/one",
      isTabCurrent: () => true,
    });

    resolvePost({
      browserSessionId: "sess-1",
      browserIncarnation: "1",
      profileEpoch: "1",
      navigationRevision: "1",
      viewportEpoch: "1",
      url: "https://example.com/one",
      title: "One",
      status: "running",
      geometry: { cssWidth: 1280, cssHeight: 800, offsetTop: 0, scrollX: 0, scrollY: 0, pageScale: 1, visualOffsetX: 0, visualOffsetY: 0, dpr: 1 },
      inputAvailable: true,
    });

    const [res1, res2] = await Promise.all([call1, call2]);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(res1).toEqual(res2);
    expect(res1.kind).toBe("success");
    if (res1.kind === "success") {
      expect(res1.adopted).toBe(true);
      expect(res1.session.browserSessionId).toBe("sess-1");
    }
  });

  it("handles late response by triggering late cleanup when tab is no longer current", async () => {
    vi.spyOn(client, "createBrowserSession").mockResolvedValue({
      browserSessionId: "sess-late",
      browserIncarnation: "1",
      profileEpoch: "1",
      navigationRevision: "1",
      viewportEpoch: "1",
      url: "https://example.com",
      title: "Late",
      status: "running",
      geometry: { cssWidth: 1280, cssHeight: 800, offsetTop: 0, scrollX: 0, scrollY: 0, pageScale: 1, visualOffsetX: 0, visualOffsetY: 0, dpr: 1 },
      inputAvailable: true,
    });

    const cleanupSpy = vi.fn();
    const res = await dispatchBrowserCreateIntent({
      owner: sampleOwner,
      scope: sampleScope,
      windowId: "w1",
      tabId: "t-closed",
      actionSequence: 1,
      url: "https://example.com",
      isTabCurrent: () => false, // tab closed or replaced!
      onLateCleanup: cleanupSpy,
    });

    expect(res.kind).toBe("success");
    if (res.kind === "success") {
      expect(res.adopted).toBe(false);
      expect(cleanupSpy).toHaveBeenCalledWith(sampleScope, "sess-late");
    }
  });

  it("settles 429 browserBusy rejections cleanly as typed rejection", async () => {
    const error429 = Object.assign(new Error("Capacity reached"), { status: 429 });
    vi.spyOn(client, "createBrowserSession").mockRejectedValue(error429);

    const res = await dispatchBrowserCreateIntent({
      owner: sampleOwner,
      scope: sampleScope,
      windowId: "w1",
      tabId: "t1",
      actionSequence: 1,
      url: "https://example.com",
      isTabCurrent: () => true,
    });

    expect(res.kind).toBe("rejected");
    if (res.kind === "rejected") {
      expect(res.capacity).toBe(true);
      expect(res.status).toBe(429);
    }
    const disk = loadBrowserRecoveryDisk();
    expect(disk.operations).toHaveLength(0); // settled!
  });

  it("leaves unknown marker in recovery store upon network / 500 error", async () => {
    const error500 = Object.assign(new Error("Internal server error"), { status: 500 });
    vi.spyOn(client, "createBrowserSession").mockRejectedValue(error500);

    const res = await dispatchBrowserCreateIntent({
      owner: sampleOwner,
      scope: sampleScope,
      windowId: "w1",
      tabId: "t1",
      actionSequence: 1,
      url: "https://example.com",
      isTabCurrent: () => true,
    });

    expect(res.kind).toBe("unknown");
    const disk = loadBrowserRecoveryDisk();
    expect(disk.operations).toHaveLength(1);
    expect(disk.operations[0]?.status).toBe("unknown");
  });

  it("settles 503 browserUnavailable and cleanupPending rejections without leaving unknown recovery ops", async () => {
    vi.spyOn(client, "createBrowserSession").mockRejectedValueOnce(
      new client.BrowserHostClientError("Host browser unavailable", "browserUnavailable", 503),
    );
    const resUnavailable = await dispatchBrowserCreateIntent({
      owner: sampleOwner,
      scope: sampleScope,
      windowId: "w1",
      tabId: "t-unavail",
      actionSequence: 1,
      url: "https://example.com",
      isTabCurrent: () => true,
    });
    expect(resUnavailable.kind).toBe("rejected");
    expect(loadBrowserRecoveryDisk().operations).toHaveLength(0);

    vi.spyOn(client, "createBrowserSession").mockRejectedValueOnce(
      new client.BrowserHostClientError("Cleanup pending", "cleanupPending", 503),
    );
    const resCleanup = await dispatchBrowserCreateIntent({
      owner: sampleOwner,
      scope: sampleScope,
      windowId: "w1",
      tabId: "t-cleanup",
      actionSequence: 2,
      url: "https://example.com",
      isTabCurrent: () => true,
    });
    expect(resCleanup.kind).toBe("rejected");
    expect(loadBrowserRecoveryDisk().operations).toHaveLength(0);
  });
});
