import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useLockScreenStore } from "@/stores/lock-screen.js";
import { useWindowStore } from "./window-store.js";
import { syncBrowserSessionWindow } from "./browser-session-sync.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import {
  getConnectionSnapshot,
  isCurrentConnection,
  subscribeConnections,
  useConnectionSnapshot,
} from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { CanvasView } from "../browser-host/canvas-view.js";
import { BrowserStreamController } from "../browser-host/stream-controller.js";
import {
  isDocumentVisible,
  subscribeDocumentVisibility,
} from "../browser-host/visibility-demand.js";
import {
  BrowserInputController,
  type CanvasPointerInput,
} from "../browser-host/input-controller.js";
import { PcmPlayer } from "../browser-host/pcm-player.js";
import {
  TextInputProxy,
  writeTextToClipboard,
  type TextInputProxyHandle,
} from "../browser-host/text-input-proxy.js";
import {
  acquireBrowserControl,
  BrowserHostClientError,
  getBrowserSelectedText,
  getBrowserSession,
  mintViewerAttachmentTickets,
  releaseBrowserControl,
  respondBrowserDialog,
  type ViewerAttachmentCredentials,
} from "../api/browser-host-client.js";
import type {
  BrowserAudioChunk,
  BrowserSessionDto,
  QualityPreference,
  ServerControlEvent,
  StreamQualityEvent,
} from "../api/browser-host-types.js";
import {
  clearStreamQuality,
  getQualityPreference,
  publishStreamQuality,
  releaseGeneration,
  releaseTab,
  subscribeStreamQuality,
  type StreamQualityTuple,
} from "./browser/browser-stream-quality.js";
import type { OsWindow } from "./types.js";
import { runSerializedBrowserControlAcquire } from "./browser/browser-control-gate.js";
import {
  browserTabSlotKey,
  findBrowserTab,
  patchBrowserTab,
} from "./browser/browser-tab-state.js";
import { readCanonicalBrowserWindowState } from "./browser/browser-navigation.js";
import {
  areBrowserOwnerScopesEqual,
  captureVerifiedBrowserOwner,
  createBrowserNativeTargetKey,
  isCanonicalPositiveU64Decimal,
  isCapturedBrowserOwnerCurrent,
} from "./browser/browser-owner-scope.js";
import { commitNativeTargetAdmission } from "./browser/browser-admission-guard.js";
import { isNativeTargetClosing } from "./browser/browser-closing-gates.js";
import {
  dispatchBrowserCreateIntent,
  processWithheldCleanups,
} from "./browser/browser-create-lifecycle.js";
import {
  completeBrowserPopupTab,
  reconcileOpenerPopupSnapshot,
  reconcilePopupTabCompletion,
} from "./browser/browser-popup-tabs.js";
import type {
  BrowserOwnerScope,
  BrowserTabRuntime,
  BrowserWindowState,
} from "./browser/browser-tab-types.js";

// ============================================================================
// Tuple-Keyed Slot Registry for Root-Owned Browser Keep-Alive
// ============================================================================

export interface BrowserStreamSlot {
  windowId: string;
  tabId: string;
  element: HTMLElement | null;
  isVisible: boolean;
  audioMuted?: boolean;
}

const slotRegistry = new Map<string, BrowserStreamSlot>();
const slotListeners = new Set<() => void>();

const fencedBrowserProfiles = new Map<
  string,
  { generation: number; reason: string }
>();
const fenceListeners = new Set<() => void>();

const proxyFocusListeners = new Map<
  string,
  (owner: ConnectionRef, sessionId: string, leaseToken: string) => void
>();

const audioUnlockListeners = new Map<
  string,
  (owner: ConnectionRef, sessionId?: string) => void
>();

const audioBlockedTabs = new Set<string>();
const audioBlockedListeners = new Set<() => void>();

interface DispatchedTabCreateRecord {
  readonly actionSequence: number;
  readonly owner: ConnectionRef;
  readonly scope: BrowserOwnerScope;
}

const dispatchedTabCreates = new Map<string, DispatchedTabCreateRecord>();

function setBrowserAudioBlocked(
  windowId: string,
  tabId: string,
  blocked: boolean,
): void {
  const key = browserTabSlotKey(windowId, tabId);
  const had = audioBlockedTabs.has(key);
  if (blocked === had) return;
  if (blocked) {
    audioBlockedTabs.add(key);
  } else {
    audioBlockedTabs.delete(key);
  }
  audioBlockedListeners.forEach((l) => l());
}

export function subscribeBrowserAudioBlocked(listener: () => void): () => void {
  audioBlockedListeners.add(listener);
  return () => {
    audioBlockedListeners.delete(listener);
  };
}

export function isBrowserAudioBlocked(
  windowId: string,
  tabId: string,
): boolean {
  return audioBlockedTabs.has(browserTabSlotKey(windowId, tabId));
}

export function requestBrowserAudioUnlock(
  windowId: string,
  tabId: string,
  owner: ConnectionRef,
  sessionId?: string,
): void {
  audioUnlockListeners.get(browserTabSlotKey(windowId, tabId))?.(
    owner,
    sessionId,
  );
}

export function requestBrowserProxyFocus(
  windowId: string,
  tabId: string,
  owner: ConnectionRef,
  sessionId: string,
  leaseToken: string,
): void {
  proxyFocusListeners.get(browserTabSlotKey(windowId, tabId))?.(
    owner,
    sessionId,
    leaseToken,
  );
}

function subscribeBrowserViewFences(listener: () => void): () => void {
  fenceListeners.add(listener);
  return () => {
    fenceListeners.delete(listener);
  };
}

export function isBrowserViewFenced(
  profileId?: string,
  generation?: number,
): boolean {
  if (!profileId) return false;
  const entry = fencedBrowserProfiles.get(profileId);
  if (!entry) return false;
  return generation === undefined || entry.generation === generation;
}

export function fenceBrowserViewsForProfile(
  profileId?: string,
  reason = "Shared Browser profile reset or logged out",
  expectedGeneration?: number,
): void {
  if (!profileId) return;
  const gen = getConnectionSnapshot(profileId)?.owner.generation ?? 0;
  if (expectedGeneration !== undefined && gen !== expectedGeneration) {
    return;
  }
  releaseGeneration(profileId, gen);
  fencedBrowserProfiles.set(profileId, { generation: gen, reason });
  // Notify fence listeners FIRST so active audio/sockets flush synchronously before store mutations
  fenceListeners.forEach((l) => l());
  const state = useWindowStore.getState();
  const windows = state.session?.windows ?? {};
  for (const win of Object.values(windows)) {
    if (win.appId === "browser" && win.ctx.profileId === profileId && win.appState) {
      const appState = win.appState as unknown as BrowserWindowState;
      if (Array.isArray(appState.tabs)) {
        state.updateAppState(win.id, {
          ...appState,
          tabs: appState.tabs.map((t) => ({
            ...t,
            sessionId: undefined,
            phase: t.committedUrl ? "unavailable" : "new-tab",
            snapshot: undefined,
            isController: false,
            leaseToken: undefined,
            viewerId: undefined,
            unsupportedReason: reason,
          })),
        } as unknown as Record<string, unknown>);
      }
    }
  }
}

export function clearBrowserViewFenceForProfile(
  profileId?: string,
  expectedGeneration?: number,
): void {
  if (!profileId || !fencedBrowserProfiles.has(profileId)) return;
  const gen = getConnectionSnapshot(profileId)?.owner.generation ?? 0;
  if (expectedGeneration !== undefined && gen !== expectedGeneration) {
    return;
  }
  fencedBrowserProfiles.delete(profileId);
  const state = useWindowStore.getState();
  const windows = state.session?.windows ?? {};
  for (const win of Object.values(windows)) {
    if (win.appId === "browser" && win.ctx.profileId === profileId && win.appState) {
      const appState = win.appState as unknown as BrowserWindowState;
      if (Array.isArray(appState.tabs)) {
        state.updateAppState(win.id, {
          ...appState,
          tabs: appState.tabs.map((t) => ({
            ...t,
            unsupportedReason: undefined,
          })),
        } as unknown as Record<string, unknown>);
      }
    }
  }
  fenceListeners.forEach((l) => l());
}

export function registerBrowserStreamSlot(
  windowId: string,
  tabId: string,
  element: HTMLElement | null,
  isVisible: boolean,
  audioMuted = false,
): () => void {
  const key = browserTabSlotKey(windowId, tabId);
  const existing = slotRegistry.get(key);
  slotRegistry.set(key, {
    windowId,
    tabId,
    element,
    isVisible,
    audioMuted: existing?.audioMuted ?? audioMuted,
  });
  slotListeners.forEach((l) => l());
  return () => {
    const cur = slotRegistry.get(key);
    if (!cur || cur.element === element) {
      slotRegistry.delete(key);
      slotListeners.forEach((l) => l());
    }
  };
}

export function updateBrowserStreamSlot(
  windowId: string,
  tabId: string,
  element: HTMLElement | null,
  isVisible: boolean,
  audioMuted = false,
): void {
  const key = browserTabSlotKey(windowId, tabId);
  const existing = slotRegistry.get(key);
  if (
    existing?.element === element &&
    existing.isVisible === isVisible &&
    Boolean(existing.audioMuted) === audioMuted
  ) {
    return;
  }
  slotRegistry.set(key, { windowId, tabId, element, isVisible, audioMuted });
  slotListeners.forEach((l) => l());
}

export function getBrowserStreamSlot(
  windowId: string,
  tabId: string,
): BrowserStreamSlot | undefined {
  return slotRegistry.get(browserTabSlotKey(windowId, tabId));
}

function readBrowserWindowAndTab(
  windowId: string,
  tabId: string,
): { win: OsWindow; appState: BrowserWindowState; tab: BrowserTabRuntime } | null {
  const win = useWindowStore.getState().session?.windows?.[windowId];
  if (!win || win.appId !== "browser" || !win.appState) return null;
  const appState = readCanonicalBrowserWindowState(win.appState, tabId);
  const tab = findBrowserTab(appState, tabId);
  if (!tab) return null;
  return { win, appState, tab };
}

function updateBrowserTabInStore(
  windowId: string,
  tabId: string,
  patch: Partial<Omit<BrowserTabRuntime, "tabId">>,
  nextOwnerScope?: BrowserOwnerScope,
): void {
  const current = readBrowserWindowAndTab(windowId, tabId);
  if (!current || current.appState.closing) return;
  const nextState = patchBrowserTab(current.appState, tabId, patch);
  useWindowStore.getState().updateAppState(windowId, {
    ...nextState,
    ...(nextOwnerScope ? { ownerScope: nextOwnerScope } : {}),
  } as unknown as Record<string, unknown>);
}

// ============================================================================
// Dialog Modal Overlay
// ============================================================================

export interface ActiveDialogState {
  dialogId: string;
  message: string;
  dialogType: string;
  sessionId: string;
  browserIncarnation: string;
  profileEpoch: string;
}

interface BrowserDialogModalProps {
  dialog: ActiveDialogState;
  onConfirm: (promptText?: string) => void;
  onCancel: () => void;
}

