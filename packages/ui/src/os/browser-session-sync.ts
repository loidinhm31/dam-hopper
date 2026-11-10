import { isCurrentConnection } from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import { useWindowStore } from "./window-store.js";

export type BrowserSessionSyncResult = "applied" | "stale" | "detached";

export interface BrowserSessionRuntime {
  browserIncarnation: string;
  profileEpoch: string | number;
}

export interface SwitchBrowserSessionOptions {
  openerSessionId?: string;
  dismissedPopupSessionId?: string;
}

/** Apply a live snapshot only to the window/session/connection that requested it. */
export function syncBrowserSessionWindow(
  owner: ConnectionRef,
  windowId: string,
  sessionId: string,
  snapshot: BrowserSessionDto,
  expectedRuntime?: BrowserSessionRuntime,
): BrowserSessionSyncResult {
  if (!isCurrentConnection(owner) || snapshot.browserSessionId !== sessionId) return "detached";
  const state = useWindowStore.getState();
  const win = state.session.windows[windowId];
  if (!win || win.ctx.profileId !== owner.profileId || win.appState?.sessionId !== sessionId) {
    return "detached";
  }
  const current = win.appState;
  if (expectedRuntime && (
    current.browserIncarnation !== expectedRuntime.browserIncarnation ||
    String(current.profileEpoch) !== String(expectedRuntime.profileEpoch) ||
    snapshot.browserIncarnation !== expectedRuntime.browserIncarnation ||
    snapshot.profileEpoch !== String(expectedRuntime.profileEpoch)
  )) return "detached";
  const sameRuntime = current.browserIncarnation === snapshot.browserIncarnation &&
    String(current.profileEpoch) === snapshot.profileEpoch;
  // Decimal revisions are u64s: Number would lose the CAS token's precision.
  const profileEpoch = Number(snapshot.profileEpoch);
  if (!Number.isSafeInteger(profileEpoch) || profileEpoch <= 0) {
    throw new Error("Browser profile epoch cannot be represented exactly");
  }
  const staleNavigation = sameRuntime && current.navigationRevision !== undefined &&
    BigInt(String(current.navigationRevision)) > BigInt(snapshot.navigationRevision);
  const staleViewport = sameRuntime && current.viewportEpoch !== undefined &&
    BigInt(String(current.viewportEpoch)) > BigInt(snapshot.viewportEpoch);
  const currentGeometry = current.geometry as BrowserSessionDto["geometry"] | undefined;
  const geometry = staleViewport ? currentGeometry :
    currentGeometry && Object.entries(snapshot.geometry).every(
      ([key, value]) => currentGeometry[key as keyof BrowserSessionDto["geometry"]] === value,
    ) ? currentGeometry : snapshot.geometry;
  const popupBlocked = snapshot.popupBlocked ? true : undefined;
  const activePopupSessionId = snapshot.activePopupSessionId ?? undefined;
  const parentSessionId = snapshot.parentSessionId ?? undefined;
  const dismissedPopupSessionId =
    activePopupSessionId && current.dismissedPopupSessionId === activePopupSessionId
      ? current.dismissedPopupSessionId
      : undefined;
  const update = {
    browserIncarnation: snapshot.browserIncarnation,
    profileEpoch,
    browserSessionStatus: snapshot.status,
    navigationRevision: staleNavigation ? current.navigationRevision : snapshot.navigationRevision,
    viewportEpoch: staleViewport ? current.viewportEpoch : snapshot.viewportEpoch,
    geometry,
    url: staleNavigation ? current.url : snapshot.url,
    title: staleNavigation ? current.title : snapshot.title,
    inputAvailable: snapshot.status === "running" && snapshot.inputAvailable,
    unsupportedReason: snapshot.status === "running" ? undefined : `Browser session is ${snapshot.status}`,
    unavailableReason: snapshot.unavailableReason,
    popupBlocked,
    activePopupSessionId,
    parentSessionId,
    dismissedPopupSessionId,
    ...(!sameRuntime ? { openerSessionId: undefined } : {}),
    ...(!sameRuntime || snapshot.status !== "running" ? { isController: false, leaseToken: undefined } : {}),
  };
  if (Object.entries(update).some(([key, value]) => current[key] !== value)) {
    state.updateAppState(windowId, update);
  }
  return staleNavigation ? "stale" : "applied";
}

/**
 * Atomically switches a browser window from `expectedSessionId` to `targetSnapshot` (either
 * entering an admitted OAuth popup or returning to its live opener) within the same runtime.
 */
export function switchBrowserWindowSession(
  owner: ConnectionRef,
  windowId: string,
  expectedSessionId: string,
  targetSnapshot: BrowserSessionDto,
  options?: SwitchBrowserSessionOptions,
): BrowserSessionSyncResult {
  if (!isCurrentConnection(owner) || targetSnapshot.status !== "running") return "detached";
  const state = useWindowStore.getState();
  const win = state.session.windows[windowId];
  if (!win || win.ctx.profileId !== owner.profileId || win.appState?.sessionId !== expectedSessionId) {
    return "detached";
  }
  const current = win.appState;
  if (
    current.browserIncarnation !== targetSnapshot.browserIncarnation ||
    String(current.profileEpoch) !== targetSnapshot.profileEpoch
  ) {
    return "detached";
  }
  const profileEpoch = Number(targetSnapshot.profileEpoch);
  if (!Number.isSafeInteger(profileEpoch) || profileEpoch <= 0) {
    throw new Error("Browser profile epoch cannot be represented exactly");
  }
  state.updateAppState(windowId, {
    sessionId: targetSnapshot.browserSessionId,
    browserIncarnation: targetSnapshot.browserIncarnation,
    profileEpoch,
    browserSessionStatus: targetSnapshot.status,
    navigationRevision: targetSnapshot.navigationRevision,
    viewportEpoch: targetSnapshot.viewportEpoch,
    geometry: targetSnapshot.geometry,
    url: targetSnapshot.url,
    title: targetSnapshot.title,
    inputAvailable: targetSnapshot.inputAvailable,
    unsupportedReason: undefined,
    unavailableReason: targetSnapshot.unavailableReason,
    popupBlocked: targetSnapshot.popupBlocked ? true : undefined,
    activePopupSessionId: targetSnapshot.activePopupSessionId ?? undefined,
    parentSessionId: targetSnapshot.parentSessionId ?? undefined,
    openerSessionId: options?.openerSessionId,
    dismissedPopupSessionId: options?.dismissedPopupSessionId,
    isController: false,
    leaseToken: undefined,
    viewerId: undefined,
  });
  return "applied";
}
