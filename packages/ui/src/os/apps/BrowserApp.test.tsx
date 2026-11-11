// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import type * as BrowserHostClientModule from "@/api/browser-host-client.js";
import { BrowserHostClientError } from "@/api/browser-host-types.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { OsWindow } from "../types.js";
import { OS_SESSION_STORAGE_KEY } from "../persistence.js";
import { clearNavigationsForTesting } from "../browser/browser-navigation.js";
import { BROWSER_RECOVERY_STORAGE_KEY } from "../browser/browser-recovery-store.js";
import { clearCloseLifecycleForTesting } from "../browser/browser-close-lifecycle.js";
import { clearBrowserControlGateForTesting, runSerializedBrowserControlAcquire } from "../browser/browser-control-gate.js";
import { isOperationRiskAcknowledged } from "../browser/browser-session-inventory.js";
import { clearPopupTabStateForTesting } from "../browser/browser-popup-tabs.js";
import { projectBrowserWindowState } from "../browser/browser-persistence.js";
import { loadBrowserRecoveryDisk, saveBrowserRecoveryDisk } from "../browser/browser-recovery-store.js";
import { clearInventoryAcksForTesting } from "../browser/browser-session-inventory.js";
import { BROWSER_STATE_VERSION, type BrowserWindowState } from "../browser/browser-tab-types.js";

const {
  owner,
  connState,
  cognitoState,
  lockState,
  store,
  api,
  requestProxyFocus,
  requestAudioUnlock,
  registerStreamSlot,
  updateStreamSlot,
  audioBlockedState,
} = vi.hoisted(() => ({
  owner: { profileId: "profile-1", generation: 1 },
  connState: {
    status: "connected" as const,
    serverUrl: "https://hub.example.com",
    verifiedBrowserIdentity: { principal: "alice", namespace: "prod" as const },
  },
  cognitoState: { active: false },
  lockState: { isLocked: false },
  store: {
    session: {
      schema: 1,
      activeDesktopId: "desktop-1",
      desktops: [{ id: "desktop-1", name: "Desktop 1", tree: null, floatingWindowIds: [], focusedWindowId: "window-1" }],
      windows: {} as Record<string, OsWindow>,
    },
    updateAppState: vi.fn(),
    closeWindow: vi.fn(),
    focusWindow: vi.fn(),
    restoreWindow: vi.fn(),
    switchDesktop: vi.fn(),
  },
  api: {
    getBrowserSession: vi.fn(),
    listBrowserSessions: vi.fn(),
    closeBrowserSession: vi.fn(),
    navigateBrowser: vi.fn(),
    reloadBrowser: vi.fn(),
    historyBrowser: vi.fn(),
    acquireBrowserControl: vi.fn(),
    renewBrowserControl: vi.fn(),
    releaseBrowserControl: vi.fn(),
  },
  requestProxyFocus: vi.fn(),
  requestAudioUnlock: vi.fn(),
  registerStreamSlot: vi.fn(() => () => {}),
  updateStreamSlot: vi.fn(),
  audioBlockedState: { blocked: false, listeners: new Set<() => void>() },
}));

vi.mock("@/api/browser-host-client.js", async (original) => ({
  ...(await original<typeof BrowserHostClientModule>()),
  ...api,
}));
vi.mock("@/api/connections.js", () => {
  const getSnapshot = (): ConnectionSnapshot => ({
    owner,
    status: connState.status,
    intent: false,
    serverUrl: connState.serverUrl,
    verifiedBrowserIdentity: connState.verifiedBrowserIdentity,
  });
  return {
    isCurrentConnection: (ref: { profileId: string; generation: number }) =>
      connState.status === "connected" && ref.profileId === owner.profileId && ref.generation === owner.generation,
    getConnectionSnapshot: () => getSnapshot(),
    useConnectionSnapshot: () => getSnapshot(),
    getApi: () => ({ terminal: { listDetailed: async () => [] } }),
  };
});
vi.mock("../window-store.js", () => ({
  useWindowStore: Object.assign(
    (selector: (state: typeof store) => unknown) => selector(store),
    { getState: () => store, subscribe: () => () => {} },
  ),
}));
vi.mock("../window-context.js", () => ({
  useWindowOwner: () => owner,
  useWindowContext: () => ({ isActiveDesktop: true, isFocused: true }),
}));
vi.mock("../resource-registry.js", () => ({ useResourceClaim: () => ({ success: true }) }));
vi.mock("@/stores/cognito-mode.js", () => ({
  useCognitoModeStore: Object.assign(
    (selector: (s: typeof cognitoState) => unknown) => selector(cognitoState),
    { getState: () => cognitoState, subscribe: () => () => {} },
  ),
}));
vi.mock("@/stores/lock-screen.js", () => ({
  useLockScreenStore: Object.assign(
    (selector: (s: typeof lockState) => unknown) => selector(lockState),
    { getState: () => lockState, subscribe: () => () => {} },
  ),
}));
vi.mock("../BrowserStreamKeepAliveHost.js", () => ({
  registerBrowserStreamSlot: registerStreamSlot,
  updateBrowserStreamSlot: updateStreamSlot,
  clearBrowserViewFenceForProfile: () => {},
  requestBrowserProxyFocus: requestProxyFocus,
  requestBrowserAudioUnlock: requestAudioUnlock,
  isBrowserAudioBlocked: () => audioBlockedState.blocked,
  subscribeBrowserAudioBlocked: (fn: () => void) => {
    audioBlockedState.listeners.add(fn);
    return () => audioBlockedState.listeners.delete(fn);
  },
}));
vi.mock("@/browser-host/selection-controller.js", () => ({
  collectHostTerminalCandidates: () => [],
  useHostBrowserSelection: () => ({}),
}));

