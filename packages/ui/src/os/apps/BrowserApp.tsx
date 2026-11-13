import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  acquireBrowserControl,
  getBrowserSession,
  releaseBrowserControl,
  renewBrowserControl,
} from "@/api/browser-host-client.js";
import type { BrowserSessionDto, QualityPreference } from "@/api/browser-host-types.js";
import { getApi, isCurrentConnection, useConnectionSnapshot } from "@/api/connections.js";
import type { SessionInfo } from "@/api/client.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { collectHostTerminalCandidates, useHostBrowserSelection, type HostTerminalCandidate } from "@/browser-host/selection-controller.js";
import { isDocumentVisible, subscribeDocumentVisibility } from "@/browser-host/visibility-demand.js";
import { generateUUID } from "@/lib/utils.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useLockScreenStore } from "@/stores/lock-screen.js";
import { executeAction } from "../action-executor.js";
import { BrowserAddressBar } from "../browser/browser-address-bar.js";
import { closeBrowserTarget } from "../browser/browser-close-lifecycle.js";
import { runSerializedBrowserControlAcquire } from "../browser/browser-control-gate.js";
import {
  activateTabInWindow,
  navigateTabHistory,
  readCanonicalBrowserWindowState,
  reloadBrowserTab,
  resetTabDraftToCommitted,
  retireTabNavigation,
  sanitizeBrowserError,
  submitTabAddress,
  updateTabDraftValue,
  writeCanonicalWindowState,
} from "../browser/browser-navigation.js";
import { BrowserNewTabPage } from "../browser/browser-new-tab-page.js";
import {
  areBrowserOwnerScopesEqual,
  captureVerifiedBrowserOwner,
  extractBrowserOwnerScopeFromSnapshot,
  isCapturedBrowserOwnerCurrent,
} from "../browser/browser-owner-scope.js";
import { completeBrowserPopupTab } from "../browser/browser-popup-tabs.js";
import {
  BROWSER_RECOVERY_STORAGE_KEY,
  clearRememberedPagesAndSuppress,
  loadBrowserRecoveryDisk,
  settleRecoveryOperation,
  stageRecoveryOperation,
} from "../browser/browser-recovery-store.js";
import {
  commitTargetAdmission,
  getVerifiedBrowserSession,
  isOperationRiskAcknowledged,
} from "../browser/browser-session-inventory.js";
import {
  addBrowserTab,
  browserTabSlotKey,
  createBlankBrowserTab,
  findBrowserTab,
  patchBrowserTab,
  removeBrowserTab,
  selectBrowserTab,
} from "../browser/browser-tab-state.js";
import { BrowserTabStrip, getBrowserTabIds } from "../browser/browser-tab-strip.js";
import type { BrowserTabRuntime, BrowserWindowState } from "../browser/browser-tab-types.js";
import { BrowserTools } from "../browser/browser-tools.js";
import { normalizeBrowserCommittedUrl } from "../browser/browser-url-normalization.js";
import {
  getStreamQuality,
  releaseTab,
  releaseWindow,
  setQualityPreference,
  subscribeStreamQuality,
} from "../browser/browser-stream-quality.js";
import {
  clearBrowserViewFenceForProfile,
  isBrowserAudioBlocked,
  registerBrowserStreamSlot,
  requestBrowserAudioUnlock,
  requestBrowserProxyFocus,
  subscribeBrowserAudioBlocked,
  updateBrowserStreamSlot,
} from "../BrowserStreamKeepAliveHost.js";
import { OS_SESSION_STORAGE_KEY, sanitizeSessionForPersistence, validateOsSession } from "../persistence.js";
import { useResourceClaim } from "../resource-registry.js";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import { useWindowContext, useWindowOwner } from "../window-context.js";
import { useWindowStore } from "../window-store.js";

export interface BrowserAppProps {
  window: OsWindow;
}

export function BrowserApp({ window }: BrowserAppProps) {
  const owner = useWindowOwner();
  return <BrowserTabbedShell window={window} owner={owner} />;
}

