import { BrowserHostClientError, getBrowserSession } from "@/api/browser-host-client.js";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import { isCurrentConnection } from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { generateUUID } from "@/lib/utils.js";
import { syncBrowserSessionWindow } from "../browser-session-sync.js";
import { useWindowStore } from "../window-store.js";
import { commitNativeTargetAdmission } from "./browser-admission-guard.js";
import { isNativeTargetClosing } from "./browser-closing-gates.js";
import { areBrowserOwnerScopesEqual, browserOwnerScopeKey, captureVerifiedBrowserOwner, createBrowserNativeTargetKey, isCanonicalPositiveU64Decimal, isCapturedBrowserOwnerCurrent } from "./browser-owner-scope.js";
import { addBrowserTab, browserTabSlotKey, createBlankBrowserTab, findBrowserTab, patchBrowserTab } from "./browser-tab-state.js";
import type { BrowserTabRuntime, BrowserWindowState } from "./browser-tab-types.js";
import { normalizeBrowserCommittedUrl } from "./browser-url-normalization.js";

export type BrowserPopupAdmissionResult = "admitted" | "already-admitted" | "blocked" | "detached" | "noop";
export type BrowserPopupCompletionResult = "removed" | "running" | "detached";

const admittedOrDismissedPopups = new Set<string>();
const inFlightAdmissions = new Map<string, Promise<BrowserPopupAdmissionResult>>();
const inFlightCompletions = new Map<string, Promise<BrowserPopupCompletionResult>>();
const lastVisibleOpenerPopupLinks = new Map<string, string | undefined>();
export function clearPopupTabStateForTesting(): void {
  admittedOrDismissedPopups.clear(); inFlightAdmissions.clear(); inFlightCompletions.clear(); lastVisibleOpenerPopupLinks.clear();
}

function pruneRetiredPopupBookkeeping(): void {
  const windows = useWindowStore.getState().session?.windows ?? {};
  const liveSlots = new Set<string>();
  for (const win of Object.values(windows)) {
    const app = win.appId === "browser" ? (win.appState as unknown as BrowserWindowState | undefined) : undefined;
    if (Array.isArray(app?.tabs)) for (const t of app.tabs) liveSlots.add(browserTabSlotKey(win.id, t.tabId));
  }
  for (const k of lastVisibleOpenerPopupLinks.keys()) if (!liveSlots.has(k)) lastVisibleOpenerPopupLinks.delete(k);
  for (const entry of admittedOrDismissedPopups) {
    try {
      const p: unknown = JSON.parse(entry);
      if (Array.isArray(p) && typeof p[1] === "string" && typeof p[2] === "string" && !liveSlots.has(browserTabSlotKey(p[1], p[2]))) admittedOrDismissedPopups.delete(entry);
    } catch { admittedOrDismissedPopups.delete(entry); }
  }
}

function isWindowCurrentlyFocused(windowId: string): boolean {
  const s = useWindowStore.getState().session, w = s?.windows?.[windowId];
  if (!w || w.minimized || (s.activeDesktopId && w.desktopId && w.desktopId !== s.activeDesktopId)) return false;
  if (Array.isArray(s.desktops) && s.desktops.length > 0) {
    const d = s.desktops.find((item) => item.id === s.activeDesktopId) ?? s.desktops[0];
    if (d && "focusedWindowId" in d) return d.focusedWindowId === windowId;
  }
  return true;
}

function pickNearestOrdinaryFallbackTabId(tabs: readonly BrowserTabRuntime[], removedIndex: number): string | undefined {
  let bestTabId: string | undefined, bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < tabs.length; i++) {
    const c = tabs[i]!;
    if (c.tabId === tabs[removedIndex]?.tabId || c.kind !== "ordinary") continue;
    if (Math.abs(i - removedIndex) < bestDistance) { bestDistance = Math.abs(i - removedIndex); bestTabId = c.tabId; }
  }
  return bestTabId;
}

