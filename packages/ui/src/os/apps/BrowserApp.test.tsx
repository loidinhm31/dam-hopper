// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import type * as BrowserHostClientModule from "@/api/browser-host-client.js";
import type { OsWindow } from "../types.js";
import { BrowserHostClientError } from "@/api/browser-host-types.js";

const { owner, store, api } = vi.hoisted(() => ({
  owner: { profileId: "profile-1", generation: 1 },
  store: { session: { windows: {} as Record<string, OsWindow> }, updateAppState: vi.fn() },
  api: { getBrowserSession: vi.fn(), navigateBrowser: vi.fn(), reloadBrowser: vi.fn(), historyBrowser: vi.fn() },
}));
vi.mock("@/api/browser-host-client.js", async (original) => ({
  ...await original<typeof BrowserHostClientModule>(), ...api,
}));
vi.mock("@/api/connections.js", () => ({
  isCurrentConnection: () => true, getConnectionSnapshot: () => ({ owner, status: "connected" }),
  getApi: () => ({ terminal: { listDetailed: async () => [] } }),
}));
vi.mock("../window-store.js", () => ({ useWindowStore: Object.assign(
  (selector: (state: typeof store) => unknown) => selector(store), { getState: () => store },
) }));
vi.mock("../window-context.js", () => ({
  useWindowOwner: () => owner, useWindowContext: () => ({ isActiveDesktop: true, isFocused: true }),
}));
vi.mock("../resource-registry.js", () => ({ useResourceClaim: () => ({ success: true }) }));
vi.mock("@/stores/cognito-mode.js", () => ({ useCognitoModeStore: () => false }));
vi.mock("../BrowserStreamKeepAliveHost.js", () => ({
  registerBrowserStreamSlot: () => () => {}, updateBrowserStreamSlot: () => {}, clearBrowserViewFenceForProfile: () => {},
}));
vi.mock("@/browser-host/selection-controller.js", () => ({
  collectHostTerminalCandidates: () => [], useHostBrowserSelection: () => ({}),
}));
import { BrowserApp } from "./BrowserApp.js";

