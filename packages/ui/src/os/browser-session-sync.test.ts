// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import { addClosingGate, clearClosingGatesForTesting } from "./browser/browser-closing-gates.js";
import { createBrowserNativeTargetKey } from "./browser/browser-owner-scope.js";
import { projectBrowserWindowState } from "./browser/browser-persistence.js";
import { BROWSER_RECOVERY_STORAGE_KEY, isOwnerAddressSuppressed, saveBrowserRecoveryDisk } from "./browser/browser-recovery-store.js";
import { createBlankBrowserTab, createInitialBrowserWindowState, findBrowserTab } from "./browser/browser-tab-state.js";
import type { BrowserOwnerScope, BrowserWindowState } from "./browser/browser-tab-types.js";
import type { OsWindow } from "./types.js";
import { syncBrowserSessionWindow } from "./browser-session-sync.js";

const { currentConnection, snapshots, store } = vi.hoisted(() => ({
  currentConnection: vi.fn(() => true),
  snapshots: new Map<string, ConnectionSnapshot>(),
  store: { session: { windows: {} as Record<string, OsWindow> }, updateAppState: vi.fn() },
}));

vi.mock("@/api/connections.js", () => ({
  isCurrentConnection: currentConnection,
  getConnectionSnapshot: (profileId: string) => snapshots.get(profileId),
}));
vi.mock("./window-store.js", () => ({ useWindowStore: { getState: () => store } }));

const owner = { profileId: "profile-1", generation: 1 };
const scope1: BrowserOwnerScope = {
  profileId: "profile-1", endpoint: "https://host.example.test", principal: "alice", namespace: "prod",
};
const snapshot: BrowserSessionDto = {
  browserSessionId: "session-1", browserIncarnation: "incarnation-1",
  profileEpoch: "9007199254740995", navigationRevision: "9007199254740993", viewportEpoch: "2",
  url: "https://example.test/redirected?code=abc#done", title: "Redirected",
  status: "running", inputAvailable: true,
  geometry: { cssWidth: 800, cssHeight: 600, offsetTop: 0, scrollX: 0, scrollY: 0, pageScale: 1, visualOffsetX: 0, visualOffsetY: 0, dpr: 1 },
};

function readTab(windowId = "window-1", tabId = "tab-1") {
  const appState = store.session.windows[windowId]?.appState as unknown as BrowserWindowState;
  return findBrowserTab(appState, tabId)!;
}

const sync = (update: Partial<BrowserSessionDto> = {}, tabId = "tab-1") =>
  syncBrowserSessionWindow(owner, "window-1", tabId, "session-1", { ...snapshot, ...update });

beforeEach(() => {
  clearClosingGatesForTesting();
  localStorage.clear();
  currentConnection.mockReturnValue(true);
  snapshots.clear();
  snapshots.set("profile-1", {
    owner, status: "connected", serverUrl: scope1.endpoint,
    verifiedBrowserIdentity: { principal: scope1.principal, namespace: scope1.namespace },
  } as ConnectionSnapshot);

  const tab1 = {
    ...createBlankBrowserTab({ tabId: "tab-1", draftValue: "https://example.test/initial", dirty: false }),
    committedUrl: "https://example.test/initial", sessionId: "session-1",
    phase: "live" as const, isController: true, leaseToken: "lease-1",
    snapshot: { ...snapshot, navigationRevision: "9007199254740992", url: "https://example.test/initial", title: "Initial" },
  };
  const tab2 = {
    ...createBlankBrowserTab({ tabId: "tab-2", draftValue: "https://example.test/other", dirty: true }),
    committedUrl: "https://example.test/other", sessionId: "session-2", phase: "live" as const,
  };
  store.session.windows = {
    "window-1": {
      id: "window-1", appId: "browser", title: "Browser", ctx: { profileId: "profile-1" },
      mode: "tile", desktopId: "desktop-1", maximized: false, minimized: false,
      appState: createInitialBrowserWindowState({ ownerScope: scope1, tabs: [tab1, tab2], activeTabId: "tab-1" }) as unknown as Record<string, unknown>,
    },
  };
  store.updateAppState.mockReset().mockImplementation((id: string, update: Record<string, unknown>) => {
    const win = store.session.windows[id]!;
    store.session.windows[id] = { ...win, appState: { ...win.appState, ...update } };
  });
});

