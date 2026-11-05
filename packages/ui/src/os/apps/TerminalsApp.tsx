import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Terminal, Loader2 } from "lucide-react";
import { getConnectionSnapshot, getApi } from "@/api/connections.js";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import {
  terminalTargetKey,
  isCanonicalUuid,
  isCanonicalPositiveU64,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";
import { ApiRequestError } from "@/api/client.js";
import { useWindowOwner } from "../window-context.js";
import { useResourceClaim } from "../resource-registry.js";
import { attachTerminalsToHost } from "@/lib/terminal-host-attachment.js";
import { getTerminal, subscribeToRegistryChanges } from "@/lib/terminal-registry.js";
import { latestTerminalSessionIncarnation } from "@/lib/terminal-incarnation-state.js";
import { useWindowStore } from "../window-store.js";
import { toServerFsTarget, type FsTargetRef } from "@/api/ownership.js";
import {
  reserveTerminalLaunch,
  settleTerminalLaunch,
  type LaunchIdentityParams,
} from "../persistence.js";

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
  const requestedId = window.appState?.requestedTerminalId as string | undefined;
  const attemptId = window.appState?.attemptId as string | undefined;
  const isExistingOnly = Boolean(
    target || window.appState?.attachPolicy === "existing-only" || !attemptId,
  );
  const sessionId =
    target?.terminalId ??
    requestedId ??
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
  const [hasRendererRegistered, setHasRendererRegistered] = useState(() =>
    Boolean(getTerminal(target ? terminalTargetKey(target) : { profileId: owner.profileId, id: sessionId })),
  );
  const isRemoteAttached = Boolean(target?.incarnation || window.appState?.incarnation);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(
    (window.appState?.createError as string | undefined) ?? null,
  );

  const isDispatched = Boolean(window.appState?.dispatched);

  const handleLaunchSession = useCallback(async () => {
    if (isExistingOnly || isLaunching || isDispatched || isRemoteAttached) return;
    const originatingGeneration = owner.generation;
    setIsLaunching(true);
    setLaunchError(null);
    updateAppState(window.id, { dispatched: true });
    let alreadySettled = false;
    let requestSent = false;
    try {
      const snap = getConnectionSnapshot(owner.profileId);
      if (!snap || snap.status !== "connected") {
        if (attemptId) {
          alreadySettled = true;
          await settleTerminalLaunch(attemptId, {
            kind: "confirmed-not-created",
            reason: `Profile ${owner.profileId} is not connected`,
          });
        }
        throw new Error(`Profile ${owner.profileId} is not connected`);
      }
      if (snap.owner.generation !== originatingGeneration) {
        if (attemptId) {
          alreadySettled = true;
          await settleTerminalLaunch(attemptId, {
            kind: "confirmed-not-created",
            reason: "Connection generation changed before launch",
          });
        }
        throw new Error("Connection generation changed before launch");
      }
      const client = getApi(snap.owner);
      const wireTarget = window.ctx.target ? toServerFsTarget(window.ctx.target) : undefined;

      requestSent = true;
      const sessionRes = await client.terminal.create({
        id: sessionId,
        command: (window.appState?.command as string | undefined) ?? "",
        project: window.ctx.projectId,
        cwd: (window.appState?.cwd as string | undefined) ?? undefined,
        target: wireTarget,
        cols: 80,
        rows: 24,
      });

      const serverEpoch =
        sessionRes.serverEpoch && isCanonicalUuid(sessionRes.serverEpoch)
          ? sessionRes.serverEpoch
          : undefined;
      const rawIncarnation =
        typeof (sessionRes as { incarnationExact?: string }).incarnationExact === "string" &&
        isCanonicalPositiveU64((sessionRes as { incarnationExact?: string }).incarnationExact)
          ? (sessionRes as { incarnationExact?: string }).incarnationExact
          : typeof sessionRes.incarnation === "number" &&
            Number.isSafeInteger(sessionRes.incarnation) &&
            sessionRes.incarnation > 0
            ? String(sessionRes.incarnation)
            : undefined;
      const isIncarnationValid = Boolean(rawIncarnation);

      const createdTarget: TerminalTarget | undefined =
        serverEpoch && isIncarnationValid && rawIncarnation
          ? {
              profileId: owner.profileId,
              generation: originatingGeneration,
              terminalId: sessionId,
              incarnation: rawIncarnation,
              serverEpoch,
            }
          : undefined;

      const afterSnap = getConnectionSnapshot(owner.profileId);
      const isOwnerChanged =
        !afterSnap ||
        afterSnap.status !== "connected" ||
        afterSnap.owner.profileId !== snap.owner.profileId ||
        afterSnap.owner.generation !== originatingGeneration;

      if (attemptId) {
        alreadySettled = true;
        if (createdTarget) {
          // Contract C3 Rule 3: A successful create settles as confirmed-success even if owner changed afterwards
          await settleTerminalLaunch(attemptId, {
            kind: "confirmed-success",
            target: createdTarget,
          });
        } else {
          await settleTerminalLaunch(attemptId, {
            kind: "uncertain",
            reason: "Server creation succeeded but serverEpoch or incarnationExact is missing or non-canonical",
          });
        }
      }

      if (isOwnerChanged) {
        throw new Error("Connection owner changed during launch");
      }

      const currentWin = useWindowStore.getState().session.windows[window.id];
      const winSessionId =
        (currentWin?.appState?.sessionId as string | undefined) ??
        (currentWin?.appState?.terminalId as string | undefined) ??
        (currentWin?.appState?.requestedTerminalId as string | undefined);
      const isWindowStillPresent = Boolean(
        currentWin &&
          currentWin.appId === "terminals" &&
          winSessionId === sessionId,
      );

      if (isWindowStillPresent) {
        updateAppState(window.id, {
          ...(createdTarget ? { target: createdTarget } : {}),
          sessionId,
          terminalId: sessionId,
          createError: undefined,
          incarnation: sessionRes.incarnation,
          incarnationExact: rawIncarnation ?? String(sessionRes.incarnation),
          generation: originatingGeneration,
          profileId: owner.profileId,
          ...(serverEpoch ? { serverEpoch } : {}),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLaunchError(msg);
      updateAppState(window.id, { createError: msg });
      if (attemptId && !alreadySettled) {
        const isDefiniteNotCreated =
          !requestSent ||
          (err instanceof ApiRequestError &&
            [400, 401, 403, 404, 413, 422].includes(err.status));
        await settleTerminalLaunch(attemptId, {
          kind: isDefiniteNotCreated ? "confirmed-not-created" : "uncertain",
          reason: msg,
        });
      }
    } finally {
      setIsLaunching(false);
    }
  }, [
    isExistingOnly,
    isLaunching,
    isDispatched,
    isRemoteAttached,
    owner.generation,
    owner.profileId,
    sessionId,
    attemptId,
    updateAppState,
    window.appState,
    window.ctx.projectId,
    window.ctx.target,
    window.id,
  ]);

  // Auto-launch upon window mount if reserved and not yet dispatched or attached
  useEffect(() => {
    if (
      !isExistingOnly &&
      attemptId &&
      !isDispatched &&
      !isRemoteAttached &&
      claimStatus.success &&
      owner.isConnected
    ) {
      void handleLaunchSession();
    }
  }, [
    isExistingOnly,
    attemptId,
    isDispatched,
    isRemoteAttached,
    claimStatus.success,
    owner.isConnected,
    handleLaunchSession,
  ]);

  const handleRetryLaunch = useCallback(async () => {
    setLaunchError(null);
    const activeDesktopId = useWindowStore.getState().session.activeDesktopId;
    const targetRef: FsTargetRef =
      window.ctx.target ?? { kind: "workspace", profileId: owner.profileId };
    const cwd = (window.appState?.cwd as string | undefined) ?? null;
    const identityParams: LaunchIdentityParams = {
      profileId: owner.profileId,
      endpointBinding: "default-endpoint",
      action: "terminal.create",
      targetKind: targetRef.kind,
      workspaceId: targetRef.kind === "workspace" ? targetRef.profileId : null,
      projectId:
        targetRef.kind === "project"
          ? targetRef.project
          : window.ctx.projectId ?? null,
      worktreeId:
        targetRef.kind === "project"
          ? targetRef.worktreePath ?? null
          : window.ctx.worktreeId ?? null,
      cwd,
    };
    const reserveResult = await reserveTerminalLaunch(identityParams, {
      generation: owner.generation,
      desktopId: activeDesktopId,
    });
    if (reserveResult.status === "blocked") {
      setLaunchError(reserveResult.reason);
      return;
    }
    updateAppState(window.id, {
      requestedTerminalId: reserveResult.requestedTerminalId,
      sessionId: reserveResult.requestedTerminalId,
      terminalId: reserveResult.requestedTerminalId,
      attemptId: reserveResult.attemptId,
      dispatched: false,
      createError: undefined,
    });
  }, [
    owner.generation,
    owner.profileId,
    updateAppState,
    window.appState?.cwd,
    window.ctx.projectId,
    window.ctx.target,
    window.ctx.worktreeId,
    window.id,
  ]);


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
      setHasRendererRegistered(Boolean(entry));
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
  }, [sessionId, claimStatus.success, owner.profileId, target]);

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
      {!isExistingOnly && Boolean(attemptId) && (launchError !== null || (!isRemoteAttached && !hasRendererRegistered)) && owner.isConnected && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)] gap-3 pointer-events-auto z-10">
          <Terminal className="h-8 w-8 text-[var(--color-primary)] opacity-80" />
          <div className="flex flex-col gap-1">
            <span className="font-medium text-[var(--color-text)]">
              Terminal Session Inactive
            </span>
            <span className="text-[11px] font-mono text-[var(--color-text-muted)]">
              {sessionId}
            </span>
          </div>
          {launchError && (
            <span className="text-red-400 text-2xs max-w-xs">{launchError}</span>
          )}
          <button
            type="button"
            onClick={() => {
              if (launchError || isDispatched) {
                void handleRetryLaunch();
              } else {
                void handleLaunchSession();
              }
            }}
            disabled={isLaunching}
            className="px-3 py-1.5 rounded bg-[var(--color-primary)] text-white text-xs font-medium hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50 pointer-events-auto"
          >
            {isLaunching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isLaunching
              ? "Launching Session…"
              : launchError || isDispatched
                ? "Retry Launch (Reserve New Attempt)"
                : "Launch Terminal Session"}
          </button>
        </div>
      )}
    </div>
  );
}
