import { BrowserHostClientError, getBrowserSession, historyBrowser, navigateBrowser, reloadBrowser } from "@/api/browser-host-client.js";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
import { isCurrentConnection } from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { generateUUID } from "@/lib/utils.js";
import { syncBrowserSessionWindow, type BrowserSessionRuntime } from "../browser-session-sync.js";
import { useWindowStore } from "../window-store.js";
import { areBrowserOwnerScopesEqual, captureVerifiedBrowserOwner, isCapturedBrowserOwnerCurrent, type VerifiedBrowserOwner } from "./browser-owner-scope.js";
import { loadBrowserRecoveryDisk, saveBrowserRecoveryDisk, withBrowserRecoveryLock } from "./browser-recovery-store.js";
import { isOperationRiskAcknowledged } from "./browser-session-inventory.js";
import { browserTabSlotKey, createBlankBrowserTab, createInitialBrowserWindowState, findBrowserTab, patchBrowserTab, selectBrowserTab, setBrowserTabDraft } from "./browser-tab-state.js";
import { BROWSER_STATE_VERSION, type BrowserOwnerScope, type BrowserTabKind, type BrowserTabPhase, type BrowserTabRuntime, type BrowserWindowClosingState, type BrowserWindowState } from "./browser-tab-types.js";
import { normalizeBrowserCommittedUrl } from "./browser-url-normalization.js";
import { parseBrowserWindowDisk } from "./browser-persistence.js";

