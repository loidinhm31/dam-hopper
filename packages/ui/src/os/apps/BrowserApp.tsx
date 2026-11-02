import { useEffect, useMemo, useRef } from "react";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import { useWindowOwner, useWindowContext } from "../window-context.js";
import { useResourceClaim } from "../resource-registry.js";
import { useWindowStore } from "../window-store.js";
import {
  registerBrowserSlot,
  updateBrowserSlot,
} from "../OsResourceHost.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";

export interface BrowserAppProps {
  window: OsWindow;
}

export function BrowserApp({ window }: BrowserAppProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const owner = useWindowOwner();
  const context = useWindowContext();
  const isCognitoActive = useCognitoModeStore((state) => state.active);
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const previewUrl =
    (window.appState?.url as string | undefined) ?? "http://localhost:5173";

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