export function completeBrowserPopupTab(owner: ConnectionRef, windowId: string, popupTabId: string, expectedSessionId: string): BrowserPopupCompletionResult {
  pruneRetiredPopupBookkeeping();
  if (!isCurrentConnection(owner) || !windowId || !popupTabId || !expectedSessionId) return "detached";
  const verified = captureVerifiedBrowserOwner(owner.profileId);
  if (!verified || verified.owner.generation !== owner.generation) return "detached";

  const state = useWindowStore.getState();
  const win = state.session?.windows?.[windowId];
  const appState = win?.appState as unknown as BrowserWindowState | undefined;
  if (!win || win.appId !== "browser" || win.ctx.profileId !== owner.profileId || !appState || !Array.isArray(appState.tabs) || appState.closing) return "detached";
  if (appState.ownerScope && !areBrowserOwnerScopesEqual(appState.ownerScope, verified.scope)) return "detached";

  const removedIndex = appState.tabs.findIndex((t) => t.tabId === popupTabId);
  const popupTab = removedIndex >= 0 ? appState.tabs[removedIndex] : undefined;
  if (!popupTab || popupTab.kind !== "popup" || popupTab.sessionId !== expectedSessionId) return "detached";

  const scopeKey = browserOwnerScopeKey(verified.scope);
  if (popupTab.parentTabId) admittedOrDismissedPopups.add(JSON.stringify([scopeKey, windowId, popupTab.parentTabId, expectedSessionId]));
  for (const t of appState.tabs) {
    if (t.snapshot?.activePopupSessionId === expectedSessionId) admittedOrDismissedPopups.add(JSON.stringify([scopeKey, windowId, t.tabId, expectedSessionId]));
  }

  const updatedState = popupTab.parentTabId && findBrowserTab(appState, popupTab.parentTabId)
    ? patchBrowserTab(appState, popupTab.parentTabId, { dismissedPopupSessionId: expectedSessionId }) : appState;
  const remaining = updatedState.tabs.filter((t) => t.tabId !== popupTabId);
  let nextTabs = remaining, nextActiveTabId = updatedState.activeTabId;

  if (updatedState.activeTabId === popupTabId) {
    const survivingOpener = popupTab.parentTabId && remaining.some((t) => t.tabId === popupTab.parentTabId) ? popupTab.parentTabId : undefined;
    const nearestOrdinary = survivingOpener ?? pickNearestOrdinaryFallbackTabId(updatedState.tabs, removedIndex);
    if (nearestOrdinary) nextActiveTabId = nearestOrdinary;
    else { const blank = createBlankBrowserTab(); nextTabs = [...remaining, blank]; nextActiveTabId = blank.tabId; }
  } else if (nextTabs.length === 0) {
    const blank = createBlankBrowserTab(); nextTabs = [blank]; nextActiveTabId = blank.tabId;
  }

  state.updateAppState(windowId, { ...updatedState, ownerScope: verified.scope, tabs: nextTabs, activeTabId: nextActiveTabId } as unknown as Record<string, unknown>);
  return "removed";
}

export function reconcilePopupTabCompletion(params: { owner: ConnectionRef; windowId: string; popupTabId: string; popupSessionId: string; signal?: AbortSignal }): Promise<BrowserPopupCompletionResult> {
  const key = JSON.stringify([params.owner.profileId, params.owner.generation, params.windowId, params.popupTabId, params.popupSessionId]);
  const existing = inFlightCompletions.get(key);
  if (existing) return existing;

  const run = (async (): Promise<BrowserPopupCompletionResult> => {
    const verified = captureVerifiedBrowserOwner(params.owner.profileId);
    if (!verified || verified.owner.generation !== params.owner.generation) return "detached";
    try {
      const snap = await getBrowserSession(params.owner, params.popupSessionId, params.signal);
      if (!isCapturedBrowserOwnerCurrent(params.owner, verified.scope)) return "detached";
      if (snap.status === "closed" || snap.status === "lost") return completeBrowserPopupTab(params.owner, params.windowId, params.popupTabId, params.popupSessionId);
      return syncBrowserSessionWindow(params.owner, params.windowId, params.popupTabId, params.popupSessionId, snap) === "detached" ? "detached" : "running";
    } catch (err) {
      const status = err instanceof BrowserHostClientError ? err.status : err && typeof err === "object" && "status" in err && typeof err.status === "number" ? err.status : undefined;
      if (status === 404) return completeBrowserPopupTab(params.owner, params.windowId, params.popupTabId, params.popupSessionId);
      return "detached";
    } finally { inFlightCompletions.delete(key); }
  })();
  inFlightCompletions.set(key, run);
  return run;
}

