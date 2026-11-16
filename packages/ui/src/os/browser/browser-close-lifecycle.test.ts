// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCloseLifecycleForTesting,
  closeBrowserTarget,
  isNativeTargetClosing,
} from "./browser-close-lifecycle.js";
import { loadBrowserRecoveryDisk } from "./browser-recovery-store.js";
import type { BrowserOwnerScope, BrowserWindowState } from "./browser-tab-types.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import * as client from "@/api/browser-host-client.js";
import * as ownerScopeModule from "./browser-owner-scope.js";
import { useWindowStore } from "../window-store.js";
import { createDefaultOsSession, openWindow } from "../window-ops.js";

describe("browser-close-lifecycle", () => {
  const scopeA: BrowserOwnerScope = {
    profileId: "p1",
    endpoint: "https://hub.example.com",
    principal: "alice",
    namespace: "prod",
  };
  const scopeB: BrowserOwnerScope = {
    profileId: "p2",
    endpoint: "https://hub.example.com",
    principal: "alice",
    namespace: "prod",
  };
  const ownerA: ConnectionRef = { profileId: "p1", generation: 1 };
  const ownerB: ConnectionRef = { profileId: "p2", generation: 1 };

  beforeEach(() => {
    localStorage.clear();
    clearCloseLifecycleForTesting();
    vi.clearAllMocks();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_name: string, _opts: unknown, callback: () => Promise<unknown>) => callback(),
      },
    });
    vi.spyOn(ownerScopeModule, "isCapturedBrowserOwnerCurrent").mockReturnValue(true);
  });

  it("first view close releases with zero DELETE; final view close issues one DELETE", async () => {
    const dummySession: BrowserSessionDto = {
      browserSessionId: "sess-shared",
      browserIncarnation: "1",
      profileEpoch: "1",
      navigationRevision: "1",
      viewportEpoch: "1",
      url: "https://example.com",
      title: "Shared",
      status: "running",
      geometry: { cssWidth: 1280, cssHeight: 800, offsetTop: 0, scrollX: 0, scrollY: 0, pageScale: 1, visualOffsetX: 0, visualOffsetY: 0, dpr: 1 },
      inputAvailable: true,
    };
    vi.spyOn(client, "getBrowserSession").mockResolvedValue(dummySession);
    const deleteSpy = vi.spyOn(client, "closeBrowserSession").mockResolvedValue(undefined);

    const winState1: BrowserWindowState = {
      browserStateVersion: 1,
      ownerScope: scopeA,
      tabs: [{
        tabId: "t1",
        kind: "ordinary",
        sessionId: "sess-shared",
        phase: "live",
        draft: { value: "", dirty: false },
        actionSequence: 0,
      }],
      activeTabId: "t1",
    };

    const winState2: BrowserWindowState = {
      browserStateVersion: 1,
      ownerScope: scopeB,
      tabs: [{
        tabId: "t2",
        kind: "ordinary",
        sessionId: "sess-shared",
        phase: "live",
        draft: { value: "", dirty: false },
        actionSequence: 0,
      }],
      activeTabId: "t2",
    };

    let session = createDefaultOsSession("d1", "Main");
    session = openWindow(session, { id: "w1", appId: "browser", title: "B1", ctx: { profileId: "p1" }, mode: "tile", appState: winState1 });
    session = openWindow(session, { id: "w2", appId: "browser", title: "B2", ctx: { profileId: "p2" }, mode: "tile", appState: winState2 });
    useWindowStore.setState({ session });

    // 1. Close first view (w1)
    const res1 = await closeBrowserTarget({
      owner: ownerA,
      scope: scopeA,
      sessionId: "sess-shared",
      windowId: "w1",
      tabId: "t1",
    });

    expect(res1.kind).toBe("released");
    expect(res1.remoteDeleteIssued).toBe(false);
    expect(deleteSpy).toHaveBeenCalledTimes(0);

    // Remove w1 from window store to reflect view closure
    const remainingWindows = { ...session.windows };
    delete remainingWindows["w1"];
    useWindowStore.setState({ session: { ...session, windows: remainingWindows } });

    // 2. Close final view (w2)
    const res2 = await closeBrowserTarget({
      owner: ownerB,
      scope: scopeB,
      sessionId: "sess-shared",
      windowId: "w2",
      tabId: "t2",
    });

    expect(res2.kind).toBe("closed");
    expect(res2.remoteDeleteIssued).toBe(true);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(ownerB, "sess-shared", undefined);

    const targetKey = ownerScopeModule.createBrowserNativeTargetKey(scopeB, "sess-shared");
    expect(targetKey).not.toBeNull();
    if (targetKey) {
      expect(isNativeTargetClosing(targetKey)).toBe(false); // gate released on success
    }
  });

  it("leaves unknown marker and keeps gate active on ambiguous DELETE error", async () => {
    vi.spyOn(client, "closeBrowserSession").mockRejectedValue(new Error("502 Bad Gateway"));

    let session = createDefaultOsSession("d1", "Main");
    useWindowStore.setState({ session });

    const res = await closeBrowserTarget({
      owner: ownerA,
      scope: scopeA,
      sessionId: "sess-err",
      windowId: "w1",
      tabId: "t1",
    });

    expect(res.kind).toBe("unknown");
    const disk = loadBrowserRecoveryDisk();
    expect(disk.operations).toHaveLength(1);
    expect(disk.operations[0]?.status).toBe("unknown");

    const targetKey = ownerScopeModule.createBrowserNativeTargetKey(scopeA, "sess-err");
    expect(targetKey).not.toBeNull();
    if (targetKey) {
      expect(isNativeTargetClosing(targetKey)).toBe(true); // gate stays active!
    }
  });

  it("rejects DELETE when runtime mismatch indicates target was replaced", async () => {
    const replacedSession: BrowserSessionDto = {
      browserSessionId: "sess-replaced",
      browserIncarnation: "2",
      profileEpoch: "1",
      navigationRevision: "1",
      viewportEpoch: "1",
      url: "https://example.com",
      title: "Replaced",
      status: "running",
      geometry: { cssWidth: 1280, cssHeight: 800, offsetTop: 0, scrollX: 0, scrollY: 0, pageScale: 1, visualOffsetX: 0, visualOffsetY: 0, dpr: 1 },
      inputAvailable: true,
    };
    vi.spyOn(client, "getBrowserSession").mockResolvedValue(replacedSession);
    const deleteSpy = vi.spyOn(client, "closeBrowserSession");

    let session = createDefaultOsSession("d1", "Main");
    useWindowStore.setState({ session });

    const res = await closeBrowserTarget({
      owner: ownerA,
      scope: scopeA,
      sessionId: "sess-replaced",
      windowId: "w1",
      runtime: { browserIncarnation: "1", profileEpoch: "1" },
    });

    expect(res.kind).toBe("rejected");
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
