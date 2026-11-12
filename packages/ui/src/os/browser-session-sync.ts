import { isCurrentConnection } from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import { areBrowserOwnerScopesEqual, captureVerifiedBrowserOwner, createBrowserNativeTargetKey, isCanonicalPositiveU64Decimal } from "./browser/browser-owner-scope.js";
import { isNativeTargetClosing } from "./browser/browser-closing-gates.js";
import { findBrowserTab, patchBrowserTab } from "./browser/browser-tab-state.js";
import { normalizeBrowserCommittedUrl } from "./browser/browser-url-normalization.js";
import type { BrowserTabPhase, BrowserWindowState } from "./browser/browser-tab-types.js";
import { useWindowStore } from "./window-store.js";

export interface BrowserSessionDialogSummary {
  readonly dialogId: string;
  readonly message: string;
  readonly dialogType: string;
}

declare module "@/api/browser-host-types.js" {
  interface BrowserSessionDto {
    dialog?: BrowserSessionDialogSummary | null;
  }
}

declare module "./browser/browser-tab-types.js" {
  interface BrowserTabRuntime {
    readonly isController?: boolean;
    readonly leaseToken?: string;
    readonly viewerId?: string;
    readonly unsupportedReason?: string;
    readonly unavailableReason?: string;
    readonly dismissedPopupSessionId?: string;
  }
}

export type BrowserSessionSyncResult = "applied" | "stale" | "detached";

export interface BrowserSessionRuntime {
  browserIncarnation: string;
  profileEpoch: string | number;
  actionSequence?: number;
  subscriptionEpoch?: string;
  currentSubscriptionEpoch?: string;
}

/**
 * Apply a live snapshot only to the exact (owner, windowId, tabId, sessionId)
 * that requested or subscribed to it. Never overwrites dirty drafts or clears
 * durable address suppression.
 */
