// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadBrowserRecoveryDisk } from "./browser-recovery-store.js";
import { clearCloseLifecycleForTesting } from "./browser-close-lifecycle.js";
import { acknowledgeUnknownOperationRisk } from "./browser-session-inventory.js";
import type { BrowserOwnerScope, BrowserWindowState } from "./browser-tab-types.js";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import * as client from "@/api/browser-host-client.js";
import * as ownerScopeModule from "./browser-owner-scope.js";
import { useWindowStore } from "../window-store.js";
import { createDefaultOsSession, openWindow } from "../window-ops.js";

describe("browser-window-lifecycle", () => {
  const scope: BrowserOwnerScope = {
    profileId: "p1",
    endpoint: "https://hub.example.com",
    principal: "alice",
    namespace: "prod",
  };

  beforeEach(() => {
    localStorage.clear();
    clearCloseLifecycleForTesting();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_name: string, _opts: unknown, callback: () => Promise<unknown>) => callback(),
      },
    });
    vi.spyOn(ownerScopeModule, "isCapturedBrowserOwnerCurrent").mockReturnValue(true);
  });

  it("stages remembered group and closes all window targets before removing window", async () => {
    const dummySession: BrowserSessionDto = {
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
    };
    vi.spyOn(client, "getBrowserSession").mockResolvedValue(dummySession);
    const deleteSpy = vi.spyOn(client, "closeBrowserSession").mockResolvedValue(undefined);

    const winState: BrowserWindowState = {
      browserStateVersion: 1,
      ownerScope: scope,
      tabs: [
        {
          tabId: "t1",
          kind: "ordinary",
          committedUrl: "https://example.com/one",
          sessionId: "s1",
          phase: "live",
          draft: { value: "", dirty: false },
          actionSequence: 0,
        },
        {
          tabId: "t2",
          kind: "ordinary",
          committedUrl: "https://example.com/two",
          sessionId: "s2",
          phase: "live",
          draft: { value: "", dirty: false },
          actionSequence: 0,
        },
      ],
      activeTabId: "t2",
    };

    let session = createDefaultOsSession("d1", "Main");
    session = openWindow(session, {
      id: "w-browser",
      appId: "browser",
      title: "Browser",
      ctx: { profileId: "p1" },
      mode: "tile",
      appState: winState,
    });
    useWindowStore.setState({ session });

    useWindowStore.getState().closeWindow("w-browser");

    // Wait for async coordinator
    await vi.waitFor(() => {
      expect(useWindowStore.getState().session.windows["w-browser"]).toBeUndefined();
    });

    expect(deleteSpy).toHaveBeenCalledTimes(2);

    // Staged group is present in recovery store
    const disk = loadBrowserRecoveryDisk();
    expect(disk.groups).toHaveLength(1);
    expect(disk.groups[0]?.addresses).toEqual(["https://example.com/one", "https://example.com/two"]);
    expect(disk.groups[0]?.activeIndex).toBe(1);
    // Operation settled
    expect(disk.operations).toHaveLength(0);
  });

  it("retains window shell with unknown status when target close fails ambiguously, allowing acknowledged close", async () => {
    const dummySession: BrowserSessionDto = {
      browserSessionId: "s-fail",
      browserIncarnation: "1",
      profileEpoch: "1",
      navigationRevision: "1",
      viewportEpoch: "1",
      url: "https://example.com",
      title: "Fail",
      status: "running",
      geometry: { cssWidth: 1280, cssHeight: 800, offsetTop: 0, scrollX: 0, scrollY: 0, pageScale: 1, visualOffsetX: 0, visualOffsetY: 0, dpr: 1 },
      inputAvailable: true,
    };
    vi.spyOn(client, "getBrowserSession").mockResolvedValue(dummySession);
    vi.spyOn(client, "closeBrowserSession").mockRejectedValue(new Error("Network timeout"));

    const winState: BrowserWindowState = {
      browserStateVersion: 1,
      ownerScope: scope,
      tabs: [{
        tabId: "t1",
        kind: "ordinary",
        committedUrl: "https://example.com",
        sessionId: "s-fail",
        phase: "live",
        draft: { value: "", dirty: false },
        actionSequence: 0,
      }],
      activeTabId: "t1",
    };

    let session = createDefaultOsSession("d1", "Main");
    session = openWindow(session, {
      id: "w-fail",
      appId: "browser",
      title: "Browser Fail",
      ctx: { profileId: "p1" },
      mode: "tile",
      appState: winState,
    });
    useWindowStore.setState({ session });

    useWindowStore.getState().closeWindow("w-fail");

    // Window must remain visible with closing status unknown
    await vi.waitFor(() => {
      const win = useWindowStore.getState().session.windows["w-fail"];
      expect(win).toBeDefined();
      const state = win?.appState as BrowserWindowState;
      expect(state.closing?.status).toBe("unknown");
    });

    const disk = loadBrowserRecoveryDisk();
    expect(disk.operations).toHaveLength(2);
    const windowOp = disk.operations.find((op) => op.kind === "close-window");
    expect(windowOp?.status).toBe("unknown");
    const tabOp = disk.operations.find((op) => op.kind === "close-tab");
    expect(tabOp?.status).toBe("unknown");

    // Acknowledge risk on the window close operation and close again
    acknowledgeUnknownOperationRisk(windowOp!.operationId);
    useWindowStore.getState().closeWindow("w-fail");

    expect(useWindowStore.getState().session.windows["w-fail"]).toBeUndefined();
  });
});