export interface TabNavActionParams {
  owner: ConnectionRef; windowId: string; tabId: string; fallbackTabId?: string;
  viewport?: { width: number; height: number; dpr: number };
  onPendingChange?: (pending: boolean) => void; onError?: (error: string | null) => void;
}
const inFlightNavigations = new Map<string, AbortController>();
const DEFAULT_VIEWPORT = { width: 1280, height: 800, dpr: 1 };
const SAFE_BROWSER_ERROR_PREFIXES = ["Web Locks API is unavailable", "Resolve or acknowledge the pending recovery operation", "Browser recovery metadata exceeds", "Invalid persisted OS session", "Popup window is no longer available"];
const HOST_ERROR_MESSAGES: Record<string, string> = {
  sessionConflict: "Page state changed; retry the action.", sessionNotFound: "Browser page session was not found.",
  browserBusy: "Browser target capacity reached; close an unused session and retry.", forbidden: "Browser session access was denied.",
  invalidInput: "The requested URL or navigation input was rejected.", policyViolation: "The requested navigation is blocked by network policy.",
  nativeTargetUnavailable: "The browser runtime is currently unavailable.", cleanupPending: "Browser profile cleanup is still in progress.",
  leaseConflict: "Browser control lease changed or expired.", leaseNotFound: "Browser control lease changed or expired.",
  leaseExpired: "Browser control lease changed or expired.", notLeaseHolder: "Browser control lease changed or expired.",
};
const HOST_STATUS_MESSAGES: Record<number, string> = { 400: HOST_ERROR_MESSAGES.invalidInput!, 403: HOST_ERROR_MESSAGES.forbidden!, 404: HOST_ERROR_MESSAGES.sessionNotFound!, 409: HOST_ERROR_MESSAGES.sessionConflict!, 429: HOST_ERROR_MESSAGES.browserBusy!, 502: HOST_ERROR_MESSAGES.nativeTargetUnavailable!, 503: HOST_ERROR_MESSAGES.nativeTargetUnavailable! };
export const clearNavigationsForTesting = (): void => { inFlightNavigations.forEach((c) => c.abort()); inFlightNavigations.clear(); };
export const retireTabNavigation = (windowId: string, tabId: string): void => {
  const key = browserTabSlotKey(windowId, tabId); inFlightNavigations.get(key)?.abort(); inFlightNavigations.delete(key);
};
export const sanitizeBrowserError = (err: unknown, fallback: string): string => {
  if (err instanceof BrowserHostClientError) return HOST_ERROR_MESSAGES[err.kind] ?? (err.status !== undefined ? HOST_STATUS_MESSAGES[err.status] : undefined) ?? fallback;
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return SAFE_BROWSER_ERROR_PREFIXES.some((p) => msg.startsWith(p)) ? msg.slice(0, 140) : fallback;
};
export function hydrateBrowserTabRuntime(rawTab: unknown, fallbackTabId: string): BrowserTabRuntime {
  if (!rawTab || typeof rawTab !== "object") {
    return createBlankBrowserTab({ tabId: fallbackTabId });
  }
  const t = rawTab as Record<string, unknown>;
  const tabId = typeof t.tabId === "string" && t.tabId.trim() ? t.tabId : fallbackTabId;
  const committedUrl = normalizeBrowserCommittedUrl(t.committedUrl);
  const sessionId = typeof t.sessionId === "string" && t.sessionId.trim() ? t.sessionId : undefined;
  const rawDraft = t.draft && typeof t.draft === "object" ? t.draft : undefined;
  const draftValue = rawDraft && "value" in rawDraft && typeof rawDraft.value === "string" ? rawDraft.value : (committedUrl ?? "");
  const dirty = rawDraft && "dirty" in rawDraft && typeof rawDraft.dirty === "boolean" ? rawDraft.dirty : false;
  const kind: BrowserTabKind = t.kind === "popup" ? "popup" : "ordinary";
  const parentTabId = typeof t.parentTabId === "string" && t.parentTabId.trim() ? t.parentTabId : undefined;
  const phase: BrowserTabPhase =
    typeof t.phase === "string" &&
    ["new-tab", "connecting", "live", "unavailable", "capacity", "creating", "create-unknown", "closing", "close-unknown", "deferred"].includes(t.phase)
      ? (t.phase as BrowserTabPhase)
      : sessionId
        ? "connecting"
        : committedUrl
          ? "unavailable"
          : "new-tab";
  const actionSequence = typeof t.actionSequence === "number" && Number.isFinite(t.actionSequence) ? t.actionSequence : 0;

  return {
    ...t,
    tabId,
    kind,
    ...(parentTabId ? { parentTabId } : {}),
    ...(committedUrl ? { committedUrl } : {}),
    ...(sessionId ? { sessionId } : {}),
    phase,
    draft: { value: draftValue, dirty },
    actionSequence,
  } as BrowserTabRuntime;
}
export function readCanonicalBrowserWindowState(rawAppState: Record<string, unknown> | undefined, fallbackTabId: string): BrowserWindowState {
  if (rawAppState?.browserStateVersion === BROWSER_STATE_VERSION && Array.isArray(rawAppState.tabs) && rawAppState.tabs.length > 0) {
    const rawTabs = rawAppState.tabs as Array<Record<string, unknown>>;
    const alreadyValid = rawTabs.every(
      (t) => t && typeof t === "object" && typeof t.tabId === "string" && t.tabId.trim() &&
             t.draft && typeof t.draft === "object" && "value" in t.draft && typeof t.draft.value === "string" &&
             typeof t.phase === "string" && typeof t.kind === "string"
    );
    if (alreadyValid) {
      const c = rawAppState as unknown as BrowserWindowState;
      return c.tabs.some((t) => t.tabId === c.activeTabId) ? c : { ...c, activeTabId: c.tabs[0]!.tabId };
    }
    const tabs: BrowserTabRuntime[] = rawTabs.map((t, idx) =>
      hydrateBrowserTabRuntime(t, idx === 0 ? fallbackTabId : `${fallbackTabId}-${idx}`)
    );
    const activeTabId = typeof rawAppState.activeTabId === "string" && tabs.some((t) => t.tabId === rawAppState.activeTabId)
      ? (rawAppState.activeTabId as string)
      : tabs[0]!.tabId;
    return {
      browserStateVersion: BROWSER_STATE_VERSION,
      ...(rawAppState.ownerScope ? { ownerScope: rawAppState.ownerScope as BrowserOwnerScope } : {}),
      tabs,
      activeTabId,
      ...(rawAppState.closing && typeof rawAppState.closing === "object" ? { closing: rawAppState.closing as BrowserWindowClosingState } : {}),
      ...(typeof rawAppState.restoreGroupId === "string" ? { restoreGroupId: rawAppState.restoreGroupId } : {}),
    };
  }
  if (rawAppState && typeof rawAppState === "object" && (rawAppState.url !== undefined || rawAppState.sessionId !== undefined)) {
    const committedUrl = normalizeBrowserCommittedUrl(rawAppState.url);
    const tab: BrowserTabRuntime = {
      tabId: fallbackTabId,
      kind: "ordinary",
      ...(committedUrl ? { committedUrl } : {}),
      ...(typeof rawAppState.sessionId === "string" && rawAppState.sessionId.trim() ? { sessionId: rawAppState.sessionId } : {}),
      phase: committedUrl ? "unavailable" : "new-tab",
      draft: { value: committedUrl ?? "", dirty: false },
      actionSequence: 0,
    };
    return createInitialBrowserWindowState({ tabs: [tab], activeTabId: fallbackTabId });
  }
  return createInitialBrowserWindowState({ tabs: [createBlankBrowserTab({ tabId: fallbackTabId })] });
}
export function writeCanonicalWindowState(windowId: string, state: BrowserWindowState): void {
  useWindowStore.getState().updateAppState(windowId, {
    browserStateVersion: BROWSER_STATE_VERSION, ownerScope: state.ownerScope, tabs: state.tabs, activeTabId: state.activeTabId,
    closing: state.closing, restoreGroupId: state.restoreGroupId, url: undefined, sessionId: undefined, presentation: undefined,
    navigationRevision: undefined, isController: undefined, leaseToken: undefined, viewerId: undefined, unsupportedReason: undefined, unavailableReason: undefined,
  });
}
export const isTabHistoryEnabled = (tab: BrowserTabRuntime): boolean => tab.phase === "live" && tab.snapshot?.status === "running" && Boolean(tab.sessionId);
export const isTabReloadable = (tab: BrowserTabRuntime): boolean => (tab.phase === "live" && Boolean(tab.sessionId)) || ((tab.phase === "unavailable" || tab.phase === "capacity" || tab.phase === "deferred") && Boolean(normalizeBrowserCommittedUrl(tab.committedUrl)));
export const validateBrowserUrlInput = (rawInput: string): { valid: true; url: string } | { valid: false; error: string } => {
  const url = normalizeBrowserCommittedUrl(rawInput);
  return url ? { valid: true, url } : { valid: false, error: "Enter a valid http:// or https:// URL without username/password (search terms are not allowed)." };
};
function resolveTab(windowId: string, tabId: string, fallbackTabId?: string) {
  const win = useWindowStore.getState().session?.windows?.[windowId]; if (!win || win.appId !== "browser") return null;
  const appState = readCanonicalBrowserWindowState(win.appState, fallbackTabId ?? `tab-${windowId}`);
  const tab = findBrowserTab(appState, tabId); return tab ? { win, appState, tab } : null;
}
function resolveAuthorizedTab(p: TabNavActionParams) {
  const ctx = resolveTab(p.windowId, p.tabId, p.fallbackTabId);
  if (!ctx) return null;
  const verified = captureVerifiedBrowserOwner(p.owner.profileId);
  if (!verified || verified.owner.generation !== p.owner.generation || !isCurrentConnection(p.owner)) { p.onError?.("Connection generation changed or profile is disconnected."); return null; }
  if (ctx.appState.closing) { p.onError?.("Window is closing."); return null; }
  if (ctx.appState.ownerScope && !areBrowserOwnerScopesEqual(ctx.appState.ownerScope, verified.scope)) { p.onError?.("Window belongs to a different server, user, or environment."); return null; }
  return { ...ctx, verified };
}
export const updateTabDraftValue = (windowId: string, tabId: string, value: string, fallbackTabId?: string): void => {
  const ctx = resolveTab(windowId, tabId, fallbackTabId); if (ctx && !ctx.appState.closing) writeCanonicalWindowState(windowId, setBrowserTabDraft(ctx.appState, tabId, value));
};
export const resetTabDraftToCommitted = (windowId: string, tabId: string, fallbackTabId?: string): void => {
  const ctx = resolveTab(windowId, tabId, fallbackTabId); if (ctx && !ctx.appState.closing) writeCanonicalWindowState(windowId, setBrowserTabDraft(ctx.appState, tabId, ctx.tab.committedUrl ?? "", false));
};
const isTabCurrentUnderLock = (p: TabNavActionParams, verified: VerifiedBrowserOwner, expectedActionSeq: number, prepCtrl?: AbortController, expectedSessionId?: string, expectedSnap?: BrowserSessionDto) => {
  const slotKey = browserTabSlotKey(p.windowId, p.tabId);
  if (prepCtrl && (prepCtrl.signal.aborted || inFlightNavigations.get(slotKey) !== prepCtrl)) return false;
  if (!isCapturedBrowserOwnerCurrent(verified.owner, verified.scope)) return false;
  const cur = resolveTab(p.windowId, p.tabId, p.fallbackTabId);
  if (!cur || cur.appState.closing || cur.tab.actionSequence !== expectedActionSeq) return false;
  if (expectedSessionId !== undefined && cur.tab.sessionId !== expectedSessionId) return false;
  if (expectedSnap && (cur.tab.snapshot?.browserIncarnation !== expectedSnap.browserIncarnation || String(cur.tab.snapshot?.profileEpoch ?? "") !== String(expectedSnap.profileEpoch))) return false;
  return true;
};
async function stageTabCreateUnderLock(
  p: TabNavActionParams, verified: VerifiedBrowserOwner, url: string, preserveDirtyDraft: boolean, expectedActionSeq: number, resetSuppression: boolean, prepCtrl?: AbortController,
): Promise<boolean> {
  const slotKey = browserTabSlotKey(p.windowId, p.tabId);
  let ownCtrl: AbortController | undefined;
  if (!prepCtrl) { if (inFlightNavigations.has(slotKey)) return false; ownCtrl = new AbortController(); inFlightNavigations.set(slotKey, ownCtrl); p.onPendingChange?.(true); p.onError?.(null); }
  const ctrl = prepCtrl ?? ownCtrl!;
  let abortedDuringLock = false;
  try {
    try {
      await withBrowserRecoveryLock(() => {
        if (!isTabCurrentUnderLock(p, verified, expectedActionSeq, ctrl)) { abortedDuringLock = true; return; }
        const disk = loadBrowserRecoveryDisk();
        if (disk.operations.some((op) => areBrowserOwnerScopesEqual(op.ownerScope, verified.scope) && op.windowId === p.windowId && (!op.tabId || op.tabId === p.tabId) && (op.status === "pending" || op.status === "unknown") && !isOperationRiskAcknowledged(op.operationId))) {
          throw new Error("Resolve or acknowledge the pending recovery operation before creating a fresh page.");
        }
        if (resetSuppression) saveBrowserRecoveryDisk({ ...disk, addressSuppressedScopes: disk.addressSuppressedScopes.filter((s) => !areBrowserOwnerScopesEqual(s, verified.scope)) });
      });
    } catch (err) { if (!ctrl.signal.aborted && inFlightNavigations.get(slotKey) === ctrl) p.onError?.(sanitizeBrowserError(err, "Recovery storage unavailable.")); return false; }
    if (abortedDuringLock || !isTabCurrentUnderLock(p, verified, expectedActionSeq, ctrl)) return false;
    const latest = resolveTab(p.windowId, p.tabId, p.fallbackTabId)!;
    const creationKey = generateUUID();
    const next = patchBrowserTab(latest.appState, p.tabId, {
      committedUrl: url, sessionId: undefined, snapshot: undefined, title: undefined, phase: "creating",
      draft: preserveDirtyDraft && latest.tab.draft.dirty ? latest.tab.draft : { value: url, dirty: false }, actionSequence: latest.tab.actionSequence + 1,
      createIntent: { operationId: generateUUID(), creationKey, request: { creationKey, url, viewport: p.viewport ?? DEFAULT_VIEWPORT } },
      isController: false, leaseToken: undefined, viewerId: undefined, unsupportedReason: undefined, unavailableReason: undefined,
    });
    p.onError?.(null); writeCanonicalWindowState(p.windowId, { ...next, ownerScope: verified.scope });
    return true;
  } finally { if (ownCtrl && inFlightNavigations.get(slotKey) === ownCtrl) { inFlightNavigations.delete(slotKey); p.onPendingChange?.(false); } }
}
async function runCasNav(
  p: TabNavActionParams & { verified: VerifiedBrowserOwner; tab: BrowserTabRuntime; op: (rev: string, sig: AbortSignal) => Promise<BrowserSessionDto>; recreateUrl?: string; preserveDirtyDraft?: boolean; submittedValues?: [string, string]; reservedCtrl?: AbortController },
): Promise<void> {
  const { verified, windowId, tab, fallbackTabId, op, recreateUrl, preserveDirtyDraft = true, submittedValues, onPendingChange, onError, reservedCtrl } = p;
  const sessionId = tab.sessionId, slotKey = browserTabSlotKey(windowId, tab.tabId);
  if (!sessionId || (!reservedCtrl && inFlightNavigations.has(slotKey))) return;
  const ctrl = reservedCtrl ?? new AbortController();
  if (!reservedCtrl) { inFlightNavigations.set(slotKey, ctrl); onPendingChange?.(true); onError?.(null); }
  const expectedRuntime: BrowserSessionRuntime | undefined = tab.snapshot ? { browserIncarnation: tab.snapshot.browserIncarnation, profileEpoch: tab.snapshot.profileEpoch, actionSequence: tab.actionSequence } : undefined;
  const isCurrent = () => isTabCurrentUnderLock(p, verified, tab.actionSequence, ctrl, sessionId, tab.snapshot);
  try {
    const current = await getBrowserSession(verified.owner, sessionId, ctrl.signal);
    if (!isCurrent()) return;
    if (recreateUrl && (current.status === "lost" || current.status === "closed")) { await stageTabCreateUnderLock(p, verified, recreateUrl, preserveDirtyDraft, tab.actionSequence, false, ctrl); return; }
    const sync = syncBrowserSessionWindow(verified.owner, windowId, tab.tabId, sessionId, current, expectedRuntime);
    if (sync === "detached") return;
    if (sync === "stale") throw new BrowserHostClientError("Page changed while preparing navigation; retry the action", "sessionConflict", 409);
    const response = await op(current.navigationRevision, ctrl.signal);
    if (isCurrent()) {
      const latest = resolveTab(windowId, tab.tabId, fallbackTabId);
      if (latest && submittedValues && (latest.tab.draft?.value === submittedValues[0] || latest.tab.draft?.value === submittedValues[1])) writeCanonicalWindowState(windowId, setBrowserTabDraft(latest.appState, tab.tabId, latest.tab.draft?.value ?? "", false));
      syncBrowserSessionWindow(verified.owner, windowId, tab.tabId, sessionId, response, expectedRuntime);
    }
  } catch (err) {
    if (ctrl.signal.aborted || inFlightNavigations.get(slotKey) !== ctrl) return;
    const status = err instanceof BrowserHostClientError ? err.status : undefined;
    if (recreateUrl && status === 404 && isCurrent()) { await stageTabCreateUnderLock(p, verified, recreateUrl, preserveDirtyDraft, tab.actionSequence, false, ctrl); return; }
    if (status === 409) { try { const r = await getBrowserSession(verified.owner, sessionId, ctrl.signal); if (isCurrent()) syncBrowserSessionWindow(verified.owner, windowId, tab.tabId, sessionId, r, expectedRuntime); } catch { /* ignore */ } }
    if (isCurrent()) onError?.(sanitizeBrowserError(err, "Navigation failed"));
  } finally { if (inFlightNavigations.get(slotKey) === ctrl) { inFlightNavigations.delete(slotKey); onPendingChange?.(false); } }
}
export async function submitTabAddress(p: TabNavActionParams & { rawInput: string }): Promise<void> {
  const v = validateBrowserUrlInput(p.rawInput); if (!v.valid) { p.onError?.(v.error); return; }
  const slotKey = browserTabSlotKey(p.windowId, p.tabId); if (inFlightNavigations.has(slotKey)) return;
  const auth = resolveAuthorizedTab(p); if (!auth) return;
  const { phase } = auth.tab;
  if (phase === "creating" || phase === "connecting" || phase === "closing" || phase === "create-unknown" || phase === "close-unknown") { p.onError?.("Tab is busy or awaiting recovery resolution."); return; }
  const prepCtrl = new AbortController(); inFlightNavigations.set(slotKey, prepCtrl); p.onPendingChange?.(true); p.onError?.(null);
  let handoff = false;
  try {
    if (auth.tab.sessionId && phase === "live" && auth.tab.snapshot?.status === "running") {
      let abortedDuringLock = false;
      try {
        await withBrowserRecoveryLock(() => {
          if (!isTabCurrentUnderLock(p, auth.verified, auth.tab.actionSequence, prepCtrl, auth.tab.sessionId, auth.tab.snapshot)) { abortedDuringLock = true; return; }
          const disk = loadBrowserRecoveryDisk(); saveBrowserRecoveryDisk({ ...disk, addressSuppressedScopes: disk.addressSuppressedScopes.filter((s) => !areBrowserOwnerScopesEqual(s, auth.verified.scope)) });
        });
      } catch (err) { if (!prepCtrl.signal.aborted && inFlightNavigations.get(slotKey) === prepCtrl) p.onError?.(sanitizeBrowserError(err, "Recovery lock failed")); return; }
      if (abortedDuringLock || !isTabCurrentUnderLock(p, auth.verified, auth.tab.actionSequence, prepCtrl, auth.tab.sessionId, auth.tab.snapshot)) return;
      const latest = resolveTab(p.windowId, p.tabId, p.fallbackTabId)!; handoff = true;
      await runCasNav({ ...p, verified: auth.verified, tab: latest.tab, recreateUrl: v.url, preserveDirtyDraft: false, submittedValues: [p.rawInput, v.url], reservedCtrl: prepCtrl, op: (rev, sig) => navigateBrowser(auth.verified.owner, latest.tab.sessionId!, { url: v.url, navigationRevision: rev }, sig) });
      return;
    }
    await stageTabCreateUnderLock(p, auth.verified, v.url, false, auth.tab.actionSequence, true, prepCtrl);
  } finally { if (!handoff && inFlightNavigations.get(slotKey) === prepCtrl) { inFlightNavigations.delete(slotKey); p.onPendingChange?.(false); } }
}
export async function reloadBrowserTab(p: TabNavActionParams): Promise<void> {
  const auth = resolveAuthorizedTab(p); if (!auth) return;
  const committed = normalizeBrowserCommittedUrl(auth.tab.committedUrl);
  if (auth.tab.phase === "live" && auth.tab.sessionId) { await runCasNav({ ...p, verified: auth.verified, tab: auth.tab, recreateUrl: committed, preserveDirtyDraft: true, op: (rev, sig) => reloadBrowser(auth.verified.owner, auth.tab.sessionId!, { navigationRevision: rev }, sig) }); return; }
  if (committed && (auth.tab.phase === "unavailable" || auth.tab.phase === "capacity" || auth.tab.phase === "deferred")) await stageTabCreateUnderLock(p, auth.verified, committed, true, auth.tab.actionSequence, false);
}
export async function navigateTabHistory(p: TabNavActionParams & { direction: "back" | "forward" }): Promise<void> {
  const auth = resolveAuthorizedTab(p);
  if (auth && isTabHistoryEnabled(auth.tab)) await runCasNav({ ...p, verified: auth.verified, tab: auth.tab, op: (rev, sig) => historyBrowser(auth.verified.owner, auth.tab.sessionId!, { direction: p.direction, navigationRevision: rev }, sig) });
}
export async function activateTabInWindow(p: TabNavActionParams): Promise<void> {
  const init = resolveTab(p.windowId, p.tabId, p.fallbackTabId); if (!init) return;
  if (init.appState.activeTabId !== p.tabId) retireTabNavigation(p.windowId, init.appState.activeTabId);
  const selected = selectBrowserTab(init.appState, p.tabId); writeCanonicalWindowState(p.windowId, selected);
  const target = findBrowserTab(selected, p.tabId); const committed = normalizeBrowserCommittedUrl(target?.committedUrl);
  if (target?.phase === "deferred" && committed) { const auth = resolveAuthorizedTab({ ...p, onError: undefined }); if (auth) await stageTabCreateUnderLock(p, auth.verified, committed, true, target.actionSequence, false); }
}
