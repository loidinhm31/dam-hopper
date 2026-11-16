// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as BrowserHostClientModule from "@/api/browser-host-client.js";
import { BrowserHostClientError } from "@/api/browser-host-types.js";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { OsWindow } from "../types.js";
import { addClosingGate, clearClosingGatesForTesting } from "./browser-closing-gates.js";
import { createBrowserNativeTargetKey } from "./browser-owner-scope.js";
import { projectBrowserWindowState } from "./browser-persistence.js";
import {
  clearPopupTabStateForTesting,
  completeBrowserPopupTab,
  reconcileOpenerPopupSnapshot,
  reconcilePopupTabCompletion,
} from "./browser-popup-tabs.js";
import { createBlankBrowserTab, createInitialBrowserWindowState, patchBrowserTab } from "./browser-tab-state.js";
import type { BrowserOwnerScope, BrowserWindowState } from "./browser-tab-types.js";

const { currentConnection, snapshots, getSession, store } = vi.hoisted(() => ({
  currentConnection: vi.fn(() => true),
  snapshots: new Map<string, ConnectionSnapshot>(),
  getSession: vi.fn(),
  store: {
    session: {
      activeDesktopId: "desktop-1",
      desktops: [{ id: "desktop-1", focusedWindowId: "window-1" as string | null }],
      windows: {} as Record<string, OsWindow>,
    },
    updateAppState: vi.fn(),
  },
}));

vi.mock("@/api/connections.js", () => ({
  isCurrentConnection: currentConnection,
  getConnectionSnapshot: (profileId: string) => snapshots.get(profileId),
}));
vi.mock("@/api/browser-host-client.js", async (orig) => ({
  ...(await orig<typeof BrowserHostClientModule>()),
  getBrowserSession: getSession,
}));
vi.mock("../window-store.js", () => ({ useWindowStore: { getState: () => store } }));

const owner = { profileId: "profile-1", generation: 1 };
const scope: BrowserOwnerScope = {
  profileId: "profile-1", endpoint: "https://host.example.test", principal: "alice", namespace: "prod",
};
const openerSnap: BrowserSessionDto = {
  browserSessionId: "session-opener", browserIncarnation: "inc-1", profileEpoch: "3",
  navigationRevision: "2", viewportEpoch: "1", url: "https://app.example.test/login",
  title: "App Login", status: "running", inputAvailable: true, activePopupSessionId: "session-popup-1",
  geometry: { cssWidth: 800, cssHeight: 600, offsetTop: 0, scrollX: 0, scrollY: 0, pageScale: 1, visualOffsetX: 0, visualOffsetY: 0, dpr: 1 },
};
const popupSnap: BrowserSessionDto = {
  ...openerSnap, browserSessionId: "session-popup-1",
  url: "https://accounts.example.test/oauth?secret=1#token", title: "OAuth Popup",
  activePopupSessionId: undefined, parentSessionId: "session-opener",
};

function readState(windowId = "window-1"): BrowserWindowState {
  return store.session.windows[windowId]!.appState as unknown as BrowserWindowState;
}

function updateOpenerLink(activePopupSessionId?: string) {
  const nextOpenerSnap = { ...openerSnap, activePopupSessionId };
  const nextState = patchBrowserTab(readState(), "tab-opener", { snapshot: nextOpenerSnap });
  store.updateAppState("window-1", nextState as unknown as Record<string, unknown>);
  return nextOpenerSnap;
}