describe("tab-fenced browser session synchronization", () => {
  it("retains canonical u64 decimal epochs above MAX_SAFE_INTEGER and rejects stale navigation", () => {
    expect(sync()).toBe("applied");
    expect(readTab().snapshot?.profileEpoch).toBe("9007199254740995");
    expect(readTab().snapshot?.navigationRevision).toBe("9007199254740993");
    expect(readTab().committedUrl).toBe("https://example.test/redirected?code=abc#done");
    expect(readTab().draft).toEqual({ value: "https://example.test/redirected?code=abc#done", dirty: false });
    expect(readTab("window-1", "tab-2").draft).toEqual({ value: "https://example.test/other", dirty: true });

    expect(sync({ navigationRevision: "9007199254740992", url: "https://example.test/stale", title: "Stale" })).toBe("stale");
    expect(readTab().snapshot?.navigationRevision).toBe("9007199254740993");
    expect(readTab().committedUrl).toBe("https://example.test/redirected?code=abc#done");
  });

  it("preserves dirty draft on target tab while updating committedUrl and snapshot", () => {
    const app = store.session.windows["window-1"]!.appState as unknown as BrowserWindowState;
    store.updateAppState("window-1", {
      ...app,
      tabs: app.tabs.map((t) => t.tabId === "tab-1" ? { ...t, draft: { value: "https://user-typing.test", dirty: true } } : t),
    });
    expect(sync({ url: "https://example.test/native-nav", title: "Native Nav" })).toBe("applied");
    expect(readTab().committedUrl).toBe("https://example.test/native-nav");
    expect(readTab().draft).toEqual({ value: "https://user-typing.test", dirty: true });
  });

  it("reuses geometry reference when unchanged and does not regress viewportEpoch", () => {
    expect(sync()).toBe("applied");
    const geomRef = readTab().snapshot?.geometry;
    store.updateAppState.mockClear();

    expect(sync({ geometry: { ...snapshot.geometry } })).toBe("applied");
    expect(store.updateAppState).not.toHaveBeenCalled();

    expect(sync({ viewportEpoch: "1", geometry: { ...snapshot.geometry, cssWidth: 640 } })).toBe("applied");
    expect(readTab().snapshot?.viewportEpoch).toBe("2");
    expect(readTab().snapshot?.geometry).toBe(geomRef);
  });

  it("propagates lastDownload updates from sessionUpdated snapshots and reuses unchanged references", () => {
    const dl1 = {
      guid: "dl-1",
      suggestedFilename: "archive.zip",
      state: "inProgress" as const,
      receivedBytes: 256,
      totalBytes: 1024,
    };
    expect(sync({ lastDownload: dl1 })).toBe("applied");
    const firstDlRef = readTab().snapshot?.lastDownload;
    expect(firstDlRef).toEqual(dl1);

    // Identical lastDownload payload does not trigger spurious store updates
    store.updateAppState.mockClear();
    expect(sync({ lastDownload: { ...dl1 } })).toBe("applied");
    expect(store.updateAppState).not.toHaveBeenCalled();
    expect(readTab().snapshot?.lastDownload).toBe(firstDlRef);

    // Completed transition updates lastDownload with host filePath
    const dlCompleted = {
      ...dl1,
      state: "completed" as const,
      receivedBytes: 1024,
      filePath: "/home/alice/Downloads/archive.zip",
    };
    expect(sync({ lastDownload: dlCompleted })).toBe("applied");
    expect(readTab().snapshot?.lastDownload).toEqual(dlCompleted);
  });

  it("fences wrong tab, owner mismatch, retired action/subscription, and closing native gate", () => {
    expect(sync({}, "tab-2")).toBe("detached");
    expect(syncBrowserSessionWindow(owner, "window-1", "tab-1", "session-1", snapshot, {
      browserIncarnation: snapshot.browserIncarnation, profileEpoch: snapshot.profileEpoch, actionSequence: 99,
    })).toBe("detached");
    expect(syncBrowserSessionWindow(owner, "window-1", "tab-1", "session-1", snapshot, {
      browserIncarnation: snapshot.browserIncarnation, profileEpoch: snapshot.profileEpoch,
      subscriptionEpoch: "sub-old", currentSubscriptionEpoch: "sub-new",
    })).toBe("detached");

    addClosingGate(createBrowserNativeTargetKey({ ...scope1, profileId: "profile-2" }, "session-1")!);
    expect(sync()).toBe("detached");
    clearClosingGatesForTesting();

    snapshots.set("profile-1", {
      owner, status: "connected", serverUrl: scope1.endpoint,
      verifiedBrowserIdentity: { principal: "bob", namespace: "prod" },
    } as ConnectionSnapshot);
    expect(sync()).toBe("detached");
  });

  it("invalidates control lease on runtime replacement or terminal status and preserves suppression", () => {
    saveBrowserRecoveryDisk({ version: 1, groups: [], addressSuppressedScopes: [scope1], operations: [] });
    expect(localStorage.getItem(BROWSER_RECOVERY_STORAGE_KEY)).toBeTruthy();

    expect(sync({ url: "https://user:pass@example.test/secret" })).toBe("applied");
    expect(readTab().committedUrl).toBeUndefined();
    expect(readTab().snapshot?.url).toBe("https://user:pass@example.test/secret");
    const projected = projectBrowserWindowState(store.session.windows["window-1"]!.appState as unknown as BrowserWindowState, "local");
    expect(projected.tabs.find((t) => t.tabId === "tab-1")?.committedUrl).toBeUndefined();
    expect(isOwnerAddressSuppressed(scope1)).toBe(true);

    expect(sync({ status: "lost" })).toBe("applied");
    expect(readTab().phase).toBe("unavailable");
    expect(readTab().isController).toBe(false);
    expect(readTab().leaseToken).toBeUndefined();
    expect(readTab().unsupportedReason).toBe("Browser session is lost");
  });

  it("preserves active dialog in snapshot during live sync and clears it on terminal status", () => {
    const dlg = { dialogId: "d1", dialogType: "prompt", message: "Enter name" };
    expect(sync({ dialog: dlg })).toBe("applied");
    expect(readTab().snapshot?.dialog).toEqual(dlg);
    expect(sync({ status: "closed" })).toBe("applied");
    expect(readTab().snapshot?.dialog).toBeUndefined();
  });
});
