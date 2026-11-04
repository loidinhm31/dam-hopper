import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Terminal, Loader2 } from "lucide-react";
import { getConnectionSnapshot, getApi } from "@/api/connections.js";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import {
  terminalTargetKey,
  isCanonicalUuid,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";
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
  const updateAppState = useWindowStore((state) => state.updateAppState);
  const target =
    window.runtimeIdentity?.kind === "terminal"
      ? window.runtimeIdentity.target
      : (window.appState?.target as TerminalTarget | undefined);
  const isExistingOnly = Boolean(
    target || window.appState?.attachPolicy === "existing-only",
  );

  const sessionId =
    target?.terminalId ??
    (window.appState?.sessionId as string | undefined) ??
    (window.appState?.terminalId as string | undefined) ??
    `${window.ctx.profileId}:${window.id}`;

  const incarnation = latestTerminalSessionIncarnation({
    profileId: owner.profileId,
    id: sessionId,
  });

  const claimKey = useMemo<ResourceClaimKey>(
    () => {
      if (target) {
        return {
          resourceKind: "terminal",
          profileId: target.profileId,
          generation: target.generation,
          resourceId: target.terminalId,
          incarnation: target.incarnation,
          authority: target.serverEpoch,
        };
      }
      return {
        resourceKind: "terminal",
        profileId: owner.profileId,
        generation: owner.generation,
        resourceId: sessionId,
        incarnation,
      };
    },
    [target, owner.profileId, owner.generation, sessionId, incarnation],
  );

  const claimStatus = useResourceClaim(claimKey, window.id);
  const [hasAttachedTerminal, setHasAttachedTerminal] = useState(() =>
    Boolean(getTerminal(target ? terminalTargetKey(target) : { profileId: owner.profileId, id: sessionId })),
  );
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(
    (window.appState?.createError as string | undefined) ?? null,
  );

  const handleLaunchSession = useCallback(async () => {
    if (isExistingOnly) return;
    const originatingGeneration = owner.generation;
    setIsLaunching(true);
    setLaunchError(null);
    try {
      const snap = getConnectionSnapshot(owner.profileId);
      if (!snap || snap.status !== "connected") {
        throw new Error(`Profile ${owner.profileId} is not connected`);
      }
      if (snap.owner.generation !== originatingGeneration) {
        throw new Error("Connection generation changed before launch");
      }
      const client = getApi(snap.owner);
      const sessionRes = await client.terminal.create({
        id: sessionId,
        command: (window.appState?.command as string | undefined) ?? "",
        project: window.ctx.projectId,
        cwd: (window.appState?.cwd as string | undefined) ?? undefined,
        cols: 80,
        rows: 24,
      });
      const afterSnap = getConnectionSnapshot(owner.profileId);
      if (
        !afterSnap ||
        afterSnap.status !== "connected" ||
        afterSnap.owner.profileId !== snap.owner.profileId ||
        afterSnap.owner.generation !== originatingGeneration
      ) {
        throw new Error("Connection owner changed during launch");
      }
      const currentWin = useWindowStore.getState().session.windows[window.id];
      if (
        !currentWin ||
        currentWin.appId !== "terminals" ||
        (currentWin.appState?.sessionId ?? currentWin.appState?.terminalId) !== sessionId
      ) {
        return;
      }
      const serverEpoch =
        sessionRes.serverEpoch && isCanonicalUuid(sessionRes.serverEpoch)
          ? sessionRes.serverEpoch
          : undefined;
      updateAppState(window.id, {
        createError: undefined,
        incarnation: sessionRes.incarnation,
        incarnationExact: String(sessionRes.incarnation),
        generation: originatingGeneration,
        profileId: owner.profileId,
        ...(serverEpoch ? { serverEpoch } : {}),
      });
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLaunching(false);
    }
  }, [isExistingOnly, owner.generation, owner.profileId, sessionId, updateAppState, window.appState, window.ctx.projectId, window.id]);

  // Attach terminal DOM element only if claim succeeded
  useEffect(() => {
    if (!claimStatus.success) return;
    const el = slotRef.current;
    if (!el) return;

    const attach = () => {
      const lookupKey = target
        ? terminalTargetKey(target)
        : { profileId: owner.profileId, id: sessionId };
      const entry = getTerminal(lookupKey);
      setHasAttachedTerminal(Boolean(entry));
      attachTerminalsToHost({
        host: el,
        sessionIds: [sessionId],
        activeSessionId: sessionId,
        resolveTerminal: () => getTerminal(lookupKey),
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
      {!hasAttachedTerminal && owner.isConnected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)] gap-3 pointer-events-auto">
          <Terminal className={`h-8 w-8 ${isExistingOnly ? "text-amber-500 opacity-80" : "text-[var(--color-primary)] opacity-80"}`} />
          <div className="flex flex-col gap-1">
            <span className="font-medium text-[var(--color-text)]">
              {isExistingOnly ? "Terminal Session Unavailable" : "Terminal Session Inactive"}
            </span>
            <span className="text-[11px] font-mono text-[var(--color-text-muted)]">
              {sessionId}
            </span>
          </div>
          {isExistingOnly ? (
            <span className="text-amber-400 text-2xs max-w-xs">
              Target PTY session is missing, replaced, or retired. Automatic re-creation is disabled for existing-only windows.
            </span>
          ) : (
            <>
              {launchError && (
                <span className="text-red-400 text-2xs max-w-xs">{launchError}</span>
              )}
              <button
                type="button"
                onClick={() => void handleLaunchSession()}
                disabled={isLaunching}
                className="px-3 py-1.5 rounded bg-[var(--color-primary)] text-white text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50 pointer-events-auto"
              >
                {isLaunching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isLaunching ? "Launching Session…" : "Launch Terminal Session"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
