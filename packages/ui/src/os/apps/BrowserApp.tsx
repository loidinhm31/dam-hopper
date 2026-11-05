import { useEffect, useMemo, useRef, useState } from "react";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import { useWindowOwner, useWindowContext } from "../window-context.js";
import type { ConnectionRef } from "@/api/ownership.js";
import { useResourceClaim } from "../resource-registry.js";
import { useWindowStore } from "../window-store.js";
import {
  registerBrowserSlot,
  updateBrowserSlot,
} from "../OsResourceHost.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { getConnectionSnapshot } from "@/api/connections.js";

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
  const [collisionMsg, setCollisionMsg] = useState<string | null>(null);
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
    setCollisionMsg(null);

    const windows = useWindowStore.getState().session.windows;
    const collision = Object.values(windows).find(
      (w) =>
        w.id !== window.id &&
        w.appId === "browser" &&
        w.appState?.url === trimmed &&
        w.ctx.profileId === owner.profileId,
    );

    if (collision) {
      if (collision.minimized) {
        useWindowStore.getState().restoreWindow(collision.id);
      }
      useWindowStore.getState().focusWindow(collision.id);
      setCollisionMsg(
        `URL '${trimmed}' is already open in another window. Focused existing window.`,
      );
      return;
    }

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

        {collisionMsg && (
          <div
            role="alert"
            data-testid="browser-chooser-collision"
            className="rounded border border-[var(--color-warning)] bg-[var(--color-warning)]/10 p-2.5 text-xs text-[var(--color-warning)]"
          >
            {collisionMsg}
          </div>
        )}

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
    (!window.appState?.url && presentation?.kind !== "resource");

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
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const previewUrl = (window.appState?.url as string | undefined) ?? "";
  const claimKey = useMemo<ResourceClaimKey>(
    () => ({
      resourceKind: "browser",
      profileId: owner.profileId,
      generation: owner.generation,
      resourceId: previewUrl,
    }),
    [owner.profileId, owner.generation, previewUrl],
  );

  const claimStatus = useResourceClaim(claimKey, window.id);

  const isVisible =
    claimStatus.success &&
    !window.minimized &&
    context.isActiveDesktop &&
    !isCognitoActive;

  useEffect(() => {
    if (!claimStatus.success) return;
    const el = slotRef.current;
    const unregister = registerBrowserSlot(window.id, previewUrl, el, isVisible);
    return () => {
      unregister();
    };
  }, [window.id, previewUrl, claimStatus.success]);

  useEffect(() => {
    if (!claimStatus.success) return;
    updateBrowserSlot(window.id, slotRef.current, isVisible);
  }, [window.id, isVisible, claimStatus.success]);

  if (!claimStatus.success) {
    const holderId = claimStatus.existingHolderWindowId ?? "unknown";
    return (
      <div
        data-os-claim-denied="true"
        data-testid="browser-claim-denied"
        className="flex flex-col items-center justify-center p-4 text-center h-full bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)] gap-3"
      >
        <p>Browser preview is already active in another window ({previewUrl}).</p>
        <button
          type="button"
          onClick={() => focusWindow(holderId)}
          className="px-3 py-1.5 rounded bg-[var(--color-primary)] text-white text-xs font-medium hover:opacity-90 transition-opacity"
        >
          Focus Existing Window
        </button>
      </div>
    );
  }

  return (
    <div
      data-os-browser-app={window.id}
      data-testid={`browser-app-${window.id}`}
      className="relative w-full h-full bg-white overflow-hidden flex flex-col"
    >
      <div className="flex items-center gap-2 px-2 py-1 bg-[var(--color-surface)] border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)] font-mono select-none">
        <span>URL:</span>
        <span className="truncate text-[var(--color-text)]">{previewUrl}</span>
      </div>
      <div
        ref={slotRef}
        data-os-browser-slot={window.id}
        className="flex-1 min-h-0 relative bg-white"
      />
    </div>
  );
}
