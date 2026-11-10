import { isCurrentConnection } from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import { useWindowStore } from "./window-store.js";

export type BrowserSessionSyncResult = "applied" | "stale" | "detached";

export interface BrowserSessionRuntime {
  browserIncarnation: string;
  profileEpoch: string | number;
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
    ...(!sameRuntime || snapshot.status !== "running" ? { isController: false, leaseToken: undefined } : {}),
  };
  if (Object.entries(update).some(([key, value]) => current[key] !== value)) {
    state.updateAppState(windowId, update);
  }
  return staleNavigation ? "stale" : "applied";
}
