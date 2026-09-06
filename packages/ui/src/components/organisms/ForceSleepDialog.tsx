import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import { Button } from "@/components/atoms/Button.js";
import { AlertTriangle } from "lucide-react";
import { useForceSuspend } from "@/api/queries.js";
import {
  asIdleSuspendConflictResponse,
  type IdleSuspendStatusV1,
  type IdleSuspendFleetSnapshot,
} from "@/api/client.js";
import {
  formatDurationText,
  getActiveSessionCount,
  getForceSleepErrorMessage,
  getInitialTimedWakeSeconds,
} from "@/lib/force-sleep-dialog-utils.js";

export interface ForceSleepDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialStatus: IdleSuspendStatusV1;
}

export function ForceSleepDialog({
  open,
  onOpenChange,
  initialStatus,
}: ForceSleepDialogProps) {
  const forceSuspend = useForceSuspend();
  const [wakeMode, setWakeMode] = useState<"indefinite" | "timed">("indefinite");
  const [fleetSnapshot, setFleetSnapshot] = useState<IdleSuspendFleetSnapshot>(
    initialStatus.fleetSnapshot,
  );
  const [confirmedActive, setConfirmedActive] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [wakeSecondsInput, setWakeSecondsInput] = useState<string>(() =>
    String(getInitialTimedWakeSeconds(initialStatus)),
  );

  useEffect(() => {
    if (open) {
      setWakeMode("indefinite");
      setFleetSnapshot(initialStatus.fleetSnapshot);
      setConfirmedActive(false);
      setConflictWarning(null);
      setErrorMsg(null);
      setWakeSecondsInput(String(getInitialTimedWakeSeconds(initialStatus)));
    }
  }, [open, initialStatus]);

  const activeCount = getActiveSessionCount(fleetSnapshot);
  const isPending = forceSuspend.isPending;
  const wakeNum = parseInt(wakeSecondsInput, 10);
  const isTimedInvalid =
    wakeMode === "timed" &&
    (isNaN(wakeNum) ||
      wakeNum < initialStatus.minWakeAfterSeconds ||
      wakeNum > initialStatus.maxWakeAfterSeconds);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isPending) return;

    const wakeAfterSeconds = wakeMode === "indefinite" ? 0 : wakeNum;
    if (wakeMode === "timed" && isTimedInvalid) {
      setErrorMsg(
        `Wake duration must be between ${initialStatus.minWakeAfterSeconds} and ${initialStatus.maxWakeAfterSeconds} seconds.`,
      );
      return;
    }

    const force = activeCount > 0;
    if (force && !confirmedActive) {
      setErrorMsg(
        "Explicit confirmation is required when managed sessions are active.",
      );
      return;
    }

    setErrorMsg(null);
    setConflictWarning(null);

    try {
      await forceSuspend.mutateAsync({ wakeAfterSeconds, force });
      onOpenChange(false);
    } catch (err) {
      const conflict = asIdleSuspendConflictResponse(err);
      if (conflict) {
        setFleetSnapshot(conflict.fleetSnapshot);
        setConfirmedActive(false);
        setConflictWarning(
          `Fleet activity updated: ${conflict.activeSessionCount} active managed session(s) detected. Please review and confirm again.`,
        );
      } else {
        setErrorMsg(getForceSleepErrorMessage(err));
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isPending) onOpenChange(isOpen);
      }}
    >
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (isPending) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (isPending) e.preventDefault();
        }}
        className="w-full max-w-[min(26rem,calc(100vw-2rem))] space-y-4 p-4 text-[var(--color-text)]"
      >
        <DialogHeader>
          <DialogTitle className="text-sm font-bold text-[var(--color-danger)]">
            Force Machine to Sleep
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--color-text-muted)]">
            Put the host machine to sleep immediately. Running work is paused,
            not killed.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {activeCount > 0 && (
            <div
              role="alert"
              className="rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-warning)]"
            >
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Active managed terminals/builds in progress</span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed">
                There {activeCount === 1 ? "is" : "are"}{" "}
                <strong>
                  {activeCount} active managed session
                  {activeCount === 1 ? "" : "s"}
                </strong>{" "}
                ({fleetSnapshot.liveCount} live, {fleetSnapshot.creatingCount}{" "}
                creating, {fleetSnapshot.restartPendingCount} restarting).
              </p>
              <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                Covers DamHopper-managed terminals and builds only. Putting the
                host to sleep will pause these sessions and disrupt network
                connections.
              </p>
              <label className="mt-3 flex items-start gap-2.5 cursor-pointer text-xs font-medium text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={confirmedActive}
                  onChange={(e) => setConfirmedActive(e.target.checked)}
                  disabled={isPending}
                  className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] cursor-pointer"
                />
                <span>Confirm pausing active managed sessions</span>
              </label>
            </div>
          )}

          <fieldset className="space-y-2 text-xs">
            <legend className="font-semibold text-[var(--color-text)]">
              Wake mode
            </legend>
            <label className="flex items-start gap-2.5 cursor-pointer rounded border border-[var(--color-border)] p-2.5 transition-colors hover:bg-[var(--color-surface-2)]">
              <input
                type="radio"
                name="wake-mode"
                value="indefinite"
                checked={wakeMode === "indefinite"}
                onChange={() => setWakeMode("indefinite")}
                disabled={isPending}
                className="mt-0.5 h-4 w-4 cursor-pointer"
              />
              <div className="min-w-0">
                <span className="font-semibold text-[var(--color-text)]">
                  Sleep indefinitely (default)
                </span>
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  No automatic wake timer is scheduled. The host remains asleep
                  until manually powered on.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer rounded border border-[var(--color-border)] p-2.5 transition-colors hover:bg-[var(--color-surface-2)]">
              <input
                type="radio"
                name="wake-mode"
                value="timed"
                checked={wakeMode === "timed"}
                onChange={() => setWakeMode("timed")}
                disabled={isPending}
                className="mt-0.5 h-4 w-4 cursor-pointer"
              />
              <div className="min-w-0">
                <span className="font-semibold text-[var(--color-text)]">
                  Wake automatically
                </span>
                <p className="text-[10px] text-[var(--color-text-muted)]">
                  Schedule a hardware RTC wake alarm to wake the host
                  automatically.
                </p>
              </div>
            </label>
          </fieldset>

          {wakeMode === "timed" && (
            <div className="space-y-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5 text-xs">
              <label
                htmlFor="force-sleep-duration-input"
                className="block font-semibold text-[var(--color-text)]"
              >
                Wake duration (seconds)
              </label>
              <input
                id="force-sleep-duration-input"
                type="number"
                min={initialStatus.minWakeAfterSeconds}
                max={initialStatus.maxWakeAfterSeconds}
                step={1}
                value={wakeSecondsInput}
                onChange={(e) => setWakeSecondsInput(e.target.value)}
                disabled={isPending}
                className="min-h-11 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-mono text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
              />
              <div className="flex flex-wrap items-center justify-between text-[10px] text-[var(--color-text-muted)]">
                <span>Duration: {formatDurationText(wakeNum)}</span>
                <span>
                  Allowed: {initialStatus.minWakeAfterSeconds}s –{" "}
                  {initialStatus.maxWakeAfterSeconds}s
                </span>
              </div>
            </div>
          )}

          {conflictWarning && (
            <div
              role="alert"
              className="rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-2.5 text-xs text-[var(--color-warning)]"
            >
              {conflictWarning}
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-2.5 text-xs text-[var(--color-danger)]"
            >
              {errorMsg}
            </div>
          )}

          <div aria-live="polite" className="sr-only">
            {isPending ? "Submitting force sleep request to host…" : ""}
          </div>

          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
              className="min-h-11 w-full sm:w-auto px-4 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              loading={isPending}
              disabled={
                isPending ||
                (activeCount > 0 && !confirmedActive) ||
                isTimedInvalid
              }
              className="min-h-11 w-full sm:w-auto px-4 text-xs"
            >
              Force Machine to Sleep
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
