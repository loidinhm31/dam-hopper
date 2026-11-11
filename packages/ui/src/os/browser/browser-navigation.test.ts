// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import type * as BrowserHostClientModule from "@/api/browser-host-client.js";
import { BrowserHostClientError } from "@/api/browser-host-types.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { OsWindow } from "../types.js";
import { BROWSER_STATE_VERSION, type BrowserWindowState } from "./browser-tab-types.js";

const { owner, connState, store, api } = vi.hoisted(() => ({
  owner: { profileId: "p1", generation: 1 },
  connState: { status: "connected" as const, serverUrl: "https://hub.example.com", verifiedBrowserIdentity: { principal: "alice", namespace: "prod" as const } },
  store: { session: { schema: 1, activeDesktopId: "d1", desktops: [], windows: {} as Record<string, OsWindow> }, updateAppState: vi.fn() },
  api: { getBrowserSession: vi.fn(), navigateBrowser: vi.fn(), reloadBrowser: vi.fn(), historyBrowser: vi.fn() },
}));
vi.mock("@/api/browser-host-client.js", async (orig) => ({ ...(await orig<typeof BrowserHostClientModule>()), ...api }));
vi.mock("@/api/connections.js", () => ({
  isCurrentConnection: (ref: { profileId: string; generation: number }) =>
    connState.status === "connected" && ref.profileId === owner.profileId && ref.generation === owner.generation,
  getConnectionSnapshot: (): ConnectionSnapshot => ({
    owner, status: connState.status, intent: false, serverUrl: connState.serverUrl, verifiedBrowserIdentity: connState.verifiedBrowserIdentity,
  }),
}));
vi.mock("../window-store.js", () => ({ useWindowStore: { getState: () => store } }));

import {
  activateTabInWindow, clearNavigationsForTesting, navigateTabHistory, reloadBrowserTab,
  resetTabDraftToCommitted, retireTabNavigation, sanitizeBrowserError, submitTabAddress, validateBrowserUrlInput,
} from "./browser-navigation.js";
import {
  BROWSER_RECOVERY_STORAGE_KEY, clearRememberedPagesAndSuppress, isOwnerAddressSuppressed, loadBrowserRecoveryDisk, saveBrowserRecoveryDisk,
} from "./browser-recovery-store.js";

const liveSnap: BrowserSessionDto = {
  browserSessionId: "sess-1", browserIncarnation: "inc-1", profileEpoch: "1", navigationRevision: "42", viewportEpoch: "1",
  url: "https://example.test/start?q=1#top", title: "Start", status: "running", inputAvailable: true,
  geometry: { cssWidth: 1280, cssHeight: 800, dpr: 1, offsetTop: 0, scrollX: 0, scrollY: 0, pageScale: 1, visualOffsetX: 0, visualOffsetY: 0 },
};
const scopeA = { profileId: "p1", endpoint: "https://hub.example.com", principal: "alice", namespace: "prod" as const };