export function reconcileOpenerPopupSnapshot(params: {
  owner: ConnectionRef; windowId: string; openerTabId: string; openerSessionId: string; openerSnapshot: BrowserSessionDto; isOpenerVisible?: boolean; signal?: AbortSignal;
}): Promise<BrowserPopupAdmissionResult> {
  pruneRetiredPopupBookkeeping();
  const verified = captureVerifiedBrowserOwner(params.owner.profileId);
  if (!verified || verified.owner.generation !== params.owner.generation || !isCurrentConnection(params.owner)) return Promise.resolve("detached");

  const slotKey = browserTabSlotKey(params.windowId, params.openerTabId);
  const currentPopupId = params.openerSnapshot.activePopupSessionId ?? undefined;
  if (params.isOpenerVisible ?? true) {
    const prevPopupId = lastVisibleOpenerPopupLinks.get(slotKey);
    lastVisibleOpenerPopupLinks.set(slotKey, currentPopupId);
    if (prevPopupId && prevPopupId !== currentPopupId) {
      const app = useWindowStore.getState().session?.windows?.[params.windowId]?.appState as unknown as BrowserWindowState | undefined;
      const hiddenChild = app?.tabs?.find((t) => t.kind === "popup" && t.parentTabId === params.openerTabId && t.sessionId === prevPopupId && app.activeTabId !== t.tabId);
      if (hiddenChild) void reconcilePopupTabCompletion({ owner: params.owner, windowId: params.windowId, popupTabId: hiddenChild.tabId, popupSessionId: prevPopupId, signal: params.signal });
    }
  }
  if (params.openerSnapshot.status !== "running" || !currentPopupId) return Promise.resolve("noop");

  const historyKey = JSON.stringify([browserOwnerScopeKey(verified.scope), params.windowId, params.openerTabId, currentPopupId]);
  const initialApp = useWindowStore.getState().session?.windows?.[params.windowId]?.appState as unknown as BrowserWindowState | undefined;
  const initialOpener = initialApp ? findBrowserTab(initialApp, params.openerTabId) : undefined;
  if (!initialOpener || initialOpener.sessionId !== params.openerSessionId) return Promise.resolve("detached");
  if (admittedOrDismissedPopups.has(historyKey) || initialOpener.dismissedPopupSessionId === currentPopupId || initialApp?.tabs.some((t) => t.sessionId === currentPopupId)) {
    return Promise.resolve("already-admitted");
  }
  const preKey = createBrowserNativeTargetKey(verified.scope, currentPopupId);
  if (!preKey || isNativeTargetClosing(preKey)) return Promise.resolve("blocked");

  const flightKey = JSON.stringify([params.owner.profileId, params.owner.generation, params.windowId, params.openerTabId, currentPopupId]);
  const existingFlight = inFlightAdmissions.get(flightKey);
  if (existingFlight) return existingFlight;

  const run = (async (): Promise<BrowserPopupAdmissionResult> => {
    try {
      const popupSnap = await getBrowserSession(params.owner, currentPopupId, params.signal);
      if (!isCapturedBrowserOwnerCurrent(params.owner, verified.scope)) return "detached";
      const state = useWindowStore.getState();
      const win = state.session?.windows?.[params.windowId];
      const appState = win?.appState as unknown as BrowserWindowState | undefined;
      if (!win || win.appId !== "browser" || win.ctx.profileId !== params.owner.profileId || !appState || !Array.isArray(appState.tabs) || appState.closing) return "detached";
      if (appState.ownerScope && !areBrowserOwnerScopesEqual(appState.ownerScope, verified.scope)) return "detached";

      const openerTab = findBrowserTab(appState, params.openerTabId);
      const validLink = Boolean(
        openerTab && openerTab.sessionId === params.openerSessionId && openerTab.phase === "live" &&
        openerTab.snapshot?.browserIncarnation === params.openerSnapshot.browserIncarnation && String(openerTab.snapshot?.profileEpoch) === String(params.openerSnapshot.profileEpoch) &&
        openerTab.snapshot?.activePopupSessionId === currentPopupId && openerTab.dismissedPopupSessionId !== currentPopupId &&
        popupSnap.browserSessionId === currentPopupId && popupSnap.status === "running" && popupSnap.parentSessionId === params.openerSessionId &&
        popupSnap.browserIncarnation === params.openerSnapshot.browserIncarnation && String(popupSnap.profileEpoch) === String(params.openerSnapshot.profileEpoch) && isCanonicalPositiveU64Decimal(popupSnap.profileEpoch),
      );
      if (!validLink) return "detached";
      if (admittedOrDismissedPopups.has(historyKey) || appState.tabs.some((t) => t.sessionId === currentPopupId)) return "already-admitted";

      let admitted = false;
      const committed = commitNativeTargetAdmission(verified.scope, currentPopupId, () => {
        admittedOrDismissedPopups.add(historyKey);
        const shouldActivate = isWindowCurrentlyFocused(params.windowId) && appState.activeTabId === params.openerTabId;
        const cleanDraft = normalizeBrowserCommittedUrl(popupSnap.url) ?? popupSnap.url;
        const popupTab: BrowserTabRuntime = {
          tabId: generateUUID(), kind: "popup", sessionId: popupSnap.browserSessionId, title: popupSnap.title, phase: "live",
          draft: { value: cleanDraft, dirty: false }, actionSequence: 0, parentTabId: params.openerTabId, popupAdmissionId: popupSnap.browserSessionId, snapshot: popupSnap,
        };
        const added = addBrowserTab(appState, { tab: popupTab, afterTabId: params.openerTabId, activate: shouldActivate });
        state.updateAppState(params.windowId, { ...added.state, ownerScope: verified.scope } as unknown as Record<string, unknown>);
        admitted = true;
      });
      return committed && admitted ? "admitted" : "blocked";
    } catch { return "detached"; } finally { inFlightAdmissions.delete(flightKey); }
  })();
  inFlightAdmissions.set(flightKey, run);
  return run;
}