function BrowserTabbedShell({ window, owner }: { window: OsWindow; owner: ConnectionRef }) {
  const slotRef = useRef<HTMLDivElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  const toolsPanelId = useId();
  const fallbackTabIdRef = useRef<string>(generateUUID());
  const context = useWindowContext();
  const windows = useWindowStore((s) => s.session.windows);
  const isCognitoActive = useCognitoModeStore((s) => s.active);
  const isLocked = useLockScreenStore((s) => s.isLocked);
  const privacyMasked = isCognitoActive || isLocked;
  const connectionSnap = useConnectionSnapshot(owner.profileId);
  const verifiedScope = useMemo(
    () => (connectionSnap?.status === "connected" ? extractBrowserOwnerScopeFromSnapshot(connectionSnap) : null),
    [connectionSnap],
  );
  const canonicalState = useMemo(
    () => readCanonicalBrowserWindowState(window.appState, fallbackTabIdRef.current),
    [window.appState],
  );
  const activeTab = useMemo<BrowserTabRuntime>(
    () => canonicalState.tabs.find((t) => t.tabId === canonicalState.activeTabId) ?? canonicalState.tabs[0] ?? createBlankBrowserTab({ tabId: fallbackTabIdRef.current }),
    [canonicalState],
  );
  const activeDraftValue = activeTab?.draft?.value ?? activeTab?.committedUrl ?? "";
  const ownerMismatch = Boolean(
    canonicalState.ownerScope && verifiedScope && !areBrowserOwnerScopesEqual(canonicalState.ownerScope, verifiedScope),
  );
  const masked = privacyMasked || ownerMismatch;

  const [toolsOpen, setToolsOpen] = useState(false);
  const [pendingByTab, setPendingByTab] = useState<Record<string, boolean>>({});
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [clearPending, setClearPending] = useState(false);
  const [clearStatus, setClearStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [audioMutedByTab, setAudioMutedByTab] = useState<Record<string, boolean>>({});
  const [recoveryTick, setRecoveryTick] = useState(0);
  const [controlPending, setControlPending] = useState(false);
  const [liveSessions, setLiveSessions] = useState<SessionInfo[]>([]);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>("");
  const controlAttemptRef = useRef(0);
  const controlInFlightRef = useRef(false);
  const activeTabId = activeTab.tabId;
  const sessionId = activeTab.sessionId;
  const isController = Boolean(activeTab.isController);
  const leaseToken = activeTab.leaseToken;
  const navigationRevision = activeTab.snapshot?.navigationRevision ?? 1;
  const navigationPending = Boolean(pendingByTab[activeTabId]);
  const audioMuted = Boolean(audioMutedByTab[activeTabId]);
  const audioBlocked = useSyncExternalStore(
    subscribeBrowserAudioBlocked,
    () => isBrowserAudioBlocked(window.id, activeTabId),
    () => false,
  );

  const qualityTuple = useMemo(
    () => ({
      profileId: owner.profileId,
      generation: owner.generation,
      windowId: window.id,
      tabId: activeTabId,
    }),
    [owner.profileId, owner.generation, window.id, activeTabId],
  );
  const qualityState = useSyncExternalStore(
    useCallback((notify) => subscribeStreamQuality(qualityTuple, notify), [qualityTuple]),
    useCallback(() => getStreamQuality(qualityTuple), [qualityTuple]),
  );
  const handleQualityPreferenceChange = useCallback(
    (pref: QualityPreference) => {
      setQualityPreference(qualityTuple, pref);
    },
    [qualityTuple],
  );

  useEffect(() => {
    if (canonicalState.closing) {
      releaseWindow(window.id);
    }
  }, [canonicalState.closing, window.id]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === BROWSER_RECOVERY_STORAGE_KEY) setRecoveryTick((n) => n + 1);
    };
    globalThis.window?.addEventListener("storage", onStorage);
    return () => globalThis.window?.removeEventListener("storage", onStorage);
  }, []);

  const unresolvedCount = useMemo(() => {
    void recoveryTick;
    if (masked || !verifiedScope) return 0;
    try {
      return loadBrowserRecoveryDisk().operations.filter((op) =>
        areBrowserOwnerScopesEqual(op.ownerScope, verifiedScope),
      ).length;
    } catch {
      return 1;
    }
  }, [masked, recoveryTick, verifiedScope]);

  const setTabPending = useCallback((tabId: string, pending: boolean) => {
    setPendingByTab((prev) => (prev[tabId] === pending ? prev : { ...prev, [tabId]: pending }));
  }, []);

  useLayoutEffect(() => {
    setNavigationError(null);
    controlAttemptRef.current += 1;
    controlInFlightRef.current = false;
    setControlPending(false);
    return () => {
      retireTabNavigation(window.id, activeTabId);
      setTabPending(activeTabId, false);
    };
  }, [owner.profileId, owner.generation, activeTabId, sessionId, window.id, setTabPending]);

  const claimKey = useMemo<ResourceClaimKey>(
    () => ({
      resourceKind: "browser",
      profileId: owner.profileId,
      generation: owner.generation,
      resourceId: browserTabSlotKey(window.id, activeTabId),
    }),
    [activeTabId, owner.profileId, owner.generation, window.id],
  );
  const claimStatus = useResourceClaim(claimKey, window.id);
  const canStreamActiveTab =
    (activeTab.phase === "live" || activeTab.phase === "connecting") &&
    Boolean(sessionId) &&
    !canonicalState.closing &&
    !ownerMismatch;
  const isDocVisible = useSyncExternalStore(
    subscribeDocumentVisibility,
    isDocumentVisible,
    () => true,
  );
  const isVisible =
    isDocVisible &&
    canStreamActiveTab &&
    claimStatus.success &&
    !window.minimized &&
    context.isActiveDesktop &&
    !privacyMasked;
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;
  const audioMutedRef = useRef(audioMuted);
  audioMutedRef.current = audioMuted;

  const maskedRef = useRef(masked);
  maskedRef.current = masked;
  useEffect(() => {
    const el = slotRef.current;
    const unregister = registerBrowserStreamSlot(
      window.id,
      activeTabId,
      el,
      isVisibleRef.current,
      audioMutedRef.current,
    );
    return () => unregister();
  }, [activeTabId, window.id]);

  useLayoutEffect(() => {
    updateBrowserStreamSlot(window.id, activeTabId, slotRef.current, isVisible, audioMuted);
  }, [activeTabId, window.id, isVisible, audioMuted]);

  const handleToggleAudio = useCallback(() => {
    if (masked || !sessionId) return;
    if (!audioMuted && audioBlocked) {
      if (isVisible) requestBrowserAudioUnlock(window.id, activeTabId, owner, sessionId);
      return;
    }
    const nextMuted = !audioMuted;
    setAudioMutedByTab((prev) => ({ ...prev, [activeTabId]: nextMuted }));
    updateBrowserStreamSlot(window.id, activeTabId, slotRef.current, isVisible, nextMuted);
    if (!nextMuted && isVisible) requestBrowserAudioUnlock(window.id, activeTabId, owner, sessionId);
  }, [activeTabId, audioBlocked, audioMuted, isVisible, masked, owner, sessionId, window.id]);

  const handleNavigationSync = useCallback(
    (update: { navigationRevision: string; url?: string }) => {
      if (!isCurrentConnection(owner) || !sessionId) return;
      const latestWin = useWindowStore.getState().session.windows[window.id];
      if (!latestWin) return;
      const latestState = readCanonicalBrowserWindowState(latestWin.appState, fallbackTabIdRef.current);
      const tab = findBrowserTab(latestState, activeTabId);
      if (!tab || tab.sessionId !== sessionId) return;
      const currentRev = tab.snapshot?.navigationRevision;
      if (currentRev !== undefined && BigInt(String(currentRev)) > BigInt(update.navigationRevision)) return;
      const nextSnap = tab.snapshot ? { ...tab.snapshot, navigationRevision: update.navigationRevision } : undefined;
      const nextCommitted = update.url ? normalizeBrowserCommittedUrl(update.url) ?? tab.committedUrl : tab.committedUrl;
      writeCanonicalWindowState(
        window.id,
        patchBrowserTab(latestState, activeTabId, {
          ...(nextSnap ? { snapshot: nextSnap } : {}),
          ...(nextCommitted ? { committedUrl: nextCommitted } : {}),
        }),
      );
    },
    [activeTabId, owner, sessionId, window.id],
  );

  const refreshTerminalCandidates = useCallback(async () => {
    if (!isCurrentConnection(owner)) return;
    try {
      const rows = await getApi(owner).terminal.listDetailed();
      if (isCurrentConnection(owner) && Array.isArray(rows)) setLiveSessions(rows);
    } catch { /* ignore transient lookup failure */ }
  }, [owner]);

  const terminalCandidates = useMemo(
    () => collectHostTerminalCandidates(owner, windows, liveSessions),
    [owner, windows, liveSessions],
  );

  useEffect(() => {
    if (selectedTerminalId && terminalCandidates.some((t) => t.sessionId === selectedTerminalId && t.ready)) return;
    setSelectedTerminalId((terminalCandidates.find((t) => t.ready) ?? terminalCandidates[0])?.sessionId ?? "");
  }, [terminalCandidates, selectedTerminalId]);

  const selectedTerminal: HostTerminalCandidate | undefined = useMemo(
    () => terminalCandidates.find((t) => t.sessionId === selectedTerminalId) ?? terminalCandidates[0],
    [terminalCandidates, selectedTerminalId],
  );

  const selection = useHostBrowserSelection({
    owner,
    sessionId,
    navigationRevision,
    leaseToken,
    targets: terminalCandidates,
    onNavigationSync: handleNavigationSync,
    enabled: isVisible,
  });

  useEffect(() => {
    if (isVisible && (selection.selectionActive || selection.preview)) void refreshTerminalCandidates();
  }, [isVisible, selection.selectionActive, selection.preview, selection.error, context.isFocused, windows, refreshTerminalCandidates]);

  useEffect(() => {
    if (!isVisible || !selection.preview || selectedTerminal?.ready) return;
    const timer = setInterval(() => void refreshTerminalCandidates(), 400);
    return () => clearInterval(timer);
  }, [isVisible, selection.preview, selectedTerminal?.ready, refreshTerminalCandidates]);

  const getViewport = useCallback(() => {
    const rect = slotRef.current?.getBoundingClientRect();
    return {
      width: rect && rect.width >= 320 ? Math.round(rect.width) : 1280,
      height: rect && rect.height >= 240 ? Math.round(rect.height) : 800,
      dpr: typeof globalThis.devicePixelRatio === "number" ? globalThis.devicePixelRatio : 1,
    };
  }, []);

  const navParams = useMemo(
    () => ({
      owner,
      windowId: window.id,
      tabId: activeTabId,
      fallbackTabId: fallbackTabIdRef.current,
      viewport: getViewport(),
      onPendingChange: (p: boolean) => setTabPending(activeTabId, p),
      onError: setNavigationError,
    }),
    [owner, window.id, activeTabId, getViewport, setTabPending],
  );

  const handleSubmitAddress = useCallback(() => {
    clearBrowserViewFenceForProfile(owner.profileId);
    void submitTabAddress({ ...navParams, rawInput: activeDraftValue });
  }, [activeDraftValue, navParams, owner.profileId]);

  const handleReload = useCallback(() => {
    clearBrowserViewFenceForProfile(owner.profileId);
    void reloadBrowserTab(navParams);
  }, [navParams, owner.profileId]);

  const handleBack = useCallback(() => void navigateTabHistory({ ...navParams, direction: "back" }), [navParams]);
  const handleForward = useCallback(() => void navigateTabHistory({ ...navParams, direction: "forward" }), [navParams]);

  const handleSelectTab = useCallback((tabId: string) => {
    const curWin = useWindowStore.getState().session.windows[window.id];
    const curState = readCanonicalBrowserWindowState(curWin?.appState, fallbackTabIdRef.current);
    if (tabId === curState.activeTabId || curState.closing) return;
    const prevTab = findBrowserTab(curState, curState.activeTabId);
    if (prevTab?.isController && prevTab.leaseToken && prevTab.sessionId && isCurrentConnection(owner)) {
      void releaseBrowserControl(owner, prevTab.sessionId, { leaseToken: prevTab.leaseToken }).catch(() => {});
      writeCanonicalWindowState(window.id, patchBrowserTab(curState, prevTab.tabId, { isController: false, leaseToken: undefined }));
    }
    if (selection.selectionActive || selection.preview || selection.preparedArtifact) void selection.cancelSelection();
    setNavigationError(null);
    setClearStatus(null);
    void activateTabInWindow({ ...navParams, tabId });
  }, [navParams, owner, selection, window.id]);

  const handleNewTab = useCallback(() => {
    const curWin = useWindowStore.getState().session.windows[window.id];
    const curState = readCanonicalBrowserWindowState(curWin?.appState, fallbackTabIdRef.current);
    if (curState.closing) return;
    retireTabNavigation(window.id, curState.activeTabId);
    if (selection.selectionActive || selection.preview || selection.preparedArtifact) void selection.cancelSelection();
    setNavigationError(null);
    setClearStatus(null);
    const added = addBrowserTab(curState, { activate: true });
    writeCanonicalWindowState(window.id, added.state);
    requestAnimationFrame(() => addressInputRef.current?.focus());
  }, [selection, window.id]);

  const handleCloseTab = useCallback((tabId: string) => {
    const curWin = useWindowStore.getState().session.windows[window.id];
    const curState = readCanonicalBrowserWindowState(curWin?.appState, fallbackTabIdRef.current);
    const target = findBrowserTab(curState, tabId);
    if (!target || curState.closing || ownerMismatch || target.phase === "closing") return;
    const preVerified = captureVerifiedBrowserOwner(owner.profileId);
    if (curState.ownerScope && preVerified && !areBrowserOwnerScopesEqual(curState.ownerScope, preVerified.scope)) {
      setNavigationError("Cannot close page: window belongs to a different verified owner.");
      return;
    }
    if (tabId === curState.activeTabId && (selection.selectionActive || selection.preview || selection.preparedArtifact)) {
      void selection.cancelSelection();
    }
    updateBrowserStreamSlot(window.id, tabId, null, false, true);
    retireTabNavigation(window.id, tabId);
    releaseTab({
      profileId: owner.profileId,
      generation: owner.generation,
      windowId: window.id,
      tabId,
    });

    if (target.phase === "create-unknown") {
      try {
        const ops = loadBrowserRecoveryDisk().operations.filter((o) => o.windowId === window.id && o.tabId === tabId && o.status === "unknown");
        if (ops.some((o) => !isOperationRiskAcknowledged(o.operationId))) {
          setNavigationError("Unresolved page creation may still exist; inspect Recovery or acknowledge duplicate risk to dismiss.");
          setToolsOpen(true);
          return;
        }
      } catch { /* fallback allow removal only if unblocked */ }
    }

    if (!target.sessionId) {
      writeCanonicalWindowState(window.id, removeBrowserTab(curState, tabId));
      return;
    }
    if (!preVerified || preVerified.owner.generation !== owner.generation) {
      setNavigationError("Original verified owner disconnected before closing page.");
      setToolsOpen(true);
      return;
    }

    const expectedScope = curState.ownerScope ?? preVerified.scope;
    const closeSessionId = target.sessionId;
    const targetKind = target.kind;
    const operationId = generateUUID();
    const capturedRuntime = target.snapshot;
    writeCanonicalWindowState(
      window.id,
      patchBrowserTab(curState, tabId, {
        phase: "closing",
        isController: false,
        leaseToken: undefined,
        actionSequence: target.actionSequence + 1,
      }),
    );

    void (async () => {
      const setCloseUnknown = (reason: string) => {
        const latestWin = useWindowStore.getState().session.windows[window.id];
        if (latestWin) {
          const latestState = readCanonicalBrowserWindowState(latestWin.appState, fallbackTabIdRef.current);
          if (!latestState.ownerScope || areBrowserOwnerScopesEqual(latestState.ownerScope, expectedScope)) {
            writeCanonicalWindowState(window.id, patchBrowserTab(latestState, tabId, {
              phase: "close-unknown",
              unavailableReason: reason,
            }));
          }
        }
        setNavigationError(reason);
        setToolsOpen(true);
        setRecoveryTick((n) => n + 1);
      };
      if (!isCapturedBrowserOwnerCurrent(preVerified.owner, expectedScope)) {
        setCloseUnknown("Original verified owner disconnected before closing page.");
        return;
      }
      try {
        await stageRecoveryOperation({
          operationId,
          ownerScope: expectedScope,
          kind: "close-tab",
          windowId: window.id,
          tabId,
          sessionId: closeSessionId,
          status: "pending",
        });
        if (!isCapturedBrowserOwnerCurrent(preVerified.owner, expectedScope)) {
          setCloseUnknown("Owner changed while staging close operation.");
          return;
        }
        const outcome = await closeBrowserTarget({
          owner: preVerified.owner,
          scope: expectedScope,
          sessionId: closeSessionId,
          windowId: window.id,
          tabId,
          operationId,
          runtime: capturedRuntime,
        });
        if (outcome.kind === "closed" || outcome.kind === "released") {
          await settleRecoveryOperation(operationId).catch(() => {});
          const latestWin = useWindowStore.getState().session.windows[window.id];
          if (latestWin) {
            const latestState = readCanonicalBrowserWindowState(latestWin.appState, fallbackTabIdRef.current);
            if (!latestState.ownerScope || areBrowserOwnerScopesEqual(latestState.ownerScope, expectedScope)) {
              if (targetKind === "popup") {
                if (completeBrowserPopupTab(preVerified.owner, window.id, tabId, closeSessionId) === "detached" && findBrowserTab(latestState, tabId)) {
                  writeCanonicalWindowState(window.id, removeBrowserTab(latestState, tabId));
                }
              } else if (findBrowserTab(latestState, tabId)) {
                writeCanonicalWindowState(window.id, removeBrowserTab(latestState, tabId));
              }
            }
          }
          setRecoveryTick((n) => n + 1);
          return;
        }
        setCloseUnknown(sanitizeBrowserError(outcome.error, "Close status unknown."));
      } catch (err) {
        setCloseUnknown(sanitizeBrowserError(err, "Close operation failed."));
      }
    })();
  }, [owner.generation, owner.profileId, ownerMismatch, selection, window.id]);

  const handleAcquireControl = useCallback(async () => {
    if (!sessionId || masked || !isVisible || canonicalState.closing || controlInFlightRef.current) return;
    const verified = captureVerifiedBrowserOwner(owner.profileId);
    if (!verified || verified.owner.generation !== owner.generation) return;
    const attemptId = ++controlAttemptRef.current;
    controlInFlightRef.current = true;
    setControlPending(true);
    const expectedTabId = activeTabId;
    const expectedSessionId = sessionId;
    const expectedActionSeq = activeTab.actionSequence;
    const expectedViewerId = activeTab.viewerId;
    const activeViewerId = expectedViewerId ?? `${window.id}:${expectedTabId}`;
    const expectedIncarnation = activeTab.snapshot?.browserIncarnation;
    const expectedProfileEpoch = activeTab.snapshot?.profileEpoch;
    const expectedIsController = Boolean(activeTab.isController);
    const expectedLeaseToken = activeTab.leaseToken;
    try {
      await runSerializedBrowserControlAcquire(verified.owner, expectedSessionId, activeViewerId, async () => {
        const preWin = useWindowStore.getState().session.windows[window.id];
        const preState = readCanonicalBrowserWindowState(preWin?.appState, fallbackTabIdRef.current);
        const preTab = findBrowserTab(preState, expectedTabId);
        const matchesPreconditions = (curWin: OsWindow | undefined, curState: BrowserWindowState, curTab: BrowserTabRuntime | undefined) => Boolean(
          attemptId === controlAttemptRef.current &&
          isCapturedBrowserOwnerCurrent(verified.owner, verified.scope) &&
          curWin?.ctx.profileId === verified.owner.profileId &&
          !curState.closing &&
          curState.activeTabId === expectedTabId &&
          !maskedRef.current &&
          isVisibleRef.current &&
          curTab &&
          curTab.phase === "live" &&
          curTab.actionSequence === expectedActionSeq &&
          curTab.sessionId === expectedSessionId &&
          curTab.viewerId === expectedViewerId &&
          Boolean(curTab.isController) === expectedIsController &&
          curTab.leaseToken === expectedLeaseToken &&
          curTab.snapshot?.browserIncarnation === expectedIncarnation &&
          String(curTab.snapshot?.profileEpoch ?? "") === String(expectedProfileEpoch ?? "") &&
          (curTab.snapshot?.status === undefined || curTab.snapshot.status === "running"),
        );
        if (!matchesPreconditions(preWin, preState, preTab)) return;
        const resp = await acquireBrowserControl(verified.owner, expectedSessionId, { viewerId: activeViewerId, holderKind: "human" });
        const curWin = useWindowStore.getState().session.windows[window.id];
        const curState = readCanonicalBrowserWindowState(curWin?.appState, fallbackTabIdRef.current);
        const curTab = findBrowserTab(curState, expectedTabId);
        if (!matchesPreconditions(curWin, curState, curTab)) {
          if (isCurrentConnection(verified.owner)) {
            void releaseBrowserControl(verified.owner, expectedSessionId, { leaseToken: resp.leaseToken }).catch(() => {});
          }
          return;
        }
        writeCanonicalWindowState(window.id, patchBrowserTab(curState, expectedTabId, { isController: true, leaseToken: resp.leaseToken }));
        requestBrowserProxyFocus(window.id, expectedTabId, verified.owner, expectedSessionId, resp.leaseToken);
      });
    } catch {
      console.warn("[BrowserApp] Acquire control failed");
    } finally {
      if (attemptId === controlAttemptRef.current) {
        controlInFlightRef.current = false;
        setControlPending(false);
      }
    }
  }, [activeTab.actionSequence, activeTab.isController, activeTab.leaseToken, activeTab.snapshot, activeTab.viewerId, activeTabId, canonicalState.closing, isVisible, masked, owner.generation, owner.profileId, sessionId, window.id]);

  const handleReleaseControl = useCallback(async () => {
    if (!sessionId || !leaseToken) return;
    controlAttemptRef.current += 1;
    controlInFlightRef.current = false;
    setControlPending(false);
    const capturedTabId = activeTabId;
    const capturedSessionId = sessionId;
    const capturedLease = leaseToken;
    const capturedOwner = { ...owner };
    const capturedInc = activeTab.snapshot?.browserIncarnation;
    const capturedEpoch = activeTab.snapshot?.profileEpoch;
    try {
      await releaseBrowserControl(capturedOwner, capturedSessionId, { leaseToken: capturedLease });
    } catch {
      console.warn("[BrowserApp] Release control failed");
    } finally {
      if (isCurrentConnection(capturedOwner)) {
        const curWin = useWindowStore.getState().session.windows[window.id];
        if (curWin) {
          const curState = readCanonicalBrowserWindowState(curWin.appState, fallbackTabIdRef.current);
          const curTab = findBrowserTab(curState, capturedTabId);
          if (
            curTab &&
            curTab.sessionId === capturedSessionId &&
            curTab.leaseToken === capturedLease &&
            curTab.snapshot?.browserIncarnation === capturedInc &&
            String(curTab.snapshot?.profileEpoch ?? "") === String(capturedEpoch ?? "")
          ) {
            writeCanonicalWindowState(window.id, patchBrowserTab(curState, capturedTabId, { isController: false, leaseToken: undefined }));
          }
        }
      }
    }
  }, [activeTab.snapshot?.browserIncarnation, activeTab.snapshot?.profileEpoch, activeTabId, leaseToken, owner, sessionId, window.id]);

  useEffect(() => {
    if (!isController || !leaseToken || !sessionId) return;
    const capturedTabId = activeTabId;
    const capturedSessionId = sessionId;
    const capturedLease = leaseToken;
    const capturedOwner = { ...owner };
    const capturedInc = activeTab.snapshot?.browserIncarnation;
    const capturedEpoch = activeTab.snapshot?.profileEpoch;
    let cancelled = false;
    const matchesCaptured = (curTab: BrowserTabRuntime | undefined): boolean => Boolean(
      curTab &&
      curTab.sessionId === capturedSessionId &&
      curTab.isController &&
      curTab.leaseToken === capturedLease &&
      curTab.snapshot?.browserIncarnation === capturedInc &&
      String(curTab.snapshot?.profileEpoch ?? "") === String(capturedEpoch ?? ""),
    );
    const interval = setInterval(async () => {
      if (cancelled || !isDocumentVisible() || !isCurrentConnection(capturedOwner)) return;
      try {
        const resp = await renewBrowserControl(capturedOwner, capturedSessionId, { leaseToken: capturedLease });
        if (cancelled || !isCurrentConnection(capturedOwner)) return;
        const curWin = useWindowStore.getState().session.windows[window.id];
        if (!curWin) return;
        const curState = readCanonicalBrowserWindowState(curWin.appState, fallbackTabIdRef.current);
        if (matchesCaptured(findBrowserTab(curState, capturedTabId))) {
          writeCanonicalWindowState(window.id, patchBrowserTab(curState, capturedTabId, { leaseToken: resp.leaseToken }));
        }
      } catch {
        if (cancelled || !isCurrentConnection(capturedOwner)) return;
        console.warn("[BrowserApp] Lease renewal failed; reverting to view-only");
        const curWin = useWindowStore.getState().session.windows[window.id];
        if (!curWin) return;
        const curState = readCanonicalBrowserWindowState(curWin.appState, fallbackTabIdRef.current);
        if (matchesCaptured(findBrowserTab(curState, capturedTabId))) {
          writeCanonicalWindowState(window.id, patchBrowserTab(curState, capturedTabId, { isController: false, leaseToken: undefined }));
        }
      }
    }, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [activeTab.snapshot?.browserIncarnation, activeTab.snapshot?.profileEpoch, activeTabId, isController, leaseToken, owner, sessionId, window.id]);

  const handleReturnToOpener = useCallback(async () => {
    if (!sessionId || activeTab.kind !== "popup") return;
    const res = completeBrowserPopupTab(owner, window.id, activeTabId, sessionId);
    if (res === "removed") { setNavigationError(null); return; }
    setNavigationError("Opener page is no longer running");
  }, [activeTab.kind, activeTabId, owner, sessionId, window.id]);

  const handleOpenActivePopup = useCallback(async () => {
    const popupId = activeTab.snapshot?.activePopupSessionId;
    if (!sessionId || !popupId) return;
    const curWin = useWindowStore.getState().session.windows[window.id];
    const curState = readCanonicalBrowserWindowState(curWin?.appState, fallbackTabIdRef.current);
    const existingPopup = curState.tabs.find((t) => t.kind === "popup" && t.sessionId === popupId);
    if (existingPopup) {
      writeCanonicalWindowState(window.id, selectBrowserTab(curState, existingPopup.tabId));
      setNavigationError(null);
      return;
    }
    const verified = captureVerifiedBrowserOwner(owner.profileId);
    if (!verified || verified.owner.generation !== owner.generation) {
      setNavigationError("Profile disconnected or generation changed before opening popup");
      return;
    }
    try {
      const openerSnap = await getBrowserSession(owner, sessionId);
      if (!openerSnap.activePopupSessionId || openerSnap.activePopupSessionId !== popupId) {
        setNavigationError("Popup window is no longer available");
        return;
      }
      const popupSnap = await getVerifiedBrowserSession(verified.owner, verified.scope, popupId);
      if (
        !popupSnap ||
        popupSnap.parentSessionId !== sessionId ||
        popupSnap.browserIncarnation !== openerSnap.browserIncarnation ||
        String(popupSnap.profileEpoch) !== String(openerSnap.profileEpoch)
      ) {
        setNavigationError("Popup window is no longer available");
        return;
      }
      const latestWin = useWindowStore.getState().session.windows[window.id];
      const latestState = readCanonicalBrowserWindowState(latestWin?.appState, fallbackTabIdRef.current);
      const openerTab = findBrowserTab(latestState, activeTabId);
      if (!openerTab || openerTab.sessionId !== sessionId || latestState.closing) return;
      if (latestState.ownerScope && !areBrowserOwnerScopesEqual(latestState.ownerScope, verified.scope)) return;
      const alreadyOpen = latestState.tabs.find((t) => t.kind === "popup" && t.sessionId === popupId);
      if (alreadyOpen) {
        writeCanonicalWindowState(window.id, selectBrowserTab(latestState, alreadyOpen.tabId));
        setNavigationError(null);
        return;
      }
      const admitted = commitTargetAdmission(verified.scope, popupId, () => {
        const cleanDraft = normalizeBrowserCommittedUrl(popupSnap.url) ?? popupSnap.url;
        const cleared = patchBrowserTab(latestState, activeTabId, { dismissedPopupSessionId: undefined });
        const popupTab: BrowserTabRuntime = {
          ...createBlankBrowserTab({ draftValue: cleanDraft, dirty: false }),
          kind: "popup",
          sessionId: popupSnap.browserSessionId,
          committedUrl: normalizeBrowserCommittedUrl(popupSnap.url),
          title: popupSnap.title,
          phase: "live",
          parentTabId: activeTabId,
          popupAdmissionId: popupSnap.browserSessionId,
          snapshot: popupSnap,
        };
        const added = addBrowserTab(cleared, { tab: popupTab, afterTabId: activeTabId, activate: true });
        writeCanonicalWindowState(window.id, { ...added.state, ownerScope: verified.scope });
      });
      if (admitted) setNavigationError(null);
    } catch (err) {
      setNavigationError(sanitizeBrowserError(err, "Popup window is no longer available."));
    }
  }, [activeTab.snapshot?.activePopupSessionId, activeTabId, owner, sessionId, window.id]);

  const handleClearRemembered = useCallback(async () => {
    const verified = captureVerifiedBrowserOwner(owner.profileId);
    if (!verified || verified.owner.generation !== owner.generation) {
      setClearStatus({ kind: "error", message: "Connect and verify this profile before clearing remembered pages." });
      return;
    }
    setClearPending(true);
    setClearStatus(null);
    try {
      const res = await clearRememberedPagesAndSuppress(verified.scope, () => {
        const raw = localStorage.getItem(OS_SESSION_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const validation = validateOsSession(parsed);
        if (!validation.valid || !validation.session) {
          throw new Error("Invalid persisted OS session.");
        }
        const suppressedScopes = loadBrowserRecoveryDisk().addressSuppressedScopes;
        const stripped = sanitizeSessionForPersistence(validation.session, "local", suppressedScopes);
        localStorage.setItem(OS_SESSION_STORAGE_KEY, JSON.stringify(stripped));
      });
      setClearStatus(res.success ? { kind: "success", message: "Remembered pages cleared locally." } : { kind: "error", message: sanitizeBrowserError(res.error, "Address suppression persisted, but local session cleanup failed.") });
      setRecoveryTick((n) => n + 1);
    } catch (err) {
      setClearStatus({ kind: "error", message: sanitizeBrowserError(err, "Failed to clear remembered pages.") });
    } finally {
      setClearPending(false);
    }
  }, [owner.generation, owner.profileId]);

  const handleAttachInventorySession = useCallback((sess: BrowserSessionDto) => {
    const curWin = useWindowStore.getState().session.windows[window.id];
    const curState = readCanonicalBrowserWindowState(curWin?.appState, fallbackTabIdRef.current);
    const existing = curState.tabs.find((t) => t.sessionId === sess.browserSessionId);
    if (existing) {
      writeCanonicalWindowState(window.id, selectBrowserTab(curState, existing.tabId));
      setNavigationError(null);
      return;
    }
    const isPopup = Boolean(sess.parentSessionId);
    const openerTab = isPopup ? curState.tabs.find((t) => t.sessionId === sess.parentSessionId) : undefined;
    const cleanUrl = normalizeBrowserCommittedUrl(sess.url);
    const newTab: BrowserTabRuntime = {
      ...createBlankBrowserTab({ kind: isPopup ? "popup" : "ordinary", draftValue: cleanUrl ?? "", dirty: false }),
      sessionId: sess.browserSessionId,
      committedUrl: cleanUrl,
      title: sess.title,
      phase: sess.status === "running" ? "live" : "connecting",
      ...(openerTab ? { parentTabId: openerTab.tabId } : {}),
      ...(isPopup ? { popupAdmissionId: sess.browserSessionId } : {}),
      snapshot: sess,
    };
    const added = addBrowserTab(curState, { tab: newTab, afterTabId: openerTab?.tabId, activate: true });
    writeCanonicalWindowState(window.id, { ...added.state, ...(verifiedScope ? { ownerScope: verifiedScope } : {}) });
    setNavigationError(null);
  }, [verifiedScope, window.id]);

  const showSelectionPanel = Boolean(
    !masked && (selection.selectionActive || selection.preview || selection.preparedArtifact || selection.error || selection.notice),
  );
  const { tabDomId, panelDomId } = getBrowserTabIds(window.id, activeTabId);
  const showStreamSlot = !ownerMismatch && (activeTab.phase === "live" || activeTab.phase === "connecting");

  return (
    <div data-os-browser-app={window.id} data-testid={`browser-app-${window.id}`} className="os-browser-chrome">
      <BrowserTabStrip
        windowId={window.id}
        tabs={canonicalState.tabs}
        activeTabId={activeTabId}
        privacyMasked={privacyMasked}
        ownerMismatch={ownerMismatch}
        closingWindow={Boolean(canonicalState.closing)}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewTab={handleNewTab}
      />

      <BrowserAddressBar
        windowId={window.id}
        tab={activeTab}
        draftValue={activeDraftValue}
        navigationPending={navigationPending}
        audioMuted={audioMuted}
        audioBlocked={audioBlocked}
        privacyMasked={privacyMasked}
        ownerMismatch={ownerMismatch}
        toolsOpen={toolsOpen}
        toolsPanelId={toolsPanelId}
        addressInputRef={addressInputRef}
        toolsButtonRef={toolsButtonRef}
        onDraftChange={(val) => updateTabDraftValue(window.id, activeTabId, val, fallbackTabIdRef.current)}
        onSubmitAddress={handleSubmitAddress}
        onEscapeDraft={() => resetTabDraftToCommitted(window.id, activeTabId, fallbackTabIdRef.current)}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onToggleAudio={handleToggleAudio}
        onToggleTools={() => setToolsOpen((o) => !o)}
      />

      {ownerMismatch && (
        <div role="alert" data-testid="browser-owner-mismatch-banner" className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--color-danger)]/15 border-b border-[var(--color-danger)]/30 text-[var(--color-danger)] text-xs">
          <span>This browser window belongs to a different server, user, or environment. Content is masked.</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button type="button" data-testid="browser-mismatch-discard-btn" onClick={() => useWindowStore.getState().closeWindow(window.id)} className="rounded border border-[var(--color-danger)]/40 px-2 py-0.5 text-[11px] font-medium">Discard Window</button>
            <button type="button" data-testid="browser-mismatch-new-window-btn" onClick={() => void executeAction({ id: "app.browser.new-window", context: { kind: "desktop", desktopId: window.desktopId, owner } })} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text)]">New Window</button>
          </div>
        </div>
      )}

      {canonicalState.closing && (
        <div role="status" data-testid="browser-window-closing-banner" className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[var(--color-warning)]/15 border-b border-[var(--color-warning)]/30 text-[var(--color-warning)] text-xs">
          <span>{canonicalState.closing.status === "unknown" ? "Window close outcome unknown — use Recovery to retry close or acknowledge duplicate risk." : "Closing browser window…"}</span>
          {canonicalState.closing.status === "unknown" && !toolsOpen && (
            <button type="button" data-testid="browser-window-open-recovery-btn" onClick={() => setToolsOpen(true)} className="rounded border border-[var(--color-warning)]/50 px-2 py-0.5 text-[11px] font-medium">Open Recovery</button>
          )}
        </div>
      )}

      {!masked && activeTab.unsupportedReason && (
        <div role="alert" data-testid="browser-unsupported-banner" className="flex items-center justify-between px-3 py-1.5 bg-[var(--color-danger)]/15 border-b border-[var(--color-danger)]/30 text-[var(--color-danger)] text-xs">
          <span className="font-medium">Browser capability unavailable: {activeTab.unsupportedReason}</span>
        </div>
      )}

      {navigationError && activeTab.phase !== "new-tab" && (
        <div role="alert" data-testid="browser-navigation-error" className="px-3 py-1 bg-[var(--color-danger)]/10 border-b border-[var(--color-danger)]/20 text-xs text-[var(--color-danger)]">
          {masked ? "Action blocked while protected mode is active." : navigationError}
        </div>
      )}

      {!masked && activeTab.snapshot?.popupBlocked && (
        <div role="alert" data-testid="browser-popup-blocked-banner" className="flex items-center justify-between px-3 py-1 bg-amber-500/15 border-b border-amber-500/30 text-amber-300 text-xs">
          <span>Sign-in popup blocked: browser target capacity reached. Close an unused browser session and retry.</span>
        </div>
      )}

      {!masked && activeTab.kind === "popup" && activeTab.parentTabId && (
        <div data-testid="browser-popup-banner" className="flex items-center justify-between gap-2 px-3 py-1 bg-blue-500/15 border-b border-blue-500/30 text-blue-300 text-xs">
          <span className="truncate">Viewing popup window ({activeTab.committedUrl || "about:blank"})</span>
          <button type="button" data-testid="browser-popup-return-btn" onClick={() => void handleReturnToOpener()} className="shrink-0 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-400/40">Return to Page</button>
        </div>
      )}

      {!masked && activeTab.kind !== "popup" && activeTab.snapshot?.activePopupSessionId && (
        <div data-testid="browser-active-popup-banner" className="flex items-center justify-between gap-2 px-3 py-1 bg-blue-500/15 border-b border-blue-500/30 text-blue-300 text-xs">
          <span className="truncate">Sign-in popup window is open</span>
          <button type="button" data-testid="browser-open-popup-btn" onClick={() => void handleOpenActivePopup()} className="shrink-0 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-400/40">Open Popup</button>
        </div>
      )}

      {toolsOpen && (
        <BrowserTools
          panelId={toolsPanelId}
          windowId={window.id}
          owner={owner}
          verifiedScope={verifiedScope}
          activeTab={activeTab}
          windowClosing={canonicalState.closing}
          privacyMasked={privacyMasked}
          ownerMismatch={ownerMismatch}
          navigationError={navigationError}
          selectionPending={Boolean(selection.pending)}
          selectionActive={Boolean(selection.selectionActive)}
          controlPending={controlPending}
          clearPending={clearPending}
          clearStatus={clearStatus}
          onAcquireControl={() => void handleAcquireControl()}
          onReleaseControl={() => void handleReleaseControl()}
          onToggleSelection={() => { if (selection.selectionActive) void selection.cancelSelection(); else void selection.startSelection(); }}
          onClearRemembered={() => void handleClearRemembered()}
          onCloseTools={() => { setToolsOpen(false); requestAnimationFrame(() => toolsButtonRef.current?.focus()); }}
          onAttachSession={handleAttachInventorySession}
          onWindowStateUpdated={() => setRecoveryTick((n) => n + 1)}
          onCloseUnknownWindowAllowed={() => useWindowStore.getState().closeWindow(window.id)}
          qualityPreference={qualityState.preference}
          qualityStatus={qualityState.status}
          qualityPending={qualityState.pending}
          onQualityPreferenceChange={handleQualityPreferenceChange}
        />
      )}

      <div id={panelDomId} role="tabpanel" aria-labelledby={tabDomId} className="flex-1 min-h-0 relative flex flex-col">
        <div
          ref={slotRef}
          data-os-browser-slot={window.id}
          data-testid={`browser-slot-${window.id}`}
          data-selection-active={selection.selectionActive ? "true" : "false"}
          className={showStreamSlot ? "flex-1 min-h-0 relative bg-black" : "hidden"}
        />

        {!showStreamSlot && activeTab.phase === "new-tab" && (
          <BrowserNewTabPage
            draftValue={activeDraftValue}
            navigationError={navigationError}
            privacyMasked={privacyMasked}
            ownerMismatch={ownerMismatch}
            clearPending={clearPending}
            clearStatus={clearStatus}
            unresolvedCount={unresolvedCount}
            onDraftChange={(val) => updateTabDraftValue(window.id, activeTabId, val, fallbackTabIdRef.current)}
            onSubmitAddress={handleSubmitAddress}
            onEscapeDraft={() => resetTabDraftToCommitted(window.id, activeTabId, fallbackTabIdRef.current)}
            onClearRemembered={() => void handleClearRemembered()}
            onOpenRecovery={() => setToolsOpen(true)}
          />
        )}

        {!showStreamSlot && activeTab.phase !== "new-tab" && (
          <div
            data-testid={
              activeTab.phase === "deferred" ? "browser-deferred-panel" :
              activeTab.phase === "creating" ? "browser-creating-panel" :
              activeTab.phase === "create-unknown" || activeTab.phase === "close-unknown" || activeTab.phase === "closing" ? "browser-unknown-panel" :
              "browser-unavailable-panel"
            }
            className="os-browser-new-tab-panel"
          >
            <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-3 text-xs">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                {activeTab.phase === "capacity" ? "Browser capacity busy — Retry when ready" :
                 activeTab.phase === "deferred" ? "Page deferred until reopened" :
                 activeTab.phase === "creating" ? "Opening page…" :
                 activeTab.phase === "closing" ? "Closing page…" :
                 activeTab.phase === "create-unknown" || activeTab.phase === "close-unknown" ? "Operation outcome unknown" :
                 "Page unavailable — Reload to open a fresh page"}
              </h3>
              {!masked && (activeTab.unavailableReason || activeTab.committedUrl) && (
                <p className="text-[var(--color-text-muted)] break-all">
                  {activeTab.unavailableReason ?? activeTab.committedUrl}
                </p>
              )}
              <div className="flex items-center gap-2">
                {(activeTab.phase === "unavailable" || activeTab.phase === "capacity" || activeTab.phase === "deferred") && activeTab.committedUrl && (
                  <button
                    type="button"
                    data-testid={activeTab.phase === "deferred" ? "browser-deferred-reload-btn" : "browser-unavailable-reload-btn"}
                    disabled={masked}
                    onClick={handleReload}
                    className="rounded bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-40"
                  >
                    Reload
                  </button>
                )}
                {(activeTab.phase === "create-unknown" || activeTab.phase === "close-unknown") && (
                  <button
                    type="button"
                    data-testid="browser-open-recovery-btn"
                    onClick={() => setToolsOpen(true)}
                    className="rounded border border-[var(--color-warning)]/50 bg-[var(--color-warning)]/10 px-3 py-1.5 text-xs font-medium text-[var(--color-warning)]"
                  >
                    Open Tools & Recovery
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showSelectionPanel && (
        <div data-testid="browser-selection-panel" className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text)] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">CDP Selection Preview</div>
            <button type="button" data-testid="browser-selection-close-btn" onClick={() => void selection.cancelSelection()} className="px-1.5 py-0.5 rounded text-[10px] border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]">Clear</button>
          </div>
          {selection.notice && <p role="status" data-testid="browser-selection-notice" className="text-[11px] text-emerald-400">{selection.notice}</p>}
          {selection.error && <p role="alert" data-testid="browser-selection-error" className="text-[11px] text-red-400">{selection.error}</p>}
          {selection.preview && (
            <div data-testid="browser-selection-preview-card" className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 space-y-1 font-mono text-[11px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-[var(--color-primary)]">&lt;{selection.preview.tag}&gt;</span>
                {selection.preview.role && <span className="px-1 rounded bg-[var(--color-surface)] text-[10px]">role={selection.preview.role}</span>}
                {selection.preview.accessibleName && <span className="text-[var(--color-text-muted)] truncate max-w-[200px]">"{selection.preview.accessibleName}"</span>}
              </div>
              <div className="text-[10px] text-[var(--color-text-muted)] truncate">{selection.preview.locator}</div>
              {selection.preview.text && <div className="text-[10px] text-[var(--color-text)] truncate">{selection.preview.text}</div>}
            </div>
          )}
          {selection.preview && (
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-1.5">
                Terminal:
                <select
                  data-testid="browser-selection-terminal-select"
                  value={selectedTerminal?.sessionId ?? ""}
                  onChange={(e) => setSelectedTerminalId(e.target.value)}
                  disabled={Boolean(selection.preparedArtifact) || selection.pending}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-0.5 text-[11px] text-[var(--color-text)]"
                >
                  {terminalCandidates.length === 0 ? (
                    <option value="">No active terminals</option>
                  ) : (
                    terminalCandidates.map((t) => (
                      <option key={t.sessionId} value={t.sessionId}>
                        {t.label} {t.ready ? `(#${t.incarnation})` : `(${t.reason ?? "unavailable"})`}
                      </option>
                    ))
                  )}
                </select>
              </label>
              {!selection.preparedArtifact ? (
                <button type="button" data-testid="browser-selection-prepare-btn" disabled={!selectedTerminal?.ready || selection.pending} onClick={() => { if (selectedTerminal) void selection.prepareArtifact(selectedTerminal, true); }} className="px-2.5 py-1 rounded text-[11px] font-medium bg-[var(--color-primary)] text-white disabled:opacity-40">Prepare Artifact</button>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span data-testid="browser-selection-artifact-ref" className="font-mono text-[10px] text-[var(--color-text-muted)] max-w-[320px] truncate" title={selection.preparedArtifact.reference}>{selection.preparedArtifact.reference}</span>
                  <span data-testid="browser-selection-artifact-png-status" className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-surface-2)] border border-[var(--color-border)]">{selection.preparedArtifact.artifact.pngPath ? "PNG attached" : "JSON only"}</span>
                  <button type="button" data-testid="browser-selection-handoff-btn" disabled={selection.inserted || selection.pending} onClick={() => void selection.handoffArtifact()} className="px-2.5 py-1 rounded text-[11px] font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40">{selection.inserted ? "Inserted" : "Insert to Terminal"}</button>
                  {!selection.inserted && (
                    <button type="button" data-testid="browser-selection-discard-btn" disabled={selection.pending} onClick={() => void selection.discardArtifact()} className="px-2 py-1 rounded text-[11px] border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]">Discard</button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