beforeEach(() => {
  clearPopupTabStateForTesting();
  clearClosingGatesForTesting();
  currentConnection.mockReturnValue(true);
  getSession.mockReset().mockResolvedValue(popupSnap);
  snapshots.clear();
  snapshots.set("profile-1", {
    owner, status: "connected", serverUrl: scope.endpoint,
    verifiedBrowserIdentity: { principal: scope.principal, namespace: scope.namespace },
  } as ConnectionSnapshot);
  store.session.desktops = [{ id: "desktop-1", focusedWindowId: "window-1" }];

  const openerTab = {
    ...createBlankBrowserTab({ tabId: "tab-opener", draftValue: openerSnap.url, dirty: false }),
    committedUrl: openerSnap.url, sessionId: "session-opener", phase: "live" as const, snapshot: openerSnap,
  };
  const siblingTab = {
    ...createBlankBrowserTab({ tabId: "tab-sibling", draftValue: "https://docs.example.test", dirty: false }),
    committedUrl: "https://docs.example.test", sessionId: "session-sibling", phase: "live" as const,
  };
  store.session.windows = {
    "window-1": {
      id: "window-1", appId: "browser", title: "Browser", ctx: { profileId: "profile-1" },
      mode: "tile", desktopId: "desktop-1", maximized: false, minimized: false,
      appState: createInitialBrowserWindowState({ ownerScope: scope, tabs: [openerTab, siblingTab], activeTabId: "tab-opener" }) as unknown as Record<string, unknown>,
    },
  };
  store.updateAppState.mockReset().mockImplementation((id: string, update: Record<string, unknown>) => {
    const win = store.session.windows[id]!;
    store.session.windows[id] = { ...win, appState: { ...win.appState, ...update } };
  });
});

