import { useEffect, useMemo, useCallback, useRef, type ReactElement } from "react";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { useResourceClaim } from "../resource-registry.js";
import { useWindowStore } from "../window-store.js";
import { SessionChangesPanel } from "@/components/organisms/SessionChangesPanel.js";
import {
  closeReviewTargetSafely,
  purgeOwnerReviewQueries,
  useSessionChangesEnabled,
} from "@/api/session-changes-queries.js";
import { useQueryClient } from "@tanstack/react-query";
import type { ConnectionRef } from "@/api/ownership.js";
import type { ReviewTarget } from "@/api/terminal-session-contract.js";
import { AlertCircle, ShieldAlert } from "lucide-react";

export interface SessionChangesAppProps {
  window: OsWindow;
}

export function SessionChangesApp({ window }: SessionChangesAppProps): ReactElement {
  const windowOwner = useWindowOwner();
  const qc = useQueryClient();
  const closeWindow = useWindowStore((state) => state.closeWindow);
  const rootRef = useRef<HTMLDivElement>(null);

  // Resolve immutable ReviewTarget from appState without ambient or guessed fallbacks
  const target = useMemo<ReviewTarget | null>(() => {
    const rawTarget = window.appState?.target as ReviewTarget | undefined;
    if (rawTarget && typeof rawTarget === "object") {
      if (
        rawTarget.profileId &&
        typeof rawTarget.generation === "number" &&
        rawTarget.terminalId &&
        rawTarget.terminalIncarnation &&
        rawTarget.ompSessionId &&
        rawTarget.serverEpoch &&
        rawTarget.rootId &&
        rawTarget.baselineId
      ) {
        return Object.freeze({ ...rawTarget });
      }
    }

    const pId =
      (window.appState?.profileId as string | undefined) ??
      (window.ctx.profileId as string | undefined);
    const gen = window.appState?.generation as number | undefined;
    const termId = window.appState?.terminalId as string | undefined;
    const termInc = window.appState?.terminalIncarnation as string | undefined;
    const ompId = window.appState?.ompSessionId as string | undefined;
    const sEpoch = window.appState?.serverEpoch as string | undefined;
    const rId = window.appState?.rootId as string | undefined;
    const bId = window.appState?.baselineId as string | undefined;

    if (
      pId &&
      typeof gen === "number" &&
      termId &&
      termInc &&
      ompId &&
      sEpoch &&
      rId &&
      bId
    ) {
      return Object.freeze({
        profileId: pId,
        generation: gen,
        terminalId: termId,
        terminalIncarnation: termInc,
        ompSessionId: ompId,
        serverEpoch: sEpoch,
        rootId: rId,
        baselineId: bId,
      });
    }

    return null;
  }, [window.appState, window.ctx.profileId]);

  const isRetired = target
    ? windowOwner.generation !== target.generation
    : false;

  const owner: ConnectionRef | undefined = useMemo(() => {
    if (!target) return undefined;
    return {
      profileId: target.profileId,
      generation: target.generation,
    };
  }, [target]);

  // Full-tuple resource claim key
  const claimKey = useMemo<ResourceClaimKey | null>(() => {
    if (!target) return null;
    return {
      resourceKind: "session-changes",
      profileId: target.profileId,
      generation: target.generation,
      resourceId: `${target.terminalId}:${target.terminalIncarnation}:${target.ompSessionId}:${target.serverEpoch}:${target.rootId}:${target.baselineId}`,
    };
  }, [target]);

  const claimStatus = useResourceClaim(claimKey, window.id);

  const { enabled: isEnabled, isLoading } = useSessionChangesEnabled(
    target && !isRetired ? owner : undefined,
  );

  useEffect(() => {
    rootRef.current?.focus();
  }, [isLoading, target, isEnabled, isRetired]);

  // When disabled or disconnected, purge owner review queries (do NOT close window automatically)
  useEffect(() => {
    if (owner && !isLoading && !isEnabled) {
      void purgeOwnerReviewQueries(qc, owner);
    }
  }, [owner, isLoading, isEnabled, qc]);

  // When owner generation retires, purge owner review queries immediately
  useEffect(() => {
    if (owner && isRetired) {
      void purgeOwnerReviewQueries(qc, owner);
    }
  }, [owner, isRetired, qc]);

  // User-initiated close: targeted cancellation and removal of ONLY this exact review identity
  const handleClose = useCallback(() => {
    if (target) {
      closeReviewTargetSafely(
        qc,
        target,
        window.id,
        useWindowStore.getState().session.windows,
      );
    }
    closeWindow(window.id);
  }, [qc, target, closeWindow, window.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        e.preventDefault();
        void handleClose();
        return;
      }

      if (e.key === "Tab") {
        const container = rootRef.current;
        if (!container) return;
        const allElements = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])',
          ),
        );
        const focusables = allElements.filter(
          (el) =>
            el.offsetParent !== null &&
            !el.getAttribute("aria-hidden") &&
            (el.ownerDocument.defaultView ?? globalThis).getComputedStyle(el)
              .display !== "none" &&
            (el.ownerDocument.defaultView ?? globalThis).getComputedStyle(el)
              .visibility !== "hidden",
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (
            document.activeElement === first ||
            document.activeElement === container
          ) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [handleClose],
  );

  // Content-free refusal 1: Incomplete Review Target Tuple
  if (!target) {
    return (
      <div
        ref={rootRef}
        data-os-session-changes-app={window.id}
        data-testid={`session-changes-app-${window.id}`}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-xs text-[var(--color-text-muted)] gap-3 bg-[var(--color-surface)] select-none focus:outline-hidden"
      >
        <ShieldAlert className="h-8 w-8 text-[var(--color-warning)]" />
        <div className="space-y-1">
          <p className="font-semibold text-sm text-[var(--color-text)]">
            Incomplete Session Identity
          </p>
          <p className="max-w-sm text-2xs text-[var(--color-text-muted)]">
            Missing required verified review tuple (profileId, generation, terminalId,
            terminalIncarnation, ompSessionId, serverEpoch, rootId, or baselineId).
            Ambient fallbacks and guessed roots are disabled.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleClose()}
          className="px-3 py-1.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs font-medium hover:bg-[var(--color-surface-hover)]"
        >
          Close Review
        </button>
      </div>
    );
  }

  // Content-free refusal 2: Claim Denied
  if (claimStatus && !claimStatus.success) {
    return (
      <div
        data-os-claim-denied="true"
        data-testid="session-changes-claim-denied"
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className="flex flex-col items-center justify-center p-6 text-center h-full bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)] gap-3 select-none focus:outline-hidden"
      >
        <p>Session Changes review is already active in another window for this session.</p>
        <button
          type="button"
          onClick={() => void handleClose()}
          className="px-3 py-1.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs font-medium hover:bg-[var(--color-surface-hover)]"
        >
          Close
        </button>
      </div>
    );
  }

  // Content-free refusal 3: Connection Generation Retired
  if (isRetired) {
    return (
      <div
        ref={rootRef}
        data-os-session-changes-app={window.id}
        data-testid={`session-changes-app-${window.id}`}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-xs text-[var(--color-text-muted)] gap-3 bg-[var(--color-surface)] select-none focus:outline-hidden"
      >
        <AlertCircle className="h-8 w-8 text-[var(--color-danger)]" />
        <div className="space-y-1">
          <p className="font-semibold text-sm text-[var(--color-text)]">
            Session Review Retired
          </p>
          <p className="max-w-sm text-2xs text-[var(--color-text-muted)]">
            The host connection generation has retired. Protected review data has
            been purged to prevent cross-connection pollution.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleClose()}
          className="px-3 py-1.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs font-medium hover:bg-[var(--color-surface-hover)]"
        >
          Close Review
        </button>
      </div>
    );
  }

  // Loading State
  if (isLoading) {
    return (
      <div
        ref={rootRef}
        data-os-session-changes-app={window.id}
        data-testid={`session-changes-app-${window.id}`}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className="w-full h-full flex items-center justify-center p-6 text-center text-xs text-[var(--color-text-muted)] bg-[var(--color-surface)] select-none focus:outline-hidden"
      >
        <span>Loading session review...</span>
      </div>
    );
  }

  // Content-free refusal 4: Disabled or Disconnected
  if (!isEnabled) {
    return (
      <div
        ref={rootRef}
        data-os-session-changes-app={window.id}
        data-testid={`session-changes-app-${window.id}`}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-xs text-[var(--color-text-muted)] gap-3 bg-[var(--color-surface)] select-none focus:outline-hidden"
      >
        <AlertCircle className="h-8 w-8 text-[var(--color-danger)]" />
        <div className="space-y-1">
          <p className="font-semibold text-sm text-[var(--color-text)]">
            Session Review Unavailable
          </p>
          <p className="max-w-sm text-2xs text-[var(--color-text-muted)]">
            Session changes tracking is disabled or the target session has disconnected.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleClose()}
          className="px-3 py-1.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs font-medium hover:bg-[var(--color-surface-hover)]"
        >
          Close Review
        </button>
      </div>
    );
  }

  // Live Viewer Subtree: SessionChangesPanel
  return (
    <div
      ref={rootRef}
      data-os-session-changes-app={window.id}
      data-testid={`session-changes-app-${window.id}`}
      onKeyDown={handleKeyDown}
      onKeyUp={(e) => e.stopPropagation()}
      onKeyPress={(e) => e.stopPropagation()}
      tabIndex={0}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none focus:outline-hidden"
    >
      <SessionChangesPanel
        key={`${target.profileId}:${target.generation}:${target.terminalId}:${target.terminalIncarnation}:${target.ompSessionId}:${target.serverEpoch}:${target.rootId}:${target.baselineId}`}
        owner={owner!}
        terminalId={target.terminalId}
        terminalIncarnation={target.terminalIncarnation}
        ompSessionId={target.ompSessionId}
        rootId={target.rootId}
        serverEpoch={target.serverEpoch}
        baselineId={target.baselineId}
        target={target}
        onClose={() => void handleClose()}
        className="h-full border-none rounded-none shadow-none"
      />
    </div>
  );
}
