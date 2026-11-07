import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Terminal as TerminalIcon, Loader2 } from "lucide-react";
import type { Terminal } from "@xterm/xterm";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import {
  terminalTargetKey,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";
import { useWindowOwner } from "../window-context.js";
import { useResourceClaim } from "../resource-registry.js";
import { attachTerminalsToHost } from "@/lib/terminal-host-attachment.js";
import { getTerminal, subscribeToRegistryChanges } from "@/lib/terminal-registry.js";
import { scheduleTerminalFit } from "@/lib/terminal-fit-scheduler.js";
import { latestTerminalSessionIncarnation } from "@/lib/terminal-incarnation-state.js";
import { useWindowStore } from "../window-store.js";
import { toServerFsTarget, type FsTargetRef } from "@/api/ownership.js";
import { buildTerminalClaimKey } from "../terminal-claim-key.js";
import {
  acquireTerminalPresentation,
  releaseTerminalPresentation,
  runIfCurrentPresenter,
  type TerminalPresentationToken,
} from "@/lib/terminal-presentation-input.js";
import {
  buildTerminalLaunchIdentity,
  executeTerminalLaunch,
  reserveTrackedTerminalLaunch,
} from "../terminal-launch-lifecycle.js";
export interface TerminalsAppProps {
  window: OsWindow;
}

export function TerminalsApp({ window }: TerminalsAppProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const owner = useWindowOwner();
  const revealWindow = useWindowStore((state) => state.revealWindow);
  const updateAppState = useWindowStore((state) => state.updateAppState);
  const target =
    window.runtimeIdentity?.kind === "terminal"
      ? window.runtimeIdentity.target
      : (window.appState?.target as TerminalTarget | undefined);
  const requestedId = window.appState?.requestedTerminalId as string | undefined;
  const attemptId = window.appState?.attemptId as string | undefined;
  const isExistingOnly = Boolean(
    target || window.appState?.attachPolicy === "existing-only",
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
        return buildTerminalClaimKey({ target });
      }
      return buildTerminalClaimKey({
        profileId: owner.profileId,
        generation: owner.generation,
        sessionId,
        incarnation,
      });
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

    const isWorkspaceTarget = window.ctx.target?.kind === "workspace";
    const rawCwd = (window.appState?.cwd as string | undefined) ?? undefined;
    const wireTarget =
      window.ctx.target
        ? toServerFsTarget(window.ctx.target)
        : undefined;
    const projectParam = isWorkspaceTarget ? undefined : window.ctx.projectId;
    const cwdParam = isWorkspaceTarget ? (rawCwd || ".") : rawCwd;

    try {
      const outcome = await executeTerminalLaunch({
        owner: { profileId: owner.profileId, generation: originatingGeneration },
        attemptId,
        terminalId: sessionId,
        command: (window.appState?.command as string | undefined) ?? "",
        project: projectParam,
        cwd: cwdParam,
        wireTarget,
      });

      if (outcome.kind === "failed") {
        setLaunchError(outcome.error);
        updateAppState(window.id, { createError: outcome.error });
        return;
      }

      const currentWin = useWindowStore.getState().session.windows[window.id];
      const winSessionId =
        (currentWin?.appState?.sessionId as string | undefined) ??
        (currentWin?.appState?.terminalId as string | undefined) ??
        (currentWin?.appState?.requestedTerminalId as string | undefined) ??
        (currentWin ? `${currentWin.ctx.profileId}:${currentWin.id}` : undefined);
      const isWindowStillPresent = Boolean(
        currentWin &&
          currentWin.appId === "terminals" &&
          winSessionId === sessionId,
      );

      if (isWindowStillPresent) {
        updateAppState(window.id, {
          ...(outcome.target ? { target: outcome.target } : {}),
          sessionId,
          terminalId: sessionId,
          createError: undefined,
          incarnation: outcome.incarnation,
          incarnationExact: outcome.incarnationExact,
          generation: originatingGeneration,
          profileId: owner.profileId,
          ...(outcome.serverEpoch ? { serverEpoch: outcome.serverEpoch } : {}),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLaunchError(msg);
      updateAppState(window.id, { createError: msg });
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
    window.appState?.command,
    window.appState?.cwd,
    window.ctx.projectId,
    window.ctx.target,
    window.id,
  ]);

  // Auto-launch upon window mount if not yet dispatched or attached
  useEffect(() => {
    if (
      !isExistingOnly &&
      !isDispatched &&
      !isRemoteAttached &&
      claimStatus.success &&
      owner.isConnected
    ) {
      void handleLaunchSession();
    }
  }, [
    isExistingOnly,
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
    const identityParams = buildTerminalLaunchIdentity({
      profileId: owner.profileId,
      target: targetRef,
      fallbackProjectId: window.ctx.projectId,
      fallbackWorktreeId: window.ctx.worktreeId,
      cwd,
    });
    const reserveResult = await reserveTrackedTerminalLaunch(identityParams, {
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


  // Attach terminal DOM element only if claim succeeded and acquire presentation
  useEffect(() => {
    if (!claimStatus.success) return;
    const el = slotRef.current;
    if (!el) return;

    let presentationToken: TerminalPresentationToken | null = null;
    let presentedTerm: Terminal | null = null;

    const releaseCurrentPresentation = () => {
      if (presentedTerm && presentationToken) {
        const term = presentedTerm;
        const token = presentationToken;
        presentedTerm = null;
        presentationToken = null;
        runIfCurrentPresenter(term, token, () => {
          term.textarea?.blur();
        });
        releaseTerminalPresentation(term, token);
      }
    };

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

      const element = entry?.attachmentElement ?? entry?.terminal.element;
      const isAttachedToHost = Boolean(element && element.parentElement === el);

      if (entry && isAttachedToHost) {
        if (presentedTerm !== entry.terminal) {
          releaseCurrentPresentation();
          presentedTerm = entry.terminal;
          presentationToken = acquireTerminalPresentation(
            entry.terminal,
            `terminals:${window.id}`,
          );
        }
      } else {
        releaseCurrentPresentation();
      }
    };

    attach();
    const unsubscribe = subscribeToRegistryChanges(attach);
    return () => {
      unsubscribe();
      releaseCurrentPresentation();
    };
  }, [sessionId, claimStatus.success, owner.profileId, target, window.id]);
  // Fit terminal on slot resize (window resize, split pane resize)
  useEffect(() => {
    const el = slotRef.current;
    if (!el || !claimStatus.success) return;

    const lookupKey = target
      ? terminalTargetKey(target)
      : { profileId: owner.profileId, id: sessionId };

    const entry = getTerminal(lookupKey);
    if (entry) {
      scheduleTerminalFit(entry);
    }

    const observer = new ResizeObserver(() => {
      scheduleTerminalFit(getTerminal(lookupKey));
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [sessionId, target, owner.profileId, claimStatus.success]);
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
          onClick={() => revealWindow(holderId)}
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
          <TerminalIcon className="h-8 w-8 text-[var(--color-primary)] opacity-80" />
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
