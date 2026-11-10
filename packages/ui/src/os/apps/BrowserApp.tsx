import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { generateUUID } from "@/lib/utils.js";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import { useWindowOwner, useWindowContext } from "../window-context.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { useResourceClaim } from "../resource-registry.js";
import { useWindowStore } from "../window-store.js";
import {
  switchBrowserWindowSession,
  syncBrowserSessionWindow,
} from "../browser-session-sync.js";
import {
  clearBrowserViewFenceForProfile,
  registerBrowserStreamSlot,
  requestBrowserProxyFocus,
  updateBrowserStreamSlot,
} from "../BrowserStreamKeepAliveHost.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { getApi, getConnectionSnapshot, isCurrentConnection } from "@/api/connections.js";
import type { SessionInfo } from "@/api/client.js";
import {
  acquireBrowserControl,
  BrowserHostClientError,
  getBrowserSession,
  historyBrowser,
  navigateBrowser,
  releaseBrowserControl,
  reloadBrowser,
  renewBrowserControl,
} from "@/api/browser-host-client.js";
import {
  collectHostTerminalCandidates,
  useHostBrowserSelection,
  type HostTerminalCandidate,
} from "@/browser-host/selection-controller.js";
import type { BrowserSessionDto } from "@/api/browser-host-types.js";
export interface BrowserAppProps {
  window: OsWindow;
}

function BrowserTargetChooser({
  window,
  owner,
}: {
  window: OsWindow;
  owner: ConnectionRef;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleOpen = () => {
    let trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter a URL for the browser preview");
      return;
    }
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      trimmed = `https://${trimmed}`;
    }
    try {
      new URL(trimmed);
    } catch {
      setError("Invalid URL format");
      return;
    }

    const snap = getConnectionSnapshot(owner.profileId);
    if (
      !snap ||
      snap.status !== "connected" ||
      snap.owner.generation !== owner.generation
    ) {
      setError(
        `Connection generation changed or disconnected for profile '${owner.profileId}'. Please re-open.`,
      );
      return;
    }
    setError(null);
    clearBrowserViewFenceForProfile(owner.profileId);

    useWindowStore.getState().updateAppState(window.id, {
      presentation: { kind: "resource", url: trimmed },
      url: trimmed,
    });
  };

  const handleCancel = () => {
    useWindowStore.getState().closeWindow(window.id);
  };

  return (
    <div
      data-testid={`browser-chooser-${window.id}`}
      data-os-browser-chooser="true"
      className="flex flex-col items-center justify-center p-6 h-full bg-[var(--color-surface)] text-[var(--color-text)] gap-4 select-none"
    >
      <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-6 space-y-4 shadow-md">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          Browser Preview
        </h3>
        <p className="text-xs text-[var(--color-text-muted)]">
          Enter an HTTP or HTTPS endpoint to preview inside this workspace.
        </p>

        {error && (
          <div
            role="alert"
            className="rounded border border-[var(--color-danger)] bg-[var(--color-danger)]/10 p-2 text-xs text-[var(--color-danger)]"
          >
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">
            URL
          </label>
          <input
            type="text"
            data-testid="browser-chooser-url-input"
            value={url}
            placeholder="http://localhost:5173"
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleOpen();
              if (e.key === "Escape") handleCancel();
            }}
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-input)] px-3 py-1.5 text-sm text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
            autoFocus
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            data-testid="browser-chooser-cancel-btn"
            onClick={handleCancel}
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="browser-chooser-open-btn"
            onClick={handleOpen}
            className="rounded bg-[var(--color-primary)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-primary)]/90"
          >
            Open Preview
          </button>
        </div>
      </div>
    </div>
  );
}

export function BrowserApp({ window }: BrowserAppProps) {
  const owner = useWindowOwner();
  const presentation = window.appState?.presentation as { kind?: string } | undefined;
  const isChooser =
    presentation?.kind === "choose-target" ||
    (!window.appState?.url && !window.appState?.sessionId && presentation?.kind !== "resource");

  if (isChooser) {
    return <BrowserTargetChooser window={window} owner={owner} />;
  }

  return <BrowserResourceView window={window} owner={owner} />;
}