export function syncBrowserSessionWindow(
  owner: ConnectionRef, windowId: string, tabId: string,
  sessionId: string, snapshot: BrowserSessionDto, expectedRuntime?: BrowserSessionRuntime,
): BrowserSessionSyncResult {
  if (!isCurrentConnection(owner) || !windowId || !tabId || !sessionId || snapshot.browserSessionId !== sessionId) return "detached";
  const verified = captureVerifiedBrowserOwner(owner.profileId);
  if (!verified || verified.owner.generation !== owner.generation) return "detached";

  const state = useWindowStore.getState();
  const win = state.session?.windows?.[windowId];
  if (!win || win.appId !== "browser" || win.ctx.profileId !== owner.profileId || !win.appState) return "detached";

  const appState = win.appState as unknown as BrowserWindowState;
  if (!Array.isArray(appState.tabs) || appState.closing) return "detached";
  if (appState.ownerScope && !areBrowserOwnerScopesEqual(appState.ownerScope, verified.scope)) return "detached";

  const tab = findBrowserTab(appState, tabId);
  if (!tab || tab.sessionId !== sessionId || tab.phase === "closing" || tab.phase === "close-unknown" || tab.phase === "creating" || tab.phase === "create-unknown") {
    return "detached";
  }

  const targetKey = createBrowserNativeTargetKey(verified.scope, sessionId);
  if (!targetKey || (isNativeTargetClosing(targetKey) && snapshot.status === "running")) return "detached";

  if (!isCanonicalPositiveU64Decimal(snapshot.profileEpoch)) throw new Error("Browser profile epoch cannot be represented exactly");
  if (!isCanonicalPositiveU64Decimal(snapshot.navigationRevision) || !isCanonicalPositiveU64Decimal(snapshot.viewportEpoch)) {
    throw new Error("Browser revision epoch cannot be represented exactly");
  }

  const currentSnap = tab.snapshot;
  if (expectedRuntime) {
    const expectedEpoch = String(expectedRuntime.profileEpoch);
    if (
      !isCanonicalPositiveU64Decimal(expectedEpoch) ||
      (expectedRuntime.actionSequence !== undefined && tab.actionSequence !== expectedRuntime.actionSequence) ||
      (expectedRuntime.subscriptionEpoch !== undefined && expectedRuntime.currentSubscriptionEpoch !== undefined && expectedRuntime.subscriptionEpoch !== expectedRuntime.currentSubscriptionEpoch) ||
      !currentSnap || currentSnap.browserIncarnation !== expectedRuntime.browserIncarnation ||
      String(currentSnap.profileEpoch) !== expectedEpoch ||
      snapshot.browserIncarnation !== expectedRuntime.browserIncarnation || snapshot.profileEpoch !== expectedEpoch
    ) return "detached";
  }

  const sameRuntime = Boolean(currentSnap && currentSnap.browserIncarnation === snapshot.browserIncarnation && String(currentSnap.profileEpoch) === snapshot.profileEpoch);
  const staleNavigation = Boolean(sameRuntime && currentSnap?.navigationRevision !== undefined && BigInt(String(currentSnap.navigationRevision)) > BigInt(snapshot.navigationRevision));
  const staleViewport = Boolean(sameRuntime && currentSnap?.viewportEpoch !== undefined && BigInt(String(currentSnap.viewportEpoch)) > BigInt(snapshot.viewportEpoch));

  const currentGeometry = currentSnap?.geometry;
  const geometry = staleViewport && currentGeometry
    ? currentGeometry
    : currentGeometry && Object.entries(snapshot.geometry).every(([k, v]) => currentGeometry[k as keyof BrowserSessionDto["geometry"]] === v)
      ? currentGeometry : snapshot.geometry;

  const popupBlocked = snapshot.popupBlocked ? true : undefined;
  const activePopupSessionId = snapshot.activePopupSessionId ?? undefined;
  const parentSessionId = snapshot.parentSessionId ?? undefined;
  const dismissedPopupSessionId = activePopupSessionId && activePopupSessionId !== tab.dismissedPopupSessionId
    ? undefined : tab.dismissedPopupSessionId;

  const rawDialog = snapshot.dialog;
  const nextDialogCandidate =
    snapshot.status === "running" && rawDialog && typeof rawDialog.dialogId === "string" && typeof rawDialog.message === "string" && typeof rawDialog.dialogType === "string"
      ? { dialogId: rawDialog.dialogId, message: rawDialog.message, dialogType: rawDialog.dialogType }
      : rawDialog === undefined && sameRuntime && currentSnap?.dialog && snapshot.status === "running" ? currentSnap.dialog : undefined;
  const prevDialog = currentSnap?.dialog ?? undefined;
  const dialog = prevDialog && nextDialogCandidate && prevDialog.dialogId === nextDialogCandidate.dialogId && prevDialog.message === nextDialogCandidate.message && prevDialog.dialogType === nextDialogCandidate.dialogType
    ? prevDialog : nextDialogCandidate;

  const effectiveUrl = staleNavigation && currentSnap ? currentSnap.url : snapshot.url;
  const effectiveTitle = staleNavigation && currentSnap ? currentSnap.title : snapshot.title;
  const effectiveNavRev = staleNavigation && currentSnap ? String(currentSnap.navigationRevision) : snapshot.navigationRevision;
  const effectiveViewportEpoch = staleViewport && currentSnap ? String(currentSnap.viewportEpoch) : snapshot.viewportEpoch;
  const effectiveInputAvailable = snapshot.status === "running" && snapshot.inputAvailable;

  const nextSnapCandidate: BrowserSessionDto = {
    browserSessionId: snapshot.browserSessionId, browserIncarnation: snapshot.browserIncarnation,
    profileEpoch: snapshot.profileEpoch, navigationRevision: effectiveNavRev,
    viewportEpoch: effectiveViewportEpoch, url: effectiveUrl, title: effectiveTitle,
    status: snapshot.status, inputAvailable: effectiveInputAvailable,
    unavailableReason: snapshot.unavailableReason, geometry,
    ...(dialog !== undefined ? { dialog } : {}),
    popupBlocked, activePopupSessionId, parentSessionId,
  };

  const nextSnap =
    currentSnap && currentSnap.browserSessionId === nextSnapCandidate.browserSessionId &&
    currentSnap.browserIncarnation === nextSnapCandidate.browserIncarnation &&
    String(currentSnap.profileEpoch) === nextSnapCandidate.profileEpoch &&
    String(currentSnap.navigationRevision) === nextSnapCandidate.navigationRevision &&
    String(currentSnap.viewportEpoch) === nextSnapCandidate.viewportEpoch &&
    currentSnap.url === nextSnapCandidate.url && currentSnap.title === nextSnapCandidate.title &&
    currentSnap.status === nextSnapCandidate.status && currentSnap.inputAvailable === nextSnapCandidate.inputAvailable &&
    currentSnap.unavailableReason === nextSnapCandidate.unavailableReason && currentSnap.geometry === nextSnapCandidate.geometry &&
    (currentSnap.dialog ?? undefined) === dialog && currentSnap.popupBlocked === nextSnapCandidate.popupBlocked &&
    currentSnap.activePopupSessionId === nextSnapCandidate.activePopupSessionId && currentSnap.parentSessionId === nextSnapCandidate.parentSessionId
      ? currentSnap : nextSnapCandidate;

  const nextCommittedUrl = tab.kind === "popup" ? undefined : staleNavigation ? tab.committedUrl : normalizeBrowserCommittedUrl(effectiveUrl);
  const cleanDraftValue = nextCommittedUrl ?? effectiveUrl;
  const isDirty = Boolean(tab.draft?.dirty);
  const currentDraftVal = tab.draft?.value ?? (tab.committedUrl ?? "");
  const nextDraft = isDirty || staleNavigation
    ? (tab.draft ?? { value: currentDraftVal, dirty: isDirty })
    : currentDraftVal === cleanDraftValue && !isDirty
      ? (tab.draft ?? { value: cleanDraftValue, dirty: false })
      : { value: cleanDraftValue, dirty: false };

  const nextPhase: BrowserTabPhase = snapshot.status === "running" ? "live" : snapshot.status === "initializing" ? "connecting" : "unavailable";
  const retainControl = sameRuntime && snapshot.status === "running";
  const nextIsController = retainControl ? Boolean(tab.isController) : false;
  const nextLeaseToken = retainControl ? tab.leaseToken : undefined;
  const nextUnsupportedReason = snapshot.status === "running" ? undefined : `Browser session is ${snapshot.status}`;
  const nextUnavailableReason = snapshot.unavailableReason;

  const tabUnchanged =
    tab.committedUrl === nextCommittedUrl && tab.title === effectiveTitle &&
    tab.phase === nextPhase && tab.draft === nextDraft && tab.snapshot === nextSnap &&
    Boolean(tab.isController) === nextIsController && tab.leaseToken === nextLeaseToken &&
    tab.unsupportedReason === nextUnsupportedReason && tab.unavailableReason === nextUnavailableReason &&
    tab.dismissedPopupSessionId === dismissedPopupSessionId;

  if (!tabUnchanged || !areBrowserOwnerScopesEqual(appState.ownerScope, verified.scope)) {
    const nextState = {
      ...patchBrowserTab(appState, tabId, {
        committedUrl: nextCommittedUrl, title: effectiveTitle, phase: nextPhase,
        draft: nextDraft, snapshot: nextSnap, isController: nextIsController,
        leaseToken: nextLeaseToken, unsupportedReason: nextUnsupportedReason,
        unavailableReason: nextUnavailableReason, dismissedPopupSessionId,
      }),
      ownerScope: verified.scope,
    };
    state.updateAppState(windowId, nextState as unknown as Record<string, unknown>);
  }

  return staleNavigation ? "stale" : "applied";
}
