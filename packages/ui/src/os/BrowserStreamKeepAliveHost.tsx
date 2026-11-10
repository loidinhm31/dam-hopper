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
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import {
  getConnectionSnapshot,
  useConnectionSnapshot,
} from "@/api/connections.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { CanvasView } from "../browser-host/canvas-view.js";
import {
  BrowserStreamController,
} from "../browser-host/stream-controller.js";
import { BrowserInputController } from "../browser-host/input-controller.js";
import {
  TextInputProxy,
  type TextInputProxyHandle,
} from "../browser-host/text-input-proxy.js";
import {
  acquireBrowserControl,
  createBrowserSession,
  getBrowserCapabilities,
  mintViewerAttachmentTickets,
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
  if (existing) {
    existing.element = element;
    existing.isVisible = isVisible;
    slotListeners.forEach((l) => l());
  } else {
    slotRegistry.set(windowId, { windowId, element, isVisible });
    slotListeners.forEach((l) => l());
  }
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

  const [streamController, setStreamController] = useState<BrowserStreamController | null>(null);
  const [inputController, setInputController] = useState<BrowserInputController | null>(null);

  const [slot, setSlot] = useState<BrowserStreamSlot | null>(() =>
    slotRegistry.get(win.id) ?? null,
  );
  const [activeDialog, setActiveDialog] = useState<ActiveDialogState | null>(null);

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
        inputControllerRef.current?.releaseAllHeldInput();
      }
    }
  }, [isSuppressed]);

  useLayoutEffect(() => {
    if (streamControllerRef.current) {
      streamControllerRef.current.setVisibility(isEffectiveVisible);
    }
  }, [isEffectiveVisible]);

  // Initialize controllers when canvas is ready
  useLayoutEffect(() => {
    if (!canvasEl) return;

    if (!streamControllerRef.current) {
      const streamCtrl = new BrowserStreamController({
        canvas: canvasEl,
        onGeometryChange: () => {},
        onControlEvent: (event: ServerControlEvent) => {
          if (event.kind === "dialogOpened") {
            setActiveDialog({
              dialogId: event.dialogId,
              message: event.message,
              dialogType: event.dialogType,
            });
          } else if (event.kind === "dialogClosed") {
            setActiveDialog(null);
          } else if (event.kind === "leaseRevoked") {
            useWindowStore.getState().updateAppState(win.id, {
              isController: false,
              leaseToken: undefined,
            });
            // Dismiss pending dialog on controller loss per contract §9
            setActiveDialog(null);
          } else if (event.kind === "status") {
            useWindowStore.getState().updateAppState(win.id, {
              inputAvailable: event.inputAvailable,
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
        onError: (err) => {
          console.error("[BrowserInput] Controller error:", err);
        },
      });

      inputControllerRef.current = inputCtrl;
      setInputController(inputCtrl);
    }
  }, [canvasEl, win.id, win.ctx.profileId]);

  // Server session connection / creation lifecycle
  useEffect(() => {
    let isCancelled = false;
    const abortCtrl = new AbortController();

    const connectSession = async () => {
      const rawSessionId = win.appState?.sessionId as string | undefined;
      const url = win.appState?.url as string | undefined;

      if (!url && !rawSessionId) return;

      try {
        let activeSessionId = rawSessionId;
        let activeIncarnation = win.appState?.browserIncarnation as string | undefined;
        let activeProfileEpoch = win.appState?.profileEpoch as number | undefined;

        // If no session created yet, verify capabilities then create session
        if (!activeSessionId && url) {
          try {
            const caps = await getBrowserCapabilities(owner, abortCtrl.signal);
            if (!caps.available) {
              if (!isCancelled) {
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

            if (isCancelled) return;

            activeSessionId = created.browserSessionId;
            activeIncarnation = created.browserIncarnation;
            activeProfileEpoch = parseInt(created.profileEpoch, 10) || 0;

            useWindowStore.getState().updateAppState(win.id, {
              creationKey,
              sessionId: created.browserSessionId,
              browserIncarnation: created.browserIncarnation,
              profileEpoch: activeProfileEpoch,
              viewportEpoch: created.viewportEpoch,
              url: created.url,
              title: created.title,
              navigationRevision: created.navigationRevision ?? 1,
            });
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
          try {
            const creds = await mintViewerAttachmentTickets(
              owner,
              activeSessionId,
              activeIncarnation ?? "1",
              activeProfileEpoch ?? 0,
              abortCtrl.signal,
            );

            if (isCancelled) return;
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
        if (!isCancelled) {
          console.error("[BrowserStream] Session connect failed:", err);
        }
      }
    };

    void connectSession();

    return () => {
      isCancelled = true;
      abortCtrl.abort();
    };
  }, [
    owner,
    win.id,
    win.appState?.url,
    win.appState?.sessionId,
    win.appState?.browserIncarnation,
    win.appState?.profileEpoch,
    win.appState?.creationKey,
  ]);

  // Reconnect stream on restore from paused/disconnected state
  const prevEffectiveVisibleRef = useRef(isEffectiveVisible);
  useEffect(() => {
    if (isEffectiveVisible && !prevEffectiveVisibleRef.current) {
      const latestWin = useWindowStore.getState().session.windows[win.id];
      const activeSessionId = latestWin?.appState?.sessionId as string | undefined;
      const activeIncarnation = latestWin?.appState?.browserIncarnation as string | undefined;
      const activeProfileEpoch = latestWin?.appState?.profileEpoch as number | undefined;

      if (activeSessionId && streamControllerRef.current?.getStatus() === "disconnected") {
        void (async () => {
          try {
            const creds = await mintViewerAttachmentTickets(
              owner,
              activeSessionId,
              activeIncarnation ?? "1",
              activeProfileEpoch ?? 0,
            );
            streamControllerRef.current?.attach(creds);
            useWindowStore.getState().updateAppState(win.id, {
              viewerId: creds.viewerId,
            });
          } catch (err) {
            console.warn("[BrowserStream] Re-attach on restore failed:", err);
          }
        })();
      }
    }
    prevEffectiveVisibleRef.current = isEffectiveVisible;
  }, [isEffectiveVisible, owner, win.id]);

  // Cleanup controllers on final component unmount (when window is closed)
  useEffect(() => {
    return () => {
      streamControllerRef.current?.dispose();
      inputControllerRef.current?.dispose();
      streamControllerRef.current = null;
      inputControllerRef.current = null;
    };
  }, []);

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
      textInputProxyRef.current?.focus();

      const latestWin = useWindowStore.getState().session.windows[win.id];
      if (!latestWin?.appState?.isController) {
        const activeViewerId =
          (latestWin?.appState?.viewerId as string | undefined) ?? win.id;
        const sessionId = latestWin?.appState?.sessionId as string | undefined;
        if (sessionId) {
          void acquireBrowserControl(owner, sessionId, {
            viewerId: activeViewerId,
            holderKind: "human",
          })
            .then((resp) => {
              useWindowStore.getState().updateAppState(win.id, {
                isController: true,
                leaseToken: resp.leaseToken,
              });
            })
            .catch(() => {});
        }
      }

      inputControllerRef.current?.handlePointerDown(e);
    },
    [owner, win.id],
  );
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    inputControllerRef.current?.handlePointerUp(e);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    inputControllerRef.current?.handlePointerMove(e);
  }, []);

  const handlePointerCancel = useCallback(() => {
    inputControllerRef.current?.handlePointerCancel();
  }, []);

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
      />
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
