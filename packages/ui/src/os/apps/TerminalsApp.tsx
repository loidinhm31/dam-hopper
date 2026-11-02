import { useEffect, useMemo, useRef } from "react";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { useResourceClaim } from "../resource-registry.js";
import { attachTerminalsToHost } from "@/lib/terminal-host-attachment.js";
import { getTerminal, subscribeToRegistryChanges } from "@/lib/terminal-registry.js";
import { latestTerminalSessionIncarnation } from "@/lib/terminal-incarnation-state.js";
import { useWindowStore } from "../window-store.js";

export interface TerminalsAppProps {
  window: OsWindow;
}

export function TerminalsApp({ window }: TerminalsAppProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const owner = useWindowOwner();
  const focusWindow = useWindowStore((state) => state.focusWindow);
  const sessionId =
    (window.appState?.sessionId as string | undefined) ??
    `${window.ctx.profileId}:default`;

  const incarnation = latestTerminalSessionIncarnation({
    profileId: owner.profileId,
    id: sessionId,
  });

  const claimKey = useMemo<ResourceClaimKey>(
    () => ({
      resourceKind: "terminal",
      profileId: owner.profileId,
      generation: owner.generation,
      resourceId: sessionId,
      incarnation,
    }),
    [owner.profileId, owner.generation, sessionId, incarnation],
  );

  const claimStatus = useResourceClaim(claimKey, window.id);

  // Attach terminal DOM element only if claim succeeded
  useEffect(() => {
    if (!claimStatus.success) return;
    const el = slotRef.current;
    if (!el) return;

    const attach = () => {
      attachTerminalsToHost({
        host: el,
        sessionIds: [sessionId],
        activeSessionId: sessionId,
        resolveTerminal: (id) =>
          getTerminal({ profileId: owner.profileId, id }),
      });
    };

    attach();
    const unsubscribe = subscribeToRegistryChanges(attach);
    return () => {
      unsubscribe();
    };
  }, [sessionId, claimStatus.success, owner.profileId]);

  if (!claimStatus.success) {
    const holderId = claimStatus.existingHolderWindowId ?? "unknown";
    return (
      <div
        data-os-claim-denied="true"
        data-testid="terminals-claim-denied"
        className="flex flex-col items-center justify-center p-4 text-center h-full bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)] gap-3"
      >
        <p>Terminal session is currently active in another window.</p>
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
      ref={slotRef}
      data-os-terminals-app={window.id}
      data-testid={`terminals-app-${window.id}`}
      style={{ pointerEvents: owner.isConnected ? "auto" : "none" }}
      className="relative w-full h-full bg-[var(--color-bg)] overflow-hidden"
    >
      {!owner.isConnected && (
        <div
          data-os-terminal-disconnected="true"
          style={{ pointerEvents: "auto" }}
          className="absolute top-0 left-0 right-0 z-10 bg-amber-500/90 text-black text-[10px] px-2 py-0.5 text-center font-mono select-none"
        >
          Disconnected from profile server ({owner.status})
        </div>
      )}
      <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--color-text-muted)] pointer-events-none">
        Terminal surface: {sessionId}
      </div>
    </div>
  );
}