function BrowserDialogModal({
  dialog,
  onConfirm,
  onCancel,
}: BrowserDialogModalProps) {
  const [promptValue, setPromptValue] = useState("");

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="browser-dialog-overlay"
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4 select-text pointer-events-auto"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xl space-y-3">
        <h4 className="text-xs font-semibold text-[var(--color-text)] uppercase tracking-wider">
          {dialog.dialogType === "prompt"
            ? "Prompt"
            : dialog.dialogType === "confirm"
              ? "Confirm"
              : dialog.dialogType === "beforeunload"
                ? "Leave Page?"
                : "Alert"}
        </h4>
        <p className="text-xs text-[var(--color-text-muted)] whitespace-pre-wrap">
          {dialog.message}
        </p>

        {dialog.dialogType === "prompt" && (
          <input
            type="text"
            data-testid="browser-dialog-prompt-input"
            value={promptValue}
            onChange={(e) => setPromptValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onConfirm(promptValue);
              if (e.key === "Escape") onCancel();
            }}
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2.5 py-1 text-xs text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
            autoFocus
          />
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          {dialog.dialogType !== "alert" && (
            <button
              type="button"
              data-testid="browser-dialog-cancel-btn"
              onClick={onCancel}
              className="rounded border border-[var(--color-border)] px-3 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            data-testid="browser-dialog-ok-btn"
            onClick={() => onConfirm(promptValue)}
            className="rounded bg-[var(--color-primary)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--color-primary)]/90"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Single Parked Browser Stream Item (Per Window + Tab Tuple)
// ============================================================================

interface ParkedBrowserStreamItemProps {
  window: OsWindow;
  tab: BrowserTabRuntime;
  parkingHost: HTMLElement;
}

function snapshotBrowserPointer(
  event: React.PointerEvent<HTMLCanvasElement>,
): CanvasPointerInput {
  return {
    currentTarget: event.currentTarget,
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  };
}

interface PendingBrowserPointer {
  pointerId: number;
  down: CanvasPointerInput;
  move?: CanvasPointerInput;
  up?: CanvasPointerInput;
  replayed?: boolean;
}

function ParkedBrowserStreamItem({
  window: win,
  tab,
  parkingHost,
}: ParkedBrowserStreamItemProps) {
  const slotKey = useMemo(
    () => browserTabSlotKey(win.id, tab.tabId),
    [win.id, tab.tabId],
  );
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const pendingCredsRef = useRef<ViewerAttachmentCredentials | null>(null);
  const currentAttachedCredsRef =
    useRef<ViewerAttachmentCredentials | null>(null);
  const textInputProxyRef = useRef<TextInputProxyHandle | null>(null);
  const streamControllerRef = useRef<BrowserStreamController | null>(null);
  const inputControllerRef = useRef<BrowserInputController | null>(null);
  const pendingPointerRef = useRef<PendingBrowserPointer | null>(null);
  const pcmPlayerRef = useRef<PcmPlayer | null>(null);
  const pointerVisibleRef = useRef(false);
  const pointerDownPosRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const cachedSelectedTextRef = useRef<{
    text: string;
    sessionId: string;
    leaseToken: string;
    navigationRevision: string;
    browserIncarnation: string;
    profileEpoch: string;
    scopeKey: string;
  } | null>(null);
  const selectedTextRefreshTimerRef = useRef<number | null>(null);
  const selectionCacheGenRef = useRef(0);

  const clearSelectedTextCache = useCallback(() => {
    selectionCacheGenRef.current += 1;
    clearTimeout(selectedTextRefreshTimerRef.current ?? undefined);
    selectedTextRefreshTimerRef.current = null;
    cachedSelectedTextRef.current = null;
  }, []);

  const readSelectionAuthority = useCallback(() => {
    const cur = readBrowserWindowAndTab(win.id, tab.tabId);
    const verified = captureVerifiedBrowserOwner(win.ctx.profileId);
    const liveOwner = ownerRef.current;
    if (
      !cur ||
      !verified ||
      verified.owner.generation !== liveOwner.generation ||
      !isCurrentConnection(liveOwner) ||
      isSuppressedRef.current ||
      !isEffectiveVisibleRef.current ||
      cur.appState.closing ||
      cur.appState.activeTabId !== tab.tabId ||
      (cur.appState.ownerScope &&
        !areBrowserOwnerScopesEqual(cur.appState.ownerScope, verified.scope)) ||
      cur.tab.phase !== "live" ||
      cur.tab.snapshot?.status !== "running" ||
      !cur.tab.isController ||
      !cur.tab.leaseToken ||
      !cur.tab.sessionId
    ) {
      return null;
    }
    return {
      sessionId: cur.tab.sessionId,
      leaseToken: cur.tab.leaseToken,
      navigationRevision: String(cur.tab.snapshot.navigationRevision ?? ""),
      browserIncarnation: cur.tab.snapshot.browserIncarnation ?? "",
      profileEpoch: String(cur.tab.snapshot.profileEpoch ?? ""),
      scopeKey: JSON.stringify(verified.scope),
    };
  }, [tab.tabId, win.ctx.profileId, win.id]);
  const [streamController, setStreamController] =
    useState<BrowserStreamController | null>(null);
  const [inputController, setInputController] =
    useState<BrowserInputController | null>(null);

  const [slot, setSlot] = useState<BrowserStreamSlot | null>(
    () => slotRegistry.get(slotKey) ?? null,
  );
  const [activeDialog, setActiveDialog] = useState<ActiveDialogState | null>(
    null,
  );
  const [controlError, setControlError] = useState<string | null>(null);
  const [viewerCapacityError, setViewerCapacityError] = useState<string | null>(
    null,
  );
  const [streamStatus, setStreamStatus] = useState<string>("idle");
  const [retryNonce, setRetryNonce] = useState(0);
  const cancelPendingGesture = useCallback(() => {
    pendingPointerRef.current = null;
    inputControllerRef.current?.cancelControlHandoff();
    textInputProxyRef.current?.reset();
  }, []);

  const canPlayAudioRef = useRef<() => boolean>(() => false);
  const ensurePcmPlayer = useCallback((): PcmPlayer => {
    if (!pcmPlayerRef.current) {
      pcmPlayerRef.current = new PcmPlayer({
        canPlay: () => canPlayAudioRef.current(),
        onAutoplayBlockedChange: (blocked) =>
          setBrowserAudioBlocked(win.id, tab.tabId, blocked),
      });
    }
    return pcmPlayerRef.current;
  }, [win.id, tab.tabId]);

  useEffect(() => {
    const handleWindowBlur = () => {
      cancelPendingGesture();
      inputControllerRef.current?.releaseAllHeldInput();
    };
    window.addEventListener("blur", handleWindowBlur);
    return () => window.removeEventListener("blur", handleWindowBlur);
  }, [cancelPendingGesture]);

  const isCognitoActive = useCognitoModeStore((state) => state.active);
  const isLockScreenActive = useLockScreenStore((state) => state.isLocked);
  const connSnap = useConnectionSnapshot(win.ctx.profileId);
  const currentGen = connSnap?.owner.generation ?? 0;
  const isProfileResetFenced = useSyncExternalStore(
    subscribeBrowserViewFences,
    () => isBrowserViewFenced(win.ctx.profileId, currentGen),
    () => false,
  );
  const isDocVisible = useSyncExternalStore(
    subscribeDocumentVisibility,
    isDocumentVisible,
    () => true,
  );
  const isSuppressed =
    isCognitoActive || isLockScreenActive || isProfileResetFenced;
  const owner = useMemo<ConnectionRef>(
    () => ({
      profileId: win.ctx.profileId,
      generation: currentGen,
    }),
    [win.ctx.profileId, currentGen],
  );
  const ownerRef = useRef<ConnectionRef>(owner);
  ownerRef.current = owner;
  const lastAudioDocEpochRef = useRef<string | null>(null);
  const isSuppressedRef = useRef(isSuppressed);
  isSuppressedRef.current = isSuppressed;
  const isEffectiveVisibleRef = useRef(false);
  const tabPhaseRef = useRef(tab.phase);
  tabPhaseRef.current = tab.phase;
  const connSnapRef = useRef(connSnap);
  connSnapRef.current = connSnap;

  const qualityTuple = useMemo<StreamQualityTuple>(
    () => ({
      profileId: win.ctx.profileId,
      generation: currentGen,
      windowId: win.id,
      tabId: tab.tabId,
    }),
    [win.ctx.profileId, currentGen, win.id, tab.tabId],
  );

  const latestTupleRef = useRef<StreamQualityTuple>(qualityTuple);
  latestTupleRef.current = qualityTuple;
  const lastPublishedTupleRef = useRef<StreamQualityTuple | null>(null);

  const prevGenRef = useRef(currentGen);
  useEffect(() => {
    if (prevGenRef.current !== currentGen) {
      releaseGeneration(win.ctx.profileId, prevGenRef.current);
      prevGenRef.current = currentGen;
    }
  }, [currentGen, win.ctx.profileId]);

  const lastSentPrefRef = useRef<QualityPreference | null>(getQualityPreference(qualityTuple));

  useEffect(() => {
    const unsubscribe = subscribeStreamQuality(qualityTuple, () => {
      const pref = getQualityPreference(qualityTuple);
      if (lastSentPrefRef.current !== pref) {
        lastSentPrefRef.current = pref;
        streamControllerRef.current?.setQualityPreference(pref);
      }
    });
    const initialPref = getQualityPreference(qualityTuple);
    if (lastSentPrefRef.current !== initialPref) {
      lastSentPrefRef.current = initialPref;
      streamControllerRef.current?.setQualityPreference(initialPref);
    }
    return unsubscribe;
  }, [qualityTuple]);


  const canConnectTab = useCallback(
    (targetOwner: ConnectionRef = ownerRef.current): boolean => {
      if (!isDocumentVisible()) {
        return false;
      }
      const liveSlot = slotRegistry.get(slotKey);
      if (!liveSlot?.isVisible || !liveSlot.element) {
        return false;
      }
      if (
        useCognitoModeStore.getState().active ||
        useLockScreenStore.getState().isLocked ||
        isBrowserViewFenced(targetOwner.profileId, targetOwner.generation) ||
        !isCurrentConnection(targetOwner)
      ) {
        return false;
      }
      const verified = captureVerifiedBrowserOwner(targetOwner.profileId);
      if (!verified || verified.owner.generation !== targetOwner.generation) {
        return false;
      }
      const winState = useWindowStore.getState();
      const currentWin = winState.session?.windows?.[win.id];
      const activeDesktopId = winState.session?.activeDesktopId;
      if (
        !currentWin ||
        currentWin.appId !== "browser" ||
        currentWin.minimized ||
        (activeDesktopId &&
          currentWin.desktopId &&
          currentWin.desktopId !== activeDesktopId) ||
        currentWin.ctx.profileId !== targetOwner.profileId ||
        !currentWin.appState
      ) {
        return false;
      }
      const currentApp = readCanonicalBrowserWindowState(currentWin.appState, tab.tabId);
      if (
        !Array.isArray(currentApp.tabs) ||
        currentApp.closing ||
        currentApp.activeTabId !== tab.tabId ||
        (currentApp.ownerScope &&
          !areBrowserOwnerScopesEqual(currentApp.ownerScope, verified.scope))
      ) {
        return false;
      }
      const currentTab = findBrowserTab(currentApp, tab.tabId);
      if (
        !currentTab ||
        !currentTab.sessionId ||
        (currentTab.phase !== "connecting" && currentTab.phase !== "live")
      ) {
        return false;
      }
      const targetKey = createBrowserNativeTargetKey(
        verified.scope,
        currentTab.sessionId,
      );
      return Boolean(targetKey && !isNativeTargetClosing(targetKey));
    },
    [slotKey, tab.tabId, win.id],
  );
  const computeLiveMuteState = useCallback((): boolean => {
    const liveSlot = slotRegistry.get(slotKey);
    const liveSuppressed =
      useCognitoModeStore.getState().active ||
      useLockScreenStore.getState().isLocked ||
      isBrowserViewFenced(win.ctx.profileId, connSnapRef.current?.owner.generation);
    if (!liveSlot || Boolean(liveSlot.audioMuted) || !isEffectiveVisibleRef.current || liveSuppressed) {
      return true;
    }
    if (!canConnectTab()) {
      return true;
    }
    const cur = readBrowserWindowAndTab(win.id, tab.tabId);
    if (!cur || cur.tab.phase !== "live" || cur.tab.snapshot?.status !== "running") {
      return true;
    }
    return false;
  }, [canConnectTab, slotKey, tab.tabId, win.ctx.profileId, win.id]);

  const canStreamTab = useCallback(
    (creds?: ViewerAttachmentCredentials): boolean => {
      const targetCreds = creds ?? currentAttachedCredsRef.current ?? undefined;
      const targetOwner = targetCreds?.owner ?? ownerRef.current;
      if (!canConnectTab(targetOwner)) {
        return false;
      }
      const cur = readBrowserWindowAndTab(win.id, tab.tabId);
      if (!cur) return false;
      if (targetCreds) {
        const streamCtrl = streamControllerRef.current;
        const hasMatchingSubscriptionEpoch = streamCtrl
          ? streamCtrl.getCurrentSubscriptionEpoch() === targetCreds.subscriptionEpoch
          : pendingCredsRef.current === targetCreds;
        return (
          cur.tab.phase === "live" &&
          cur.tab.snapshot?.status === "running" &&
          cur.tab.sessionId === targetCreds.browserSessionId &&
          cur.tab.snapshot.browserIncarnation ===
            targetCreds.browserIncarnation &&
          String(cur.tab.snapshot.profileEpoch) ===
            String(targetCreds.profileEpoch) &&
          hasMatchingSubscriptionEpoch
        );
      }
      return (
        cur.tab.phase === "live" && cur.tab.snapshot?.status === "running"
      );
    },
    [canConnectTab, tab.tabId, win.id],
  );
  const canStreamTabRef = useRef(canStreamTab);
  canStreamTabRef.current = canStreamTab;

  const canPlayAudio = useCallback(
    (creds?: ViewerAttachmentCredentials): boolean => {
      const liveSlot = slotRegistry.get(slotKey);
      if (!liveSlot || liveSlot.audioMuted || !canStreamTab(creds)) {
        return false;
      }
      return true;
    },
    [canStreamTab, slotKey],
  );
  canPlayAudioRef.current = (creds?: ViewerAttachmentCredentials) => canPlayAudio(creds);

  const syncDialogFromSnapshot = useCallback(
    (snap: BrowserSessionDto, creds?: ViewerAttachmentCredentials) => {
      if (!canStreamTabRef.current(creds)) {
        setActiveDialog(null);
        return;
      }
      if (
        snap.status === "running" &&
        snap.dialog &&
        typeof snap.dialog.dialogId === "string"
      ) {
        setActiveDialog({
          dialogId: snap.dialog.dialogId,
          message: snap.dialog.message,
          dialogType: snap.dialog.dialogType,
          sessionId: snap.browserSessionId,
          browserIncarnation: snap.browserIncarnation,
          profileEpoch: String(snap.profileEpoch),
        });
      } else if (
        snap.status !== "running" ||
        snap.dialog === null ||
        ("dialog" in snap && !snap.dialog)
      ) {
        setActiveDialog(null);
      }
    },
    [],
  );

  // Direct synchronous source subscriptions so Cognito, LockScreen, profile fence,
  // tab selection, slot hide, and window/session/navigation/terminal-status changes
  // flush scheduled audio, release held input/lease, and detach media/control sockets BEFORE React commits.
  useLayoutEffect(() => {
    const readIdentityKey = (): string => {
      const cur = readBrowserWindowAndTab(win.id, tab.tabId);
      if (!cur) return "";
      const scopeStr = cur.appState.ownerScope
        ? JSON.stringify(cur.appState.ownerScope)
        : "";
      return `${cur.win.ctx.profileId}:${scopeStr}:${cur.tab.sessionId ?? ""}:${cur.tab.snapshot?.browserIncarnation ?? ""}:${cur.tab.snapshot?.profileEpoch ?? ""}`;
    };
    const readNavRev = (): string => {
      const cur = readBrowserWindowAndTab(win.id, tab.tabId);
      return `${cur?.tab.snapshot?.navigationRevision ?? ""}`;
    };
    const readViewportKey = (): string => {
      const cur = readBrowserWindowAndTab(win.id, tab.tabId);
      return `${cur?.tab.snapshot?.viewportEpoch ?? ""}`;
    };
    let prevIdentity = readIdentityKey();
    let prevNavRev = readNavRev();
    let prevViewport = readViewportKey();
    let prevConnectable = canConnectTab();
    let prevStreamable = canStreamTab();

    const detachActiveStreamSynchronously = () => {
      pendingCredsRef.current = null;
      currentAttachedCredsRef.current = null;
      pointerVisibleRef.current = false;
      streamControllerRef.current?.setVisibility(false);
      setActiveDialog(null);
      const cur = readBrowserWindowAndTab(win.id, tab.tabId);
      if (cur && (cur.tab.isController || cur.tab.leaseToken)) {
        const lease = cur.tab.leaseToken;
        const sessId = cur.tab.sessionId;
        updateBrowserTabInStore(win.id, tab.tabId, {
          isController: false,
          leaseToken: undefined,
        });
        if (lease && sessId && isCurrentConnection(ownerRef.current)) {
          void releaseBrowserControl(ownerRef.current, sessId, {
            leaseToken: lease,
          }).catch(() => {});
        }
      }
    };

    const syncInvalidate = () => {
      const nextIdentity = readIdentityKey();
      const nextNavRev = readNavRev();
      const nextViewport = readViewportKey();
      const nextConnectable = canConnectTab();
      const nextStreamable = canStreamTab();

      if (nextIdentity !== prevIdentity) {
        prevIdentity = nextIdentity;
        prevNavRev = nextNavRev;
        prevViewport = nextViewport;
        lastAudioDocEpochRef.current = null;
        pcmPlayerRef.current?.flush();
        streamControllerRef.current?.resetAudioAuthority();
        clearSelectedTextCache();
        cancelPendingGesture();
        if (currentAttachedCredsRef.current) {
          detachActiveStreamSynchronously();
          setRetryNonce((n) => n + 1);
        }
      } else if (nextNavRev !== prevNavRev) {
        prevNavRev = nextNavRev;
        prevViewport = nextViewport;
        if (String(lastAudioDocEpochRef.current ?? "") !== String(nextNavRev)) {
          pcmPlayerRef.current?.flush();
        }
        streamControllerRef.current?.resetAudioAuthority(nextNavRev);
        clearSelectedTextCache();
        cancelPendingGesture();
      } else if (nextViewport !== prevViewport) {
        prevViewport = nextViewport;
        cancelPendingGesture();
      } else if (!canPlayAudio()) {
        pcmPlayerRef.current?.flush();
      }

      if (!nextConnectable || !nextStreamable) {
        pcmPlayerRef.current?.flush();
        cancelPendingGesture();
        textInputProxyRef.current?.blur();
        inputControllerRef.current?.releaseAllHeldInput();
        if (
          prevConnectable ||
          prevStreamable ||
          currentAttachedCredsRef.current !== null
        ) {
          detachActiveStreamSynchronously();
        }
      } else if (!prevConnectable && nextConnectable) {
        setRetryNonce((n) => n + 1);
      }
      prevConnectable = nextConnectable;
      prevStreamable = nextStreamable;
    };

    const unsubFence = subscribeBrowserViewFences(syncInvalidate);
    const unsubConn =
      typeof subscribeConnections === "function"
        ? subscribeConnections(syncInvalidate)
        : undefined;
    const cognitoSub = (
      useCognitoModeStore as unknown as {
        subscribe?: (fn: () => void) => () => void;
      }
    ).subscribe?.(syncInvalidate);
    const lockSub = (
      useLockScreenStore as unknown as {
        subscribe?: (fn: () => void) => () => void;
      }
    ).subscribe?.(syncInvalidate);
    const winSub = (
      useWindowStore as unknown as {
        subscribe?: (fn: () => void) => () => void;
      }
    ).subscribe?.(syncInvalidate);
    const docVisSub = subscribeDocumentVisibility(syncInvalidate);
    slotListeners.add(syncInvalidate);
    return () => {
      slotListeners.delete(syncInvalidate);
      docVisSub();
      unsubFence();
      unsubConn?.();
      cognitoSub?.();
      lockSub?.();
      winSub?.();
    };
  }, [
    win.id,
    tab.tabId,
    canPlayAudio,
    canStreamTab,
    cancelPendingGesture,
    clearSelectedTextCache,
  ]);

  // Track slot registration updates and synchronously flush audio on hide/mute
  useEffect(() => {
    const update = () => {
      const next = slotRegistry.get(slotKey) ?? null;
      if (!next?.isVisible || !next.element || next.audioMuted) {
        pcmPlayerRef.current?.flush();
      }
      setSlot(next);
    };
    slotListeners.add(update);
    update();
    return () => {
      slotListeners.delete(update);
    };
  }, [slotKey]);

  // Imperatively create host element inside parkingHost so React never manages hostEl's parent
  useLayoutEffect(() => {
    const el = document.createElement("div");
    el.setAttribute("data-os-browser-stream-container", slotKey);
    el.setAttribute("data-os-browser-window-id", win.id);
    el.setAttribute("data-os-browser-tab-id", tab.tabId);
    el.setAttribute(
      "data-testid",
      `browser-stream-container-${win.id}-${tab.tabId}`,
    );
    el.className =
      "relative w-full h-full bg-black overflow-hidden select-none";
    el.style.width = "100%";
    el.style.height = "100%";
    parkingHost.appendChild(el);
    setHostEl(el);

    return () => {
      el.remove();
      setHostEl(null);
    };
  }, [parkingHost, slotKey, win.id, tab.tabId]);

  const currentWindowAndTab = readBrowserWindowAndTab(win.id, tab.tabId);
  const verifiedOwner = captureVerifiedBrowserOwner(win.ctx.profileId);
  const isOwnerScopeValid = Boolean(
    verifiedOwner &&
      verifiedOwner.owner.generation === owner.generation &&
      (!currentWindowAndTab?.appState.ownerScope ||
        areBrowserOwnerScopesEqual(
          currentWindowAndTab.appState.ownerScope,
          verifiedOwner.scope,
        )),
  );
  const isActiveTabInWindow =
    currentWindowAndTab?.appState.activeTabId === tab.tabId;

  // Reparent container node between slot.element and parkingHost
  useLayoutEffect(() => {
    if (!hostEl) return;
    const destination =
      isActiveTabInWindow && slot?.element ? slot.element : parkingHost;
    if (destination && hostEl.parentElement !== destination) {
      destination.appendChild(hostEl);
    }
  }, [isActiveTabInWindow, slot?.element, parkingHost, hostEl]);

  // Derived effective visibility for active streaming/bootstrap
  const isEffectiveVisible = Boolean(
    isDocVisible &&
      slot?.isVisible &&
      slot?.element &&
      !isSuppressed &&
      isOwnerScopeValid &&
      isActiveTabInWindow &&
      !currentWindowAndTab?.win.minimized &&
      !currentWindowAndTab?.appState.closing &&
      (tab.phase === "connecting" || tab.phase === "live"),
  );
  pointerVisibleRef.current = isEffectiveVisible;
  isEffectiveVisibleRef.current = isEffectiveVisible;

  // Synchronous style updates for suppression and visibility
  useLayoutEffect(() => {
    if (!hostEl) return;
    hostEl.style.pointerEvents =
      isSuppressed || !isEffectiveVisible ? "none" : "auto";
    hostEl.style.visibility = isEffectiveVisible ? "visible" : "hidden";
  }, [hostEl, isSuppressed, isEffectiveVisible]);

  // Synchronous privacy / visibility updates to stream controller
  useLayoutEffect(() => {
    if (isSuppressed) {
      pcmPlayerRef.current?.flush();
      clearSelectedTextCache();
      currentAttachedCredsRef.current = null;
      clearStreamQuality(qualityTuple);
    }
    if (streamControllerRef.current) {
      streamControllerRef.current.setPrivacyMode(isSuppressed);
      if (isSuppressed) {
        cancelPendingGesture();
        textInputProxyRef.current?.blur();
        inputControllerRef.current?.releaseAllHeldInput();
      }
    }
  }, [isSuppressed, cancelPendingGesture, clearSelectedTextCache, qualityTuple]);

  useLayoutEffect(() => {
    if (!isEffectiveVisible || slot?.audioMuted) {
      pcmPlayerRef.current?.flush();
    }
    if (!isEffectiveVisible) {
      clearSelectedTextCache();
      currentAttachedCredsRef.current = null;
      cancelPendingGesture();
      inputControllerRef.current?.releaseAllHeldInput();
      setActiveDialog(null);
      setControlError(null);
      clearStreamQuality(qualityTuple);
    }
    if (streamControllerRef.current) {
      streamControllerRef.current.setVisibility(isEffectiveVisible);
    }
  }, [isEffectiveVisible, slot?.audioMuted, cancelPendingGesture, clearSelectedTextCache, qualityTuple]);

  // Retire an old acquisition and flush audio/authority immediately on session identity change.
  useLayoutEffect(() => {
    lastAudioDocEpochRef.current = null;
    pcmPlayerRef.current?.flush();
    streamControllerRef.current?.resetAudioAuthority();
    clearSelectedTextCache();
    cancelPendingGesture();
    clearStreamQuality(qualityTuple);
    return () => {
      lastAudioDocEpochRef.current = null;
      pcmPlayerRef.current?.flush();
      streamControllerRef.current?.resetAudioAuthority();
      clearSelectedTextCache();
      cancelPendingGesture();
      clearStreamQuality(qualityTuple);
    };
  }, [
    owner,
    tab.sessionId,
    tab.viewerId,
    tab.snapshot?.browserIncarnation,
    tab.snapshot?.profileEpoch,
    cancelPendingGesture,
    clearSelectedTextCache,
    qualityTuple,
  ]);

  useLayoutEffect(() => {
    const liveMute = computeLiveMuteState();
    streamControllerRef.current?.setAudioMuted(liveMute);
  }, [slot?.audioMuted, isEffectiveVisible, isSuppressed, tab.phase, tab.snapshot?.status, computeLiveMuteState]);
  useLayoutEffect(() => {
    const verified = captureVerifiedBrowserOwner(win.ctx.profileId);
    if (
      !verified ||
      verified.owner.generation !== currentGen ||
      !isCurrentConnection(owner) ||
      tab.phase !== "live"
    ) {
      clearStreamQuality(qualityTuple);
    }
  }, [win.ctx.profileId, currentGen, owner, tab.phase, qualityTuple]);

  useLayoutEffect(() => {
    const navRev = tab.snapshot?.navigationRevision;
    streamControllerRef.current?.resetAudioAuthority(
      navRev !== undefined && navRev !== null ? String(navRev) : undefined,
    );
    cancelPendingGesture();
  }, [tab.snapshot?.navigationRevision, cancelPendingGesture]);

  useLayoutEffect(() => {
    cancelPendingGesture();
  }, [tab.snapshot?.viewportEpoch, cancelPendingGesture]);

  useLayoutEffect(() => {
    const handler = (
      reqOwner: ConnectionRef,
      reqSessionId: string,
      reqLeaseToken: string,
    ) => {
      if (
        !isEffectiveVisible ||
        activeDialog !== null ||
        useCognitoModeStore.getState().active ||
        useLockScreenStore.getState().isLocked ||
        isBrowserViewFenced(reqOwner.profileId, reqOwner.generation) ||
        !isCurrentConnection(reqOwner)
      ) {
        return;
      }
      const storeState = useWindowStore.getState();
      const activeDesktop = storeState.session?.desktops?.find(
        (d) => d.id === storeState.session.activeDesktopId,
      );
      if (
        activeDesktop?.focusedWindowId &&
        activeDesktop.focusedWindowId !== win.id
      ) {
        return;
      }
      const cur = readBrowserWindowAndTab(win.id, tab.tabId);
      if (
        !cur ||
        cur.win.ctx.profileId !== reqOwner.profileId ||
        cur.appState.activeTabId !== tab.tabId ||
        cur.tab.sessionId !== reqSessionId ||
        cur.tab.leaseToken !== reqLeaseToken ||
        !cur.tab.isController ||
        cur.tab.phase !== "live" ||
        cur.tab.snapshot?.status !== "running" ||
        cur.tab.snapshot.inputAvailable === false
      ) {
        return;
      }
      const activeEl = document.activeElement as HTMLElement | null;
      if (
        activeEl &&
        !textInputProxyRef.current?.isFocused() &&
        (activeEl instanceof HTMLInputElement ||
          activeEl instanceof HTMLTextAreaElement ||
          activeEl instanceof HTMLSelectElement ||
          activeEl.isContentEditable)
      ) {
        return;
      }
      textInputProxyRef.current?.focus();
    };
    proxyFocusListeners.set(slotKey, handler);
    return () => {
      if (proxyFocusListeners.get(slotKey) === handler) {
        proxyFocusListeners.delete(slotKey);
      }
    };
  }, [slotKey, win.id, tab.tabId, isEffectiveVisible, activeDialog]);

  useLayoutEffect(() => {
    const unlockHandler = (reqOwner: ConnectionRef, reqSessionId?: string) => {
      const cur = readBrowserWindowAndTab(win.id, tab.tabId);
      const liveSlot = slotRegistry.get(slotKey);
      const liveSuppressed =
        useCognitoModeStore.getState().active ||
        useLockScreenStore.getState().isLocked ||
        isBrowserViewFenced(reqOwner.profileId, reqOwner.generation);
      const verified = captureVerifiedBrowserOwner(win.ctx.profileId);
      const ownerScopeValid = Boolean(
        verified &&
          verified.owner.generation === reqOwner.generation &&
          (!cur?.appState.ownerScope ||
            areBrowserOwnerScopesEqual(cur.appState.ownerScope, verified.scope)),
      );
      const activeDesktopId = useWindowStore.getState().session?.activeDesktopId;
      const onActiveDesktop = !activeDesktopId || !cur?.win.desktopId || cur.win.desktopId === activeDesktopId;
      if (
        !isCurrentConnection(reqOwner) ||
        !cur ||
        cur.win.ctx.profileId !== reqOwner.profileId ||
        cur.appState.closing ||
        cur.win.minimized ||
        !onActiveDesktop ||
        cur.appState.activeTabId !== tab.tabId ||
        cur.tab.sessionId !== reqSessionId ||
        !liveSlot ||
        !liveSlot.element ||
        Boolean(liveSlot.audioMuted) ||
        liveSuppressed ||
        !ownerScopeValid ||
        !isDocumentVisible()
      ) {
        pcmPlayerRef.current?.flush();
        return;
      }
      if (canPlayAudio()) {
        ensurePcmPlayer().prime();
        return;
      }
      const preLiveAllowed =
        cur.tab.phase === "new-tab" ||
        cur.tab.phase === "creating" ||
        cur.tab.phase === "connecting" ||
        cur.tab.phase === "unavailable" ||
        cur.tab.phase === "capacity" ||
        cur.tab.phase === "deferred";
      if (preLiveAllowed) {
        ensurePcmPlayer().prime(true);
      } else {
        pcmPlayerRef.current?.flush();
      }
    };
    audioUnlockListeners.set(slotKey, unlockHandler);
    return () => {
      if (audioUnlockListeners.get(slotKey) === unlockHandler) {
        audioUnlockListeners.delete(slotKey);
      }
    };
  }, [slotKey, win.id, win.ctx.profileId, tab.tabId, canPlayAudio, ensurePcmPlayer]);

  // Initialize controllers when canvas is ready (live ref bridges preserve latest generation authority)
  useLayoutEffect(() => {
    if (!canvasEl) return;

    if (!streamControllerRef.current) {
      const streamCtrl = new BrowserStreamController({
        canvas: canvasEl,
        onStatusChange: (status) => {
          setStreamStatus(status);
          if (status !== "streaming" && status !== "connecting") {
            lastSentPrefRef.current = null;
            clearStreamQuality(latestTupleRef.current);
          }
        },
        onStreamQualityReset: () => {
          lastSentPrefRef.current = null;
          clearStreamQuality(latestTupleRef.current);
        },
        onGeometryChange: () => {},
        onAudioChunk: (chunk: BrowserAudioChunk, credentials) => {
          if (!canPlayAudioRef.current() || !canStreamTabRef.current(credentials)) {
            pcmPlayerRef.current?.flush();
            return;
          }
          lastAudioDocEpochRef.current = chunk.docEpoch;
          ensurePcmPlayer().enqueue(chunk.data);
        },
        onAudioReset: () => {
          pcmPlayerRef.current?.flush();
        },
        onStreamQuality: (event: StreamQualityEvent, credentials) => {
          const verified = captureVerifiedBrowserOwner(
            credentials.owner.profileId,
          );
          if (
            !verified ||
            verified.owner.generation !== credentials.owner.generation ||
            !isCurrentConnection(credentials.owner)
          ) {
            return;
          }
          const cur = readBrowserWindowAndTab(win.id, tab.tabId);
          if (
            !cur ||
            cur.win.ctx.profileId !== credentials.owner.profileId ||
            cur.appState.closing ||
            (cur.appState.ownerScope &&
              !areBrowserOwnerScopesEqual(
                cur.appState.ownerScope,
                verified.scope,
              )) ||
            cur.tab.sessionId !== credentials.browserSessionId ||
            cur.tab.snapshot?.browserIncarnation !==
              credentials.browserIncarnation ||
            String(cur.tab.snapshot?.profileEpoch) !==
              String(credentials.profileEpoch) ||
            streamControllerRef.current?.getCurrentSubscriptionEpoch() !==
              credentials.subscriptionEpoch
          ) {
            return;
          }
          const currentLiveTuple = latestTupleRef.current;
          if (
            credentials.owner.profileId !== currentLiveTuple.profileId ||
            credentials.owner.generation !== currentLiveTuple.generation
          ) {
            return;
          }
          if (isSuppressedRef.current || !isEffectiveVisibleRef.current || tabPhaseRef.current !== "live") {
            clearStreamQuality(currentLiveTuple);
            return;
          }
          lastPublishedTupleRef.current = currentLiveTuple;
          publishStreamQuality(currentLiveTuple, event);
        },
        onControlEvent: (event: ServerControlEvent, credentials) => {
          const verified = captureVerifiedBrowserOwner(
            credentials.owner.profileId,
          );
          if (
            !verified ||
            verified.owner.generation !== credentials.owner.generation ||
            !isCurrentConnection(credentials.owner)
          ) {
            return;
          }
          const cur = readBrowserWindowAndTab(win.id, tab.tabId);
          if (
            !cur ||
            cur.win.ctx.profileId !== credentials.owner.profileId ||
            cur.appState.closing ||
            (cur.appState.ownerScope &&
              !areBrowserOwnerScopesEqual(
                cur.appState.ownerScope,
                verified.scope,
              )) ||
            cur.tab.sessionId !== credentials.browserSessionId ||
            cur.tab.snapshot?.browserIncarnation !==
              credentials.browserIncarnation ||
            String(cur.tab.snapshot?.profileEpoch) !==
              String(credentials.profileEpoch) ||
            streamControllerRef.current?.getCurrentSubscriptionEpoch() !==
              credentials.subscriptionEpoch
          ) {
            return;
          }

          if (event.kind === "sessionUpdated") {
            const prevNavRev = cur.tab.snapshot?.navigationRevision;
            const prevViewport = cur.tab.snapshot?.viewportEpoch;
            const result = syncBrowserSessionWindow(
              credentials.owner,
              win.id,
              tab.tabId,
              credentials.browserSessionId,
              event.session,
              {
                browserIncarnation: credentials.browserIncarnation,
                profileEpoch: credentials.profileEpoch,
                subscriptionEpoch: credentials.subscriptionEpoch,
                currentSubscriptionEpoch:
                  streamControllerRef.current?.getCurrentSubscriptionEpoch() ??
                  undefined,
              },
            );
            if (result === "detached" || event.session.status !== "running") {
              lastAudioDocEpochRef.current = null;
              pcmPlayerRef.current?.flush();
              streamControllerRef.current?.resetAudioAuthority();
              currentAttachedCredsRef.current = null;
              streamControllerRef.current?.setVisibility(false);
              clearStreamQuality(qualityTuple);
              cancelPendingGesture();
              textInputProxyRef.current?.blur();
              inputControllerRef.current?.releaseAllHeldInput();
              setActiveDialog(null);
              if (result === "detached") {
                const lease = cur.tab.leaseToken;
                const sessId = cur.tab.sessionId;
                updateBrowserTabInStore(win.id, tab.tabId, {
                  isController: false,
                  leaseToken: undefined,
                  phase: "unavailable",
                  unsupportedReason: "Browser runtime changed on host",
                });
                if (lease && sessId && isCurrentConnection(credentials.owner)) {
                  void releaseBrowserControl(credentials.owner, sessId, { leaseToken: lease }).catch(() => {});
                }
              }
            } else if (
              String(event.session.navigationRevision) !== String(prevNavRev)
            ) {
              if (
                String(lastAudioDocEpochRef.current ?? "") !==
                String(event.session.navigationRevision)
              ) {
                pcmPlayerRef.current?.flush();
              }
              streamControllerRef.current?.resetAudioAuthority(
                event.session.navigationRevision,
              );
            } else if (
              String(event.session.viewportEpoch) !== String(prevViewport)
            ) {
              cancelPendingGesture();
            }
            if (
              result !== "detached" &&
              (event.session.status !== "running" ||
                !event.session.inputAvailable)
            ) {
              cancelPendingGesture();
              pcmPlayerRef.current?.flush();
              inputControllerRef.current?.releaseAllHeldInput();
              setActiveDialog(null);
            }
            if (result !== "detached") {
              syncDialogFromSnapshot(event.session, credentials);
              if (
                cur.tab.kind === "popup" &&
                (event.session.status === "closed" ||
                  event.session.status === "lost")
              ) {
                cancelPendingGesture();
                inputControllerRef.current?.releaseAllHeldInput();
                setActiveDialog(null);
                completeBrowserPopupTab(
                  credentials.owner,
                  win.id,
                  tab.tabId,
                  credentials.browserSessionId,
                );
              } else {
                void reconcileOpenerPopupSnapshot({
                  owner: credentials.owner,
                  windowId: win.id,
                  openerTabId: tab.tabId,
                  openerSessionId: credentials.browserSessionId,
                  openerSnapshot: event.session,
                  isOpenerVisible: canStreamTabRef.current(credentials),
                });
              }
            }
          } else if (event.kind === "dialogOpened") {
            if (!canStreamTabRef.current(credentials)) return;
            cancelPendingGesture();
            inputControllerRef.current?.releaseAllHeldInput();
            setActiveDialog({
              dialogId: event.dialogId,
              message: event.message,
              dialogType: event.dialogType,
              sessionId: credentials.browserSessionId,
              browserIncarnation: credentials.browserIncarnation,
              profileEpoch: String(credentials.profileEpoch),
            });
          } else if (event.kind === "dialogClosed") {
            setActiveDialog(null);
          } else if (event.kind === "leaseRevoked") {
            clearSelectedTextCache();
            cancelPendingGesture();
            inputControllerRef.current?.releaseAllHeldInput();
            updateBrowserTabInStore(win.id, tab.tabId, {
              isController: false,
              leaseToken: undefined,
            });
            setActiveDialog(null);
          } else if (event.kind === "status") {
            if (!event.inputAvailable) {
              cancelPendingGesture();
              inputControllerRef.current?.releaseAllHeldInput();
            }
            const latest = readBrowserWindowAndTab(win.id, tab.tabId);
            if (latest?.tab.snapshot) {
              const nextInputAvailable =
                latest.tab.snapshot.status === "running" &&
                event.inputAvailable;
              updateBrowserTabInStore(win.id, tab.tabId, {
                unavailableReason: event.unavailableReason,
                snapshot: {
                  ...latest.tab.snapshot,
                  inputAvailable: nextInputAvailable,
                  unavailableReason: event.unavailableReason,
                },
              });
            }
          } else if (event.kind === "error") {
            console.error(
              "[BrowserStream] Control socket error:",
              event.message,
            );
          }
        },
        onError: (err) => {
          console.error("[BrowserStream] Controller error:", err);
        },
      });

      streamCtrl.setPrivacyMode(isSuppressed);
      streamCtrl.setVisibility(isEffectiveVisible);
      const initialPref = getQualityPreference(latestTupleRef.current);
      lastSentPrefRef.current = initialPref;
      const initialMute = computeLiveMuteState();
      streamCtrl.setPrivacyMode(isSuppressed);
      streamCtrl.setVisibility(isEffectiveVisible);
      streamCtrl.setQualityPreference(initialPref);
      streamCtrl.setAudioMuted(initialMute);
      streamControllerRef.current = streamCtrl;
      setStreamController(streamCtrl);

      if (pendingCredsRef.current) {
        currentAttachedCredsRef.current = pendingCredsRef.current;
        streamCtrl.setQualityPreference(initialPref);
        streamCtrl.setAudioMuted(initialMute);
        streamCtrl.attach(pendingCredsRef.current);
      }
    }

    if (!inputControllerRef.current) {
      const inputCtrl = new BrowserInputController({
        getSessionId: () =>
          readBrowserWindowAndTab(win.id, tab.tabId)?.tab.sessionId ?? "",
        getIncarnation: () =>
          readBrowserWindowAndTab(win.id, tab.tabId)?.tab.snapshot
            ?.browserIncarnation ?? "",
        getProfileEpoch: () =>
          readBrowserWindowAndTab(win.id, tab.tabId)?.tab.snapshot
            ?.profileEpoch ?? "",
        getSubscriptionEpoch: () =>
          streamControllerRef.current?.getCurrentSubscriptionEpoch() ?? null,
        getLeaseToken: () =>
          readBrowserWindowAndTab(win.id, tab.tabId)?.tab.leaseToken ?? null,
        getViewportEpoch: () =>
          readBrowserWindowAndTab(win.id, tab.tabId)?.tab.snapshot
            ?.viewportEpoch ?? "",
        getDrawnRect: () => streamControllerRef.current?.getDrawnRect() ?? null,
        getControlSocket: () =>
          streamControllerRef.current?.getControlSocket() ?? null,
        isInputAllowed: () =>
          canStreamTabRef.current(
            currentAttachedCredsRef.current ?? undefined,
          ),
        onError: (err) => {
          console.error("[BrowserInput] Controller error:", err);
          setControlError(err.message);
        },
      });

      inputControllerRef.current = inputCtrl;
      setInputController(inputCtrl);
    }
  }, [
    canvasEl,
    win.id,
    tab.tabId,
    win.ctx.profileId,
    isSuppressed,
    isEffectiveVisible,
    cancelPendingGesture,
    clearSelectedTextCache,
    ensurePcmPlayer,
    syncDialogFromSnapshot,
  ]);

  // Process withheld late-create cleanups when a verified owner connects
  useEffect(() => {
    const verified = captureVerifiedBrowserOwner(win.ctx.profileId);
    if (verified && verified.owner.generation === owner.generation) {
      processWithheldCleanups(verified.scope, verified.owner);
    }
  }, [owner, win.ctx.profileId]);

  // Explicit root lifecycle create hook (independent of stream visibility; never replays on reconnect)
  useEffect(() => {
    const cur = readBrowserWindowAndTab(win.id, tab.tabId);
    if (!cur || cur.appState.closing || cur.tab.phase !== "creating" || cur.tab.sessionId) {
      dispatchedTabCreates.delete(slotKey);
      return;
    }

    const existing = dispatchedTabCreates.get(slotKey);
    const verified = captureVerifiedBrowserOwner(win.ctx.profileId);
    if (existing && existing.actionSequence === cur.tab.actionSequence) {
      if (
        !verified ||
        !isCurrentConnection(existing.owner) ||
        verified.owner.generation !== existing.owner.generation ||
        !areBrowserOwnerScopesEqual(verified.scope, existing.scope)
      ) {
        updateBrowserTabInStore(win.id, tab.tabId, {
          phase: "create-unknown",
          unsupportedReason:
            "Connection changed before browser page creation settled",
        });
      }
      return;
    }

    if (
      !verified ||
      verified.owner.generation !== owner.generation ||
      !isCurrentConnection(owner) ||
      (cur.appState.ownerScope &&
        !areBrowserOwnerScopesEqual(cur.appState.ownerScope, verified.scope))
    ) {
      return;
    }
    const targetUrl =
      cur.tab.createIntent?.request.url ?? cur.tab.committedUrl;
    if (!targetUrl) return;
    const capturedActionSeq = cur.tab.actionSequence;
    dispatchedTabCreates.set(slotKey, {
      actionSequence: capturedActionSeq,
      owner: { profileId: verified.owner.profileId, generation: verified.owner.generation },
      scope: verified.scope,
    });

    void dispatchBrowserCreateIntent({
      owner: verified.owner,
      scope: verified.scope,
      windowId: win.id,
      tabId: tab.tabId,
      actionSequence: capturedActionSeq,
      url: targetUrl,
      viewport: cur.tab.createIntent?.request.viewport ?? {
        width: 1280,
        height: 900,
        dpr: window.devicePixelRatio || 1,
      },
      isTabCurrent: () => {
        const latest = readBrowserWindowAndTab(win.id, tab.tabId);
        return Boolean(
          latest &&
            !latest.appState.closing &&
            (!latest.appState.ownerScope ||
              areBrowserOwnerScopesEqual(
                latest.appState.ownerScope,
                verified.scope,
              )) &&
            latest.tab.actionSequence === capturedActionSeq &&
            latest.tab.phase === "creating" &&
            !latest.tab.sessionId,
        );
      },
      onLateCleanup: (cleanupScope) => {
        const live = captureVerifiedBrowserOwner(win.ctx.profileId);
        if (live && areBrowserOwnerScopesEqual(live.scope, cleanupScope)) {
          processWithheldCleanups(live.scope, live.owner);
        }
      },
    }).then((outcome) => {
      const latest = readBrowserWindowAndTab(win.id, tab.tabId);
      const isOwnerCurrent = isCapturedBrowserOwnerCurrent(verified.owner, verified.scope);
      if (!isOwnerCurrent) {
        if (latest && latest.tab.actionSequence === capturedActionSeq && latest.tab.phase === "creating") {
          updateBrowserTabInStore(
            win.id,
            tab.tabId,
            {
              phase: "create-unknown",
              unsupportedReason: "Connection generation changed before target creation settled",
            },
            verified.scope,
          );
        }
        return;
      }
      if (
        dispatchedTabCreates.get(slotKey)?.actionSequence === capturedActionSeq
      ) {
        dispatchedTabCreates.delete(slotKey);
      }
      if (
        !latest ||
        latest.appState.closing ||
        latest.tab.actionSequence !== capturedActionSeq ||
        latest.tab.phase !== "creating" ||
        latest.tab.sessionId
      ) {
        return;
      }
      if (outcome.kind === "success" && outcome.adopted) {
        updateBrowserTabInStore(
          win.id,
          tab.tabId,
          {
            sessionId: outcome.session.browserSessionId,
            createIntent: undefined,
            phase: "connecting",
          },
          verified.scope,
        );
        syncBrowserSessionWindow(
          verified.owner,
          win.id,
          tab.tabId,
          outcome.session.browserSessionId,
          outcome.session,
        );
      } else if (outcome.kind === "rejected") {
        updateBrowserTabInStore(
          win.id,
          tab.tabId,
          {
            phase: outcome.capacity ? "capacity" : "unavailable",
            createIntent: undefined,
            unsupportedReason: outcome.error,
          },
          verified.scope,
        );
      } else if (outcome.kind === "unknown") {
        updateBrowserTabInStore(
          win.id,
          tab.tabId,
          {
            phase: "create-unknown",
            unsupportedReason: outcome.error,
          },
          verified.scope,
        );
      }
    });
  }, [
    owner,
    slotKey,
    win.id,
    win.ctx.profileId,
    tab.tabId,
    tab.phase,
    tab.sessionId,
    tab.actionSequence,
    tab.committedUrl,
    tab.createIntent,
  ]);

  // Reconcile hidden popup completion on tab activation even before slot attachment
  useEffect(() => {
    if (
      !isActiveTabInWindow ||
      isEffectiveVisible ||
      tab.kind !== "popup" ||
      !tab.sessionId
    ) {
      return;
    }
    if (!isOwnerScopeValid || !isCurrentConnection(owner)) return;
    void reconcilePopupTabCompletion({
      owner,
      windowId: win.id,
      popupTabId: tab.tabId,
      popupSessionId: tab.sessionId,
    });
  }, [
    isActiveTabInWindow,
    isEffectiveVisible,
    isOwnerScopeValid,
    owner,
    tab.kind,
    tab.sessionId,
    tab.tabId,
    win.id,
  ]);

  // Server session connection / stream attachment lifecycle (known sessionId only; never creates)
  useEffect(() => {
    let isCancelled = false;
    pendingCredsRef.current = null;
    if (!isEffectiveVisible || !tab.sessionId) return;

    const rawSessionId = tab.sessionId;
    const verified = captureVerifiedBrowserOwner(owner.profileId);
    if (
      !verified ||
      verified.owner.generation !== owner.generation ||
      !isCurrentConnection(owner)
    ) {
      return;
    }
    const initial = readBrowserWindowAndTab(win.id, tab.tabId);
    if (
      !initial ||
      initial.appState.closing ||
      initial.appState.activeTabId !== tab.tabId ||
      (initial.tab.phase !== "connecting" && initial.tab.phase !== "live") ||
      (initial.appState.ownerScope &&
        !areBrowserOwnerScopesEqual(
          initial.appState.ownerScope,
          verified.scope,
        ))
    ) {
      return;
    }
    const targetKey = createBrowserNativeTargetKey(
      verified.scope,
      rawSessionId,
    );
    if (!targetKey || isNativeTargetClosing(targetKey)) {
      return;
    }

    setViewerCapacityError(null);
    streamControllerRef.current?.setVisibility(true);
    if (initial.tab.isController || initial.tab.leaseToken) {
      updateBrowserTabInStore(win.id, tab.tabId, {
        isController: false,
        leaseToken: undefined,
      });
    }

    const abortCtrl = new AbortController();

    const connectSession = async () => {
      try {
        const snapshot = await getBrowserSession(
          owner,
          rawSessionId,
          abortCtrl.signal,
        );
        if (
          isCancelled ||
          !isCapturedBrowserOwnerCurrent(owner, verified.scope) ||
          !canConnectTab(owner) ||
          isNativeTargetClosing(targetKey)
        ) {
          return;
        }

        const latestBeforeSync = readBrowserWindowAndTab(win.id, tab.tabId);
        if (
          latestBeforeSync?.tab.kind === "popup" &&
          (snapshot.status === "closed" || snapshot.status === "lost")
        ) {
          completeBrowserPopupTab(owner, win.id, tab.tabId, rawSessionId);
          return;
        }

        const sync = syncBrowserSessionWindow(
          owner,
          win.id,
          tab.tabId,
          rawSessionId,
          snapshot,
        );
        if (sync === "detached" || snapshot.status !== "running") {
          currentAttachedCredsRef.current = null;
          streamControllerRef.current?.setVisibility(false);
          return;
        }

        void reconcileOpenerPopupSnapshot({
          owner,
          windowId: win.id,
          openerTabId: tab.tabId,
          openerSessionId: rawSessionId,
          openerSnapshot: snapshot,
          isOpenerVisible: true,
          signal: abortCtrl.signal,
        });

        if (!canConnectTab(owner) || isNativeTargetClosing(targetKey)) {
          return;
        }

        if (!isCanonicalPositiveU64Decimal(snapshot.profileEpoch)) {
          updateBrowserTabInStore(win.id, tab.tabId, {
            unavailableReason:
              "Browser profile epoch cannot be represented exactly",
          });
          return;
        }

        try {
          const creds = await mintViewerAttachmentTickets(
            owner,
            rawSessionId,
            snapshot.browserIncarnation,
            snapshot.profileEpoch,
            abortCtrl.signal,
          );

          const current = readBrowserWindowAndTab(win.id, tab.tabId);
          if (
            isCancelled ||
            !isCapturedBrowserOwnerCurrent(owner, verified.scope) ||
            !canConnectTab(owner) ||
            isNativeTargetClosing(targetKey) ||
            !current ||
            current.appState.activeTabId !== tab.tabId ||
            current.tab.sessionId !== rawSessionId ||
            current.tab.phase !== "live" ||
            current.tab.snapshot?.status !== "running" ||
            current.tab.snapshot.browserIncarnation !==
              creds.browserIncarnation ||
            String(current.tab.snapshot.profileEpoch) !==
              String(creds.profileEpoch)
          ) {
            return;
          }

          commitNativeTargetAdmission(verified.scope, rawSessionId, () => {
            pendingCredsRef.current = creds;
            currentAttachedCredsRef.current = creds;
            const currentLivePref = getQualityPreference(latestTupleRef.current);
            lastSentPrefRef.current = currentLivePref;
            streamControllerRef.current?.setQualityPreference(currentLivePref);
            const liveMute = computeLiveMuteState();
            streamControllerRef.current?.setAudioMuted(liveMute);
            streamControllerRef.current?.attach(creds);
            streamControllerRef.current?.setVisibility(true);
            syncDialogFromSnapshot(snapshot, creds);
            updateBrowserTabInStore(win.id, tab.tabId, {
              viewerId: creds.viewerId,
            });
          });
        } catch (ticketErr) {
          if (
            !isCancelled &&
            !abortCtrl.signal.aborted &&
            (ticketErr as Error)?.name !== "AbortError"
          ) {
            const cur = readBrowserWindowAndTab(win.id, tab.tabId);
            if (cur?.tab.kind === "popup") {
              const comp = await reconcilePopupTabCompletion({
                owner,
                windowId: win.id,
                popupTabId: tab.tabId,
                popupSessionId: rawSessionId,
                signal: abortCtrl.signal,
              });
              if (comp === "removed") return;
            }
            if (
              ticketErr instanceof BrowserHostClientError &&
              (ticketErr.status === 429 || ticketErr.kind === "browserBusy")
            ) {
              const msg =
                ticketErr.message ||
                "Viewer attachment capacity reached — retry stream attachment";
              setViewerCapacityError(msg);
              updateBrowserTabInStore(win.id, tab.tabId, {
                unavailableReason: msg,
              });
              return;
            }
            console.warn(
              "[BrowserStream] Ticket minting skipped/failed in current environment:",
              ticketErr,
            );
          }
        }
      } catch (err) {
        if (
          !isCancelled &&
          isCapturedBrowserOwnerCurrent(owner, verified.scope)
        ) {
          const current = readBrowserWindowAndTab(win.id, tab.tabId);
          const expectedIncarnation = current?.tab.snapshot?.browserIncarnation;
          const expectedProfileEpoch = current?.tab.snapshot?.profileEpoch;
          if (current && current.tab.sessionId === rawSessionId) {
            const isNotFound =
              err instanceof BrowserHostClientError && err.status === 404;
            if (current.tab.kind === "popup" && isNotFound) {
              completeBrowserPopupTab(owner, win.id, tab.tabId, rawSessionId);
              return;
            }
            const latest = readBrowserWindowAndTab(win.id, tab.tabId);
            if (
              !isCancelled &&
              latest &&
              latest.tab.sessionId === rawSessionId &&
              latest.tab.snapshot?.browserIncarnation === expectedIncarnation &&
              latest.tab.snapshot?.profileEpoch === expectedProfileEpoch
            ) {
              currentAttachedCredsRef.current = null;
              streamControllerRef.current?.setVisibility(false);
              updateBrowserTabInStore(win.id, tab.tabId, {
                phase: "unavailable",
                unsupportedReason: isNotFound
                  ? "Browser session no longer exists on this host"
                  : "Browser session could not be connected",
                isController: false,
                leaseToken: undefined,
                viewerId: undefined,
                snapshot: latest.tab.snapshot
                  ? { ...latest.tab.snapshot, inputAvailable: false }
                  : undefined,
              });
            }
          }
          console.error("[BrowserStream] Session connect failed:", err);
        }
      }
    };

    void connectSession();

    return () => {
      isCancelled = true;
      cancelPendingGesture();
      abortCtrl.abort();
      pendingCredsRef.current = null;
      currentAttachedCredsRef.current = null;
      streamControllerRef.current?.setVisibility(false);
    };
  }, [
    owner,
    isEffectiveVisible,
    win.id,
    tab.tabId,
    tab.sessionId,
    retryNonce,
    canConnectTab,
    cancelPendingGesture,
    syncDialogFromSnapshot,
  ]);

  // Cleanup controllers on final component unmount (when tab or window is closed)
  useEffect(() => {
    return () => {
      clearSelectedTextCache();
      cancelPendingGesture();
      dispatchedTabCreates.delete(slotKey);
      currentAttachedCredsRef.current = null;
      setBrowserAudioBlocked(win.id, tab.tabId, false);
      if (lastPublishedTupleRef.current) {
        clearStreamQuality(lastPublishedTupleRef.current);
        releaseTab(lastPublishedTupleRef.current);
      }
      clearStreamQuality(latestTupleRef.current);
      releaseTab(latestTupleRef.current);
      pcmPlayerRef.current?.dispose();
      pcmPlayerRef.current = null;
      streamControllerRef.current?.dispose();
      inputControllerRef.current?.dispose();
      streamControllerRef.current = null;
      inputControllerRef.current = null;
    };
  }, [slotKey, win.id, tab.tabId, cancelPendingGesture, clearSelectedTextCache]);

  // Dialog handlers (validated against current visibility/privacy and captured dialog authority)
  const handleDialogConfirm = useCallback(
    (promptText?: string) => {
      if (!activeDialog) return;
      const cur = readBrowserWindowAndTab(win.id, tab.tabId);
      const currentLeaseToken = cur?.tab.leaseToken ?? "";
      if (
        canStreamTabRef.current(
          currentAttachedCredsRef.current ?? undefined,
        ) &&
        cur &&
        cur.appState.activeTabId === tab.tabId &&
        cur.tab.phase === "live" &&
        cur.tab.sessionId === activeDialog.sessionId &&
        cur.tab.snapshot?.browserIncarnation ===
          activeDialog.browserIncarnation &&
        String(cur.tab.snapshot?.profileEpoch) === activeDialog.profileEpoch &&
        currentLeaseToken
      ) {
        void respondBrowserDialog(ownerRef.current, activeDialog.sessionId, {
          leaseToken: currentLeaseToken,
          dialogId: activeDialog.dialogId,
          accept: true,
          promptText,
        });
      }
      setActiveDialog(null);
    },
    [activeDialog, win.id, tab.tabId],
  );

  const handleDialogCancel = useCallback(() => {
    if (!activeDialog) return;
    const cur = readBrowserWindowAndTab(win.id, tab.tabId);
    const currentLeaseToken = cur?.tab.leaseToken ?? "";
    if (
      canStreamTabRef.current(currentAttachedCredsRef.current ?? undefined) &&
      cur &&
      cur.appState.activeTabId === tab.tabId &&
      cur.tab.phase === "live" &&
      cur.tab.sessionId === activeDialog.sessionId &&
      cur.tab.snapshot?.browserIncarnation ===
        activeDialog.browserIncarnation &&
      String(cur.tab.snapshot?.profileEpoch) === activeDialog.profileEpoch &&
      currentLeaseToken
    ) {
      void respondBrowserDialog(ownerRef.current, activeDialog.sessionId, {
        leaseToken: currentLeaseToken,
        dialogId: activeDialog.dialogId,
        accept: false,
      });
    }
    setActiveDialog(null);
  }, [activeDialog, win.id, tab.tabId]);

  // Input event dispatchers to input controller
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (
        !canStreamTabRef.current(currentAttachedCredsRef.current ?? undefined)
      ) {
        return;
      }
      pointerDownPosRef.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      clearSelectedTextCache();
      textInputProxyRef.current?.focus();
      if (canPlayAudio()) {
        ensurePcmPlayer().prime();
      }
      const input = inputControllerRef.current;
      const liveOwner = ownerRef.current;
      if (
        !input ||
        !pointerVisibleRef.current ||
        !isCurrentConnection(liveOwner) ||
        !input.mapClientToFractions(e.clientX, e.clientY, e.currentTarget)
      ) {
        return;
      }
      const latest = readBrowserWindowAndTab(win.id, tab.tabId);
      if (
        !latest ||
        latest.appState.activeTabId !== tab.tabId ||
        latest.tab.phase !== "live" ||
        latest.tab.snapshot?.status !== "running" ||
        !latest.tab.snapshot.inputAvailable
      ) {
        return;
      }
      if (latest.tab.isController && latest.tab.leaseToken) {
        if (pendingPointerRef.current?.replayed) cancelPendingGesture();
        input.handlePointerDown(e);
        return;
      }
      const viewerId = latest.tab.viewerId;
      const sessionId = latest.tab.sessionId;
      if (!sessionId || !viewerId || pendingPointerRef.current) return;
      setControlError(null);
      const provenance = {
        actionSequence: latest.tab.actionSequence,
        navigationRevision: latest.tab.snapshot.navigationRevision,
        viewportEpoch: latest.tab.snapshot.viewportEpoch,
        browserIncarnation: latest.tab.snapshot.browserIncarnation,
        profileEpoch: latest.tab.snapshot.profileEpoch,
        isController: Boolean(latest.tab.isController),
        leaseToken: latest.tab.leaseToken,
        subscriptionEpoch:
          streamControllerRef.current?.getCurrentSubscriptionEpoch(),
      };
      const controlSocket = streamControllerRef.current?.getControlSocket();

      const pending: PendingBrowserPointer = {
        pointerId: e.pointerId,
        down: snapshotBrowserPointer(e),
      };
      pendingPointerRef.current = pending;
      let acquiredLeaseToken: string | undefined;
      const isGestureBaseValid = (current: { appState: { activeTabId: string }; tab: { phase: string; snapshot?: { status?: string; inputAvailable?: boolean; navigationRevision: string; viewportEpoch: string; browserIncarnation: string; profileEpoch: string }; sessionId?: string; viewerId?: string; actionSequence: number } } | null) =>
        pendingPointerRef.current === pending &&
        pointerVisibleRef.current &&
        isCurrentConnection(liveOwner) &&
        canStreamTabRef.current(currentAttachedCredsRef.current ?? undefined) &&
        Boolean(textInputProxyRef.current?.isFocused()) &&
        inputControllerRef.current === input &&
        Boolean(current) &&
        current!.appState.activeTabId === tab.tabId &&
        current!.tab.phase === "live" &&
        current!.tab.snapshot?.status === "running" &&
        Boolean(current!.tab.snapshot.inputAvailable) &&
        current!.tab.sessionId === sessionId &&
        current!.tab.viewerId === viewerId &&
        current!.tab.actionSequence === provenance.actionSequence &&
        String(current!.tab.snapshot.navigationRevision) === String(provenance.navigationRevision) &&
        String(current!.tab.snapshot.viewportEpoch) === String(provenance.viewportEpoch) &&
        current!.tab.snapshot.browserIncarnation === provenance.browserIncarnation &&
        String(current!.tab.snapshot.profileEpoch) === String(provenance.profileEpoch) &&
        streamControllerRef.current?.getCurrentSubscriptionEpoch() === provenance.subscriptionEpoch &&
        streamControllerRef.current?.getControlSocket() === controlSocket;
      const isCurrentGesture = () => {
        const current = readBrowserWindowAndTab(win.id, tab.tabId);
        return (
          isGestureBaseValid(current) &&
          (acquiredLeaseToken !== undefined
            ? Boolean(current!.tab.isController) && current!.tab.leaseToken === acquiredLeaseToken
            : Boolean(current!.tab.isController) === provenance.isController &&
              current!.tab.leaseToken === provenance.leaseToken)
        );
      };
      const handleControlClose = () => {
        if (pendingPointerRef.current === pending) cancelPendingGesture();
      };
      const handoff = input.beginControlHandoff(isCurrentGesture, () => {
        controlSocket?.removeEventListener("close", handleControlClose);
        if (pendingPointerRef.current === pending) {
          pendingPointerRef.current = null;
          textInputProxyRef.current?.reset();
        }
      });
      controlSocket?.addEventListener("close", handleControlClose, { once: true });
      void runSerializedBrowserControlAcquire(liveOwner, sessionId, viewerId, async () => {
        const latestInQueue = readBrowserWindowAndTab(win.id, tab.tabId);
        if (!isGestureBaseValid(latestInQueue)) {
          if (pendingPointerRef.current === pending) cancelPendingGesture();
          return;
        }
        let leaseTokenToUse: string;
        let acquiredLocally = false;
        if (latestInQueue!.tab.isController && latestInQueue!.tab.leaseToken) {
          leaseTokenToUse = latestInQueue!.tab.leaseToken;
          acquiredLeaseToken = leaseTokenToUse;
        } else {
          if (!isCurrentGesture()) {
            if (pendingPointerRef.current === pending) cancelPendingGesture();
            return;
          }
          const response = await acquireBrowserControl(liveOwner, sessionId, { viewerId, holderKind: "human" });
          if (!isCurrentGesture()) {
            if (pendingPointerRef.current === pending) cancelPendingGesture();
            if (isCurrentConnection(liveOwner)) {
              void releaseBrowserControl(liveOwner, sessionId, { leaseToken: response.leaseToken }).catch((error) =>
                console.warn("[BrowserStream] Abandoned control release failed:", error),
              );
            }
            return;
          }
          acquiredLocally = true;
          leaseTokenToUse = response.leaseToken;
          acquiredLeaseToken = leaseTokenToUse;
          updateBrowserTabInStore(win.id, tab.tabId, { isController: true, leaseToken: leaseTokenToUse });
        }
        const focused =
          input.handlePointerDown(pending.down) &&
          (!pending.move || input.handlePointerMove(pending.move)) &&
          (!pending.up || input.handlePointerUp(pending.up));
        pending.replayed = true;
        if (
          !focused ||
          !input.completeControlHandoff(handoff, () => {
            if (pendingPointerRef.current === pending) pendingPointerRef.current = null;
            controlSocket?.removeEventListener("close", handleControlClose);
          })
        ) {
          cancelPendingGesture();
          input.releaseAllHeldInput();
          if (acquiredLocally) {
            updateBrowserTabInStore(win.id, tab.tabId, { isController: false, leaseToken: undefined });
            void releaseBrowserControl(liveOwner, sessionId, { leaseToken: leaseTokenToUse }).catch((error) =>
              console.warn("[BrowserStream] Unused control release failed:", error),
            );
          }
        }
      }).catch((error) => {
        if (pendingPointerRef.current === pending) {
          cancelPendingGesture();
          setControlError(
            error instanceof BrowserHostClientError && error.status === 409
              ? "Browser control is held by another viewer"
              : "Browser control could not be acquired",
          );
        }
        console.warn("[BrowserStream] Click control acquisition failed:", error);
      });
    },
    [win.id, tab.tabId, canPlayAudio, cancelPendingGesture, clearSelectedTextCache, ensurePcmPlayer],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (canPlayAudio()) {
        ensurePcmPlayer().prime();
      }
      const downPos = pointerDownPosRef.current;
      if (downPos && downPos.pointerId === e.pointerId) {
        pointerDownPosRef.current = null;
        if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) {
          const capturedAuth = readSelectionAuthority();
          if (capturedAuth) {
            const capturedOwner = { ...ownerRef.current };
            const capturedGen = ++selectionCacheGenRef.current;
            clearTimeout(selectedTextRefreshTimerRef.current ?? undefined);
            selectedTextRefreshTimerRef.current = window.setTimeout(() => {
              selectedTextRefreshTimerRef.current = null;
              const liveBefore = readSelectionAuthority();
              if (
                selectionCacheGenRef.current !== capturedGen ||
                !liveBefore ||
                !isCurrentConnection(capturedOwner) ||
                liveBefore.sessionId !== capturedAuth.sessionId ||
                liveBefore.leaseToken !== capturedAuth.leaseToken ||
                liveBefore.navigationRevision !== capturedAuth.navigationRevision ||
                liveBefore.browserIncarnation !== capturedAuth.browserIncarnation ||
                liveBefore.profileEpoch !== capturedAuth.profileEpoch ||
                liveBefore.scopeKey !== capturedAuth.scopeKey
              ) {
                return;
              }
              void getBrowserSelectedText(capturedOwner, capturedAuth.sessionId, capturedAuth.leaseToken)
                .then((res) => {
                  const liveAfter = readSelectionAuthority();
                  if (
                    selectionCacheGenRef.current !== capturedGen ||
                    !liveAfter ||
                    !isCurrentConnection(capturedOwner) ||
                    liveAfter.sessionId !== capturedAuth.sessionId ||
                    liveAfter.leaseToken !== capturedAuth.leaseToken ||
                    liveAfter.navigationRevision !== capturedAuth.navigationRevision ||
                    liveAfter.browserIncarnation !== capturedAuth.browserIncarnation ||
                    liveAfter.profileEpoch !== capturedAuth.profileEpoch ||
                    liveAfter.scopeKey !== capturedAuth.scopeKey
                  ) {
                    return;
                  }
                  cachedSelectedTextRef.current = res.text ? { text: res.text, ...capturedAuth } : null;
                })
                .catch(() => {});
            }, 120);
          }
        }
      }
      const pending = pendingPointerRef.current;
      if (pending && !pending.replayed) {
        if (pending.pointerId === e.pointerId)
          pending.up = snapshotBrowserPointer(e);
        return;
      }
      inputControllerRef.current?.handlePointerUp(e);
    },
    [canPlayAudio, ensurePcmPlayer, readSelectionAuthority],
  );

  const handleProxyUserGesture = useCallback(() => {
    if (canPlayAudio()) {
      ensurePcmPlayer().prime();
    }
  }, [canPlayAudio, ensurePcmPlayer]);

  const handleProxyCopy = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const liveAuth = readSelectionAuthority();
      const cached = cachedSelectedTextRef.current;
      if (
        !liveAuth ||
        !cached ||
        !cached.text ||
        cached.sessionId !== liveAuth.sessionId ||
        cached.leaseToken !== liveAuth.leaseToken ||
        cached.navigationRevision !== liveAuth.navigationRevision ||
        cached.browserIncarnation !== liveAuth.browserIncarnation ||
        cached.profileEpoch !== liveAuth.profileEpoch ||
        cached.scopeKey !== liveAuth.scopeKey
      ) {
        return;
      }
      e.clipboardData?.setData("text/plain", cached.text);
      e.preventDefault();
    },
    [readSelectionAuthority],
  );

  const handleProxyCopyShortcut = useCallback(() => {
    const capturedAuth = readSelectionAuthority();
    if (!capturedAuth) return;
    const capturedOwner = { ...ownerRef.current };
    const capturedGen = ++selectionCacheGenRef.current;
    const isStillAuthorized = (): boolean => {
      if (selectionCacheGenRef.current !== capturedGen) return false;
      const live = readSelectionAuthority();
      return Boolean(
        live &&
          isCurrentConnection(capturedOwner) &&
          live.sessionId === capturedAuth.sessionId &&
          live.leaseToken === capturedAuth.leaseToken &&
          live.navigationRevision === capturedAuth.navigationRevision &&
          live.browserIncarnation === capturedAuth.browserIncarnation &&
          live.profileEpoch === capturedAuth.profileEpoch &&
          live.scopeKey === capturedAuth.scopeKey,
      );
    };
    void getBrowserSelectedText(capturedOwner, capturedAuth.sessionId, capturedAuth.leaseToken)
      .then(async (res) => {
        if (!isStillAuthorized()) return;
        if (!res.text) {
          cachedSelectedTextRef.current = null;
          return;
        }
        cachedSelectedTextRef.current = { text: res.text, ...capturedAuth };
        await writeTextToClipboard(res.text, isStillAuthorized);
      })
      .catch(() => {});
  }, [readSelectionAuthority]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const pending = pendingPointerRef.current;
      if (pending && !pending.replayed) {
        if (pending.pointerId === e.pointerId)
          pending.move = snapshotBrowserPointer(e);
        return;
      }
      inputControllerRef.current?.handlePointerMove(e);
    },
    [],
  );

  const handlePointerCancel = useCallback(() => {
    cancelPendingGesture();
    inputControllerRef.current?.handlePointerCancel();
  }, [cancelPendingGesture]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    inputControllerRef.current?.handleWheel(e);
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      e.preventDefault();
    },
    [],
  );

  if (!hostEl) return null;

  return createPortal(
    <CanvasView
      ref={setCanvasEl}
      controller={streamController}
      isParked={!isEffectiveVisible}
      onCanvasPointerDown={handlePointerDown}
      onCanvasPointerUp={handlePointerUp}
      onCanvasPointerMove={handlePointerMove}
      onCanvasPointerCancel={handlePointerCancel}
      onCanvasWheel={handleWheel}
      onCanvasContextMenu={handleContextMenu}
    >
      <TextInputProxy
        ref={textInputProxyRef}
        controller={inputController}
        onBlur={cancelPendingGesture}
        onUserGesture={handleProxyUserGesture}
        onCopyShortcut={handleProxyCopyShortcut}
        onSelectionInvalidate={clearSelectedTextCache}
        onCopy={handleProxyCopy}
      />
      {(streamStatus === "error" || streamStatus === "unsupported") && (
        <div
          role="alert"
          data-testid={`browser-stream-status-error-${win.id}-${tab.tabId}`}
          className="absolute top-0 inset-x-0 bg-red-900/90 p-2 text-xs text-red-100 flex items-center justify-between gap-2 pointer-events-auto"
        >
          <span>{streamStatus === "unsupported" ? "Canvas frame decode unsupported" : "Stream rendering error"}</span>
        </div>
      )}
      {viewerCapacityError && (
        <div
          role="alert"
          data-testid={`browser-viewer-capacity-error-${win.id}-${tab.tabId}`}
          className="absolute top-0 inset-x-0 bg-amber-900/90 p-2 text-xs text-amber-100 flex items-center justify-between gap-2 pointer-events-auto"
        >
          <span>{viewerCapacityError}</span>
          <button
            type="button"
            data-testid={`browser-viewer-retry-btn-${win.id}-${tab.tabId}`}
            onClick={() => setRetryNonce((n) => n + 1)}
            className="px-2 py-0.5 rounded bg-amber-700 hover:bg-amber-600 text-white font-medium"
          >
            Retry stream
          </button>
        </div>
      )}
      {controlError && (
        <div
          role="alert"
          className="absolute bottom-0 inset-x-0 bg-black/80 p-2 text-xs text-white pointer-events-none"
        >
          {controlError}
        </div>
      )}
      {activeDialog && (
        <BrowserDialogModal
          dialog={activeDialog}
          onConfirm={handleDialogConfirm}
          onCancel={handleDialogCancel}
        />
      )}
    </CanvasView>,
    hostEl,
  );
}

