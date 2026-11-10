// @vitest-environment jsdom
import { act, createElement, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OsWindow } from "./types.js";
import type { BrowserSessionDto, ServerControlEvent } from "@/api/browser-host-types.js";
import type * as BrowserHostClientModule from "@/api/browser-host-client.js";
import type { ViewerAttachmentCredentials } from "@/api/browser-host-client.js";
import type { StreamControllerOptions } from "@/browser-host/stream-controller.js";
import { BrowserHostClientError } from "@/api/browser-host-types.js";
import type { CanvasViewProps } from "@/browser-host/canvas-view.js";

const { owner, store, getSession, mintTickets, attach, streamState, acquireControl, releaseControl, controlSocket } = vi.hoisted(() => ({
  owner: { profileId: "profile-1", generation: 1 },
  store: { session: { windows: {} as Record<string, OsWindow> }, updateAppState: vi.fn() },
  getSession: vi.fn(), mintTickets: vi.fn(), attach: vi.fn(),
  streamState: {
    status: "connected",
    subscriptionEpoch: "subscription-1",
    suppressed: false,
    locked: false,
    onControlEvent: undefined as StreamControllerOptions["onControlEvent"],
    credentials: null as ViewerAttachmentCredentials | null,
  },
  acquireControl: vi.fn(), releaseControl: vi.fn(),
  controlSocket: { readyState: 1, bufferedAmount: 0, send: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn() },
}));
vi.mock("@/api/connections.js", () => ({
  isCurrentConnection: (captured: { profileId: string; generation: number }) =>
    captured.profileId === owner.profileId && captured.generation === owner.generation,
  getConnectionSnapshot: () => ({ owner, status: "connected" }),
  useConnectionSnapshot: () => ({ owner, status: "connected" }),
}));
vi.mock("./window-store.js", () => ({ useWindowStore: Object.assign(
  (selector: (state: typeof store) => unknown) => selector(store), { getState: () => store },
) }));
vi.mock("@/stores/cognito-mode.js", () => ({ useCognitoModeStore: Object.assign(
  () => streamState.suppressed, { getState: () => ({ active: streamState.suppressed }) },
) }));
vi.mock("@/stores/lock-screen.js", () => ({ useLockScreenStore: Object.assign(
  () => streamState.locked, { getState: () => ({ isLocked: streamState.locked }) },
) }));
vi.mock("../api/browser-host-client.js", async (original) => ({
  ...await original<typeof BrowserHostClientModule>(), getBrowserSession: getSession, mintViewerAttachmentTickets: mintTickets,
  acquireBrowserControl: acquireControl, releaseBrowserControl: releaseControl,
}));
vi.mock("../browser-host/canvas-view.js", () => ({
  CanvasView: ({ ref, children, ...props }: CanvasViewProps & { ref: Ref<HTMLCanvasElement>; children?: ReactNode }) =>
    createElement("div", null, createElement("canvas", {
      ref, width: 800, height: 600,
      onPointerDown: props.onCanvasPointerDown,
      onPointerUp: props.onCanvasPointerUp,
      onPointerMove: props.onCanvasPointerMove,
      onPointerCancel: props.onCanvasPointerCancel,
    }), children),
}));
vi.mock("../browser-host/stream-controller.js", () => ({
  BrowserStreamController: class {
    constructor(options: StreamControllerOptions) { streamState.onControlEvent = options.onControlEvent; }
    attach(credentials: ViewerAttachmentCredentials) {
      streamState.credentials = credentials;
      attach(credentials);
    }
    setPrivacyMode() {} setVisibility() {} dispose() {}
    getStatus() { return streamState.status; }
    getCurrentSubscriptionEpoch() { return streamState.subscriptionEpoch; }
    getControlSocket() { return controlSocket; }
    getDrawnRect() {
      return { drawX: 0, drawY: 0, drawWidth: 800, drawHeight: 600,
        imageWidth: 800, imageHeight: 600, geometry: snapshot.geometry,
        viewportEpoch: "2", inputTrusted: true };
    }
  },
}));
import {
  BrowserStreamKeepAliveHost,
  fenceBrowserViewsForProfile,
  clearBrowserViewFenceForProfile,
  registerBrowserStreamSlot,
  updateBrowserStreamSlot,
} from "./BrowserStreamKeepAliveHost.js";

