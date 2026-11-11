// @vitest-environment jsdom
import { act, createElement, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OsWindow } from "./types.js";
import type { BrowserAudioChunk, BrowserSessionDto, ServerControlEvent } from "@/api/browser-host-types.js";
import type * as BrowserHostClientModule from "@/api/browser-host-client.js";
import type { ViewerAttachmentCredentials } from "@/api/browser-host-client.js";
import type { StreamControllerOptions } from "@/browser-host/stream-controller.js";
import { BrowserHostClientError } from "@/api/browser-host-types.js";
import type { CanvasViewProps } from "@/browser-host/canvas-view.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import { addClosingGate, clearClosingGatesForTesting } from "./browser/browser-closing-gates.js";
import { clearPopupTabStateForTesting } from "./browser/browser-popup-tabs.js";
import { createBrowserNativeTargetKey } from "./browser/browser-owner-scope.js";
import { isOwnerAddressSuppressed, saveBrowserRecoveryDisk } from "./browser/browser-recovery-store.js";
import {
  browserTabSlotKey,
  createBlankBrowserTab,
  createInitialBrowserWindowState,
  findBrowserTab,
  patchBrowserTab,
} from "./browser/browser-tab-state.js";
import type { BrowserOwnerScope, BrowserWindowState } from "./browser/browser-tab-types.js";

interface ControllerMockInstance {
  options: StreamControllerOptions;
  credentials: ViewerAttachmentCredentials | null;
  status: string;
  subscriptionEpoch: string;
  visible: boolean;
  privacy: boolean;
  disposed: boolean;
  setVisibilityCalls: boolean[];
  resetAudioAuthority: (minDocEpoch?: string | number | bigint) => void;
}