describe("browser-navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks(); clearNavigationsForTesting(); localStorage.clear();
    owner.generation = 1; connState.status = "connected";
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_n: string, _o: unknown, cb: () => Promise<unknown>) => cb() } });
    store.updateAppState.mockImplementation((id: string, u: Record<string, unknown>) => {
      store.session.windows[id].appState = { ...store.session.windows[id].appState, ...u };
    });
    store.session.windows = {
      "w-1": {
        id: "w-1", appId: "browser", title: "Browser", ctx: { profileId: "p1" }, mode: "tile", desktopId: "d1", maximized: false, minimized: false,
        appState: {
          browserStateVersion: BROWSER_STATE_VERSION, ownerScope: scopeA, activeTabId: "t-1",
          tabs: [
            { tabId: "t-1", kind: "ordinary", committedUrl: liveSnap.url, sessionId: "sess-1", phase: "live", draft: { value: liveSnap.url, dirty: false }, actionSequence: 0, snapshot: liveSnap },
            { tabId: "t-def", kind: "ordinary", committedUrl: "https://deferred.test/app?x=2#b", phase: "deferred", draft: { value: "https://deferred.test/app?x=2#b", dirty: false }, actionSequence: 0 },
          ],
        },
      },
    };
  });
  afterEach(() => vi.restoreAllMocks());

  it("validates HTTP(S) URLs, defaults localhost to http, preserves query/hash, and rejects userinfo/search terms", () => {
    expect(validateBrowserUrlInput("localhost:5173/test?a=1#h")).toEqual({ valid: true, url: "http://localhost:5173/test?a=1#h" });
    expect(validateBrowserUrlInput("example.com")).toEqual({ valid: true, url: "https://example.com/" });
    expect(validateBrowserUrlInput("https://user:pass@example.com").valid).toBe(false);
    expect(validateBrowserUrlInput("search for cats").valid).toBe(false);
    expect(validateBrowserUrlInput("javascript:alert(1)").valid).toBe(false);
  });

  it("blocks explicit submit if Web Locks fails and reserves single-flight before lock await", async () => {
    await clearRememberedPagesAndSuppress(scopeA, () => {});
    const lockGate = Promise.withResolvers<void>();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: async (_n: string, _o: unknown, cb: () => Promise<unknown>) => { await lockGate.promise; return cb(); } },
    });
    const first = submitTabAddress({ owner, windowId: "w-1", tabId: "t-1", rawInput: "https://first.test" });
    await submitTabAddress({ owner, windowId: "w-1", tabId: "t-1", rawInput: "https://second.test" });
    retireTabNavigation("w-1", "t-1");
    lockGate.resolve();
    await first;
    expect(api.getBrowserSession).not.toHaveBeenCalled();

    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    const onError = vi.fn();
    await submitTabAddress({ owner, windowId: "w-1", tabId: "t-1", rawInput: "https://next.test", onError });
    expect(api.navigateBrowser).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Web Locks API is unavailable"));
    expect(isOwnerAddressSuppressed(scopeA, loadBrowserRecoveryDisk())).toBe(true);
  });

  it("resets owner suppression on explicit submit and clears dirty flag only if draft remained untouched", async () => {
    await clearRememberedPagesAndSuppress(scopeA, () => {});
    api.getBrowserSession.mockResolvedValueOnce(liveSnap);
    api.navigateBrowser.mockResolvedValueOnce({ ...liveSnap, navigationRevision: "43", url: "https://next.test/?q=1" });
    await submitTabAddress({ owner, windowId: "w-1", tabId: "t-1", rawInput: "https://next.test/?q=1" });
    expect(isOwnerAddressSuppressed(scopeA, loadBrowserRecoveryDisk())).toBe(false);
    expect(api.navigateBrowser).toHaveBeenCalledWith(owner, "sess-1", { url: "https://next.test/?q=1", navigationRevision: "42" }, expect.any(AbortSignal));
  });

  it("live Reload ignores dirty draft and preserves owner address suppression", async () => {
    await clearRememberedPagesAndSuppress(scopeA, () => {});
    const st = store.session.windows["w-1"].appState as unknown as BrowserWindowState;
    store.session.windows["w-1"].appState = { ...st, tabs: [{ ...st.tabs[0]!, draft: { value: "https://dirty-draft.test", dirty: true } }, st.tabs[1]!] };
    api.getBrowserSession.mockResolvedValueOnce(liveSnap);
    api.reloadBrowser.mockResolvedValueOnce({ ...liveSnap, navigationRevision: "44" });

    await reloadBrowserTab({ owner, windowId: "w-1", tabId: "t-1" });
    expect(api.reloadBrowser).toHaveBeenCalledTimes(1);
    expect(isOwnerAddressSuppressed(scopeA, loadBrowserRecoveryDisk())).toBe(true);
    expect((store.session.windows["w-1"].appState as unknown as BrowserWindowState).tabs[0]?.draft).toEqual({ value: "https://dirty-draft.test", dirty: true });

    resetTabDraftToCommitted("w-1", "t-1");
    expect((store.session.windows["w-1"].appState as unknown as BrowserWindowState).tabs[0]?.draft).toEqual({ value: liveSnap.url, dirty: false });
  });

  it("refreshes 409 conflict without replaying CAS history and stages deferred activation without resetting suppression", async () => {
    api.getBrowserSession.mockResolvedValueOnce(liveSnap).mockResolvedValueOnce({ ...liveSnap, navigationRevision: "45", url: "https://example.test/server-nav" });
    api.historyBrowser.mockRejectedValueOnce(new BrowserHostClientError("conflict", "sessionConflict", 409));
    const onError = vi.fn();
    await navigateTabHistory({ owner, windowId: "w-1", tabId: "t-1", direction: "back", onError });
    expect(api.historyBrowser).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("Page state changed; retry the action.");
    await clearRememberedPagesAndSuppress(scopeA, () => {});
    await activateTabInWindow({ owner, windowId: "w-1", tabId: "t-def" });
    const afterDef = store.session.windows["w-1"].appState as unknown as BrowserWindowState;
    expect(afterDef.activeTabId).toBe("t-def");
    expect(afterDef.tabs[1]?.phase).toBe("creating");
    expect(isOwnerAddressSuppressed(scopeA, loadBrowserRecoveryDisk())).toBe(true);
  });

  it("blocks unavailable reload when an unacknowledged recovery op exists for the tab", async () => {
    const st = store.session.windows["w-1"].appState as unknown as BrowserWindowState;
    store.session.windows["w-1"].appState = { ...st, tabs: [{ ...st.tabs[0]!, phase: "unavailable", sessionId: undefined }] };
    saveBrowserRecoveryDisk({
      version: 1, groups: [], addressSuppressedScopes: [],
      operations: [{ operationId: "op-blk", ownerScope: scopeA, kind: "create", windowId: "w-1", tabId: "t-1", status: "unknown" }],
    });
    expect(localStorage.getItem(BROWSER_RECOVERY_STORAGE_KEY)).toBeTruthy();
    const onError = vi.fn();
    await reloadBrowserTab({ owner, windowId: "w-1", tabId: "t-1", onError });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("pending recovery operation"));
    expect((store.session.windows["w-1"].appState as unknown as BrowserWindowState).tabs[0]?.phase).toBe("unavailable");
  });

  it("retires unavailable reload and deferred activation during recovery lock await and allowlists diagnostics", async () => {
    const st = store.session.windows["w-1"].appState as unknown as BrowserWindowState;
    store.session.windows["w-1"].appState = { ...st, tabs: [{ ...st.tabs[0]!, phase: "unavailable", sessionId: undefined }, st.tabs[1]!] };
    const lockGate = Promise.withResolvers<void>();
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_n: string, _o: unknown, cb: () => Promise<unknown>) => { await lockGate.promise; return cb(); } } });
    const rel = reloadBrowserTab({ owner, windowId: "w-1", tabId: "t-1" });
    retireTabNavigation("w-1", "t-1");
    lockGate.resolve(); await rel;
    expect((store.session.windows["w-1"].appState as unknown as BrowserWindowState).tabs[0]?.phase).toBe("unavailable");

    const lockGate2 = Promise.withResolvers<void>();
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (_n: string, _o: unknown, cb: () => Promise<unknown>) => { await lockGate2.promise; return cb(); } } });
    const actDef = activateTabInWindow({ owner, windowId: "w-1", tabId: "t-def" });
    await activateTabInWindow({ owner, windowId: "w-1", tabId: "t-1" });
    lockGate2.resolve(); await actDef;
    expect((store.session.windows["w-1"].appState as unknown as BrowserWindowState).tabs[1]?.phase).toBe("deferred");

    expect(sanitizeBrowserError(new SyntaxError("Unexpected token https://secret.test/?k=1"), "Fallback.")).toBe("Fallback.");
    expect(sanitizeBrowserError(new BrowserHostClientError("confidential data:text/plain,tok /opt/key", "sessionConflict", 409), "Fallback.")).toBe("Page state changed; retry the action.");
    expect(sanitizeBrowserError(new BrowserHostClientError("secret internal msg", "unknownKind", 500), "Fallback.")).toBe("Fallback.");
  });
});
