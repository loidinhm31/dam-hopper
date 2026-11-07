import { useEffect, useRef, type ReactElement } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import { Button } from "@/components/atoms/Button.js";
import type {
  TerminalCloseRequest,
  TerminationState,
} from "@/api/terminal-session-contract.js";
import { useShellInputContext } from "./shell-input-context.js";

export interface TerminalCloseDialogProps {
  readonly open: boolean;
  readonly request: TerminalCloseRequest | null;
  readonly terminationState: TerminationState | null;
  readonly onCloseView: () => void;
  readonly onEndSession: () => void;
  readonly onCancel: () => void;
}

export function TerminalCloseDialog({
  open,
  request,
  terminationState,
  onCloseView,
  onEndSession,
  onCancel,
}: TerminalCloseDialogProps): ReactElement | null {
  const { registerModalMount } = useShellInputContext();
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // Register modal mount in ShellInputContext to isolate keyboard shortcuts
  useEffect(() => {
    if (open) {
      return registerModalMount("confirm-dialog");
    }
  }, [open, registerModalMount]);

  if (!open || !request) {
    return null;
  }

  const isLive = request.availability === "live";
  const isPending = request.availability === "restartPending";
  const isDispatching =
    terminationState?.status === "dispatching" ||
    terminationState?.status === "terminationRequested";
  const isAlreadyActed =
    terminationState?.status === "outcomeUnknown" ||
    terminationState?.status === "ended" ||
    terminationState?.status === "restartCancelled";
  const isEndEligible =
    (isLive || isPending || (request.target !== null && request.availability !== "exited")) &&
    request.target !== null &&
    !isDispatching &&
    !isAlreadyActed;
  const title = isPending
    ? "Cancel Scheduled Restart"
    : (isLive || (request.target !== null && request.availability !== "exited"))
      ? "End Terminal Session"
      : "Close Terminal View";

  const endButtonLabel = isPending ? "Cancel Restart" : "End Session";

  // Disabled reason for End
  let disabledReason: string | null = null;
  if (!isEndEligible && !isDispatching) {
    if (request.reason) {
      disabledReason = request.reason;
    } else if (request.availability === "unknown") {
      disabledReason =
        "End session is unavailable: connection disconnected, legacy headerless server, or unverified session identity.";
    } else if (request.target === null) {
      disabledReason =
        "End session is unavailable: terminal target authority is missing or invalid.";
    } else {
      disabledReason = "End session is unavailable for this session state.";
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel();
        }
      }}
    >
      <DialogContent
        data-os-modal="true"
        data-testid="terminal-close-dialog"
        className="sm:max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] select-none"
        onOpenAutoFocus={(event) => {
          // Explicit initial focus on safe Cancel button
          event.preventDefault();
          cancelBtnRef.current?.focus();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
        }}
      >
        <DialogHeader>
          <DialogTitle
            data-testid="terminal-close-title"
            className="flex items-center gap-2 text-sm font-bold text-[var(--color-text)]"
          >
            <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] shrink-0" />
            <span>{title}</span>
          </DialogTitle>
          <DialogDescription
            data-testid="terminal-close-description"
            className="text-xs text-[var(--color-text-muted)] space-y-2 pt-1"
          >
            {isLive && (
              <span className="block">
                This terminal process is actively running on the server. Ending the
                session will send an authoritative termination signal to terminate
                the live process.
              </span>
            )}
            {isPending && (
              <span className="block">
                This terminal process has exited and is scheduled to restart. Ending
                the session will cancel the scheduled restart so the process will
                not restart.
              </span>
            )}
            {!isLive && !isPending && (
              <span className="block">
                Closing this view only removes the window display.
              </span>
            )}

            {disabledReason && (
              <span
                data-testid="terminal-close-disabled-reason"
                className="block p-2 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-2xs text-[var(--color-text-muted)]"
              >
                {disabledReason}
              </span>
            )}

            {terminationState && (
              <span
                data-testid="terminal-close-state-notice"
                className="block p-2 rounded bg-[var(--color-surface-2)] text-2xs font-mono"
              >
                {terminationState.status === "dispatching" && (
                  <span className="flex items-center gap-1.5 text-blue-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Dispatching guarded termination request...</span>
                  </span>
                )}
                {terminationState.status === "terminationRequested" && (
                  <span className="flex items-center gap-1.5 text-blue-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>
                      Termination signal acknowledged (202). Waiting for process
                      exit observation...
                    </span>
                  </span>
                )}
                {terminationState.status === "refused" && (
                  <span className="text-[var(--color-danger)]">
                    Termination refused ({terminationState.error.code}):{" "}
                    {terminationState.error.error}
                  </span>
                )}
                {terminationState.status === "failed" && (
                  <span className="text-[var(--color-danger)]">
                    Termination failed ({terminationState.error.category}):{" "}
                    {terminationState.error.message}
                  </span>
                )}
                {terminationState.status === "outcomeUnknown" && (
                  <span className="text-amber-400">
                    Outcome unknown ({terminationState.error?.category ?? "network"}).
                    Waiting for authoritative inventory reconciliation...
                  </span>
                )}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="flex items-center justify-end gap-2 pt-3">
          {/* Option 1: Safe Cancel (Initial Focus) */}
          <Button
            ref={cancelBtnRef}
            type="button"
            variant="ghost"
            size="sm"
            data-testid="terminal-close-cancel-btn"
            onClick={onCancel}
            className="text-xs"
          >
            Cancel
          </Button>

          {/* Option 2: Presentation Close View (Always Available) */}
          <Button
            type="button"
            variant={!isEndEligible ? "primary" : "secondary"}
            size="sm"
            data-testid="terminal-close-view-btn"
            onClick={onCloseView}
            className="text-xs"
          >
            Close View
          </Button>

          {/* Option 3: Guarded End Session (Enabled only for eligible live/restartPending) */}
          <Button
            type="button"
            variant="danger"
            size="sm"
            data-testid="terminal-close-end-btn"
            disabled={!isEndEligible || isDispatching}
            loading={isDispatching}
            onClick={onEndSession}
            className="text-xs"
          >
            {endButtonLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