const {
  owner,
  owner2,
  scope1,
  scope2,
  snapshots,
  store,
  getSession,
  createSession,
  closeSession,
  respondDialog,
  mintTickets,
  attach,
  callOrder,
  controllers,
  streamState,
  acquireControl,
  releaseControl,
  controlSocket,
  pcmPlayerMocks,
  storeListeners,
  cognitoListeners,
  lockListeners,
  connListeners,
} = vi.hoisted(() => {
  const o1 = { profileId: "profile-1", generation: 1 };
  const o2 = { profileId: "profile-2", generation: 1 };
  const s1: BrowserOwnerScope = {
    profileId: "profile-1",
    endpoint: "https://host.example.test",
    principal: "alice",
    namespace: "prod",
  };
  const s2: BrowserOwnerScope = {
    profileId: "profile-2",
    endpoint: "https://host.example.test",
    principal: "alice",
    namespace: "prod",
  };
  return {
    owner: o1,
    owner2: o2,
    scope1: s1,
    scope2: s2,
    snapshots: new Map<string, ConnectionSnapshot>(),
    store: {
      session: { windows: {} as Record<string, OsWindow> },
      updateAppState: vi.fn(),
    },
    getSession: vi.fn(),
    createSession: vi.fn(),
    closeSession: vi.fn(),
    respondDialog: vi.fn(),
    mintTickets: vi.fn(),
    attach: vi.fn(),
    callOrder: [] as string[],
    controllers: [] as ControllerMockInstance[],
    streamState: {
      status: "connected",
      subscriptionEpoch: "subscription-1",
      suppressed: false,
      locked: false,
      onControlEvent: undefined as StreamControllerOptions["onControlEvent"],
      onAudioChunk: undefined as StreamControllerOptions["onAudioChunk"],
      onAudioReset: undefined as StreamControllerOptions["onAudioReset"],
      resetAudioAuthority: vi.fn(),
      credentials: null as ViewerAttachmentCredentials | null,
    },
    acquireControl: vi.fn(),
    releaseControl: vi.fn(),
    controlSocket: {
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    pcmPlayerMocks: {
      prime: vi.fn(),
      enqueue: vi.fn(),
      flush: vi.fn(),
      dispose: vi.fn(),
    },
    storeListeners: new Set<() => void>(),
    cognitoListeners: new Set<() => void>(),
    lockListeners: new Set<() => void>(),
    connListeners: new Set<() => void>(),
  };
});

vi.mock("@/api/connections.js", () => ({
  isCurrentConnection: (captured: { profileId: string; generation: number }) => {
    const snap = snapshots.get(captured.profileId);
    return Boolean(
      snap &&
        snap.status === "connected" &&
        snap.owner.profileId === captured.profileId &&
        snap.owner.generation === captured.generation,
    );
  },
  getConnectionSnapshot: (profileId: string) => snapshots.get(profileId),
  useConnectionSnapshot: (profileId: string) => snapshots.get(profileId),
  subscribeConnections: (fn: () => void) => {
    connListeners.add(fn);
    return () => connListeners.delete(fn);
  },
}));
vi.mock("./window-store.js", () => ({
  useWindowStore: Object.assign(
    (selector: (state: typeof store) => unknown) => selector(store),
    {
      getState: () => store,
      subscribe: (fn: () => void) => {
        storeListeners.add(fn);
        return () => storeListeners.delete(fn);
      },
    },
  ),
}));
vi.mock("@/stores/cognito-mode.js", () => ({
  useCognitoModeStore: Object.assign(() => streamState.suppressed, {
    getState: () => ({ active: streamState.suppressed }),
    subscribe: (fn: () => void) => {
      cognitoListeners.add(fn);
      return () => cognitoListeners.delete(fn);
    },
  }),
}));
vi.mock("@/stores/lock-screen.js", () => ({
  useLockScreenStore: Object.assign(() => streamState.locked, {
    getState: () => ({ isLocked: streamState.locked }),
    subscribe: (fn: () => void) => {
      lockListeners.add(fn);
      return () => lockListeners.delete(fn);
    },
  }),
}));
vi.mock("../api/browser-host-client.js", async (original) => ({
  ...(await original<typeof BrowserHostClientModule>()),
  getBrowserSession: getSession,
  createBrowserSession: createSession,
  closeBrowserSession: closeSession,
  respondBrowserDialog: respondDialog,
  mintViewerAttachmentTickets: mintTickets,
  acquireBrowserControl: acquireControl,
  releaseBrowserControl: releaseControl,
}));
vi.mock("@/api/browser-host-client.js", async (original) => ({
  ...(await original<typeof BrowserHostClientModule>()),
  getBrowserSession: getSession,
  createBrowserSession: createSession,
  closeBrowserSession: closeSession,
  respondBrowserDialog: respondDialog,
  mintViewerAttachmentTickets: mintTickets,
  acquireBrowserControl: acquireControl,
  releaseBrowserControl: releaseControl,
}));
vi.mock("../browser-host/canvas-view.js", () => ({
  CanvasView: ({
    ref,
    children,
    ...props
  }: CanvasViewProps & { ref: Ref<HTMLCanvasElement>; children?: ReactNode }) =>
    createElement(
      "div",
      null,
      createElement("canvas", {
        ref,
        width: 800,
        height: 600,
        onPointerDown: props.onCanvasPointerDown,
        onPointerUp: props.onCanvasPointerUp,
        onPointerMove: props.onCanvasPointerMove,
        onPointerCancel: props.onCanvasPointerCancel,
      }),
      children,
    ),
}));
vi.mock("../browser-host/pcm-player.js", () => ({
  PcmPlayer: class {
    prime() {
      pcmPlayerMocks.prime();
    }
    enqueue(data: string) {
      pcmPlayerMocks.enqueue(data);
    }
    flush() {
      pcmPlayerMocks.flush();
    }
    dispose() {
      pcmPlayerMocks.dispose();
    }
  },
}));
vi.mock("../browser-host/stream-controller.js", () => ({
  BrowserStreamController: class {
    instance: ControllerMockInstance;
    constructor(options: StreamControllerOptions) {
      this.instance = {
        options,
        credentials: null,
        status: streamState.status,
        subscriptionEpoch: streamState.subscriptionEpoch,
        visible: false,
        privacy: false,
        disposed: false,
        setVisibilityCalls: [],
        resetAudioAuthority: streamState.resetAudioAuthority,
      };
      controllers.push(this.instance);
      streamState.onControlEvent = options.onControlEvent;
      streamState.onAudioChunk = options.onAudioChunk;
      streamState.onAudioReset = options.onAudioReset;
    }
    attach(credentials: ViewerAttachmentCredentials) {
      this.instance.credentials = credentials;
      this.instance.subscriptionEpoch = credentials.subscriptionEpoch;
      streamState.credentials = credentials;
      streamState.onControlEvent = this.instance.options.onControlEvent;
      streamState.onAudioChunk = this.instance.options.onAudioChunk;
      streamState.onAudioReset = this.instance.options.onAudioReset;
      callOrder.push(`attach:${credentials.browserSessionId}`);
      attach(credentials);
    }
    setPrivacyMode(active: boolean) {
      this.instance.privacy = active;
    }
    setVisibility(visible: boolean) {
      if (this.instance.visible && !visible && this.instance.credentials) {
        callOrder.push(`close-sockets:${this.instance.credentials.browserSessionId}`);
        this.instance.credentials = null;
      }
      this.instance.visible = visible;
      this.instance.setVisibilityCalls.push(visible);
    }
    dispose() {
      this.instance.disposed = true;
    }
    resetAudioAuthority(minDocEpoch?: string | number | bigint) {
      this.instance.resetAudioAuthority(minDocEpoch);
    }
    getStatus() {
      return streamState.status;
    }
    getCurrentSubscriptionEpoch() {
      return this.instance.credentials?.subscriptionEpoch ?? streamState.subscriptionEpoch;
    }
    getControlSocket() {
      return controlSocket;
    }
    getDrawnRect() {
      return {
        drawX: 0,
        drawY: 0,
        drawWidth: 800,
        drawHeight: 600,
        imageWidth: 800,
        imageHeight: 600,
        geometry: snapshot.geometry,
        viewportEpoch: "2",
        inputTrusted: true,
      };
    }
  },
}));

import {
  BrowserStreamKeepAliveHost,
  fenceBrowserViewsForProfile,
  clearBrowserViewFenceForProfile,
  registerBrowserStreamSlot,
  requestBrowserAudioUnlock,
  requestBrowserProxyFocus,
  updateBrowserStreamSlot,
} from "./BrowserStreamKeepAliveHost.js";
import { countRetainedNativeReferences } from "./browser/browser-native-reference-census.js";

const snapshot: BrowserSessionDto = {
  browserSessionId: "session-1",
  browserIncarnation: "live-runtime",
  profileEpoch: "2",
  navigationRevision: "4",
  viewportEpoch: "2",
  url: "https://example.test/initial",
  title: "Initial",
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

function readAppState(windowId = "window-1"): BrowserWindowState {
  return store.session.windows[windowId]!.appState as unknown as BrowserWindowState;
}

function readTab(tabId = "tab-1", windowId = "window-1") {
  return findBrowserTab(readAppState(windowId), tabId)!;
}

function patchTabInTest(
  tabId: string,
  patch: Record<string, unknown>,
  windowId = "window-1",
) {
  const next = patchBrowserTab(readAppState(windowId), tabId, patch);
  store.updateAppState(windowId, next as unknown as Record<string, unknown>);
}

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
  localStorage.clear();
  clearClosingGatesForTesting();
  clearPopupTabStateForTesting();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_name: string, _opts: unknown, callback: () => Promise<unknown>) =>
        callback(),
    },
  });
  controllers.length = 0;
  owner.generation = 1;
  owner2.generation = 1;
  streamState.status = "connected";
  streamState.subscriptionEpoch = "subscription-1";
  streamState.suppressed = false;
  streamState.locked = false;
  snapshots.clear();
  snapshots.set("profile-1", {
    owner,
    status: "connected",
    serverUrl: scope1.endpoint,
    verifiedBrowserIdentity: { principal: scope1.principal, namespace: scope1.namespace },
  } as ConnectionSnapshot);
  snapshots.set("profile-2", {
    owner: owner2,
    status: "connected",
    serverUrl: scope2.endpoint,
    verifiedBrowserIdentity: { principal: scope2.principal, namespace: scope2.namespace },
  } as ConnectionSnapshot);

  clearBrowserViewFenceForProfile(owner.profileId, owner.generation);
  controlSocket.readyState = WebSocket.OPEN;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 800, 600),
  );
  acquireControl.mockReset();
  releaseControl.mockReset().mockResolvedValue(undefined);
  createSession.mockReset();
  closeSession.mockReset().mockResolvedValue(undefined);
  respondDialog.mockReset().mockResolvedValue(undefined);
  getSession.mockReset().mockResolvedValue(snapshot);
  mintTickets.mockReset().mockImplementation(
    async (capturedOwner, browserSessionId, browserIncarnation, profileEpoch) => {
      callOrder.push(`mint:${capturedOwner.profileId}:${browserSessionId}`);
      return {
        owner: { ...capturedOwner },
        browserSessionId,
        browserIncarnation,
        profileEpoch,
        viewerId: `viewer-${capturedOwner.profileId}-${browserSessionId}`,
        subscriptionEpoch: "subscription-1",
      };
    },
  );

  const tab1 = {
    ...createBlankBrowserTab({ tabId: "tab-1", draftValue: snapshot.url, dirty: false }),
    committedUrl: snapshot.url,
    sessionId: "session-1",
    phase: "connecting" as const,
    snapshot: { ...snapshot, browserIncarnation: "persisted-runtime", profileEpoch: "1" },
  };
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
      appState: createInitialBrowserWindowState({
        ownerScope: scope1,
        tabs: [tab1],
        activeTabId: "tab-1",
      }) as unknown as Record<string, unknown>,
    },
  };
  store.updateAppState.mockImplementation((id: string, update: Record<string, unknown>) => {
    const win = store.session.windows[id];
    if (!win) return;
    store.session.windows = {
      ...store.session.windows,
      [id]: { ...win, appState: { ...win.appState, ...update } },
    };
    storeListeners.forEach((fn) => fn());
  });

  container = document.createElement("div");
  slot = document.createElement("div");
  document.body.append(container, slot);
  unregister = registerBrowserStreamSlot("window-1", "tab-1", slot, true);
  root = createRoot(container);
  await render();
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  unregister();
  container.remove();
  slot.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("browser keepalive pushed session state & tab-scoped resources", () => {
  it("consumes the new stream's initial snapshot idempotently without resetting suppression", async () => {
    saveBrowserRecoveryDisk({
      version: 1,
      groups: [],
      addressSuppressedScopes: [scope1],
      operations: [],
    });
    store.updateAppState.mockClear();
    await push({ kind: "sessionUpdated", session: snapshot });
    await push({ kind: "sessionUpdated", session: snapshot });
    expect(store.updateAppState).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(isOwnerAddressSuppressed(scope1)).toBe(true);
  });

  it("hydrates before tickets, applies native URL/title/geometry/u64 revisions, and preserves lease without polling", async () => {
    expect(mintTickets).toHaveBeenCalledExactlyOnceWith(
      owner,
      "session-1",
      "live-runtime",
      2,
      expect.any(AbortSignal),
    );
    patchTabInTest("tab-1", { isController: true, leaseToken: "human-lease" });
    const next: BrowserSessionDto = {
      ...snapshot,
      navigationRevision: "9007199254740999",
      viewportEpoch: "3",
      url: "https://example.test/link",
      title: "Native link",
      geometry: { ...snapshot.geometry, cssWidth: 1024 },
    };
    await push({ kind: "sessionUpdated", session: next });
    await render();
    await tick(30_000);
    const t1 = readTab("tab-1");
    expect(t1.committedUrl).toBe(next.url);
    expect(t1.title).toBe(next.title);
    expect(t1.snapshot?.geometry).toEqual(next.geometry);
    expect(t1.snapshot?.navigationRevision).toBe("9007199254740999");
    expect(t1.snapshot?.viewportEpoch).toBe("3");
    expect(t1.isController).toBe(true);
    expect(t1.leaseToken).toBe("human-lease");
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(mintTickets).toHaveBeenCalledTimes(1);
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it.each(["closing", "lost", "closed"] as const)(
    "retains the session and terminal %s reason on the tab, synchronously retires sockets, and never polls",
    async (status) => {
      expect(controllers[0]?.visible).toBe(true);
      expect(controllers[0]?.credentials).not.toBeNull();
      await push({ kind: "sessionUpdated", session: { ...snapshot, status } });
      expect(controllers[0]?.visible).toBe(false);
      expect(controllers[0]?.credentials).toBeNull();
      await render();
      await tick(30_000);
      const t1 = readTab("tab-1");
      expect(t1).toMatchObject({
        sessionId: "session-1",
        phase: "unavailable",
        unsupportedReason: `Browser session is ${status}`,
        isController: false,
      });
      expect(t1.leaseToken).toBeUndefined();
      expect(getSession).toHaveBeenCalledTimes(1);
      expect(mintTickets).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps missing bootstrap session visible and never auto-creates URL-only or blank tabs", async () => {
    const blankTab = createBlankBrowserTab({ tabId: "tab-blank" });
    const deferredTab = {
      ...createBlankBrowserTab({ tabId: "tab-deferred", draftValue: "https://example.test/deferred" }),
      committedUrl: "https://example.test/deferred",
      phase: "deferred" as const,
    };
    const app = readAppState();
    store.updateAppState("window-1", {
      ...app,
      tabs: [...app.tabs, blankTab, deferredTab],
    } as unknown as Record<string, unknown>);

    getSession.mockRejectedValueOnce(
      new BrowserHostClientError("missing", "sessionNotFound", 404),
    );
    owner.generation = 2;
    snapshots.set("profile-1", {
      ...snapshots.get("profile-1")!,
      owner: { profileId: "profile-1", generation: 2 },
    });
    await render();
    await tick(30_000);
    expect(readTab("tab-1")).toMatchObject({
      sessionId: "session-1",
      phase: "unavailable",
      unsupportedReason: "Browser session no longer exists on this host",
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalledTimes(2);
    expect(mintTickets).toHaveBeenCalledTimes(1);
  });

  it("retains stable canvas/controller refs across placement and tab switches, closing outgoing sockets before incoming tickets", async () => {
    const snap2: BrowserSessionDto = {
      ...snapshot,
      browserSessionId: "session-2",
      url: snapshot.url, // Same URL, distinct target!
      title: "Second Target Same URL",
    };
    getSession.mockImplementation(async (_owner, id: string) =>
      id === "session-2" ? snap2 : snapshot,
    );

    const tab2 = {
      ...createBlankBrowserTab({ tabId: "tab-2", draftValue: snap2.url, dirty: false }),
      committedUrl: snap2.url,
      sessionId: "session-2",
      phase: "connecting" as const,
      snapshot: snap2,
    };
    const app = readAppState();
    store.updateAppState("window-1", {
      ...app,
      tabs: [...app.tabs, tab2],
      activeTabId: "tab-1",
    } as unknown as Record<string, unknown>);
    const slot2 = document.createElement("div");
    document.body.append(slot2);
    const unreg2 = registerBrowserStreamSlot("window-1", "tab-2", slot2, true);
    await render();

    // Inactive tab-2 has zero getSession/mintTickets calls while tab-1 is active
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(mintTickets).toHaveBeenCalledTimes(1);
    const canvas1 = slot.querySelector("canvas");
    const proxy1 = slot.querySelector("textarea");
    const ctrl1 = controllers[0]!;
    const ctrl2 = controllers[1]!;
    expect(canvas1).toBeInstanceOf(HTMLCanvasElement);
    expect(proxy1).toBeInstanceOf(HTMLTextAreaElement);
    expect(controllers).toHaveLength(2);

    // Placement transitions (tile -> float -> maximize) preserve exact canvas, proxy, and controller refs
    store.session.windows = {
      ...store.session.windows,
      "window-1": {
        ...store.session.windows["window-1"]!,
        mode: "float",
        maximized: true,
      },
    };
    await render();
    expect(slot.querySelector("canvas")).toBe(canvas1);
    expect(slot.querySelector("textarea")).toBe(proxy1);
    expect(controllers[0]).toBe(ctrl1);

    // Switch active tab from tab-1 to tab-2 while tab-1 holds a lease
    patchTabInTest("tab-1", { isController: true, leaseToken: "lease-tab-1" });
    callOrder.length = 0;
    await act(async () => {
      const cur = readAppState();
      store.updateAppState("window-1", {
        ...cur,
        activeTabId: "tab-2",
      } as unknown as Record<string, unknown>);
      await render();
    });
    await render();

    // Outgoing tab-1 sockets closed synchronously BEFORE incoming tab-2 tickets minted!
    expect(callOrder).toEqual([
      "close-sockets:session-1",
      "mint:profile-1:session-2",
      "attach:session-2",
    ]);
    expect(releaseControl).toHaveBeenCalledWith(owner, "session-1", {
      leaseToken: "lease-tab-1",
    });
    expect(readTab("tab-1").isController).toBe(false);
    expect(slot2.querySelector("canvas")).toBeInstanceOf(HTMLCanvasElement);

    // Switch back to tab-1: reuses exact same canvas and controller instances without native reload/create
    await act(async () => {
      const cur = readAppState();
      store.updateAppState("window-1", {
        ...cur,
        activeTabId: "tab-1",
      } as unknown as Record<string, unknown>);
      await render();
    });
    await render();
    expect(slot.querySelector("canvas")).toBe(canvas1);
    expect(slot.querySelector("textarea")).toBe(proxy1);
    expect(controllers[0]).toBe(ctrl1);
    expect(controllers[1]).toBe(ctrl2);
    expect(createSession).not.toHaveBeenCalled();

    unreg2();
    slot2.remove();
  });

  it("shares native target across two profile IDs with independent credentials and blocks attachment when closing gate is active", async () => {
    const sharedTabP2 = {
      ...createBlankBrowserTab({ tabId: "tab-p2-active", draftValue: snapshot.url }),
      committedUrl: snapshot.url,
      sessionId: "session-1",
      phase: "connecting" as const,
      snapshot,
    };
    const hiddenTabP2 = {
      ...createBlankBrowserTab({ tabId: "tab-p2-hidden", draftValue: snapshot.url }),
      committedUrl: snapshot.url,
      sessionId: "session-1",
      phase: "live" as const,
      snapshot,
    };
    store.session.windows = {
      ...store.session.windows,
      "window-2": {
        id: "window-2",
        appId: "browser",
        title: "Browser P2",
        ctx: { profileId: "profile-2" },
        mode: "float",
        desktopId: "desktop-1",
        maximized: false,
        minimized: false,
        appState: createInitialBrowserWindowState({
          ownerScope: scope2,
          tabs: [sharedTabP2, hiddenTabP2],
          activeTabId: "tab-p2-active",
        }) as unknown as Record<string, unknown>,
      },
    };
    const slotP2 = document.createElement("div");
    document.body.append(slotP2);
    const unregP2 = registerBrowserStreamSlot("window-2", "tab-p2-active", slotP2, true);
    await render();
    await render();

    // Profile 2 mints tickets with owner2 (never borrowing owner1's credentials); hidden view stays unattached
    expect(mintTickets).toHaveBeenCalledTimes(2);
    expect(mintTickets).toHaveBeenLastCalledWith(
      owner2,
      "session-1",
      "live-runtime",
      2,
      expect.any(AbortSignal),
    );
    // All 3 references (window-1/tab-1, window-2/tab-p2-active, window-2/tab-p2-hidden) counted across profiles
    const nativeKey = createBrowserNativeTargetKey(scope1, "session-1")!;
    expect(countRetainedNativeReferences(nativeKey)).toBe(3);

    // Activate closing gate via profile-1: blocks new ticket attachment on profile-2
    addClosingGate(nativeKey);
    mintTickets.mockClear();
    owner2.generation = 2;
    snapshots.set("profile-2", {
      ...snapshots.get("profile-2")!,
      owner: { profileId: "profile-2", generation: 2 },
    });
    await render();
    expect(mintTickets).not.toHaveBeenCalled();

    // Owner principal mismatch on profile-1 denies I/O
    clearClosingGatesForTesting();
    owner.generation = 2;
    snapshots.set("profile-1", {
      owner: { profileId: "profile-1", generation: 2 },
      status: "connected",
      serverUrl: scope1.endpoint,
      verifiedBrowserIdentity: { principal: "mallory", namespace: "prod" },
    } as ConnectionSnapshot);
    await render();
    expect(mintTickets).not.toHaveBeenCalled();

    unregP2();
    slotP2.remove();
  });

  it("exposes explicit viewer retry on 429 browserBusy without creating a new native target", async () => {
    mintTickets.mockRejectedValueOnce(
      new BrowserHostClientError("Viewer slots full", "browserBusy", 429),
    );
    owner.generation = 2;
    snapshots.set("profile-1", {
      ...snapshots.get("profile-1")!,
      owner: { profileId: "profile-1", generation: 2 },
    });
    await render();
    await render();

    expect(readTab("tab-1").phase).toBe("live");
    expect(readTab("tab-1").sessionId).toBe("session-1");
    expect(createSession).not.toHaveBeenCalled();
    const retryBtn = slot.querySelector(
      '[data-testid="browser-viewer-retry-btn-window-1-tab-1"]',
    ) as HTMLButtonElement;
    expect(retryBtn).toBeInstanceOf(HTMLButtonElement);

    await act(async () => retryBtn.click());
    await render();
    expect(attach).toHaveBeenCalledTimes(2);
    expect(
      slot.querySelector('[data-testid="browser-viewer-retry-btn-window-1-tab-1"]'),
    ).toBeNull();
  });

  it("prevents late ticket completion for a hidden/switched tab from reattaching", async () => {
    const delayedTickets = Promise.withResolvers<ViewerAttachmentCredentials>();
    mintTickets.mockReturnValueOnce(delayedTickets.promise);
    owner.generation = 2;
    snapshots.set("profile-1", {
      ...snapshots.get("profile-1")!,
      owner: { profileId: "profile-1", generation: 2 },
    });
    await render();
    await render();

    // Switch active tab away from tab-1 while tab-1's ticket minting is still in flight
    const tab2 = createBlankBrowserTab({ tabId: "tab-2" });
    const cur = readAppState();
    store.updateAppState("window-1", {
      ...cur,
      tabs: [...cur.tabs, tab2],
      activeTabId: "tab-2",
    } as unknown as Record<string, unknown>);
    await render();

    attach.mockClear();
    await act(async () =>
      delayedTickets.resolve({
        owner: { profileId: "profile-1", generation: 2 },
        browserSessionId: "session-1",
        browserIncarnation: "live-runtime",
        profileEpoch: 2,
        viewerId: "late-viewer",
        subscriptionEpoch: "late-sub",
        mediaTicket: "m",
        controlTicket: "c",
        mediaWsUrl: "ws://localhost/m",
        controlWsUrl: "ws://localhost/c",
        mediaSubprotocols: [],
        controlSubprotocols: [],
      }),
    );
    expect(attach).not.toHaveBeenCalled();
    expect(readTab("tab-1").viewerId).not.toBe("late-viewer");
  });

  it("never replays an unresolved create POST across reconnect and cleans up late completion after tab removal", async () => {
    const deferredPost = Promise.withResolvers<BrowserSessionDto>();
    createSession.mockReturnValueOnce(deferredPost.promise);
    const creatingTab = {
      ...createBlankBrowserTab({ tabId: "tab-create", draftValue: "https://example.test/new" }),
      committedUrl: "https://example.test/new",
      phase: "creating" as const,
      actionSequence: 1,
    };
    const cur = readAppState();
    store.updateAppState("window-1", {
      ...cur,
      tabs: [...cur.tabs, creatingTab],
    } as unknown as Record<string, unknown>);
    await render();
    await tick(10);
    expect(createSession).toHaveBeenCalledTimes(1);

    // Reconnect advances generation while POST is still pending: transitions to create-unknown without replay
    owner.generation = 2;
    snapshots.set("profile-1", {
      ...snapshots.get("profile-1")!,
      owner: { profileId: "profile-1", generation: 2 },
    });
    await render();
    await tick(10);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(readTab("tab-create").phase).toBe("create-unknown");

    // Remove tab-create, then resolve the original POST: late cleanup deletes the orphan session
    const afterUnknown = readAppState();
    store.updateAppState("window-1", {
      ...afterUnknown,
      tabs: afterUnknown.tabs.filter((t) => t.tabId !== "tab-create"),
    } as unknown as Record<string, unknown>);
    await render();

    const lateCreated: BrowserSessionDto = {
      ...snapshot,
      browserSessionId: "session-late-orphan",
      url: "https://example.test/new",
    };
    getSession.mockImplementation(async (_o, id: string) =>
      id === "session-late-orphan" ? lateCreated : snapshot,
    );
    await act(async () => deferredPost.resolve(lateCreated));
    await tick(20);
    expect(closeSession).toHaveBeenCalledWith(
      { profileId: "profile-1", generation: 2 },
      "session-late-orphan",
      undefined,
    );
  });

  it("keeps keyboard input functional on preserved controller after reconnect and restores server dialog state on tab return", async () => {
    // Advance generation (reconnect) and verify keyboard input works on the preserved input controller
    owner.generation = 2;
    snapshots.set("profile-1", {
      ...snapshots.get("profile-1")!,
      owner: { profileId: "profile-1", generation: 2 },
    });
    await render();
    await render();

    acquireControl.mockResolvedValueOnce({
      leaseToken: "gen2-lease",
      expiresAtUnixMs: Date.now() + 30_000,
    });
    controlSocket.send.mockClear();
    await act(async () => {
      clickCanvas();
      typeText("post-reconnect");
    });
    await act(async () => vi.runAllTimersAsync());
    expect(sentInput().map((m) => m.event)).toContainEqual({
      kind: "insertText",
      text: "post-reconnect",
    });

    // Open dialog, switch away from tab-1 (clearing dialog UI), then return to tab-1 with server dialog active
    await push({
      kind: "dialogOpened",
      dialogId: "dlg-1",
      dialogType: "confirm",
      message: "Proceed?",
    });
    expect(slot.querySelector('[data-testid="browser-dialog-overlay"]')).not.toBeNull();

    const tab2 = createBlankBrowserTab({ tabId: "tab-2" });
    store.updateAppState("window-1", {
      ...readAppState(),
      tabs: [...readAppState().tabs, tab2],
      activeTabId: "tab-2",
    } as unknown as Record<string, unknown>);
    await render();
    expect(slot.querySelector('[data-testid="browser-dialog-overlay"]')).toBeNull();

    // Return to tab-1 with dialog still present in server snapshot
    getSession.mockResolvedValueOnce({
      ...snapshot,
      dialog: { dialogId: "dlg-1", dialogType: "confirm", message: "Proceed?" },
    });
    store.updateAppState("window-1", {
      ...readAppState(),
      activeTabId: "tab-1",
    } as unknown as Record<string, unknown>);
    await render();
    await render();
    patchTabInTest("tab-1", { isController: true, leaseToken: "gen2-lease" });
    await render();

    const okBtn = slot.querySelector(
      '[data-testid="browser-dialog-ok-btn"]',
    ) as HTMLButtonElement;
    expect(okBtn).toBeInstanceOf(HTMLButtonElement);
    await act(async () => okBtn.click());
    expect(respondDialog).toHaveBeenCalledWith(
      { profileId: "profile-1", generation: 2 },
      "session-1",
      {
        leaseToken: "gen2-lease",
        dialogId: "dlg-1",
        accept: true,
        promptText: "",
      },
    );
  });

  it("synchronously detaches sockets, clears lease/dialog, and marks tab unavailable on pushed replacement runtime", async () => {
    patchTabInTest("tab-1", { isController: true, leaseToken: "active-lease" });
    await push({
      kind: "dialogOpened",
      dialogId: "dlg-replace",
      dialogType: "alert",
      message: "About to replace runtime",
    });
    expect(slot.querySelector('[data-testid="browser-dialog-overlay"]')).not.toBeNull();
    expect(controllers[0]?.visible).toBe(true);

    // Push sessionUpdated with replacement browserIncarnation: rejected by expectedRuntime -> detached
    const replacementSnap: BrowserSessionDto = {
      ...snapshot,
      browserIncarnation: "different-runtime-replacement",
      profileEpoch: "5",
      status: "running",
    };
    await push({ kind: "sessionUpdated", session: replacementSnap });
    await render();

    // Sockets detached, dialog cleared, lease cleared, tab marked unavailable
    expect(controllers[0]?.visible).toBe(false);
    expect(controllers[0]?.credentials).toBeNull();
    expect(slot.querySelector('[data-testid="browser-dialog-overlay"]')).toBeNull();
    const t1 = readTab("tab-1");
    expect(t1.phase).toBe("unavailable");
    expect(t1.unsupportedReason).toBe("Browser runtime changed on host");
    expect(t1.isController).toBe(false);
    expect(t1.leaseToken).toBeUndefined();
    expect(releaseControl).toHaveBeenCalledWith(owner, "session-1", {
      leaseToken: "active-lease",
    });
  });
});

const clickCanvas = () => {
  const canvas = slot.querySelector("canvas")!;
  canvas.dispatchEvent(
    new MouseEvent("pointerdown", { clientX: 400, clientY: 300, button: 0, bubbles: true }),
  );
  canvas.dispatchEvent(
    new MouseEvent("pointerup", { clientX: 400, clientY: 300, button: 0, bubbles: true }),
  );
};

const typeText = (text: string) => {
  const proxy = slot.querySelector("textarea")!;
  proxy.value = text;
  proxy.dispatchEvent(
    new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }),
  );
};

const sentInput = () =>
  controlSocket.send.mock.calls.map(([message]) => JSON.parse(message));

describe("browser first pointer gesture control handoff & popup tabs", () => {
  it("retains immediate text and editing keys behind the deferred focusing click", async () => {
    const lease = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
    acquireControl.mockReturnValueOnce(lease.promise);
    await act(async () => {
      clickCanvas();
      expect(document.activeElement).toBe(slot.querySelector("textarea"));
      typeText("surviving");
      const proxy = slot.querySelector("textarea")!;
      proxy.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Backspace",
          code: "Backspace",
          bubbles: true,
          cancelable: true,
        }),
      );
      proxy.dispatchEvent(
        new KeyboardEvent("keyup", { key: "Backspace", code: "Backspace", bubbles: true }),
      );
      typeText("-target");
    });
    expect(controlSocket.send).not.toHaveBeenCalled();
    await act(async () =>
      lease.resolve({ leaseToken: "human-lease", expiresAtUnixMs: Date.now() + 30_000 }),
    );
    await act(async () => vi.runAllTimersAsync());
    expect(sentInput().map((m) => m.event)).toEqual([
      { kind: "pointerDown", button: "left", u: 0.5, v: 0.5, modifiers: 0 },
      { kind: "pointerUp", button: "left", u: 0.5, v: 0.5, modifiers: 0 },
      { kind: "insertText", text: "surviving" },
      { kind: "keyDown", key: "Backspace", code: "Backspace", modifiers: 0 },
      { kind: "keyUp", key: "Backspace", code: "Backspace", modifiers: 0 },
      { kind: "insertText", text: "-target" },
    ]);
  });

  it.each([
    "blur",
    "window-blur",
    "privacy",
    "lock",
    "fence",
    "navigation",
    "runtime",
    "subscription",
    "socket",
    "cancel",
    "failed",
    "dispose",
    "tab-switch",
  ] as const)(
    "does not leak typeahead after %s cancels the acquisition",
    async (change) => {
      const lease = Promise.withResolvers<{ leaseToken: string; expiresAtUnixMs: number }>();
      acquireControl.mockReturnValueOnce(lease.promise);
      await act(async () => {
        clickCanvas();
        typeText("private-before-cancel");
      });
      await act(async () => {
        if (change === "blur") slot.querySelector("textarea")!.blur();
        if (change === "window-blur") window.dispatchEvent(new Event("blur"));
        if (change === "privacy") {
          streamState.suppressed = true;
          cognitoListeners.forEach((fn) => fn());
        }
        if (change === "lock") {
          streamState.locked = true;
          lockListeners.forEach((fn) => fn());
        }
        if (change === "fence")
          fenceBrowserViewsForProfile(owner.profileId, "same-turn fence", owner.generation);
        if (change === "navigation" || change === "runtime") {
          const t1 = readTab("tab-1");
          patchTabInTest("tab-1", {
            snapshot: {
              ...t1.snapshot!,
              ...(change === "navigation"
                ? { navigationRevision: "5" }
                : { browserIncarnation: "replacement-runtime" }),
            },
          });
          await render();
        }
        if (change === "subscription") {
          controllers[0]!.credentials = {
            ...controllers[0]!.credentials!,
            subscriptionEpoch: "replacement-subscription",
          };
        }
        if (change === "socket")
          controlSocket.addEventListener.mock.calls[0][1](new Event("close"));
        if (change === "cancel")
          slot
            .querySelector("canvas")!
            .dispatchEvent(new MouseEvent("pointercancel", { bubbles: true }));
        if (change === "dispose") {
          store.session.windows = {};
          await render();
        }
        if (change === "tab-switch") {
          const other = createBlankBrowserTab({ tabId: "tab-other" });
          const cur = readAppState();
          store.updateAppState("window-1", {
            ...cur,
            tabs: [...cur.tabs, other],
            activeTabId: "tab-other",
          } as unknown as Record<string, unknown>);
        }
        if (change === "failed")
          lease.reject(new BrowserHostClientError("held", "leaseConflict", 409));
        else
          lease.resolve({
            leaseToken: "unused-lease",
            expiresAtUnixMs: Date.now() + 30_000,
          });
      });
      expect(controlSocket.send).not.toHaveBeenCalled();
      if (change === "failed")
        expect(slot.textContent).toContain("Browser control is held by another viewer");
      else
        expect(releaseControl).toHaveBeenCalledExactlyOnceWith(owner, "session-1", {
          leaseToken: "unused-lease",
        });
    },
  );

  it("focuses TextInputProxy on tuple-keyed toolbar control request unless an input or another OS window is focused", async () => {
    patchTabInTest("tab-1", { isController: true, leaseToken: "toolbar-lease" });
    const proxy = slot.querySelector("textarea") as HTMLTextAreaElement;
    proxy.blur();

    await act(async () => {
      requestBrowserProxyFocus("window-1", "tab-1", owner, "session-1", "toolbar-lease");
    });
    expect(document.activeElement).toBe(proxy);

    proxy.blur();
    (store.session as unknown as Record<string, unknown>).activeDesktopId = "desktop-1";
    (store.session as unknown as Record<string, unknown>).desktops = [
      { id: "desktop-1", focusedWindowId: "other-window" },
    ];
    await act(async () => {
      requestBrowserProxyFocus("window-1", "tab-1", owner, "session-1", "toolbar-lease");
    });
    expect(document.activeElement).not.toBe(proxy);
    delete (store.session as unknown as Record<string, unknown>).activeDesktopId;
    delete (store.session as unknown as Record<string, unknown>).desktops;
  });

  it("admits OAuth popup as a distinct adjacent tab without replacing opener resource and removes it on completion", async () => {
    const popupSnapshot: BrowserSessionDto = {
      ...snapshot,
      browserSessionId: "popup-oauth-1",
      navigationRevision: "1",
      viewportEpoch: "1",
      url: "https://accounts.google.com/o/oauth2/v2/auth",
      title: "Sign in - Google Accounts",
      parentSessionId: "session-1",
    };
    getSession.mockImplementation(async (_owner, id: string) =>
      id === "popup-oauth-1" ? popupSnapshot : snapshot,
    );

    await push({
      kind: "sessionUpdated",
      session: { ...snapshot, activePopupSessionId: "popup-oauth-1" },
    });
    await tick(10);
    const stateWithPopup = readAppState();
    expect(stateWithPopup.tabs).toHaveLength(2);
    expect(stateWithPopup.tabs[0]?.sessionId).toBe("session-1");
    expect(stateWithPopup.tabs[1]).toMatchObject({
      kind: "popup",
      sessionId: "popup-oauth-1",
      parentTabId: "tab-1",
    });
    const popupTabId = stateWithPopup.tabs[1]!.tabId;
    expect(stateWithPopup.activeTabId).toBe(popupTabId);

    const popupSlot = document.createElement("div");
    document.body.append(popupSlot);
    const unregPopup = registerBrowserStreamSlot("window-1", popupTabId, popupSlot, true);
    await render();
    await render();

    // Simulate OAuth popup closing after login completes
    await push({
      kind: "sessionUpdated",
      session: { ...popupSnapshot, status: "closed", inputAvailable: false },
    });
    await tick(10);
    const afterClose = readAppState();
    expect(afterClose.tabs).toHaveLength(1);
    expect(afterClose.activeTabId).toBe("tab-1");
    expect(afterClose.tabs[0]?.sessionId).toBe("session-1");
    expect(afterClose.tabs[0]?.dismissedPopupSessionId).toBe("popup-oauth-1");

    unregPopup();
    popupSlot.remove();
  });

  it("enqueues live audio when active/unmuted and synchronously flushes BEFORE React commit on mute, hide, tab switch, privacy, lock, fence, or navigation", async () => {
    const chunk: BrowserAudioChunk = {
      kind: "audioChunk",
      browserSessionId: "session-1",
      browserIncarnation: "live-runtime",
      profileEpoch: "2",
      producerRun: "11111111-2222-4333-8444-555555555555",
      subscriptionEpoch: "subscription-1",
      docEpoch: "1",
      audioSeq: "1",
      sampleRate: 24000,
      channels: 1,
      encoding: "pcm16le",
      data: "AAAA",
    };
    pcmPlayerMocks.enqueue.mockClear();
    pcmPlayerMocks.flush.mockClear();
    pcmPlayerMocks.prime.mockClear();
    streamState.resetAudioAuthority.mockClear();

    requestBrowserAudioUnlock("window-1", "tab-1", owner, "session-1");
    expect(pcmPlayerMocks.prime).toHaveBeenCalledTimes(1);

    streamState.onAudioChunk?.(chunk, streamState.credentials!);
    expect(pcmPlayerMocks.enqueue).toHaveBeenCalledExactlyOnceWith("AAAA");

    // Muting slot synchronously flushes BEFORE React render
    pcmPlayerMocks.flush.mockClear();
    updateBrowserStreamSlot("window-1", "tab-1", slot, true, true);
    expect(pcmPlayerMocks.flush).toHaveBeenCalled();
    updateBrowserStreamSlot("window-1", "tab-1", slot, true, false);

    // Tab switch synchronously flushes PCM and detaches sockets BEFORE React render
    pcmPlayerMocks.flush.mockClear();
    const t2 = createBlankBrowserTab({ tabId: "tab-2" });
    const app = readAppState();
    store.updateAppState("window-1", {
      ...app,
      tabs: [...app.tabs, t2],
      activeTabId: "tab-2",
    } as unknown as Record<string, unknown>);
    expect(pcmPlayerMocks.flush).toHaveBeenCalled();
    expect(controllers[0]?.visible).toBe(false);

    // Restore tab-1 and verify media-before-control docEpoch ordering
    store.updateAppState("window-1", {
      ...readAppState(),
      activeTabId: "tab-1",
    } as unknown as Record<string, unknown>);
    await render();
    await render();
    await tick(10);

    streamState.onAudioChunk?.(
      { ...chunk, docEpoch: "6", audioSeq: "5", data: "CCCC" },
      streamState.credentials!,
    );
    expect(pcmPlayerMocks.enqueue).toHaveBeenLastCalledWith("CCCC");
    pcmPlayerMocks.flush.mockClear();
    streamState.resetAudioAuthority.mockClear();
    patchTabInTest("tab-1", {
      snapshot: { ...readTab("tab-1").snapshot!, navigationRevision: "6" },
    });
    expect(pcmPlayerMocks.flush).not.toHaveBeenCalled();
    expect(streamState.resetAudioAuthority).toHaveBeenCalledExactlyOnceWith("6");

    // Profile reset fence flushes synchronously BEFORE render
    pcmPlayerMocks.flush.mockClear();
    fenceBrowserViewsForProfile(owner.profileId, "Reset", owner.generation);
    expect(pcmPlayerMocks.flush).toHaveBeenCalled();
    expect(browserTabSlotKey("window-1", "tab-1")).toBe('["window-1","tab-1"]');
  });
});