import { BrowserApp } from "./BrowserApp.js";

const live: BrowserSessionDto = {
  browserSessionId: "session-1",
  browserIncarnation: "runtime-1",
  profileEpoch: "1",
  navigationRevision: "9007199254740993",
  viewportEpoch: "2",
  url: "https://example.test/page",
  title: "Page",
  status: "running",
  inputAvailable: true,
  geometry: {
    cssWidth: 800,
    cssHeight: 600,
    dpr: 1,
    offsetTop: 0,
    scrollX: 0,
    scrollY: 0,
    pageScale: 1,
    visualOffsetX: 0,
    visualOffsetY: 0,
  },
};

const scopeA = {
  profileId: "profile-1",
  endpoint: "https://hub.example.com",
  principal: "alice",
  namespace: "prod" as const,
};

function canonicalAppState(overrides?: Partial<BrowserWindowState>): Record<string, unknown> {
  return {
    browserStateVersion: BROWSER_STATE_VERSION,
    ownerScope: scopeA,
    tabs: [
      {
        tabId: "tab-1",
        kind: "ordinary",
        committedUrl: live.url,
        sessionId: "session-1",
        title: "Page",
        phase: "live",
        draft: { value: live.url, dirty: false },
        actionSequence: 0,
        snapshot: live,
      },
    ],
    activeTabId: "tab-1",
    ...overrides,
  };
}

let root: Root;
let container: HTMLDivElement;

async function rerender() {
  await act(async () => root.render(createElement(BrowserApp, { window: store.session.windows["window-1"] })));
}

beforeEach(async () => {
  vi.clearAllMocks();
  clearNavigationsForTesting();
  clearInventoryAcksForTesting();
  clearCloseLifecycleForTesting();
  clearBrowserControlGateForTesting();
  clearPopupTabStateForTesting();
  localStorage.clear();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_name: string, _opts: unknown, cb: () => Promise<unknown>) => cb(),
    },
  });
  owner.generation = 1;
  connState.status = "connected";
  connState.serverUrl = "https://hub.example.com";
  connState.verifiedBrowserIdentity = { principal: "alice", namespace: "prod" };
  cognitoState.active = false;
  lockState.isLocked = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});

  store.session.windows = {
    "window-1": {
      id: "window-1",
      appId: "browser",
      title: "Browser",
      ctx: { profileId: owner.profileId },
      mode: "tile",
      desktopId: "desktop-1",
      maximized: false,
      minimized: false,
      appState: canonicalAppState(),
    },
  };
  store.updateAppState.mockImplementation((id: string, update: Record<string, unknown>) => {
    const win = store.session.windows[id];
    win.appState = { ...win.appState, ...update };
  });
  api.getBrowserSession.mockReset().mockResolvedValue(live);
  api.listBrowserSessions.mockReset().mockResolvedValue([live]);
  api.closeBrowserSession.mockReset().mockResolvedValue(undefined);
  for (const fn of [api.navigateBrowser, api.reloadBrowser, api.historyBrowser]) {
    fn.mockReset().mockResolvedValue({ ...live, navigationRevision: "9007199254740994" });
  }
  api.acquireBrowserControl.mockReset().mockResolvedValue({
    leaseToken: "lease-1",
    expiresAtUnixMs: Date.now() + 30_000,
  });
  api.releaseBrowserControl.mockReset().mockResolvedValue({ released: true });
  api.renewBrowserControl.mockReset().mockResolvedValue({ leaseToken: "lease-renewed", expiresAtUnixMs: Date.now() + 30_000 });
  requestProxyFocus.mockReset();
  requestAudioUnlock.mockReset();
  updateStreamSlot.mockReset();
  registerStreamSlot.mockClear();
  audioBlockedState.blocked = false;
  audioBlockedState.listeners.clear();

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await rerender();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function action(kind: string) {
  await act(async () => {
    if (kind === "navigate") {
      container.querySelector('[data-testid="browser-address-input"]')!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    } else {
      (container.querySelector(`[data-testid="browser-${kind}-btn"]`) as HTMLButtonElement).click();
    }
  });
  await rerender();
}

