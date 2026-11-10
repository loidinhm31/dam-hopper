import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import type { OsWindow } from "./types.js";
import { syncBrowserSessionWindow } from "./browser-session-sync.js";

const { currentConnection, store } = vi.hoisted(() => ({
  currentConnection: vi.fn(() => true),
  store: { session: { windows: {} as Record<string, OsWindow> }, updateAppState: vi.fn() },
}));
vi.mock("@/api/connections.js", () => ({ isCurrentConnection: currentConnection }));
vi.mock("./window-store.js", () => ({ useWindowStore: { getState: () => store } }));

const owner = { profileId: "profile-1", generation: 1 };
const snapshot: BrowserSessionDto = {
  browserSessionId: "session-1", browserIncarnation: "incarnation-1", profileEpoch: "1",
  navigationRevision: "9007199254740993", viewportEpoch: "2",
  url: "https://example.test/redirected", title: "Redirected", status: "running",
  inputAvailable: true,
  geometry: { cssWidth: 800, cssHeight: 600, offsetTop: 0, scrollX: 0, scrollY: 0,
    pageScale: 1, visualOffsetX: 0, visualOffsetY: 0, dpr: 1 },
};
const sync = (update: Partial<BrowserSessionDto> = {}) =>
  syncBrowserSessionWindow(owner, "window-1", "session-1", { ...snapshot, ...update });

beforeEach(() => {
  currentConnection.mockReturnValue(true);
  store.session.windows = {
    "window-1": { id: "window-1", appId: "browser", title: "Browser", ctx: { profileId: "profile-1" },
      mode: "tile", desktopId: "desktop-1", minimized: false, maximized: false,
      appState: { sessionId: "session-1", browserIncarnation: "incarnation-1", profileEpoch: 1,
        navigationRevision: "9007199254740992", viewportEpoch: "2", url: "https://example.test/old" } },
  };
  store.updateAppState.mockReset().mockImplementation((id: string, update: Record<string, unknown>) => {
    const win = store.session.windows[id];
    win.appState = { ...win.appState, ...update };
  });
});

describe("live browser session synchronization", () => {
  it("keeps exact u64 revisions and rejects delayed older snapshots", () => {
    expect(sync()).toBe("applied");
    expect(store.session.windows["window-1"].appState?.navigationRevision).toBe("9007199254740993");
    expect(sync({ navigationRevision: "9007199254740992", url: "https://example.test/stale" })).toBe("stale");
    expect(store.session.windows["window-1"].appState?.url).toBe(snapshot.url);
  });

  it("reconciles native history/redirect URL even when API already advanced the same revision", () => {
    sync();
    sync({ url: "https://example.test/native-history" });
    expect(store.session.windows["window-1"].appState?.url).toBe("https://example.test/native-history");
  });

  it("does not update unchanged state or regress the viewport fence", () => {
    sync();
    store.updateAppState.mockClear();
    sync();
    expect(store.updateAppState).not.toHaveBeenCalled();
    sync({ viewportEpoch: "1", url: "https://example.test/next" });
    expect(store.session.windows["window-1"].appState?.viewportEpoch).toBe("2");
    expect(store.session.windows["window-1"].appState?.geometry).toEqual(snapshot.geometry);
  });

  it("rehydrates persisted runtime identity and drops an old runtime's control lease", () => {
    Object.assign(store.session.windows["window-1"].appState!, { isController: true, leaseToken: "old-lease" });
    sync({ browserIncarnation: "new-runtime", profileEpoch: "2", navigationRevision: "1" });
    expect(store.session.windows["window-1"].appState).toMatchObject({
      browserIncarnation: "new-runtime", profileEpoch: 2, navigationRevision: "1", isController: false,
    });
    expect(store.session.windows["window-1"].appState?.leaseToken).toBeUndefined();
  });

  it("ignores old connection, changed session, closed window, and wrong-profile completions", () => {
    currentConnection.mockReturnValue(false);
    expect(sync()).toBe("detached");
    currentConnection.mockReturnValue(true);
    expect(sync({ browserSessionId: "other-session" })).toBe("detached");
    store.session.windows["window-1"].ctx.profileId = "other-profile";
    expect(sync()).toBe("detached");
    delete store.session.windows["window-1"];
    expect(sync()).toBe("detached");
    expect(store.updateAppState).not.toHaveBeenCalled();
  });

  it("presents terminal runtime status instead of claiming it is available", () => {
    sync({ status: "lost" });
    expect(store.session.windows["window-1"].appState?.unsupportedReason).toBe("Browser session is lost");
    expect(store.session.windows["window-1"].appState?.sessionId).toBe("session-1");
    expect(store.session.windows["window-1"].appState?.inputAvailable).toBe(false);
  });

  it("applies terminal status and viewport updates without regressing a newer navigation revision", () => {
    sync();
    sync({
      navigationRevision: "9007199254740992", status: "closed", viewportEpoch: "3",
      geometry: { ...snapshot.geometry, cssWidth: 1000 }, url: "https://example.test/stale",
    });
    expect(store.session.windows["window-1"].appState).toMatchObject({
      navigationRevision: "9007199254740993", url: snapshot.url,
      viewportEpoch: "3", geometry: { ...snapshot.geometry, cssWidth: 1000 },
      browserSessionStatus: "closed", unsupportedReason: "Browser session is closed",
    });
  });

  it("rejects pushed state from a replaced runtime, even for the same session and connection", () => {
    const runtime = { browserIncarnation: "incarnation-1", profileEpoch: 1 };
    const pushed = () => syncBrowserSessionWindow(
      owner, "window-1", "session-1", snapshot, runtime,
    );
    expect(pushed()).toBe("applied");
    sync({ browserIncarnation: "replacement-runtime", profileEpoch: "2", navigationRevision: "1" });
    store.updateAppState.mockClear();
    expect(pushed()).toBe("detached");
    expect(store.updateAppState).not.toHaveBeenCalled();
    expect(store.session.windows["window-1"].appState?.browserIncarnation).toBe("replacement-runtime");
  });
});
