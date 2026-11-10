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
import { generateUUID } from "../lib/utils.js";
import { useWindowStore } from "./window-store.js";
import { syncBrowserSessionWindow } from "./browser-session-sync.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import {
  getConnectionSnapshot,
  isCurrentConnection,
  useConnectionSnapshot,
} from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { CanvasView } from "../browser-host/canvas-view.js";
import {
  BrowserStreamController,
} from "../browser-host/stream-controller.js";
import { BrowserInputController, type CanvasPointerInput } from "../browser-host/input-controller.js";
import {
  TextInputProxy,
  type TextInputProxyHandle,
} from "../browser-host/text-input-proxy.js";
import {
  acquireBrowserControl,
  BrowserHostClientError,
  createBrowserSession,
  getBrowserCapabilities,
  getBrowserSession,
  mintViewerAttachmentTickets,
  releaseBrowserControl,
  respondBrowserDialog,
  type ViewerAttachmentCredentials,
} from "../api/browser-host-client.js";
import type {
  ServerControlEvent,
} from "../api/browser-host-types.js";
import type { OsWindow } from "./types.js";

// ============================================================================
// Slot Registry for Root-Owned Browser Keep-Alive
// ============================================================================

export interface BrowserStreamSlot {
  windowId: string;
  element: HTMLElement | null;
  isVisible: boolean;
}

const slotRegistry = new Map<string, BrowserStreamSlot>();
const slotListeners = new Set<() => void>();

const fencedBrowserProfiles = new Map<
  string,
  { generation: number; reason: string }
>();
const fenceListeners = new Set<() => void>();

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
  fencedBrowserProfiles.set(profileId, { generation: gen, reason });
  const state = useWindowStore.getState();
  const windows = state.session?.windows ?? {};
  for (const win of Object.values(windows)) {
    if (win.appId === "browser" && win.ctx.profileId === profileId) {
      state.updateAppState(win.id, {
        sessionId: undefined,
        leaseToken: undefined,
        isController: false,
        browserIncarnation: undefined,
        unsupportedReason: reason,
      });
    }
  }
  fenceListeners.forEach((l) => l());
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
    if (win.appId === "browser" && win.ctx.profileId === profileId) {
      state.updateAppState(win.id, {
        unsupportedReason: undefined,
      });
    }
  }
  fenceListeners.forEach((l) => l());
}

export function registerBrowserStreamSlot(
  windowId: string,
  element: HTMLElement | null,
  isVisible: boolean,
): () => void {
  slotRegistry.set(windowId, { windowId, element, isVisible });
  slotListeners.forEach((l) => l());
  return () => {
    slotRegistry.delete(windowId);
    slotListeners.forEach((l) => l());
  };
}

export function updateBrowserStreamSlot(
  windowId: string,
  element: HTMLElement | null,
  isVisible: boolean,
): void {
  const existing = slotRegistry.get(windowId);
  if (existing?.element === element && existing.isVisible === isVisible) return;
  // Subscribers store the slot snapshot in React state. Publish a new identity
  // so a visibility-only transition actually runs pause/restore effects.
  slotRegistry.set(windowId, { windowId, element, isVisible });
  slotListeners.forEach((l) => l());
}

export function getBrowserStreamSlot(
  windowId: string,
): BrowserStreamSlot | undefined {
  return slotRegistry.get(windowId);
}

// ============================================================================
// Dialog Modal Overlay
// ============================================================================