function BrowserResourceView({
  window,
  owner,
}: {
  window: OsWindow;
  owner: ConnectionRef;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const context = useWindowContext();
  const isCognitoActive = useCognitoModeStore((state) => state.active);
  const previewUrl = (window.appState?.url as string | undefined) ?? "";
  const sessionId = window.appState?.sessionId as string | undefined;
  const navigationRevision = (window.appState?.navigationRevision as number | string | undefined) ?? 1;
  const unsupportedReason = window.appState?.unsupportedReason as string | undefined;
  const isController = Boolean(window.appState?.isController);
  const leaseToken = window.appState?.leaseToken as string | undefined;

  const popupBlocked = Boolean(window.appState?.popupBlocked);
  const activePopupSessionId = window.appState?.activePopupSessionId as string | undefined;
  const parentSessionId = (window.appState?.parentSessionId ??
    window.appState?.openerSessionId) as string | undefined;
  const [addressInput, setAddressInput] = useState(previewUrl);
  const [liveSessions, setLiveSessions] = useState<SessionInfo[]>([]);
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>("");
  const navigationActionRef = useRef<AbortController | null>(null);
  const [navigationPending, setNavigationPending] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const windows = useWindowStore((s) => s.session.windows);
  useEffect(() => {
    setAddressInput(previewUrl);
  }, [previewUrl]);

  // A pending request belongs to one connection/session, not this component's
  // entire lifetime. Retire it even if an aborted transport never settles.
  useLayoutEffect(() => {
    setNavigationPending(false);
    setNavigationError(null);
    return () => {
      navigationActionRef.current?.abort();
      navigationActionRef.current = null;
    };
  }, [owner.profileId, owner.generation, sessionId, window.id]);

  // Viewer-local presentation claim: each window has its own claim key,
  // allowing two windows to view the same target without resource collision.
  const claimKey = useMemo<ResourceClaimKey>(
    () => ({
      resourceKind: "browser",
      profileId: owner.profileId,
      generation: owner.generation,
      resourceId: window.id,
    }),
    [owner.profileId, owner.generation, window.id],
  );

  const claimStatus = useResourceClaim(claimKey, window.id);

  const isVisible =
    claimStatus.success &&
    !window.minimized &&
    context.isActiveDesktop &&
    !isCognitoActive;

  // Register slot with root keep-alive host
  useEffect(() => {
    const el = slotRef.current;
    const unregister = registerBrowserStreamSlot(window.id, el, isVisible);
    return () => {
      unregister();
    };
  }, [window.id, isVisible]);

  useLayoutEffect(() => {
    updateBrowserStreamSlot(window.id, slotRef.current, isVisible);
  }, [window.id, isVisible]);

  // Read authority before each explicit action; native navigation is independent
  // of our last rendered snapshot. A raced CAS rejection is refreshed, never replayed.
  const recreateDeadSession = useCallback(
    (targetUrl: string) => {
      if (!isCurrentConnection(owner)) return;
      clearBrowserViewFenceForProfile(owner.profileId);
      setNavigationError(null);
      useWindowStore.getState().updateAppState(window.id, {
        creationKey: generateUUID(),
        sessionId: undefined,
        browserIncarnation: undefined,
        browserSessionStatus: undefined,
        unsupportedReason: undefined,
        unavailableReason: undefined,
        isController: false,
        leaseToken: undefined,
        viewerId: undefined,
        parentSessionId: undefined,
        openerSessionId: undefined,
        activePopupSessionId: undefined,
        dismissedPopupSessionId: undefined,
        url: targetUrl,
      });
    },
    [owner, window.id],
  );

  const runNavigation = useCallback(async (
    operation: (revision: string, signal: AbortSignal) => Promise<BrowserSessionDto>,
    recoveryUrl?: string,
  ) => {
    if (!sessionId || navigationActionRef.current) return;
    const action = new AbortController();
    navigationActionRef.current = action;
    setNavigationPending(true);
    setNavigationError(null);
    try {
      const current = await getBrowserSession(owner, sessionId, action.signal);
      if (navigationActionRef.current !== action || action.signal.aborted) return;
      if (
        recoveryUrl &&
        (current.status === "lost" || current.status === "closed") &&
        isCurrentConnection(owner) &&
        useWindowStore.getState().session.windows[window.id]?.appState?.sessionId === sessionId
      ) {
        recreateDeadSession(recoveryUrl);
        return;
      }
      const sync = syncBrowserSessionWindow(owner, window.id, sessionId, current);
      if (sync === "detached") return;
      if (sync === "stale") {
        throw new BrowserHostClientError("Page changed while preparing navigation; retry the action", "sessionConflict", 409);
      }
      const response = await operation(current.navigationRevision, action.signal);
      if (navigationActionRef.current === action && !action.signal.aborted) {
        syncBrowserSessionWindow(owner, window.id, sessionId, response);
      }
    } catch (err) {
      if (navigationActionRef.current !== action || action.signal.aborted) return;
      if (
        recoveryUrl &&
        err instanceof BrowserHostClientError &&
        err.status === 404 &&
        isCurrentConnection(owner) &&
        useWindowStore.getState().session.windows[window.id]?.appState?.sessionId === sessionId
      ) {
        recreateDeadSession(recoveryUrl);
        return;
      }
      console.warn("[BrowserApp] Navigation failed:", err);
      if (err instanceof BrowserHostClientError && err.status === 409) {
        try {
          const current = await getBrowserSession(owner, sessionId, action.signal);
          if (navigationActionRef.current === action && !action.signal.aborted) {
            syncBrowserSessionWindow(owner, window.id, sessionId, current);
          }
        } catch (refreshError) {
          if (navigationActionRef.current === action && !action.signal.aborted) {
            console.warn("[BrowserApp] Navigation conflict refresh failed:", refreshError);
          }
        }
      }
      if (navigationActionRef.current === action && !action.signal.aborted && isCurrentConnection(owner) &&
          useWindowStore.getState().session.windows[window.id]?.appState?.sessionId === sessionId) {
        setNavigationError(err instanceof Error ? err.message : "Navigation failed");
      }
    } finally {
      if (navigationActionRef.current === action) {
        navigationActionRef.current = null;
        setNavigationPending(false);
      }
    }
  }, [owner, recreateDeadSession, sessionId, window.id]);

  const handleNavigate = useCallback(async () => {
    let trimmed = addressInput.trim();
    if (!trimmed) return;
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      trimmed = `https://${trimmed}`;
    }
    const status = window.appState?.browserSessionStatus as string | undefined;
    if (!sessionId || status === "lost" || status === "closed") {
      recreateDeadSession(trimmed);
      return;
    }
    await runNavigation(
      (revision, signal) =>
        navigateBrowser(
          owner,
          sessionId,
          {
            url: trimmed,
            navigationRevision: revision,
          },
          signal,
        ),
      trimmed,
    );
  }, [
    addressInput,
    owner,
    recreateDeadSession,
    runNavigation,
    sessionId,
    window.appState?.browserSessionStatus,
  ]);

  const handleReload = useCallback(async () => {
    const targetUrl = (addressInput.trim() || previewUrl).trim();
    const status = window.appState?.browserSessionStatus as string | undefined;
    if ((!sessionId || status === "lost" || status === "closed") && targetUrl) {
      recreateDeadSession(
        targetUrl.startsWith("http://") || targetUrl.startsWith("https://")
          ? targetUrl
          : `https://${targetUrl}`,
      );
      return;
    }
    if (!sessionId) return;
    await runNavigation(
      (revision, signal) => reloadBrowser(owner, sessionId, { navigationRevision: revision }, signal),
      targetUrl || undefined,
    );
  }, [
    addressInput,
    owner,
    previewUrl,
    recreateDeadSession,
    runNavigation,
    sessionId,
    window.appState?.browserSessionStatus,
  ]);
  const handleBack = useCallback(async () => {
    if (!sessionId) return;
    await runNavigation((revision, signal) => historyBrowser(owner, sessionId, {
      direction: "back",
      navigationRevision: revision,
    }, signal));
  }, [owner, sessionId, runNavigation]);

  const handleForward = useCallback(async () => {
    if (!sessionId) return;
    await runNavigation((revision, signal) => historyBrowser(owner, sessionId, {
      direction: "forward",
      navigationRevision: revision,
    }, signal));
  }, [owner, sessionId, runNavigation]);

  const handleAcquireControl = useCallback(async () => {
    if (!sessionId) return;
    const expectedViewerId = window.appState?.viewerId as string | undefined;
    const activeViewerId = expectedViewerId ?? window.id;
    const expectedIncarnation = window.appState?.browserIncarnation;
    const expectedProfileEpoch = window.appState?.profileEpoch;
    try {
      const resp = await acquireBrowserControl(owner, sessionId, {
        viewerId: activeViewerId,
        holderKind: "human",
      });
      const current = useWindowStore.getState().session.windows[window.id];
      if (
        !isCurrentConnection(owner) ||
        current?.ctx.profileId !== owner.profileId ||
        current.appState?.sessionId !== sessionId ||
        (current.appState?.viewerId as string | undefined) !== expectedViewerId ||
        current.appState?.browserIncarnation !== expectedIncarnation ||
        current.appState?.profileEpoch !== expectedProfileEpoch ||
        (current.appState?.browserSessionStatus !== undefined &&
          current.appState.browserSessionStatus !== "running")
      ) {
        void releaseBrowserControl(owner, sessionId, { leaseToken: resp.leaseToken }).catch(() => {});
        return;
      }
      useWindowStore.getState().updateAppState(window.id, {
        isController: true,
        leaseToken: resp.leaseToken,
      });
      requestBrowserProxyFocus(window.id, owner, sessionId, resp.leaseToken);
    } catch (err) {
      console.warn("[BrowserApp] Acquire control failed:", err);
    }
  }, [
    owner,
    sessionId,
    window.id,
    window.appState?.viewerId,
    window.appState?.browserIncarnation,
    window.appState?.profileEpoch,
  ]);

  const handleReturnToOpener = useCallback(async () => {
    if (!sessionId || !parentSessionId) return;
    const fallbackOpenerId = window.appState?.openerSessionId as string | undefined;
    const candidates =
      fallbackOpenerId && fallbackOpenerId !== parentSessionId
        ? [parentSessionId, fallbackOpenerId]
        : [parentSessionId];
    for (const candidateId of candidates) {
      try {
        const openerSnap = await getBrowserSession(owner, candidateId);
        if (openerSnap.status === "running") {
          const switched = switchBrowserWindowSession(owner, window.id, sessionId, openerSnap, {
            openerSessionId: openerSnap.parentSessionId ?? undefined,
            dismissedPopupSessionId: sessionId,
          });
          if (switched === "applied") {
            setNavigationError(null);
            return;
          }
        }
      } catch {
        // Try fallback ancestor if available
      }
    }
    if (
      isCurrentConnection(owner) &&
      useWindowStore.getState().session.windows[window.id]?.appState?.sessionId === sessionId
    ) {
      useWindowStore.getState().updateAppState(window.id, {
        parentSessionId: undefined,
        openerSessionId: undefined,
      });
      setNavigationError("Opener page is no longer running");
    }
  }, [owner, parentSessionId, sessionId, window.appState?.openerSessionId, window.id]);

  const handleOpenActivePopup = useCallback(async () => {
    if (!sessionId || !activePopupSessionId) return;
    try {
      const popupSnap = await getBrowserSession(owner, activePopupSessionId);
      if (popupSnap.status === "running" && popupSnap.parentSessionId === sessionId) {
        switchBrowserWindowSession(owner, window.id, sessionId, popupSnap, {
          openerSessionId:
            (window.appState?.openerSessionId as string | undefined) ?? sessionId,
          dismissedPopupSessionId: undefined,
        });
        setNavigationError(null);
      }
    } catch (err) {
      if (
        isCurrentConnection(owner) &&
        useWindowStore.getState().session.windows[window.id]?.appState?.sessionId === sessionId
      ) {
        setNavigationError(err instanceof Error ? err.message : "Popup window is no longer available");
      }
    }
  }, [activePopupSessionId, owner, sessionId, window.appState?.openerSessionId, window.id]);
  const handleReleaseControl = useCallback(async () => {
    if (!sessionId || !leaseToken) return;
    try {
      await releaseBrowserControl(owner, sessionId, { leaseToken });
    } catch (err) {
      console.warn("[BrowserApp] Release control failed:", err);
    } finally {
      useWindowStore.getState().updateAppState(window.id, {
        isController: false,
        leaseToken: undefined,
      });
    }
  }, [owner, sessionId, leaseToken, window.id]);

  // Periodic lease renewal (every 10s within 30s TTL) while active controller
  useEffect(() => {
    if (!isController || !leaseToken || !sessionId) return;

    const interval = setInterval(async () => {
      try {
        const resp = await renewBrowserControl(owner, sessionId, { leaseToken });
        useWindowStore.getState().updateAppState(window.id, {
          leaseToken: resp.leaseToken,
        });
      } catch (err) {
        console.warn("[BrowserApp] Lease renewal failed, reverting to view-only:", err);
        useWindowStore.getState().updateAppState(window.id, {
          isController: false,
          leaseToken: undefined,
        });
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [isController, leaseToken, owner, sessionId, window.id]);

  // Discover live terminal candidates for current owner
  const refreshTerminalCandidates = useCallback(async () => {
    if (!isCurrentConnection(owner)) return;
    try {
      const rows = await getApi(owner).terminal.listDetailed();
      if (isCurrentConnection(owner) && Array.isArray(rows)) {
        setLiveSessions(rows);
      }
    } catch {
      // ignore transient inventory lookup failure
    }
  }, [owner]);

  const terminalCandidates = useMemo(
    () => collectHostTerminalCandidates(owner, windows, liveSessions),
    [owner, windows, liveSessions],
  );

  useEffect(() => {
    if (
      selectedTerminalId &&
      terminalCandidates.some((t) => t.sessionId === selectedTerminalId && t.ready)
    ) {
      return;
    }
    const firstReady = terminalCandidates.find((t) => t.ready) ?? terminalCandidates[0];
    setSelectedTerminalId(firstReady?.sessionId ?? "");
  }, [terminalCandidates, selectedTerminalId]);

  const selectedTerminal: HostTerminalCandidate | undefined = useMemo(
    () =>
      terminalCandidates.find((t) => t.sessionId === selectedTerminalId) ??
      terminalCandidates[0],
    [terminalCandidates, selectedTerminalId],
  );

  const handleNavigationSync = useCallback(
    (update: { navigationRevision: string; url?: string }) => {
      if (!isCurrentConnection(owner) || !sessionId) return;
      const latestWin = useWindowStore.getState().session.windows[window.id];
      if (!latestWin || latestWin.appState?.sessionId !== sessionId) return;
      const currentRevision = latestWin.appState?.navigationRevision;
      if (currentRevision !== undefined &&
          BigInt(String(currentRevision)) > BigInt(update.navigationRevision)) return;
      useWindowStore.getState().updateAppState(window.id, {
        navigationRevision: update.navigationRevision,
        ...(update.url ? { url: update.url } : {}),
      });
    },
    [owner, sessionId, window.id],
  );
  const selection = useHostBrowserSelection({
    owner,
    sessionId,
    navigationRevision,
    leaseToken,
    targets: terminalCandidates,
    onNavigationSync: handleNavigationSync,
  });

  useEffect(() => {
    if (selection.selectionActive || selection.preview) {
      void refreshTerminalCandidates();
    }
  }, [
    selection.selectionActive,
    selection.preview,
    selection.error,
    context.isFocused,
    windows,
    refreshTerminalCandidates,
  ]);

  useEffect(() => {
    if (!selection.preview || selectedTerminal?.ready) return;
    const timer = setInterval(() => {
      void refreshTerminalCandidates();
    }, 400);
    return () => clearInterval(timer);
  }, [selection.preview, selectedTerminal?.ready, refreshTerminalCandidates]);

  const showSelectionPanel = Boolean(
    selection.selectionActive ||
      selection.preview ||
      selection.preparedArtifact ||
      selection.error ||
      selection.notice,
  );
  return (
    <div
      data-os-browser-app={window.id}
      data-testid={`browser-app-${window.id}`}
      className="relative w-full h-full bg-black overflow-hidden flex flex-col"
    >
      {/* Capability Reason Banner */}
      {unsupportedReason && (
        <div
          role="alert"
          data-testid="browser-unsupported-banner"
          className="flex items-center justify-between px-3 py-1.5 bg-red-500/15 border-b border-red-500/30 text-red-400 text-xs select-none"
        >
          <span className="font-medium">
            Browser capability unavailable: {unsupportedReason}
          </span>
        </div>
      )}
      {navigationError && (
        <div role="alert" data-testid="browser-navigation-error" className="px-3 py-1 text-xs text-red-400">
          {navigationError}
        </div>
      )}

      {popupBlocked && (
        <div
          role="alert"
          data-testid="browser-popup-blocked-banner"
          className="flex items-center justify-between px-3 py-1 bg-amber-500/15 border-b border-amber-500/30 text-amber-300 text-xs select-none"
        >
          <span>
            Sign-in popup blocked: browser target capacity reached. Close an unused browser session and retry.
          </span>
        </div>
      )}
      {parentSessionId && (
        <div
          data-testid="browser-popup-banner"
          className="flex items-center justify-between gap-2 px-3 py-1 bg-blue-500/15 border-b border-blue-500/30 text-blue-300 text-xs select-none"
        >
          <span className="truncate">
            Viewing popup window ({previewUrl || "about:blank"})
          </span>
          <button
            type="button"
            data-testid="browser-popup-return-btn"
            onClick={() => void handleReturnToOpener()}
            className="shrink-0 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-400/40"
          >
            Return to Page
          </button>
        </div>
      )}
      {!parentSessionId && activePopupSessionId && (
        <div
          data-testid="browser-active-popup-banner"
          className="flex items-center justify-between gap-2 px-3 py-1 bg-blue-500/15 border-b border-blue-500/30 text-blue-300 text-xs select-none"
        >
          <span className="truncate">Sign-in popup window is open</span>
          <button
            type="button"
            data-testid="browser-open-popup-btn"
            onClick={() => void handleOpenActivePopup()}
            className="shrink-0 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-400/40"
          >
            Open Popup
          </button>
        </div>
      )}
      {/* Top Browser Controls Bar */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-[var(--color-surface)] border-b border-[var(--color-border)] text-xs text-[var(--color-text)] select-none">
        <button
          type="button"
          data-testid="browser-back-btn"
          aria-label="Back"
          onClick={handleBack}
          disabled={!sessionId || navigationPending}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
        >
          ←
        </button>
        <button
          type="button"
          data-testid="browser-forward-btn"
          aria-label="Forward"
          onClick={handleForward}
          disabled={!sessionId || navigationPending}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
        >
          →
        </button>
        <button
          type="button"
          data-testid="browser-reload-btn"
          aria-label="Reload"
          onClick={handleReload}
          disabled={!sessionId || navigationPending}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
        >
          ↻
        </button>

        {/* URL Address Input */}
        <div className="flex-1 min-w-0 mx-1">
          <input
            type="text"
            data-testid="browser-address-input"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void handleNavigate();
              }
            }}
            placeholder="http://localhost:5173"
            className="w-full h-6 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 text-xs text-[var(--color-text)] font-mono focus:border-[var(--color-primary)] focus:outline-none"
          />
        </div>

        {/* View-only vs Controller Indicator */}
        {isController ? (
          <div className="flex items-center gap-1">
            <span
              data-testid="browser-controller-badge"
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-500/20 text-green-400 border border-green-500/30"
            >
              Controlling
            </span>
            <button
              type="button"
              data-testid="browser-release-control-btn"
              onClick={handleReleaseControl}
              className="px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)]"
              title="Release control to view-only mode"
            >
              Release
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span
              data-testid="browser-view-only-badge"
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30"
            >
              View-only
            </span>
            <button
              type="button"
              data-testid="browser-take-control-btn"
              disabled={!sessionId}
              onClick={handleAcquireControl}
              className="px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-text)] border border-[var(--color-border)] disabled:opacity-40"
            >
              Control
            </button>
          </div>
        )}

        {sessionId && (
          <button
            type="button"
            data-testid="browser-select-element-btn"
            disabled={!isController || !leaseToken || selection.pending}
            onClick={() => {
              if (selection.selectionActive) {
                void selection.cancelSelection();
              } else {
                void selection.startSelection();
              }
            }}
            title={
              isController
                ? "Select DOM element via CDP Overlay"
                : "Acquire Control first to select elements"
            }
            className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
              selection.selectionActive
                ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                : "bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-text)] border-[var(--color-border)]"
            } disabled:opacity-40`}
          >
            {selection.selectionActive ? "Cancel Select" : "Select Element"}
          </button>
        )}

        {sessionId && (
          <span
            title={`Session ID: ${sessionId}`}
            className="text-[10px] text-[var(--color-text-muted)] font-mono truncate max-w-[80px]"
          >
            {sessionId.slice(0, 8)}
          </span>
        )}
      </div>

      {/* Stream Canvas Slot Reparenting Target */}
      <div
        ref={slotRef}
        data-os-browser-slot={window.id}
        data-testid={`browser-slot-${window.id}`}
        data-selection-active={selection.selectionActive ? "true" : "false"}
        className="flex-1 min-h-0 relative bg-black"
      />

      {/* CDP Selection Preview & Terminal Handoff Drawer */}
      {showSelectionPanel && (
        <div
          data-testid="browser-selection-panel"
          className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text)] space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
              CDP Selection Preview
            </div>
            <button
              type="button"
              data-testid="browser-selection-close-btn"
              onClick={() => void selection.cancelSelection()}
              className="px-1.5 py-0.5 rounded text-[10px] border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
            >
              Clear
            </button>
          </div>

          {selection.notice && (
            <p
              role="status"
              data-testid="browser-selection-notice"
              className="text-[11px] text-emerald-400"
            >
              {selection.notice}
            </p>
          )}
          {selection.error && (
            <p
              role="alert"
              data-testid="browser-selection-error"
              className="text-[11px] text-red-400"
            >
              {selection.error}
            </p>
          )}

          {selection.preview && (
            <div
              data-testid="browser-selection-preview-card"
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2 space-y-1 font-mono text-[11px]"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-[var(--color-primary)]">
                  &lt;{selection.preview.tag}&gt;
                </span>
                {selection.preview.role && (
                  <span className="px-1 rounded bg-[var(--color-surface)] text-[10px]">
                    role={selection.preview.role}
                  </span>
                )}
                {selection.preview.accessibleName && (
                  <span className="text-[var(--color-text-muted)] truncate max-w-[200px]">
                    "{selection.preview.accessibleName}"
                  </span>
                )}
              </div>
              <div className="text-[10px] text-[var(--color-text-muted)] truncate">
                {selection.preview.locator}
              </div>
              {selection.preview.text && (
                <div className="text-[10px] text-[var(--color-text)] truncate">
                  {selection.preview.text}
                </div>
              )}
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
                <button
                  type="button"
                  data-testid="browser-selection-prepare-btn"
                  disabled={!selectedTerminal?.ready || selection.pending}
                  onClick={() => {
                    if (selectedTerminal) {
                      void selection.prepareArtifact(selectedTerminal, true);
                    }
                  }}
                  className="px-2.5 py-1 rounded text-[11px] font-medium bg-[var(--color-primary)] text-white disabled:opacity-40"
                >
                  Prepare Artifact
                </button>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    data-testid="browser-selection-artifact-ref"
                    className="font-mono text-[10px] text-[var(--color-text-muted)] max-w-[320px] truncate"
                    title={selection.preparedArtifact.reference}
                  >
                    {selection.preparedArtifact.reference}
                  </span>
                  <span
                    data-testid="browser-selection-artifact-png-status"
                    className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-surface-2)] border border-[var(--color-border)]"
                  >
                    {selection.preparedArtifact.artifact.pngPath
                      ? "PNG attached"
                      : "JSON only"}
                  </span>
                  <button
                    type="button"
                    data-testid="browser-selection-handoff-btn"
                    disabled={selection.inserted || selection.pending}
                    onClick={() => void selection.handoffArtifact()}
                    className="px-2.5 py-1 rounded text-[11px] font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
                  >
                    {selection.inserted ? "Inserted" : "Insert to Terminal"}
                  </button>
                  {!selection.inserted && (
                    <button
                      type="button"
                      data-testid="browser-selection-discard-btn"
                      disabled={selection.pending}
                      onClick={() => void selection.discardArtifact()}
                      className="px-2 py-1 rounded text-[11px] border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                    >
                      Discard
                    </button>
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