const live: BrowserSessionDto = {
  browserSessionId: "session-1", browserIncarnation: "runtime-1", profileEpoch: "1",
  navigationRevision: "9007199254740993", viewportEpoch: "2", url: "https://example.test/page",
  title: "Page", status: "running", inputAvailable: true,
  geometry: { cssWidth: 800, cssHeight: 600, dpr: 1, offsetTop: 0, scrollX: 0, scrollY: 0,
    pageScale: 1, visualOffsetX: 0, visualOffsetY: 0 },
};
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.clearAllMocks();
  owner.generation = 1;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  store.session.windows = { "window-1": {
    id: "window-1", appId: "browser", title: "Browser", ctx: { profileId: owner.profileId },
    mode: "tile", desktopId: "desktop-1", maximized: false, minimized: false,
    appState: { sessionId: "session-1", url: live.url, browserIncarnation: "runtime-1",
      profileEpoch: 1, navigationRevision: "1" },
  } };
  store.updateAppState.mockImplementation((id: string, update: Record<string, unknown>) => {
    const win = store.session.windows[id];
    win.appState = { ...win.appState, ...update };
  });
  api.getBrowserSession.mockReset().mockResolvedValue(live);
  for (const fn of [api.navigateBrowser, api.reloadBrowser, api.historyBrowser]) {
    fn.mockReset().mockResolvedValue({ ...live, navigationRevision: "9007199254740994" });
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(BrowserApp, { window: store.session.windows["window-1"] })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function action(kind: string) {
  await act(async () => {
    if (kind === "navigate") {
      container.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    } else {
      (container.querySelector(`[data-testid="browser-${kind}-btn"]`) as HTMLButtonElement).click();
    }
  });
}

describe("BrowserApp native-navigation CAS", () => {
  it.each(["navigate", "reload", "back", "forward"])("%s reads authority rather than the rendered revision", async (kind) => {
    await action(kind);
    const fn = kind === "navigate" ? api.navigateBrowser : kind === "reload" ? api.reloadBrowser : api.historyBrowser;
    expect(api.getBrowserSession).toHaveBeenCalledWith(owner, "session-1", expect.any(AbortSignal));
    expect(fn).toHaveBeenCalledExactlyOnceWith(owner, "session-1", {
      navigationRevision: "9007199254740993",
      ...(kind === "navigate" ? { url: live.url } : {}),
      ...(kind === "back" || kind === "forward" ? { direction: kind } : {}),
    }, expect.any(AbortSignal));
    expect(store.session.windows["window-1"].appState?.navigationRevision).toBe("9007199254740994");
  });

  it("refreshes a raced 409 without replaying history and exposes the failure", async () => {
    api.historyBrowser.mockRejectedValueOnce(new BrowserHostClientError("stale navigationRevision", "sessionConflict", 409));
    api.getBrowserSession.mockResolvedValueOnce(live).mockResolvedValueOnce({ ...live,
      navigationRevision: "9007199254740995", url: "https://example.test/native-link" });
    await action("back");
    expect(api.historyBrowser).toHaveBeenCalledTimes(1);
    expect(api.getBrowserSession).toHaveBeenCalledTimes(2);
    expect(store.session.windows["window-1"].appState?.url).toBe("https://example.test/native-link");
    expect(container.querySelector('[data-testid="browser-navigation-error"]')?.textContent).toContain("stale navigationRevision");
  });

  it("does not navigate a window whose session changed during the authority read", async () => {
    api.getBrowserSession.mockImplementationOnce(async () => {
      store.session.windows["window-1"].appState!.sessionId = "replacement-session";
      return live;
    });
    await action("reload");
    expect(api.reloadBrowser).not.toHaveBeenCalled();
  });

  it("does not dispatch a second action while the first authority read is pending", async () => {
    const { promise, resolve } = Promise.withResolvers<BrowserSessionDto>();
    api.getBrowserSession.mockReturnValueOnce(promise);
    await action("reload");
    await action("back");
    expect(api.getBrowserSession).toHaveBeenCalledTimes(1);
    await act(async () => resolve(live));
    expect(api.reloadBrowser).toHaveBeenCalledTimes(1);
    expect(api.historyBrowser).not.toHaveBeenCalled();
  });

  it("surfaces a superseded authority read without silently dropping or replaying intent", async () => {
    const { promise, resolve } = Promise.withResolvers<BrowserSessionDto>();
    api.getBrowserSession.mockReturnValueOnce(promise);
    await action("reload");
    store.session.windows["window-1"].appState!.navigationRevision = "9007199254740994";
    await act(async () => resolve(live));
    expect(api.reloadBrowser).not.toHaveBeenCalled();
    expect(api.getBrowserSession).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="browser-navigation-error"]')?.textContent).toContain("Page changed");
    expect(store.session.windows["window-1"].appState?.navigationRevision).toBe("9007199254740994");
  });

  it.each(["generation", "session"])("retires a hung old %s request and fences its finalizer", async (replacement) => {
    const oldRead = Promise.withResolvers<BrowserSessionDto>();
    const newRead = Promise.withResolvers<BrowserSessionDto>();
    api.getBrowserSession.mockReturnValueOnce(oldRead.promise);
    await action("reload");
    const oldSignal = api.getBrowserSession.mock.calls[0][2] as AbortSignal;
    const oldWindow = store.session.windows["window-1"];
    const replacementId = replacement === "session" ? "session-2" : "session-1";
    if (replacement === "generation") owner.generation = 2;
    store.session.windows = { "window-1": { ...oldWindow, appState: {
      ...oldWindow.appState, sessionId: replacementId,
    } } };
    await act(async () => root.render(createElement(BrowserApp, { window: store.session.windows["window-1"] })));
    expect(oldSignal.aborted).toBe(true);
    api.getBrowserSession.mockReturnValueOnce(newRead.promise);
    await action("back");
    expect(api.getBrowserSession).toHaveBeenCalledTimes(2);
    // Ignore abort deliberately: the retired fetch can still settle late.
    await act(async () => oldRead.resolve(live));
    expect(api.reloadBrowser).not.toHaveBeenCalled();
    await action("forward");
    expect(api.getBrowserSession).toHaveBeenCalledTimes(2);
    expect((container.querySelector('[data-testid="browser-reload-btn"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => newRead.resolve({ ...live, browserSessionId: replacementId }));
    expect(api.historyBrowser).toHaveBeenCalledExactlyOnceWith(owner, replacementId, {
      direction: "back", navigationRevision: live.navigationRevision,
    }, expect.any(AbortSignal));
    expect((container.querySelector('[data-testid="browser-reload-btn"]') as HTMLButtonElement).disabled).toBe(false);
  });
});
