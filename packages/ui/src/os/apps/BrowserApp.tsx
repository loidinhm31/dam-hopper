import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import { useWindowOwner, useWindowContext } from "../window-context.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { useResourceClaim } from "../resource-registry.js";
import { useWindowStore } from "../window-store.js";
import {
  registerBrowserStreamSlot,
  updateBrowserStreamSlot,
} from "../BrowserStreamKeepAliveHost.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { getConnectionSnapshot } from "@/api/connections.js";
import {
  acquireBrowserControl,
  historyBrowser,
  navigateBrowser,
  reloadBrowser,
} from "@/api/browser-host-client.js";

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
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please enter a URL for the browser preview");
      return;
    }
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      setError("URL must start with http:// or https://");
      return;
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

    useWindowStore.getState().updateAppState(window.id, {
      presentation: { kind: "resource", url: trimmed },
      url: trimmed,
    });
    useWindowStore.getState().focusWindow(window.id);
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

  const [addressInput, setAddressInput] = useState(previewUrl);

  // Sync address input with previewUrl when remote navigation updates it
  useEffect(() => {
    setAddressInput(previewUrl);
  }, [previewUrl]);

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

  // Navigation callbacks
  const handleNavigate = useCallback(async () => {
    const trimmed = addressInput.trim();
    if (!trimmed || !sessionId) return;
    try {
      const resp = await navigateBrowser(owner, sessionId, {
        url: trimmed,
        navigationRevision,
      });
      useWindowStore.getState().updateAppState(window.id, {
        url: resp.url,
        title: resp.title,
        navigationRevision: resp.navigationRevision,
        viewportEpoch: resp.viewportEpoch,
      });
    } catch (err) {
      console.warn("[BrowserApp] Navigate failed:", err);
    }
  }, [addressInput, owner, sessionId, navigationRevision, window.id]);

  const handleReload = useCallback(async () => {
    if (!sessionId) return;
    try {
      const resp = await reloadBrowser(owner, sessionId, { navigationRevision });
      useWindowStore.getState().updateAppState(window.id, {
        navigationRevision: resp.navigationRevision,
        viewportEpoch: resp.viewportEpoch,
      });
    } catch (err) {
      console.warn("[BrowserApp] Reload failed:", err);
    }
  }, [owner, sessionId, navigationRevision, window.id]);

  const handleBack = useCallback(async () => {
    if (!sessionId) return;
    try {
      const resp = await historyBrowser(owner, sessionId, {
        direction: "back",
        navigationRevision,
      });
      useWindowStore.getState().updateAppState(window.id, {
        url: resp.url,
        title: resp.title,
        navigationRevision: resp.navigationRevision,
        viewportEpoch: resp.viewportEpoch,
      });
    } catch (err) {
      console.warn("[BrowserApp] History back failed:", err);
    }
  }, [owner, sessionId, navigationRevision, window.id]);

  const handleForward = useCallback(async () => {
    if (!sessionId) return;
    try {
      const resp = await historyBrowser(owner, sessionId, {
        direction: "forward",
        navigationRevision,
      });
      useWindowStore.getState().updateAppState(window.id, {
        url: resp.url,
        title: resp.title,
        navigationRevision: resp.navigationRevision,
        viewportEpoch: resp.viewportEpoch,
      });
    } catch (err) {
      console.warn("[BrowserApp] History forward failed:", err);
    }
  }, [owner, sessionId, navigationRevision, window.id]);

  const handleAcquireControl = useCallback(async () => {
    if (!sessionId) return;
    const activeViewerId = (window.appState?.viewerId as string | undefined) ?? window.id;
    try {
      const resp = await acquireBrowserControl(owner, sessionId, {
        viewerId: activeViewerId,
        holderKind: "human",
      });
      useWindowStore.getState().updateAppState(window.id, {
        isController: true,
        leaseToken: resp.leaseToken,
      });
    } catch (err) {
      console.warn("[BrowserApp] Acquire control failed:", err);
    }
  }, [owner, sessionId, window.id, window.appState?.viewerId]);

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

      {/* Top Browser Controls Bar */}
      <div className="flex items-center gap-1.5 px-2 py-1 bg-[var(--color-surface)] border-b border-[var(--color-border)] text-xs text-[var(--color-text)] select-none">
        <button
          type="button"
          data-testid="browser-back-btn"
          aria-label="Back"
          onClick={handleBack}
          disabled={!sessionId}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
        >
          ←
        </button>
        <button
          type="button"
          data-testid="browser-forward-btn"
          aria-label="Forward"
          onClick={handleForward}
          disabled={!sessionId}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
        >
          →
        </button>
        <button
          type="button"
          data-testid="browser-reload-btn"
          aria-label="Reload"
          onClick={handleReload}
          disabled={!sessionId}
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
          <span
            data-testid="browser-controller-badge"
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-500/20 text-green-400 border border-green-500/30"
          >
            Controlling
          </span>
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
              onClick={handleAcquireControl}
              className="px-2 py-0.5 rounded text-[10px] font-medium bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] text-[var(--color-text)] border border-[var(--color-border)]"
            >
              Control
            </button>
          </div>
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
        className="flex-1 min-h-0 relative bg-black"
      />
    </div>
  );
}