export interface ActiveDialogState {
  dialogId: string;
  message: string;
  dialogType: string;
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
// Single Parked Browser Stream Item
// ============================================================================

interface ParkedBrowserStreamItemProps {
  window: OsWindow;
  parkingHost: HTMLElement;
}

// React clears currentTarget after dispatch. Retain only the fields input uses
// while the first pointer gesture waits for its control lease.
function snapshotBrowserPointer(event: React.PointerEvent<HTMLCanvasElement>): CanvasPointerInput {
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
  parkingHost,
}: ParkedBrowserStreamItemProps) {
  const [hostEl, setHostEl] = useState<HTMLDivElement | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const pendingCredsRef = useRef<ViewerAttachmentCredentials | null>(null);
  const textInputProxyRef = useRef<TextInputProxyHandle | null>(null);
  const streamControllerRef = useRef<BrowserStreamController | null>(null);
  const inputControllerRef = useRef<BrowserInputController | null>(null);
  const pendingPointerRef = useRef<PendingBrowserPointer | null>(null);
  const pointerVisibleRef = useRef(false);

  const [streamController, setStreamController] = useState<BrowserStreamController | null>(null);
  const [inputController, setInputController] = useState<BrowserInputController | null>(null);

  const [slot, setSlot] = useState<BrowserStreamSlot | null>(() =>
    slotRegistry.get(win.id) ?? null,
  );
  const [activeDialog, setActiveDialog] = useState<ActiveDialogState | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);

  const cancelPendingGesture = useCallback(() => {
    pendingPointerRef.current = null;
    inputControllerRef.current?.cancelControlHandoff();
    textInputProxyRef.current?.reset();
  }, []);

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
  const isSuppressed =
    isCognitoActive || isLockScreenActive || isProfileResetFenced;
  const owner = useMemo<ConnectionRef>(
    () => ({
      profileId: win.ctx.profileId,
      generation: currentGen,
    }),
    [win.ctx.profileId, currentGen],
  );

  // Track slot registration updates
  useEffect(() => {
    const update = () => {
      setSlot(slotRegistry.get(win.id) ?? null);
    };
    slotListeners.add(update);
    update();
    return () => {
      slotListeners.delete(update);
    };
  }, [win.id]);

  // Imperatively create host element inside parkingHost so React never manages hostEl's parent
  useLayoutEffect(() => {
    const el = document.createElement("div");
    el.setAttribute("data-os-browser-stream-container", win.id);
    el.setAttribute("data-testid", `browser-stream-container-${win.id}`);
    el.className = "relative w-full h-full bg-black overflow-hidden select-none";
    el.style.width = "100%";
    el.style.height = "100%";
    parkingHost.appendChild(el);
    setHostEl(el);

    return () => {
      el.remove();
      setHostEl(null);
    };
  }, [parkingHost, win.id]);

  // Reparent container node between slot.element and parkingHost
  useLayoutEffect(() => {
    if (!hostEl) return;

    const destination = slot?.element ?? parkingHost;
    if (destination && hostEl.parentElement !== destination) {
      destination.appendChild(hostEl);
    }
  }, [slot?.element, parkingHost, hostEl]);

  // Derived effective visibility
  const isEffectiveVisible = Boolean(slot?.isVisible && slot?.element && !isSuppressed);
  pointerVisibleRef.current = isEffectiveVisible;

  // Synchronous style updates for suppression and visibility
  useLayoutEffect(() => {
    if (!hostEl) return;
    hostEl.style.pointerEvents = isSuppressed ? "none" : "auto";
    hostEl.style.visibility = isEffectiveVisible ? "visible" : "hidden";
  }, [hostEl, isSuppressed, isEffectiveVisible]);

  // Synchronous privacy / visibility updates to stream controller
  useLayoutEffect(() => {
    if (streamControllerRef.current) {
      streamControllerRef.current.setPrivacyMode(isSuppressed);
      if (isSuppressed) {
        cancelPendingGesture();
        textInputProxyRef.current?.blur();
        inputControllerRef.current?.releaseAllHeldInput();
      }
    }
  }, [isSuppressed, cancelPendingGesture]);

  useLayoutEffect(() => {
    if (!isEffectiveVisible) {
      cancelPendingGesture();
      inputControllerRef.current?.releaseAllHeldInput();
    }
    if (streamControllerRef.current) {
      streamControllerRef.current.setVisibility(isEffectiveVisible);
    }
  }, [isEffectiveVisible, cancelPendingGesture]);

  // Retire an old acquisition immediately, even if its request never settles.
  useLayoutEffect(() => {
    cancelPendingGesture();
    return cancelPendingGesture;
  }, [
    owner, win.appState?.sessionId, win.appState?.viewerId,
    win.appState?.browserIncarnation, win.appState?.profileEpoch,
    win.appState?.navigationRevision, win.appState?.viewportEpoch,
    cancelPendingGesture,
  ]);

  // Initialize controllers when canvas is ready
  useLayoutEffect(() => {
    if (!canvasEl) return;

    if (!streamControllerRef.current) {
      const streamCtrl = new BrowserStreamController({
        canvas: canvasEl,
        onGeometryChange: () => {},
        onControlEvent: (event: ServerControlEvent, credentials) => {
          const current = useWindowStore.getState().session.windows[win.id];
          if (!isCurrentConnection(credentials.owner) ||
              current?.ctx.profileId !== credentials.owner.profileId ||
              current.appState?.sessionId !== credentials.browserSessionId ||
              current.appState.browserIncarnation !== credentials.browserIncarnation ||
              String(current.appState.profileEpoch) !== String(credentials.profileEpoch)) return;
          if (event.kind === "sessionUpdated") {
            const result = syncBrowserSessionWindow(
              credentials.owner, win.id, credentials.browserSessionId, event.session, credentials,
            );
            if (result !== "detached" &&
                (event.session.status !== "running" || !event.session.inputAvailable)) {
              cancelPendingGesture();
              inputControllerRef.current?.releaseAllHeldInput();
              setActiveDialog(null);
            }
          } else if (event.kind === "dialogOpened") {
            cancelPendingGesture();
            inputControllerRef.current?.releaseAllHeldInput();
            setActiveDialog({
              dialogId: event.dialogId,
              message: event.message,
              dialogType: event.dialogType,
            });
          } else if (event.kind === "dialogClosed") {
            setActiveDialog(null);
          } else if (event.kind === "leaseRevoked") {
            cancelPendingGesture();
            inputControllerRef.current?.releaseAllHeldInput();
            useWindowStore.getState().updateAppState(win.id, {
              isController: false,
              leaseToken: undefined,
            });
            // Dismiss pending dialog on controller loss per contract §9
            setActiveDialog(null);
          } else if (event.kind === "status") {
            if (!event.inputAvailable) {
              cancelPendingGesture();
              inputControllerRef.current?.releaseAllHeldInput();
            }
            useWindowStore.getState().updateAppState(win.id, {
              inputAvailable: current.appState.browserSessionStatus === "running" && event.inputAvailable,
              unavailableReason: event.unavailableReason,
            });
          } else if (event.kind === "error") {
            console.error("[BrowserStream] Control socket error:", event.message);
          }
        },
        onError: (err) => {
          console.error("[BrowserStream] Controller error:", err);
        },
      });

      streamControllerRef.current = streamCtrl;
      setStreamController(streamCtrl);

      if (pendingCredsRef.current) {
        streamCtrl.attach(pendingCredsRef.current);
      }
    }

    if (!inputControllerRef.current) {
      const inputCtrl = new BrowserInputController({
        getSessionId: () =>
          (useWindowStore.getState().session.windows[win.id]?.appState?.sessionId as string | undefined) ?? "",
        getIncarnation: () =>
          (useWindowStore.getState().session.windows[win.id]?.appState?.browserIncarnation as string | undefined) ?? "",
        getProfileEpoch: () =>
          (useWindowStore.getState().session.windows[win.id]?.appState?.profileEpoch as number | undefined) ?? 0,
        getSubscriptionEpoch: () =>
          streamControllerRef.current?.getCurrentSubscriptionEpoch() ?? null,
        getLeaseToken: () =>
          (useWindowStore.getState().session.windows[win.id]?.appState?.leaseToken as string | undefined) ?? null,
        getViewportEpoch: () =>
          (useWindowStore.getState().session.windows[win.id]?.appState?.viewportEpoch as string | number | undefined) ?? 0,
        getDrawnRect: () => streamControllerRef.current?.getDrawnRect() ?? null,
        getControlSocket: () =>
          streamControllerRef.current?.getControlSocket() ?? null,
        isInputAllowed: () =>
          !useCognitoModeStore.getState().active && !useLockScreenStore.getState().isLocked &&
          !isBrowserViewFenced(win.ctx.profileId, getConnectionSnapshot(win.ctx.profileId)?.owner.generation),
        onError: (err) => {
          console.error("[BrowserInput] Controller error:", err);
          setControlError(err.message);
        },
      });

      inputControllerRef.current = inputCtrl;
      setInputController(inputCtrl);
    }
  }, [canvasEl, win.id, win.ctx.profileId, cancelPendingGesture]);

  // A live URL is presentation state, not an attachment identity. Only a new,
  // not-yet-created target consumes it in the connection lifecycle below.
  const creationUrl = win.appState?.sessionId ? undefined : win.appState?.url;


  // Server session connection / creation lifecycle
  useEffect(() => {
    let isCancelled = false;
    pendingCredsRef.current = null;
    if (!isEffectiveVisible) return;
    streamControllerRef.current?.setVisibility(true);
    const initialWindow = useWindowStore.getState().session.windows[win.id];
    if (initialWindow?.ctx.profileId === owner.profileId) {
      useWindowStore.getState().updateAppState(win.id, {
        isController: false,
        leaseToken: undefined,
      });
    }
    const abortCtrl = new AbortController();

    const connectSession = async () => {
      const rawSessionId = win.appState?.sessionId as string | undefined;
      const url = creationUrl as string | undefined;

      if (!url && !rawSessionId) return;

      try {
        let activeSessionId = rawSessionId;

        // If no session created yet, verify capabilities then create session
        if (!activeSessionId && url) {
          try {
            const caps = await getBrowserCapabilities(owner, abortCtrl.signal);
            if (!caps.available) {
              if (!isCancelled && isCurrentConnection(owner)) {
                useWindowStore.getState().updateAppState(win.id, {
                  unsupportedReason:
                    caps.reason ?? "Browser capability unavailable on this host",
                });
              }
              return;
            }
          } catch {
            // Capability check endpoint might not be available in mock/test environment
          }

          const creationKey =
            (win.appState?.creationKey as string | undefined) ?? generateUUID();
          try {
            const created = await createBrowserSession(
              owner,
              {
                creationKey,
                url,
                viewport: {
                  width: 1280,
                  height: 900,
                  dpr: window.devicePixelRatio || 1,
                },
              },
              abortCtrl.signal,
            );

            if (isCancelled || !isCurrentConnection(owner)) return;


            useWindowStore.getState().updateAppState(win.id, {
              creationKey,
              sessionId: created.browserSessionId,
            });
            syncBrowserSessionWindow(owner, win.id, created.browserSessionId, created);
            // The state update triggers a re-render with the new sessionId,
            // which handles minting tickets without racing against this effect instance.
            return;
          } catch (createErr) {
            if (
              !isCancelled &&
              !abortCtrl.signal.aborted &&
              (createErr as Error)?.name !== "AbortError"
            ) {
              console.warn(
                "[BrowserStream] Session creation request skipped/failed in current environment:",
                createErr,
              );
            }
            return;
          }
        }

        if (activeSessionId && !isCancelled) {
          // Persisted windows are hints, never authority for runtime identity.
          const snapshot = await getBrowserSession(owner, activeSessionId, abortCtrl.signal);
          if (isCancelled || !isCurrentConnection(owner)) return;
          const sync = syncBrowserSessionWindow(owner, win.id, activeSessionId, snapshot);
          if (sync === "detached" ||
              useWindowStore.getState().session.windows[win.id]?.appState?.browserSessionStatus !== "running") return;
          try {
            const creds = await mintViewerAttachmentTickets(
              owner,
              activeSessionId,
              snapshot.browserIncarnation,
              Number(snapshot.profileEpoch),
              abortCtrl.signal,
            );

            const current = useWindowStore.getState().session.windows[win.id];
            if (isCancelled || !isCurrentConnection(owner) ||
                current?.ctx.profileId !== owner.profileId ||
                current.appState?.sessionId !== activeSessionId ||
                current.appState.browserIncarnation !== creds.browserIncarnation ||
                String(current.appState.profileEpoch) !== String(creds.profileEpoch) ||
                current.appState.browserSessionStatus !== "running") return;
            pendingCredsRef.current = creds;

            useWindowStore.getState().updateAppState(win.id, {
              viewerId: creds.viewerId,
            });

            if (streamControllerRef.current) {
              streamControllerRef.current.attach(creds);
            }
          } catch (ticketErr) {
            if (
              !isCancelled &&
              !abortCtrl.signal.aborted &&
              (ticketErr as Error)?.name !== "AbortError"
            ) {
              console.warn(
                "[BrowserStream] Ticket minting skipped/failed in current environment:",
                ticketErr,
              );
            }
          }
        }
      } catch (err) {
        if (!isCancelled && isCurrentConnection(owner)) {
          const current = useWindowStore.getState().session.windows[win.id];
          if (current?.ctx.profileId === owner.profileId && current.appState?.sessionId === rawSessionId) {
            useWindowStore.getState().updateAppState(win.id, {
              unsupportedReason: err instanceof BrowserHostClientError && err.status === 404
                ? "Browser session no longer exists on this host"
                : "Browser session could not be connected",
              inputAvailable: false,
              isController: false,
              leaseToken: undefined,
            });
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
      streamControllerRef.current?.setVisibility(false);
    };
  }, [
    owner,
    isEffectiveVisible,
    win.id,
    creationUrl,
    win.appState?.sessionId,
    win.appState?.creationKey,
    cancelPendingGesture,
  ]);


  // Cleanup controllers on final component unmount (when window is closed)
  useEffect(() => {
    return () => {
      cancelPendingGesture();
      streamControllerRef.current?.dispose();
      inputControllerRef.current?.dispose();
      streamControllerRef.current = null;
      inputControllerRef.current = null;
    };
  }, [cancelPendingGesture]);

  // Dialog handlers
  const handleDialogConfirm = useCallback(
    (promptText?: string) => {
      if (!activeDialog) return;
      const latestWin = useWindowStore.getState().session.windows[win.id];
      const sessionId = (latestWin?.appState?.sessionId as string | undefined) ?? "";
      const currentLeaseToken = (latestWin?.appState?.leaseToken as string | undefined) ?? "";
      if (sessionId) {
        void respondBrowserDialog(owner, sessionId, {
          leaseToken: currentLeaseToken,
          dialogId: activeDialog.dialogId,
          accept: true,
          promptText,
        });
      }
      setActiveDialog(null);
    },
    [activeDialog, owner, win.id],
  );

  const handleDialogCancel = useCallback(() => {
    if (!activeDialog) return;
    const latestWin = useWindowStore.getState().session.windows[win.id];
    const sessionId = (latestWin?.appState?.sessionId as string | undefined) ?? "";
    const currentLeaseToken = (latestWin?.appState?.leaseToken as string | undefined) ?? "";
    if (sessionId) {
      void respondBrowserDialog(owner, sessionId, {
        leaseToken: currentLeaseToken,
        dialogId: activeDialog.dialogId,
        accept: false,
      });
    }
    setActiveDialog(null);
  }, [activeDialog, owner, win.id]);

  // Input event dispatchers to input controller
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (useCognitoModeStore.getState().active || useLockScreenStore.getState().isLocked ||
          isBrowserViewFenced(owner.profileId, owner.generation)) return;
      textInputProxyRef.current?.focus();
      const input = inputControllerRef.current;
      if (!input || !pointerVisibleRef.current || !isCurrentConnection(owner) ||
          !input.mapClientToFractions(e.clientX, e.clientY, e.currentTarget)) return;
      const latestWin = useWindowStore.getState().session.windows[win.id];
      if (latestWin?.appState?.browserSessionStatus !== "running" ||
          !latestWin.appState.inputAvailable) return;
      if (latestWin?.appState?.isController && latestWin.appState.leaseToken) {
        // A new explicit focusing gesture retires the prior gesture's paced tail.
        if (pendingPointerRef.current?.replayed) cancelPendingGesture();
        input.handlePointerDown(e);
        return;
      }
      const viewerId = latestWin?.appState?.viewerId as string | undefined;
      const sessionId = latestWin?.appState?.sessionId as string | undefined;
      if (!latestWin?.appState || !sessionId || !viewerId || pendingPointerRef.current) return;
      setControlError(null);
      const provenance = {
        navigationRevision: latestWin.appState?.navigationRevision,
        viewportEpoch: latestWin.appState?.viewportEpoch,
        browserIncarnation: latestWin.appState?.browserIncarnation,
        profileEpoch: latestWin.appState?.profileEpoch,
        subscriptionEpoch: streamControllerRef.current?.getCurrentSubscriptionEpoch(),
      };
      const controlSocket = streamControllerRef.current?.getControlSocket();

      const pending: PendingBrowserPointer = {
        pointerId: e.pointerId,
        down: snapshotBrowserPointer(e),
      };
      pendingPointerRef.current = pending;
      const isCurrentGesture = () => {
        const current = useWindowStore.getState().session.windows[win.id];
        return pendingPointerRef.current === pending && pointerVisibleRef.current &&
          !useCognitoModeStore.getState().active && !useLockScreenStore.getState().isLocked &&
          !isBrowserViewFenced(owner.profileId, owner.generation) &&
          Boolean(slotRegistry.get(win.id)?.isVisible) &&
          Boolean(textInputProxyRef.current?.isFocused()) &&
          isCurrentConnection(owner) && inputControllerRef.current === input &&
          current?.ctx.profileId === owner.profileId &&
          current.appState?.browserSessionStatus === "running" && Boolean(current.appState.inputAvailable) &&
          current.appState.sessionId === sessionId && current.appState.viewerId === viewerId &&
          current.appState.navigationRevision === provenance.navigationRevision &&
          String(current.appState.viewportEpoch) === String(provenance.viewportEpoch) &&
          current.appState.browserIncarnation === provenance.browserIncarnation &&
          String(current.appState.profileEpoch) === String(provenance.profileEpoch) &&
          streamControllerRef.current?.getCurrentSubscriptionEpoch() === provenance.subscriptionEpoch &&
          streamControllerRef.current?.getControlSocket() === controlSocket;
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
      void acquireBrowserControl(owner, sessionId, { viewerId, holderKind: "human" })
        .then((response) => {
          if (!isCurrentGesture()) {
            if (pendingPointerRef.current === pending) cancelPendingGesture();
            if (isCurrentConnection(owner)) {
              void releaseBrowserControl(owner, sessionId, { leaseToken: response.leaseToken })
                .catch((error) => console.warn("[BrowserStream] Abandoned control release failed:", error));
            }
            return;
          }
          useWindowStore.getState().updateAppState(win.id, {
            isController: true,
            leaseToken: response.leaseToken,
          });
          const focused = input.handlePointerDown(pending.down) &&
            (!pending.move || input.handlePointerMove(pending.move)) &&
            (!pending.up || input.handlePointerUp(pending.up));
          pending.replayed = true;
          if (!focused || !input.completeControlHandoff(handoff, () => {
            if (pendingPointerRef.current === pending) pendingPointerRef.current = null;
            controlSocket?.removeEventListener("close", handleControlClose);
          })) {
            cancelPendingGesture();
            input.releaseAllHeldInput();
            useWindowStore.getState().updateAppState(win.id, {
              isController: false, leaseToken: undefined,
            });
            void releaseBrowserControl(owner, sessionId, { leaseToken: response.leaseToken })
              .catch((error) => console.warn("[BrowserStream] Unused control release failed:", error));
          }
        })
        .catch((error) => {
          if (pendingPointerRef.current === pending) {
            cancelPendingGesture();
            setControlError(error instanceof BrowserHostClientError && error.status === 409
              ? "Browser control is held by another viewer"
              : "Browser control could not be acquired");
          }
          console.warn("[BrowserStream] Click control acquisition failed:", error);
        });
    },
    [owner, win.id, cancelPendingGesture],
  );
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const pending = pendingPointerRef.current;
    if (pending && !pending.replayed) {
      if (pending.pointerId === e.pointerId) pending.up = snapshotBrowserPointer(e);
      return;
    }
    inputControllerRef.current?.handlePointerUp(e);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const pending = pendingPointerRef.current;
    if (pending && !pending.replayed) {
      if (pending.pointerId === e.pointerId) pending.move = snapshotBrowserPointer(e);
      return;
    }
    inputControllerRef.current?.handlePointerMove(e);
  }, []);

  const handlePointerCancel = useCallback(() => {
    cancelPendingGesture();
    inputControllerRef.current?.handlePointerCancel();
  }, [cancelPendingGesture]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    inputControllerRef.current?.handleWheel(e);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
  }, []);

  if (!hostEl) return null;

  return createPortal(
    <CanvasView
      ref={setCanvasEl}
      controller={streamController}
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
      />
      {controlError && (
        <div role="alert" className="absolute bottom-0 inset-x-0 bg-black/80 p-2 text-xs text-white pointer-events-none">
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

  const browserWindows = useMemo(
    () =>
      Object.values(sessionWindows).filter((w) => w.appId === "browser"),
    [sessionWindows],
  );

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
        width: 1024,
        height: 768,
        overflow: "hidden",
        top: -10000,
        left: -10000,
      }}
    >
      {parkingEl &&
        browserWindows.map((win) => {
          if (
            (win.appState?.presentation as { kind?: string } | undefined)?.kind ===
              "choose-target" ||
            (!win.appState?.url && !win.appState?.sessionId)
          ) {
            return null;
          }
          return (
            <ParkedBrowserStreamItem
              key={win.id}
              window={win}
              parkingHost={parkingEl}
            />
          );
        })}
    </div>
  );
}