// ============================================================================
// Root Browser Stream Keep-Alive Host
// ============================================================================

export function BrowserStreamKeepAliveHost() {
  const sessionWindows = useWindowStore((state) => state.session.windows);
  const parkingRef = useRef<HTMLDivElement | null>(null);
  const [parkingEl, setParkingEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    setParkingEl(parkingRef.current);
  }, []);

  const browserWindowTabs = useMemo(() => {
    const items: { window: OsWindow; tab: BrowserTabRuntime }[] = [];
    for (const win of Object.values(sessionWindows)) {
      if (win.appId !== "browser" || !win.appState) continue;
      const appState = readCanonicalBrowserWindowState(win.appState, `tab-${win.id}`);
      for (const tab of appState.tabs) {
        if (!tab || typeof tab.tabId !== "string" || !tab.tabId) continue;
        items.push({ window: win, tab });
      }
    }
    return items;
  }, [sessionWindows]);

  return (
    <div
      ref={parkingRef}
      aria-hidden="true"
      data-os-browser-parking-host="true"
      data-testid="browser-keep-alive-host"
      style={{
        position: "absolute",
        visibility: "hidden",
        pointerEvents: "none",
        width: 1,
        height: 1,
        overflow: "hidden",
        top: -10000,
        left: -10000,
      }}
    >
      {parkingEl &&
        browserWindowTabs.map(({ window: win, tab }) => (
          <ParkedBrowserStreamItem
            key={browserTabSlotKey(win.id, tab.tabId)}
            window={win}
            tab={tab}
            parkingHost={parkingEl}
          />
        ))}
    </div>
  );
}
