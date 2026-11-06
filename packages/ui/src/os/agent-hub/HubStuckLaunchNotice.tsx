import { useState, type ReactElement } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.js";
import {
  resolveStuckLaunch,
  type StuckLaunchResolution,
} from "../terminal-launch-lifecycle.js";
import { terminalKey } from "@/api/ownership.js";

export interface HubStuckLaunchNoticeProps {
  reason: string;
  attemptId: string;
  profileId: string;
  onSelectTerminal?: (sessionId: string) => void;
  onCleared?: () => void;
  onDismiss: () => void;
  onLaunchAgain?: () => void;
  resolveStuckLaunchFn?: (input: {
    attemptId: string;
    confirmNotCreated: boolean;
  }) => Promise<StuckLaunchResolution>;
}

export function HubStuckLaunchNotice({
  reason,
  attemptId,
  profileId,
  onSelectTerminal,
  onCleared,
  onDismiss,
  onLaunchAgain,
  resolveStuckLaunchFn = resolveStuckLaunch,
}: HubStuckLaunchNoticeProps): ReactElement {
  const [currentNotice, setCurrentNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearedSuccess, setClearedSuccess] = useState(false);

  const displayMessage = currentNotice ?? reason;

  async function handleClearStuck() {
    setIsClearing(true);
    try {
      const res = await resolveStuckLaunchFn({
        attemptId,
        confirmNotCreated: false,
      });

      switch (res.kind) {
        case "found": {
          onSelectTerminal?.(
            terminalKey({ profileId: res.target.profileId, id: res.target.terminalId }),
          );
          onDismiss();
          break;
        }
        case "definitely-absent": {
          setConfirmOpen(true);
          break;
        }
        case "in-flight": {
          setCurrentNotice("Launch still in progress in this window — wait");
          break;
        }
        case "present-unresolvable": {
          setCurrentNotice(
            "Terminal exists but cannot be verified — open it from Terminals or retry later",
          );
          break;
        }
        case "unknown": {
          setCurrentNotice(
            `Cannot confirm on ${profileId} — reconnect and retry`,
          );
          break;
        }
        case "unavailable": {
          setCurrentNotice(`Could not save the resolution: ${res.reason}`);
          break;
        }
        case "conflict": {
          setCurrentNotice("Launch was resolved elsewhere");
          break;
        }
        case "already-resolved": {
          onDismiss();
          break;
        }
      }
    } finally {
      setIsClearing(false);
    }
  }

  async function handleConfirmNotCreated() {
    setConfirmOpen(false);
    setIsClearing(true);
    try {
      const res = await resolveStuckLaunchFn({
        attemptId,
        confirmNotCreated: true,
      });

      switch (res.kind) {
        case "cleared": {
          setClearedSuccess(true);
          onCleared?.();
          break;
        }
        case "unavailable": {
          setCurrentNotice(`Could not save the resolution: ${res.reason}`);
          break;
        }
        case "conflict": {
          setCurrentNotice("Launch was resolved elsewhere");
          break;
        }
        default: {
          setCurrentNotice("Could not resolve launch attempt.");
          break;
        }
      }
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <>
      <div
        role="alert"
        className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2 text-xs text-[var(--color-text)]"
      >
        <div className="flex min-w-0 items-center gap-2">
          {clearedSuccess ? (
            <CheckCircle2
              className="h-4 w-4 shrink-0 text-[var(--color-success)]"
              aria-hidden="true"
            />
          ) : (
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-[var(--color-warning)]"
              aria-hidden="true"
            />
          )}
          <span className="truncate">{displayMessage}</span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {clearedSuccess ? (
            onLaunchAgain && (
              <button
                type="button"
                onClick={onLaunchAgain}
                className="rounded bg-[var(--color-primary)] px-2.5 py-1 font-medium text-[var(--color-primary-foreground)] hover:opacity-90"
              >
                Launch again
              </button>
            )
          ) : (
            <button
              type="button"
              disabled={isClearing}
              onClick={handleClearStuck}
              className="flex items-center gap-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              {isClearing && (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              )}
              Clear stuck launch
            </button>
          )}

          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss notice"
            className="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirmNotCreated}
        title="Mark launch not created?"
        description={`No terminal with id ${attemptId} exists on ${profileId}. Mark the stuck launch as not created?`}
        confirmText="Mark not created"
        cancelText="Cancel"
      />
    </>
  );
}