describe("BrowserApp native chrome & tab continuity", () => {
  it.each(["navigate", "reload", "back", "forward"])("%s reads authority rather than the rendered revision", async (kind) => {
    await action(kind);
    const fn = kind === "navigate" ? api.navigateBrowser : kind === "reload" ? api.reloadBrowser : api.historyBrowser;
    expect(api.getBrowserSession).toHaveBeenCalledWith(owner, "session-1", expect.any(AbortSignal));
    expect(fn).toHaveBeenCalledExactlyOnceWith(
      owner,
      "session-1",
      {
        navigationRevision: "9007199254740993",
        ...(kind === "navigate" ? { url: live.url } : {}),
        ...(kind === "back" || kind === "forward" ? { direction: kind } : {}),
      },
      expect.any(AbortSignal),
    );
    const winState = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    expect(winState.tabs[0]?.snapshot?.navigationRevision).toBe("9007199254740994");
  });

  it("refreshes a raced 409 without replaying history and exposes static sanitized failure", async () => {
    api.historyBrowser.mockRejectedValueOnce(new BrowserHostClientError("stale navigationRevision secret=tok", "sessionConflict", 409));
    api.getBrowserSession.mockResolvedValueOnce(live).mockResolvedValueOnce({
      ...live,
      navigationRevision: "9007199254740995",
      url: "https://example.test/native-link",
    });
    await action("back");
    expect(api.historyBrowser).toHaveBeenCalledTimes(1);
    expect(api.getBrowserSession).toHaveBeenCalledTimes(2);
    const winState = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    expect(winState.tabs[0]?.committedUrl).toBe("https://example.test/native-link");
    const errText = container.querySelector('[data-testid="browser-navigation-error"]')?.textContent ?? "";
    expect(errText).toBe("Page state changed; retry the action.");
    expect(errText).not.toContain("secret=tok");
  });

  it("does not navigate a tab whose session changed during the authority read", async () => {
    api.getBrowserSession.mockImplementationOnce(async () => {
      const st = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
      store.session.windows["window-1"].appState = {
        ...st,
        tabs: [{ ...st.tabs[0]!, sessionId: "replacement-session" }],
      };
      return live;
    });
    await action("reload");
    expect(api.reloadBrowser).not.toHaveBeenCalled();
  });

  it("retires hung old requests on generation or session replacement", async () => {
    const oldRead = Promise.withResolvers<BrowserSessionDto>();
    const newRead = Promise.withResolvers<BrowserSessionDto>();
    api.getBrowserSession.mockReturnValueOnce(oldRead.promise);
    await action("reload");
    const oldSignal = api.getBrowserSession.mock.calls[0][2] as AbortSignal;
    const oldState = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    owner.generation = 2;
    store.session.windows["window-1"] = {
      ...store.session.windows["window-1"],
      appState: {
        ...oldState,
        tabs: [{ ...oldState.tabs[0]!, sessionId: "session-2" }],
      },
    };
    await rerender();
    expect(oldSignal.aborted).toBe(true);
    api.getBrowserSession.mockReturnValueOnce(newRead.promise);
    await action("back");
    await act(async () => oldRead.resolve(live));
    expect(api.reloadBrowser).not.toHaveBeenCalled();
    await act(async () => newRead.resolve({ ...live, browserSessionId: "session-2" }));
    expect(api.historyBrowser).toHaveBeenCalledExactlyOnceWith(
      owner,
      "session-2",
      { direction: "back", navigationRevision: live.navigationRevision },
      expect.any(AbortSignal),
    );
  });

  it("acquires control per active tab inside Tools disclosure and releases stale leases", async () => {
    await act(async () => {
      (container.querySelector('[data-testid="browser-tools-toggle-btn"]') as HTMLButtonElement).click();
    });
    const controlBtn = container.querySelector('[data-testid="browser-take-control-btn"]') as HTMLButtonElement;
    await act(async () => controlBtn.click());
    await rerender();

    expect(api.acquireBrowserControl).toHaveBeenCalledWith(owner, "session-1", {
      viewerId: "window-1:tab-1",
      holderKind: "human",
    });
    expect(requestProxyFocus).toHaveBeenCalledExactlyOnceWith("window-1", "tab-1", owner, "session-1", "lease-1");

    requestProxyFocus.mockClear();
    const curState = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    store.session.windows["window-1"].appState = {
      ...curState,
      tabs: [{ ...curState.tabs[0]!, isController: false, leaseToken: undefined, viewerId: "viewer-A" }],
    };
    await rerender();

    const delayedLease = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
    api.acquireBrowserControl.mockReturnValueOnce(delayedLease.promise);
    await act(async () => {
      (container.querySelector('[data-testid="browser-take-control-btn"]') as HTMLButtonElement).click();
    });
    const stMid = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    store.session.windows["window-1"].appState = {
      ...stMid,
      tabs: [{ ...stMid.tabs[0]!, viewerId: "viewer-B" }],
    };
    await act(async () => {
      delayedLease.resolve({ leaseToken: "stale-lease", expiresAtUnixMs: Date.now() + 30_000 });
    });
    expect(api.releaseBrowserControl).toHaveBeenCalledWith(owner, "session-1", { leaseToken: "stale-lease" });
    expect(requestProxyFocus).not.toHaveBeenCalled();
  });

  it("renders popup banners for active popup tabs and Return to Page restores opener tab", async () => {
    store.session.windows["window-1"].appState = canonicalAppState({
      tabs: [
        {
          tabId: "tab-1",
          kind: "ordinary",
          committedUrl: live.url,
          sessionId: "session-1",
          phase: "live",
          draft: { value: live.url, dirty: false },
          actionSequence: 0,
          snapshot: { ...live, activePopupSessionId: "popup-session-1" },
        },
        {
          tabId: "popup-1",
          kind: "popup",
          parentTabId: "tab-1",
          committedUrl: "https://accounts.google.com/o/oauth2/v2/auth",
          sessionId: "popup-session-1",
          phase: "live",
          draft: { value: "https://accounts.google.com/o/oauth2/v2/auth", dirty: false },
          actionSequence: 0,
          snapshot: {
            ...live,
            browserSessionId: "popup-session-1",
            url: "https://accounts.google.com/o/oauth2/v2/auth",
            parentSessionId: "session-1",
            popupBlocked: true,
          },
        },
      ],
      activeTabId: "popup-1",
    });
    await rerender();
    expect(container.querySelector('[data-testid="browser-popup-blocked-banner"]')).not.toBeNull();
    const returnBtn = container.querySelector('[data-testid="browser-popup-return-btn"]') as HTMLButtonElement;
    await act(async () => returnBtn.click());
    await rerender();

    const afterReturn = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    expect(afterReturn.activeTabId).toBe("tab-1");
    expect(afterReturn.tabs).toHaveLength(1);

    const openPopupBtn = container.querySelector('[data-testid="browser-open-popup-btn"]') as HTMLButtonElement;
    expect(openPopupBtn).not.toBeNull();
    api.getBrowserSession
      .mockResolvedValueOnce({ ...live, activePopupSessionId: "popup-session-1" })
      .mockResolvedValueOnce({
        ...live,
        browserSessionId: "popup-session-1",
        url: "https://accounts.google.com/o/oauth2/v2/auth",
        parentSessionId: "session-1",
      });
    await act(async () => openPopupBtn.click());
    await rerender();
    const afterReopen = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    expect(afterReopen.tabs.some((t) => t.kind === "popup" && t.sessionId === "popup-session-1")).toBe(true);
  });

  it("stages fresh createIntent without URL inference when reloading or navigating an unavailable tab", async () => {
    store.session.windows["window-1"].appState = canonicalAppState({
      tabs: [
        {
          tabId: "tab-1",
          kind: "ordinary",
          committedUrl: live.url,
          phase: "unavailable",
          unavailableReason: "Browser session is lost",
          draft: { value: live.url, dirty: false },
          actionSequence: 0,
        },
      ],
    });
    await rerender();
    expect(container.querySelector('[data-testid="browser-unavailable-panel"]')?.textContent).toContain("Page unavailable");

    const input = container.querySelector('[data-testid="browser-address-input"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "https://accounts.google.com/login?a=1#frag");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await rerender();
    await action("navigate");

    expect(api.navigateBrowser).not.toHaveBeenCalled();
    const st = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    expect(st.tabs[0]?.phase).toBe("creating");
    expect(st.tabs[0]?.committedUrl).toBe("https://accounts.google.com/login?a=1#frag");
    expect(st.tabs[0]?.createIntent?.request.url).toBe("https://accounts.google.com/login?a=1#frag");
  });

  it("supports tab add, keyboard navigation, shared drafts across tabs, and last-tab close returning blank New Tab", async () => {
    await act(async () => {
      (container.querySelector('[data-testid="browser-new-tab-btn"]') as HTMLButtonElement).click();
    });
    await rerender();
    let st = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    expect(st.tabs).toHaveLength(2);
    const secondTabId = st.activeTabId;
    const newTabInput = container.querySelector('[data-testid="browser-new-tab-url-input"]') as HTMLInputElement;
    expect(newTabInput).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(newTabInput, "draft-unsubmitted.local");
      newTabInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await rerender();
    const addrInput = container.querySelector('[data-testid="browser-address-input"]') as HTMLInputElement;
    expect(addrInput.value).toBe("draft-unsubmitted.local");

    // ArrowLeft navigates tab strip back to tab-1 while preserving tab-2's dirty draft
    const tablist = container.querySelector('[role="tablist"]')!;
    await act(async () => {
      container.querySelector(`[data-testid="browser-tab-${secondTabId}"]`)!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    await rerender();
    st = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    expect(st.activeTabId).toBe("tab-1");
    expect(st.tabs.find((t) => t.tabId === secondTabId)?.draft).toEqual({ value: "draft-unsubmitted.local", dirty: true });
    expect(tablist.getAttribute("aria-label")).toBe("Browser tabs");

    // Closing the blank second tab leaves tab-1; closing tab-1 with remote DELETE turns into blank New Tab
    await act(async () => {
      (container.querySelector(`[data-testid="browser-tab-close-${secondTabId}"]`) as HTMLButtonElement).click();
    });
    await rerender();
    expect((store.session.windows["window-1"].appState as unknown as BrowserWindowState).tabs).toHaveLength(1);

    await act(async () => {
      (container.querySelector('[data-testid="browser-tab-close-tab-1"]') as HTMLButtonElement).click();
    });
    const flush = Promise.withResolvers<void>();
    setTimeout(flush.resolve, 10);
    await flush.promise;
    await rerender();
    const finalState = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    expect(finalState.tabs).toHaveLength(1);
    expect(finalState.tabs[0]?.phase).toBe("new-tab");
    expect(store.closeWindow).not.toHaveBeenCalled();
  });

  it("clears remembered pages under lock, strips saved OS URLs without closing live tabs, and masks all sensitive UI in Cognito/mismatch", async () => {
    localStorage.setItem(OS_SESSION_STORAGE_KEY, JSON.stringify({
      schema: 1,
      activeDesktopId: "desktop-1",
      desktops: [{ id: "desktop-1", name: "D1", tree: null, floatingWindowIds: ["window-1"], focusedWindowId: "window-1" }],
      windows: { "window-1": { ...store.session.windows["window-1"], mode: "float" } },
    }));
    await act(async () => {
      (container.querySelector('[data-testid="browser-tools-toggle-btn"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container.querySelector('[data-testid="browser-clear-remembered-btn"]') as HTMLButtonElement).click();
    });
    await rerender();
    expect(container.querySelector('[data-testid="browser-clear-remembered-status"]')?.textContent).toContain("Remembered pages cleared locally");
    const savedRecovery = JSON.parse(localStorage.getItem(BROWSER_RECOVERY_STORAGE_KEY)!);
    expect(savedRecovery.addressSuppressedScopes).toHaveLength(1);
    const savedOs = JSON.parse(localStorage.getItem(OS_SESSION_STORAGE_KEY)!);
    expect(savedOs.windows["window-1"].appState.tabs[0].committedUrl).toBeUndefined();
    expect(savedOs.windows["window-1"].appState.tabs[0].sessionId).toBe("session-1");

    // Cognito masking hides tab label, address value, session ID, and recovery inventory
    cognitoState.active = true;
    await rerender();
    expect(container.querySelector('[data-testid="browser-tab-tab-1"]')?.textContent).toContain("Hidden tab");
    expect((container.querySelector('[data-testid="browser-address-input"]') as HTMLInputElement).value).toBe("●●●●●●");
    expect(container.querySelector('[data-testid="browser-diagnostic-session-id"]')?.textContent).toContain("Hidden");
    expect(container.querySelector('[data-testid="browser-recovery-panel"]')?.textContent).toContain("hidden");
    expect(container.querySelector('[data-testid="browser-clear-remembered-status"]')?.textContent).toContain("Protected mode active");
    cognitoState.active = false;
    connState.verifiedBrowserIdentity = { principal: "mallory", namespace: "prod" };
    await rerender();
    expect(container.querySelector('[data-testid="browser-owner-mismatch-banner"]')).not.toBeNull();
  });

  it("toggles per-tab audio mute and surfaces Unlock Audio when blocked", async () => {
    const audioBtn = container.querySelector('[data-testid="browser-audio-toggle-btn"]') as HTMLButtonElement;
    expect(audioBtn.getAttribute("aria-label")).toBe("Mute audio");
    await act(async () => audioBtn.click());
    expect(audioBtn.getAttribute("aria-label")).toBe("Unmute audio");
    expect(updateStreamSlot).toHaveBeenCalledWith("window-1", "tab-1", expect.any(HTMLElement), true, true);
    expect(api.acquireBrowserControl).not.toHaveBeenCalled();

    await act(async () => audioBtn.click());
    expect(requestAudioUnlock).toHaveBeenCalledExactlyOnceWith("window-1", "tab-1", owner, "session-1");

    requestAudioUnlock.mockClear();
    await act(async () => {
      audioBlockedState.blocked = true;
      audioBlockedState.listeners.forEach((fn) => fn());
    });
    expect(audioBtn.textContent).toBe("Unlock Audio");
    await act(async () => audioBtn.click());
    expect(requestAudioUnlock).toHaveBeenCalledExactlyOnceWith("window-1", "tab-1", owner, "session-1");
  });

  it("single-flights control acquire, fences switched-tab and newer-lease responses, and fences stale release", async () => {
    await act(async () => {
      (container.querySelector('[data-testid="browser-tools-toggle-btn"]') as HTMLButtonElement).click();
    });
    const delayedCtrl = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
    api.acquireBrowserControl.mockReturnValueOnce(delayedCtrl.promise);
    const takeBtn = container.querySelector('[data-testid="browser-take-control-btn"]') as HTMLButtonElement;
    await act(async () => { takeBtn.click(); });
    expect(takeBtn.disabled).toBe(true);
    await act(async () => { takeBtn.click(); });
    expect(api.acquireBrowserControl).toHaveBeenCalledTimes(1);

    // Tab switch fences delayed acquire and releases stale lease
    await act(async () => { (container.querySelector('[data-testid="browser-new-tab-btn"]') as HTMLButtonElement).click(); });
    await rerender();
    await act(async () => { delayedCtrl.resolve({ leaseToken: "inactive-lease", expiresAtUnixMs: Date.now() + 30_000 }); });
    expect(api.releaseBrowserControl).toHaveBeenCalledWith(owner, "session-1", { leaseToken: "inactive-lease" });
    expect((store.session.windows["window-1"].appState as unknown as BrowserWindowState).tabs.find((t) => t.tabId === "tab-1")?.isController).toBeFalsy();

    // Newer lease written mid-flight prevents older acquire from overwriting AND stale release does not clear newer lease
    await act(async () => { (container.querySelector('[data-testid="browser-tab-tab-1"]') as HTMLButtonElement).click(); });
    await rerender();
    const raceCtrl = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
    api.acquireBrowserControl.mockReturnValueOnce(raceCtrl.promise);
    await act(async () => { (container.querySelector('[data-testid="browser-take-control-btn"]') as HTMLButtonElement).click(); });
    const stMid = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    store.session.windows["window-1"].appState = { ...stMid, tabs: [{ ...stMid.tabs[0]!, isController: true, leaseToken: "lease-newer" }, stMid.tabs[1]!] };
    await act(async () => { raceCtrl.resolve({ leaseToken: "lease-older", expiresAtUnixMs: Date.now() + 30_000 }); });
    expect(api.releaseBrowserControl).toHaveBeenCalledWith(owner, "session-1", { leaseToken: "lease-older" });
    expect((store.session.windows["window-1"].appState as unknown as BrowserWindowState).tabs[0]?.leaseToken).toBe("lease-newer");

    // Delayed release captured on lease-old does not strip lease-newer if state rotated mid-flight
    const delayedRel = Promise.withResolvers<void>();
    api.releaseBrowserControl.mockReturnValueOnce(delayedRel.promise);
    const stCur = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    store.session.windows["window-1"].appState = { ...stCur, tabs: [{ ...stCur.tabs[0]!, isController: true, leaseToken: "lease-capture" }, stCur.tabs[1]!] };
    await rerender();
    await act(async () => { (container.querySelector('[data-testid="browser-release-control-btn"]') as HTMLButtonElement).click(); });
    store.session.windows["window-1"].appState = { ...stCur, tabs: [{ ...stCur.tabs[0]!, isController: true, leaseToken: "lease-reacquired" }, stCur.tabs[1]!] };
    await act(async () => { delayedRel.resolve(); });
    expect((store.session.windows["window-1"].appState as unknown as BrowserWindowState).tabs[0]?.leaseToken).toBe("lease-reacquired");
  });

  it("preserves popup provenance on inventory attach and closes popup remote targets on tab close", async () => {
    await act(async () => { (container.querySelector('[data-testid="browser-tools-toggle-btn"]') as HTMLButtonElement).click(); });
    const popDto: BrowserSessionDto = { ...live, browserSessionId: "pop-inv-1", parentSessionId: "session-1", url: "https://oauth.secret.test/cb?code=1", title: "OAuth" };
    api.listBrowserSessions.mockResolvedValueOnce([live, popDto]);
    api.getBrowserSession.mockResolvedValueOnce(popDto);
    await act(async () => { (container.querySelector('[data-testid="browser-recovery-refresh-btn"]') as HTMLButtonElement).click(); });
    await rerender();
    await act(async () => { (container.querySelector('[data-testid="browser-inventory-attach-pop-inv-1"]') as HTMLButtonElement).click(); });
    await rerender();
    const afterAttach = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    const attachedTab = afterAttach.tabs.find((t) => t.sessionId === "pop-inv-1");
    expect(attachedTab?.kind).toBe("popup");
    expect(projectBrowserWindowState(afterAttach, "portable").tabs.some((t) => t.committedUrl?.includes("oauth.secret.test"))).toBe(false);

    api.getBrowserSession.mockResolvedValueOnce(popDto);
    await act(async () => { (container.querySelector(`[data-testid="browser-tab-close-${attachedTab!.tabId}"]`) as HTMLButtonElement).click(); });
    const flush = Promise.withResolvers<void>(); setTimeout(flush.resolve, 10); await flush.promise;
    await rerender();
    expect(api.closeBrowserSession).toHaveBeenCalledWith(owner, "pop-inv-1", undefined);
  });

  it("blocks owner-mismatched tab close via button disabled state and Delete key", async () => {
    connState.verifiedBrowserIdentity = { principal: "mallory", namespace: "prod" };
    await rerender();
    const closeBtn = container.querySelector('[data-testid="browser-tab-close-tab-1"]') as HTMLButtonElement;
    expect(closeBtn.disabled).toBe(true);
    await act(async () => {
      container.querySelector('[data-testid="browser-tab-tab-1"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    });
    expect(api.closeBrowserSession).not.toHaveBeenCalled();
  });

  it("reconciles parent close-window op via parent retry button and blocks close if settlement rejects", async () => {
    await act(async () => { (container.querySelector('[data-testid="browser-tools-toggle-btn"]') as HTMLButtonElement).click(); });
    store.session.windows["window-1"].appState = { ...(store.session.windows["window-1"].appState as Record<string, unknown>), closing: { operationId: "op-win", status: "unknown" } };
    saveBrowserRecoveryDisk({
      version: 1, groups: [], addressSuppressedScopes: [],
      operations: [
        { operationId: "op-win", ownerScope: scopeA, kind: "close-window", windowId: "window-1", status: "unknown" },
        { operationId: "op-tab", ownerScope: scopeA, kind: "close-tab", windowId: "window-1", tabId: "tab-1", sessionId: "session-1", status: "unknown" },
      ],
    });
    await rerender();
    // Reject ONLY parent op-win settlement after child op-tab settles cleanly
    const origLocks = navigator.locks;
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_n: string, _o: unknown, cb: () => Promise<unknown>) => {
          const raw = localStorage.getItem(BROWSER_RECOVERY_STORAGE_KEY);
          const parsed = raw ? (JSON.parse(raw) as { operations: Array<{ operationId: string }> }) : null;
          if (parsed && parsed.operations.length === 1 && parsed.operations[0]?.operationId === "op-win") {
            throw new Error("Web Locks API is unavailable");
          }
          return cb();
        },
      },
    });
    await act(async () => { (container.querySelector('[data-testid="browser-recovery-retry-op-win"]') as HTMLButtonElement).click(); });
    const flushErr = Promise.withResolvers<void>(); setTimeout(flushErr.resolve, 15); await flushErr.promise;
    await rerender();
    expect(loadBrowserRecoveryDisk().operations.map((o) => o.operationId)).toEqual(["op-win"]);
    expect(isOperationRiskAcknowledged("op-win")).toBe(false);
    expect(store.closeWindow).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="browser-recovery-status"]')?.textContent).toContain("Web Locks API is unavailable");

    // Restoring locks settles parent op-win and closes window
    Object.defineProperty(navigator, "locks", { configurable: true, value: origLocks });
    await act(async () => { (container.querySelector('[data-testid="browser-recovery-retry-op-win"]') as HTMLButtonElement).click(); });
    const flushOk = Promise.withResolvers<void>(); setTimeout(flushOk.resolve, 15); await flushOk.promise;
    await rerender();
    expect(loadBrowserRecoveryDisk().operations).toHaveLength(0);
    expect(store.closeWindow).toHaveBeenCalledWith("window-1");
  });

  it("sanitizes corrupt OS JSON errors and raw popup errors without leaking payloads", async () => {
    localStorage.setItem(OS_SESSION_STORAGE_KEY, "{broken https://secret-session.test/?token=abc");
    await act(async () => { (container.querySelector('[data-testid="browser-tools-toggle-btn"]') as HTMLButtonElement).click(); });
    await act(async () => { (container.querySelector('[data-testid="browser-clear-remembered-btn"]') as HTMLButtonElement).click(); });
    await rerender();
    const clearMsg = container.querySelector('[data-testid="browser-clear-remembered-status"]')?.textContent ?? "";
    expect(clearMsg).toContain("Address suppression persisted");
    expect(clearMsg).not.toContain("secret-session.test");

    const curWin = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
    store.session.windows["window-1"].appState = { ...curWin, tabs: [{ ...curWin.tabs[0]!, snapshot: { ...live, activePopupSessionId: "pop-raw" } }] };
    await rerender();
    api.getBrowserSession.mockRejectedValueOnce(new Error("raw file:///etc/passwd https://secret-popup.test"));
    await act(async () => { (container.querySelector('[data-testid="browser-open-popup-btn"]') as HTMLButtonElement).click(); });
    await rerender();
    const navMsg = container.querySelector('[data-testid="browser-navigation-error"]')?.textContent ?? "";
    expect(navMsg).toBe("Popup window is no longer available.");
    expect(navMsg).not.toContain("secret-popup.test");
  });
  it("serializes shared toolbar/viewer acquisitions and fences delayed renew after replacement", async () => {
    await act(async () => { (container.querySelector('[data-testid="browser-tools-toggle-btn"]') as HTMLButtonElement).click(); });
    const viewerGate = Promise.withResolvers<void>();
    const viewerTask = runSerializedBrowserControlAcquire(owner, "session-1", "window-1:tab-1", async () => {
      await viewerGate.promise;
      const cur = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
      store.session.windows["window-1"].appState = { ...cur, tabs: [{ ...cur.tabs[0]!, isController: true, leaseToken: "lease-canvas" }] };
    });
    await act(async () => { (container.querySelector('[data-testid="browser-take-control-btn"]') as HTMLButtonElement).click(); });
    expect(api.acquireBrowserControl).not.toHaveBeenCalled();
    await act(async () => { viewerGate.resolve(); await viewerTask; });
    await rerender();
    expect(api.acquireBrowserControl).not.toHaveBeenCalled();
    expect((store.session.windows["window-1"].appState as unknown as BrowserWindowState).tabs[0]?.leaseToken).toBe("lease-canvas");

    vi.useFakeTimers();
    try {
      const stInit = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
      store.session.windows["window-1"].appState = { ...stInit, tabs: [{ ...stInit.tabs[0]!, isController: true, leaseToken: "lease-old" }] };
      await rerender();
      const delayedRenew = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
      api.renewBrowserControl.mockReturnValueOnce(delayedRenew.promise);
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      const stSwap = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
      store.session.windows["window-1"].appState = { ...stSwap, tabs: [{ ...stSwap.tabs[0]!, isController: true, leaseToken: "lease-fresh" }] };
      await act(async () => { delayedRenew.resolve({ leaseToken: "lease-stale-renew", expiresAtUnixMs: Date.now() + 30_000 }); });
      expect((store.session.windows["window-1"].appState as unknown as BrowserWindowState).tabs[0]?.leaseToken).toBe("lease-fresh");

      const delayedFail = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
      api.renewBrowserControl.mockReturnValueOnce(delayedFail.promise);
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      const stSwap2 = store.session.windows["window-1"].appState as unknown as BrowserWindowState;
      store.session.windows["window-1"].appState = { ...stSwap2, tabs: [{ ...stSwap2.tabs[0]!, isController: true, leaseToken: "lease-fresh-2" }] };
      await act(async () => { delayedFail.reject(new Error("expired")); });
      const finalTab = (store.session.windows["window-1"].appState as unknown as BrowserWindowState).tabs[0]!;
      expect(finalTab.isController).toBe(true);
      expect(finalTab.leaseToken).toBe("lease-fresh-2");
    } finally {
      vi.useRealTimers();
    }
  });
});