describe("browser popup tab lifecycle", () => {
  it("inserts verified popup adjacent once, excludes popup from disk, and blocks pre-GET or in-flight closing gate", async () => {
    const [r1, r2] = await Promise.all([
      reconcileOpenerPopupSnapshot({ owner, windowId: "window-1", openerTabId: "tab-opener", openerSessionId: "session-opener", openerSnapshot: openerSnap }),
      reconcileOpenerPopupSnapshot({ owner, windowId: "window-1", openerTabId: "tab-opener", openerSessionId: "session-opener", openerSnapshot: openerSnap }),
    ]);
    expect(r1).toBe("admitted");
    expect(r2).toBe("admitted");
    expect(getSession).toHaveBeenCalledTimes(1);

    const state = readState();
    expect(state.tabs.map((t) => t.sessionId)).toEqual(["session-opener", "session-popup-1", "session-sibling"]);
    expect(state.tabs[1]?.kind).toBe("popup");
    expect(state.activeTabId).toBe(state.tabs[1]?.tabId);
    expect(projectBrowserWindowState(state, "local").tabs.map((t) => t.tabId)).toEqual(["tab-opener", "tab-sibling"]);
    expect(projectBrowserWindowState(state, "portable").tabs.map((t) => t.tabId)).toEqual(["tab-opener", "tab-sibling"]);

    // Closing gate activated WHILE getBrowserSession is already pending blocks commit
    const pendingPopup = Promise.withResolvers<BrowserSessionDto>();
    getSession.mockReturnValueOnce(pendingPopup.promise);
    const snapP2 = updateOpenerLink("session-popup-2");
    const flight = reconcileOpenerPopupSnapshot({
      owner, windowId: "window-1", openerTabId: "tab-opener", openerSessionId: "session-opener", openerSnapshot: snapP2,
    });
    addClosingGate(createBrowserNativeTargetKey({ ...scope, profileId: "profile-2" }, "session-popup-2")!);
    pendingPopup.resolve({ ...popupSnap, browserSessionId: "session-popup-2" });
    expect(await flight).toBe("blocked");
  });

  it("isolates parentSessionId and runtime mismatches and does not steal focus when unfocused or tab switched", async () => {
    store.session.desktops = [{ id: "desktop-1", focusedWindowId: "other-window" }];
    expect(await reconcileOpenerPopupSnapshot({
      owner, windowId: "window-1", openerTabId: "tab-opener", openerSessionId: "session-opener", openerSnapshot: openerSnap,
    })).toBe("admitted");
    expect(readState().activeTabId).toBe("tab-opener");
    const bgPopupId = readState().tabs.find((t) => t.kind === "popup")!.tabId;
    expect(completeBrowserPopupTab(owner, "window-1", bgPopupId, "session-popup-1")).toBe("removed");
    expect(await reconcileOpenerPopupSnapshot({
      owner, windowId: "window-1", openerTabId: "tab-opener", openerSessionId: "session-opener", openerSnapshot: openerSnap,
    })).toBe("already-admitted");

    // Matching opener link with mismatched child parentSessionId
    const wrongParentLink = updateOpenerLink("popup-wrong-parent");
    getSession.mockResolvedValueOnce({ ...popupSnap, browserSessionId: "popup-wrong-parent", parentSessionId: "other-opener" });
    expect(await reconcileOpenerPopupSnapshot({
      owner, windowId: "window-1", openerTabId: "tab-opener", openerSessionId: "session-opener", openerSnapshot: wrongParentLink,
    })).toBe("detached");

    // Matching opener link with mismatched child browserIncarnation
    const wrongRuntimeLink = updateOpenerLink("popup-wrong-runtime");
    getSession.mockResolvedValueOnce({ ...popupSnap, browserSessionId: "popup-wrong-runtime", browserIncarnation: "other-inc" });
    expect(await reconcileOpenerPopupSnapshot({
      owner, windowId: "window-1", openerTabId: "tab-opener", openerSessionId: "session-opener", openerSnapshot: wrongRuntimeLink,
    })).toBe("detached");
  });

  it("reconciles hidden popup on visible opener link change and falls back to nearest ordinary tab if opener gone", async () => {
    await reconcileOpenerPopupSnapshot({
      owner, windowId: "window-1", openerTabId: "tab-opener", openerSessionId: "session-opener", openerSnapshot: openerSnap,
    });
    const withPopup = readState();
    const popupTab = withPopup.tabs.find((t) => t.kind === "popup")!;
    store.updateAppState("window-1", { ...withPopup, activeTabId: "tab-opener" } as unknown as Record<string, unknown>);
    getSession.mockRejectedValueOnce(new BrowserHostClientError("gone", "sessionNotFound", 404));

    await reconcileOpenerPopupSnapshot({
      owner, windowId: "window-1", openerTabId: "tab-opener", openerSessionId: "session-opener",
      openerSnapshot: { ...openerSnap, activePopupSessionId: null }, isOpenerVisible: true,
    });
    await vi.waitFor(() => {
      expect(readState().tabs.some((t) => t.tabId === popupTab.tabId)).toBe(false);
    });

    const orphanPopupState = createInitialBrowserWindowState({
      ownerScope: scope,
      tabs: [{ ...popupTab, parentTabId: "missing-opener" }, withPopup.tabs[2]!],
      activeTabId: popupTab.tabId,
    });
    store.updateAppState("window-1", orphanPopupState as unknown as Record<string, unknown>);
    getSession.mockResolvedValueOnce({ ...popupSnap, status: "closed" });
    expect(await reconcilePopupTabCompletion({
      owner, windowId: "window-1", popupTabId: popupTab.tabId, popupSessionId: "session-popup-1",
    })).toBe("removed");
    expect(readState().activeTabId).toBe("tab-sibling");

    // Deferred admission aborts if owner generation advanced before lookup settled
    const delayedPopup = Promise.withResolvers<BrowserSessionDto>();
    getSession.mockReturnValueOnce(delayedPopup.promise);
    const p3Snap = updateOpenerLink("popup-p3");
    const p3Flight = reconcileOpenerPopupSnapshot({ owner, windowId: "window-1", openerTabId: "tab-opener", openerSessionId: "session-opener", openerSnapshot: p3Snap });
    owner.generation = 2;
    snapshots.set("profile-1", { ...snapshots.get("profile-1")!, owner: { profileId: "profile-1", generation: 2 } });
    delayedPopup.resolve({ ...popupSnap, browserSessionId: "popup-p3" });
    expect(await p3Flight).toBe("detached");
  });
});