const snapshot: BrowserSessionDto = {
  browserSessionId: "session-1", browserIncarnation: "live-runtime", profileEpoch: "2",
  navigationRevision: "4", viewportEpoch: "2", url: "https://example.test/initial",
  title: "Initial", status: "running", inputAvailable: true,
  geometry: { cssWidth: 800, cssHeight: 600, dpr: 1, offsetTop: 0, scrollX: 0, scrollY: 0,
    pageScale: 1, visualOffsetX: 0, visualOffsetY: 0 },
};
let root: Root;
let container: HTMLDivElement;
let slot: HTMLDivElement;
let unregister: () => void;
const render = async () => {
  await act(async () => root.render(createElement(BrowserStreamKeepAliveHost)));
};
const tick = async (ms = 500) => {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
};
const push = async (
  event: ServerControlEvent,
  credentials = streamState.credentials!,
) => {
  await act(async () => streamState.onControlEvent?.(event, credentials));
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  owner.generation = 1;
  streamState.status = "connected";
  streamState.subscriptionEpoch = "subscription-1";
  streamState.suppressed = false;
  streamState.locked = false;
  clearBrowserViewFenceForProfile(owner.profileId, owner.generation);
  controlSocket.readyState = WebSocket.OPEN;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 0, 800, 600));
  acquireControl.mockReset();
  releaseControl.mockReset().mockResolvedValue(undefined);
  getSession.mockReset().mockResolvedValue(snapshot);
  mintTickets.mockReset().mockImplementation(async (
    capturedOwner, browserSessionId, browserIncarnation, profileEpoch,
  ) => ({
    owner: { ...capturedOwner }, browserSessionId, browserIncarnation, profileEpoch,
    viewerId: "viewer-1", subscriptionEpoch: "subscription-1",
  }));
  store.session.windows = { "window-1": {
    id: "window-1", appId: "browser", title: "Browser", ctx: { profileId: owner.profileId },
    mode: "tile", desktopId: "desktop-1", maximized: false, minimized: false,
    appState: { sessionId: "session-1", url: snapshot.url, browserIncarnation: "persisted-runtime", profileEpoch: 1 },
  } };
  store.updateAppState.mockImplementation((id: string, update: Record<string, unknown>) => {
    const win = store.session.windows[id];
    store.session.windows = { ...store.session.windows, [id]: { ...win, appState: { ...win.appState, ...update } } };
  });
  container = document.createElement("div");
  slot = document.createElement("div");
  document.body.append(container, slot);
  unregister = registerBrowserStreamSlot("window-1", slot, true);
  root = createRoot(container);
  await render();
  // This store double is not reactive; publish hydrated runtime/viewer props.
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  unregister();
  container.remove(); slot.remove();
  vi.useRealTimers(); vi.restoreAllMocks();
});

