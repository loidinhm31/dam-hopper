import { useEffect, useMemo, useCallback, useRef } from "react";
import type { OsWindow, ResourceClaimKey } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { useResourceClaim } from "../resource-registry.js";
import { useWindowStore } from "../window-store.js";
import { SessionChangesPanel } from "@/components/organisms/SessionChangesPanel.js";
import { useSessionChangesEnabled } from "@/api/session-changes-queries.js";
import { profileQueryKey } from "@/api/query-client.js";
import { useQueryClient } from "@tanstack/react-query";
import type { ConnectionRef } from "@/api/ownership.js";
import { AlertCircle, ShieldAlert } from "lucide-react";

export interface SessionChangesAppProps {
  window: OsWindow;
}

export function SessionChangesApp({ window }: SessionChangesAppProps) {
  const windowOwner = useWindowOwner();
  const qc = useQueryClient();
  const closeWindow = useWindowStore((state) => state.closeWindow);
  const rootRef = useRef<HTMLDivElement>(null);


  const capturedGenerationRef = useRef<number>(
    window.ctx.generation ??
      (window.appState?.generation as number | undefined) ??
      windowOwner.generation,
  );
  const capturedGeneration = capturedGenerationRef.current;

  const owner: ConnectionRef = useMemo(
    () => ({
      profileId: windowOwner.profileId,
      generation: capturedGeneration,
    }),
    [windowOwner.profileId, capturedGeneration],
  );

  const terminalId = (window.appState?.terminalId as string | undefined) ?? "";
  const terminalIncarnation =
    (window.appState?.terminalIncarnation as string | undefined) ?? "";
  const ompSessionId =
    (window.appState?.ompSessionId as string | undefined) ?? "";
  const rootId = (window.appState?.rootId as string | undefined) ?? ".";

  const isTupleComplete = Boolean(
    owner.profileId &&
      owner.generation !== undefined &&
      terminalId &&
      terminalIncarnation &&
      ompSessionId,
  );

  const claimKey = useMemo<ResourceClaimKey | null>(() => {
    if (!isTupleComplete) return null;
    return {
      resourceKind: "session-changes",
      profileId: owner.profileId,
      generation: owner.generation,
      resourceId: `${terminalId}:${terminalIncarnation}:${ompSessionId}:${rootId}`,
    };
  }, [
    isTupleComplete,
    owner.profileId,
    owner.generation,
    terminalId,
    terminalIncarnation,
    ompSessionId,
    rootId,
  ]);

  const claimStatus = useResourceClaim(claimKey, window.id);

  const { enabled: isEnabled, isLoading } = useSessionChangesEnabled(
    isTupleComplete ? owner : undefined,
  );
  useEffect(() => {
    rootRef.current?.focus();
  }, [isLoading, isTupleComplete, isEnabled]);

  // When disabled or disconnected, purge and remove cache and close window
  useEffect(() => {
    if (isTupleComplete && !isLoading && !isEnabled) {
      void qc.cancelQueries({
        queryKey: profileQueryKey(owner, "session-changes"),
      });
      qc.removeQueries({
        queryKey: profileQueryKey(owner, "session-changes"),
      });
      closeWindow(window.id);
    }
  }, [isTupleComplete, isLoading, isEnabled, owner, qc, closeWindow, window.id]);
  // Owner generation retirement guard
  useEffect(() => {
    if (windowOwner.generation !== capturedGeneration) {
      void qc.cancelQueries({
        queryKey: profileQueryKey(owner, "session-changes"),
      });
      qc.removeQueries({
        queryKey: profileQueryKey(owner, "session-changes"),
      });
      closeWindow(window.id);
    }
  }, [windowOwner.generation, capturedGeneration, owner, qc, closeWindow, window.id]);

  const handleClose = useCallback(() => {
    void qc.cancelQueries({
      queryKey: profileQueryKey(owner, "session-changes"),
    });
    qc.removeQueries({
      queryKey: profileQueryKey(owner, "session-changes"),
    });
    closeWindow(window.id);
  }, [qc, owner, closeWindow, window.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        e.preventDefault();
        handleClose();
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
            (el.ownerDocument.defaultView ?? globalThis).getComputedStyle(el).display !== "none" &&
            (el.ownerDocument.defaultView ?? globalThis).getComputedStyle(el).visibility !== "hidden",
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

  if (!isTupleComplete) {
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
            Missing required terminal session ownership tuple (terminalId, incarnation, or session).
          </p>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="px-3 py-1.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs font-medium hover:bg-[var(--color-surface-hover)]"
        >
          Close Review
        </button>
      </div>
    );
  }

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
          onClick={handleClose}
          className="px-3 py-1.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs font-medium hover:bg-[var(--color-surface-hover)]"
        >
          Close
        </button>
      </div>
    );
  }

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
          onClick={handleClose}
          className="px-3 py-1.5 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs font-medium hover:bg-[var(--color-surface-hover)]"
        >
          Close Review
        </button>
      </div>
    );
  }

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
        key={`${owner.profileId}:${owner.generation}:${terminalId}:${terminalIncarnation}:${ompSessionId}:${rootId}`}
        owner={owner}
        terminalId={terminalId}
        terminalIncarnation={terminalIncarnation}
        ompSessionId={ompSessionId}
        rootId={rootId}
        onClose={handleClose}
        className="h-full border-none rounded-none shadow-none"
      />
    </div>
  );
}