describe("browser keepalive pushed session state", () => {
  it("consumes the new stream's initial snapshot idempotently", async () => {
    store.updateAppState.mockClear();
    await push({ kind: "sessionUpdated", session: snapshot });
    await push({ kind: "sessionUpdated", session: snapshot });
    expect(store.updateAppState).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("hydrates before tickets, applies native URL/title/geometry, and preserves the lease without HTTP polling", async () => {
    expect(mintTickets).toHaveBeenCalledExactlyOnceWith(owner, "session-1", "live-runtime", 2, expect.any(AbortSignal));
    store.session.windows["window-1"].appState = {
      ...store.session.windows["window-1"].appState, isController: true, leaseToken: "human-lease",
    };
    const next = { ...snapshot, navigationRevision: "5", viewportEpoch: "3",
      url: "https://example.test/link", title: "Native link",
      geometry: { ...snapshot.geometry, cssWidth: 1024 } };
    await push({ kind: "sessionUpdated", session: next });
    await render();
    await tick(30_000);
    expect(store.session.windows["window-1"].appState).toMatchObject({
      url: next.url, title: next.title, geometry: next.geometry, navigationRevision: "5",
      viewportEpoch: "3", isController: true, leaseToken: "human-lease",
    });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(mintTickets).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it.each(["closing", "lost", "closed"] as const)("retains the session and terminal %s reason without replacement or polling", async (status) => {
    await push({ kind: "sessionUpdated", session: { ...snapshot, status } });
    await render();
    await tick(30_000);
    expect(store.session.windows["window-1"].appState).toMatchObject({
      sessionId: "session-1", browserSessionStatus: status, inputAvailable: false,
      unsupportedReason: `Browser session is ${status}`, isController: false,
    });
    expect(store.session.windows["window-1"].appState?.leaseToken).toBeUndefined();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(mintTickets).toHaveBeenCalledTimes(1);
  });

  it("ignores a pushed snapshot after window removal", async () => {
    const credentials = streamState.credentials!;
    store.session.windows = {};
    await render();
    store.updateAppState.mockClear();
    await push({ kind: "sessionUpdated", session: snapshot }, credentials);
    expect(store.updateAppState).not.toHaveBeenCalled();
  });

  it("rejects retired owner, session, and runtime snapshots after rebinding", async () => {
    const retired = streamState.credentials!;
    owner.generation = 2;
    await render();
    store.updateAppState.mockClear();
    await push({ kind: "sessionUpdated", session: { ...snapshot, url: "https://example.test/retired" } }, retired);
    expect(store.updateAppState).not.toHaveBeenCalled();
    await push({ kind: "sessionUpdated", session: { ...snapshot, browserSessionId: "other-session" } });
    await push({ kind: "sessionUpdated", session: { ...snapshot, browserIncarnation: "other-runtime" } });
    expect(store.updateAppState).not.toHaveBeenCalled();
    await push({ kind: "sessionUpdated", session: { ...snapshot, url: "https://example.test/current" } });
    expect(store.session.windows["window-1"].appState?.url).toBe("https://example.test/current");
  });

  it("keeps a missing bootstrap session visible instead of creating another", async () => {
    getSession.mockRejectedValueOnce(new BrowserHostClientError("missing", "sessionNotFound", 404));
    owner.generation = 2;
    await render();
    await tick(30_000);
    expect(store.session.windows["window-1"].appState).toMatchObject({
      sessionId: "session-1", unsupportedReason: "Browser session no longer exists on this host",
      inputAvailable: false,
    });
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(mintTickets).toHaveBeenCalledTimes(1);
  });

  it("refreshes restore authority before tickets, then consumes the new stream's initial snapshot", async () => {
    const parkedCanvas = slot.querySelector("canvas");
    await act(async () => updateBrowserStreamSlot("window-1", slot, false));
    const pending = Promise.withResolvers<BrowserSessionDto>();
    getSession.mockReturnValueOnce(pending.promise);
    await act(async () => updateBrowserStreamSlot("window-1", slot, true));
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(mintTickets).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ...snapshot, navigationRevision: "5" }));
    expect(mintTickets).toHaveBeenCalledTimes(2);
    await push({ kind: "sessionUpdated", session: {
      ...snapshot, navigationRevision: "6", url: "https://example.test/restored",
    } });
    expect(store.session.windows["window-1"].appState?.navigationRevision).toBe("6");
    expect(store.session.windows["window-1"].appState?.url).toBe("https://example.test/restored");
    expect(slot.querySelector("canvas")).toBe(parkedCanvas);
    await tick(30_000);
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(attach).toHaveBeenCalledTimes(2);
  });
});

const clickCanvas = () => {
  const canvas = slot.querySelector("canvas")!;
  canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 400, clientY: 300, button: 0, bubbles: true }));
  canvas.dispatchEvent(new MouseEvent("pointerup", { clientX: 400, clientY: 300, button: 0, bubbles: true }));
};

const typeText = (text: string) => {
  const proxy = slot.querySelector("textarea")!;
  proxy.value = text;
  proxy.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
};

const sentInput = () => controlSocket.send.mock.calls.map(([message]) => JSON.parse(message));

describe("browser first pointer gesture control handoff", () => {
  it("retains immediate text and editing keys behind the deferred focusing click", async () => {
    const lease = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
    acquireControl.mockReturnValueOnce(lease.promise);
    await act(async () => {
      clickCanvas();
      expect(document.activeElement).toBe(slot.querySelector("textarea"));
      typeText("surviving");
      const proxy = slot.querySelector("textarea")!;
      proxy.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", code: "Backspace", bubbles: true, cancelable: true }));
      proxy.dispatchEvent(new KeyboardEvent("keyup", { key: "Backspace", code: "Backspace", bubbles: true }));
      typeText("-target");
    });
    expect(controlSocket.send).not.toHaveBeenCalled();
    await act(async () => lease.resolve({ leaseToken: "human-lease", expiresAtUnixMs: Date.now() + 30_000 }));
    await act(async () => vi.runAllTimersAsync());
    expect(sentInput().map(message => message.event)).toEqual([
      { kind: "pointerDown", button: "left", u: 0.5, v: 0.5, modifiers: 0 },
      { kind: "pointerUp", button: "left", u: 0.5, v: 0.5, modifiers: 0 },
      { kind: "insertText", text: "surviving" },
      { kind: "keyDown", key: "Backspace", code: "Backspace", modifiers: 0 },
      { kind: "keyUp", key: "Backspace", code: "Backspace", modifiers: 0 },
      { kind: "insertText", text: "-target" },
    ]);
    expect(sentInput().map(message => message.inputSeq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it.each(["privacy", "lock", "fence"] as const)("rejects a %s publication before React commits a new render", async (mode) => {
    if (mode === "privacy") streamState.suppressed = true;
    if (mode === "lock") streamState.locked = true;
    if (mode === "fence") fenceBrowserViewsForProfile(owner.profileId, "same-turn fence", owner.generation);
    await act(async () => clickCanvas());
    expect(acquireControl).not.toHaveBeenCalled();
    expect(controlSocket.send).not.toHaveBeenCalled();
  });

  it.each(["privacy", "lock", "fence"] as const)("cancels the paced tail on %s without waiting for a React commit", async (mode) => {
    const lease = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
    acquireControl.mockReturnValueOnce(lease.promise);
    await act(async () => { clickCanvas(); typeText("first"); typeText("private-tail"); });
    await act(async () => lease.resolve({ leaseToken: "human-lease", expiresAtUnixMs: Date.now() + 30_000 }));
    expect(sentInput().filter(message => message.event.kind === "insertText").map(message => message.event.text)).toEqual(["first"]);
    if (mode === "privacy") streamState.suppressed = true;
    if (mode === "lock") streamState.locked = true;
    if (mode === "fence") fenceBrowserViewsForProfile(owner.profileId, "same-turn fence", owner.generation);
    await act(async () => {
      await vi.runAllTimersAsync();
      typeText("after-cancellation-before-render");
    });
    expect(sentInput().filter(message => message.event.kind === "insertText").map(message => message.event.text)).toEqual(["first"]);
  });

  it("cancels the old paced tail before a new click can focus another remote field", async () => {
    const lease = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
    acquireControl.mockReturnValueOnce(lease.promise);
    await act(async () => { clickCanvas(); typeText("first"); typeText("old-field-tail"); });
    await act(async () => lease.resolve({ leaseToken: "human-lease", expiresAtUnixMs: Date.now() + 30_000 }));
    await act(async () => { clickCanvas(); typeText("new-field-text"); });
    await act(async () => vi.runAllTimersAsync());
    expect(sentInput().filter(message => message.event.kind === "insertText").map(message => message.event.text))
      .toEqual(["first", "new-field-text"]);
  });

  it.each(["blur", "window-blur", "privacy", "lock", "fence", "navigation", "runtime", "subscription", "socket", "cancel", "failed", "dispose"] as const)(
    "does not leak typeahead after %s cancels the acquisition", async (change) => {
      const lease = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
      acquireControl.mockReturnValueOnce(lease.promise);
      await act(async () => { clickCanvas(); typeText("private-before-cancel"); });
      await act(async () => {
        if (change === "blur") slot.querySelector("textarea")!.blur();
        if (change === "window-blur") window.dispatchEvent(new Event("blur"));
        if (change === "privacy") { streamState.suppressed = true; await render(); }
        if (change === "lock") { streamState.locked = true; await render(); }
        if (change === "fence") fenceBrowserViewsForProfile(owner.profileId, "same-turn fence", owner.generation);
        if (change === "navigation" || change === "runtime") {
          store.updateAppState("window-1", change === "navigation"
            ? { navigationRevision: "5" } : { browserIncarnation: "replacement-runtime" });
          await render();
        }
        if (change === "subscription") streamState.subscriptionEpoch = "replacement-subscription";
        if (change === "socket") controlSocket.addEventListener.mock.calls[0][1](new Event("close"));
        if (change === "cancel") slot.querySelector("canvas")!.dispatchEvent(new MouseEvent("pointercancel", { bubbles: true }));
        if (change === "dispose") { store.session.windows = {}; await render(); }
        if (change === "failed") lease.reject(new BrowserHostClientError("held", "leaseConflict", 409));
        else lease.resolve({ leaseToken: "unused-lease", expiresAtUnixMs: Date.now() + 30_000 });
      });
      expect(controlSocket.send).not.toHaveBeenCalled();
      if (change === "failed") expect(slot.textContent).toContain("Browser control is held by another viewer");
      else expect(releaseControl).toHaveBeenCalledExactlyOnceWith(owner, "session-1", { leaseToken: "unused-lease" });
    },
  );

  it("does not replay a cancelled gesture into a later successful click", async () => {
    const retired = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
    acquireControl.mockReturnValueOnce(retired.promise);
    await act(async () => { clickCanvas(); typeText("discard-me"); slot.querySelector("textarea")!.blur(); });
    const current = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
    acquireControl.mockReturnValueOnce(current.promise);
    await act(async () => { clickCanvas(); typeText("keep-me"); });
    await act(async () => retired.resolve({ leaseToken: "retired", expiresAtUnixMs: Date.now() + 30_000 }));
    expect(controlSocket.send).not.toHaveBeenCalled();
    await act(async () => current.resolve({ leaseToken: "current", expiresAtUnixMs: Date.now() + 30_000 }));
    expect(sentInput().map(message => message.event.kind)).toEqual(["pointerDown", "pointerUp", "insertText"]);
    expect(sentInput()[2].event.text).toBe("keep-me");
  });

  it("delivers a complete first click after asynchronous lease acquisition", async () => {
    const lease = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
    acquireControl.mockReturnValueOnce(lease.promise);
    const canvas = slot.querySelector("canvas")!;
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 400, clientY: 300, button: 0, bubbles: true }));
      canvas.dispatchEvent(new MouseEvent("pointerup", { clientX: 400, clientY: 300, button: 0, bubbles: true }));
    });
    expect(controlSocket.send).not.toHaveBeenCalled();
    await act(async () => lease.resolve({ leaseToken: "human-lease", expiresAtUnixMs: Date.now() + 30_000 }));
    const sent = controlSocket.send.mock.calls.map(([message]) => JSON.parse(message));
    expect(sent.map((message) => message.event)).toEqual([
      { kind: "pointerDown", button: "left", u: 0.5, v: 0.5, modifiers: 0 },
      { kind: "pointerUp", button: "left", u: 0.5, v: 0.5, modifiers: 0 },
    ]);
    expect(sent.map((message) => message.inputSeq)).toEqual([1, 2]);
  });

  it.each(["hidden", "navigation", "session"])("discards a pending click after %s changes", async (change) => {
    const lease = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
    acquireControl.mockReturnValueOnce(lease.promise);
    const canvas = slot.querySelector("canvas")!;
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 400, clientY: 300, button: 0, bubbles: true }));
      if (change === "hidden") {
        updateBrowserStreamSlot("window-1", slot, false);
      } else {
        const win = store.session.windows["window-1"];
        win.appState = { ...win.appState, ...(change === "navigation"
          ? { navigationRevision: "5" } : { sessionId: "replacement-session" }) };
        await render();
      }
    });
    await act(async () => lease.resolve({ leaseToken: "abandoned-lease", expiresAtUnixMs: Date.now() + 30_000 }));
    expect(controlSocket.send).not.toHaveBeenCalled();
    expect(store.session.windows["window-1"].appState?.isController).not.toBe(true);
    expect(releaseControl).toHaveBeenCalledExactlyOnceWith(owner, "session-1", { leaseToken: "abandoned-lease" });
  });

  it("allows replacement-generation clicks while an old acquisition is still pending", async () => {
    const retired = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
    acquireControl.mockReturnValueOnce(retired.promise);
    const canvas = slot.querySelector("canvas")!;
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 400, clientY: 300, button: 0, bubbles: true }));
    });
    owner.generation = 2;
    await render();
    acquireControl.mockResolvedValueOnce({ leaseToken: "new-lease", expiresAtUnixMs: Date.now() + 30_000 });
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 400, clientY: 300, button: 0, bubbles: true }));
      canvas.dispatchEvent(new MouseEvent("pointerup", { clientX: 400, clientY: 300, button: 0, bubbles: true }));
    });
    expect(controlSocket.send.mock.calls.map(([message]) => JSON.parse(message).event.kind))
      .toEqual(["pointerDown", "pointerUp"]);
    await act(async () => retired.resolve({ leaseToken: "old-lease", expiresAtUnixMs: Date.now() + 30_000 }));
    expect(store.session.windows["window-1"].appState?.leaseToken).toBe("new-lease");
    expect(controlSocket.send.mock.calls.map(([message]) => JSON.parse(message).event.kind))
      .toEqual(["pointerDown", "pointerUp"]);
  });
});
