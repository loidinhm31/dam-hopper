import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import { Button } from "@/components/atoms/Button.js";
import { formatDurationText } from "@/lib/force-sleep-dialog-utils.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import type {
  HostSleepConsentActionTarget,
  HostSleepConsentQueueItem,
} from "@/hooks/use-host-sleep-consent.js";

export interface HostSleepConsentDialogProps {
  readonly item: HostSleepConsentQueueItem;
  readonly queueLength: number;
  readonly otherPendingCount: number;
  readonly onApprove: (target: HostSleepConsentActionTarget) => Promise<void>;
  readonly onDeny: (target: HostSleepConsentActionTarget) => Promise<void>;
  readonly onDismiss: (target: HostSleepConsentActionTarget) => Promise<void>;
}

export function HostSleepConsentDialog({
  item,
  queueLength,
  otherPendingCount,
  onApprove,
  onDeny,
  onDismiss,
}: HostSleepConsentDialogProps) {
  const cognitoActive = useCognitoModeStore((s) => s.active);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (item.isSettled || cognitoActive) return;
    const initial = setTimeout(() => setNowMs(Date.now()), 0);
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [
    item.isSettled,
    item.consent.requestId,
    item.consent.expiresAtMs,
    cognitoActive,
  ]);

  if (cognitoActive) return null;

  const remainingSeconds = Math.max(
    0,
    Math.ceil((item.consent.expiresAtMs - nowMs) / 1000),
  );
  const { agentFree, clientPresence, consent } = item;
  const isHandedOff =
    agentFree.phase === "handedOff" || item.status.state === "handedOff";
  const wakeLabel =
    consent.wakeAfterSeconds > 0
      ? `${formatDurationText(consent.wakeAfterSeconds)} (${consent.wakeAfterSeconds}s)`
      : "Indefinite (manual wake)";

  const settledSummary =
    item.effectiveState === "cancelled"
      ? "Request cancelled — Automatic sleep check reset."
      : item.effectiveState === "expired"
        ? "Request expired unanswered — Automatic sleep deferred for 3 hours."
        : item.effectiveState === "denied" || item.effectiveDecision === "deny"
          ? "Decision settled: Denied — Automatic sleep deferred for 3 hours."
          : isHandedOff
            ? "Decision settled: Approved — Host suspend handoff in progress (cannot be cancelled)."
            : "Decision settled: Approved — Waiting for server / final safety checks.";
  return (
    <Dialog
      open={!cognitoActive}
      onOpenChange={(isOpen) => {
        if (
          !isOpen &&
          !item.isSubmitting &&
          !useCognitoModeStore.getState().active
        ) {
          void onDismiss(item.actionTarget);
        }
      }}
    >
      <DialogContent
        closeDisabled={item.isSubmitting}
        onEscapeKeyDown={(e) => {
          if (item.isSubmitting || useCognitoModeStore.getState().active) {
            e.preventDefault();
          }
        }}
        onPointerDownOutside={(e) => {
          if (item.isSubmitting || useCognitoModeStore.getState().active) {
            e.preventDefault();
          }
        }}
        className="w-full max-w-[min(28rem,calc(100vw-2rem))] space-y-3 p-4 text-xs text-[var(--color-text)]"
      >
        <DialogHeader>
          <DialogTitle className="text-sm font-bold text-[var(--color-warning)]">
            Automatic Host Sleep Request
          </DialogTitle>
          <DialogDescription className="space-y-1 text-xs text-[var(--color-text-muted)]">
            <span className="block font-mono text-[11px] text-[var(--color-text)]">
              Target host: {item.profileName} ({item.endpointLabel})
            </span>
            {item.aliasProfileNames.length > 1 && (
              <span className="block text-[10px] text-[var(--color-text-muted)]">
                Aliases: {item.aliasProfileNames.join(", ")}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {queueLength > 1 && (
          <div
            role="status"
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[11px] text-[var(--color-text)]"
          >
            Host 1 of {queueLength}
            {otherPendingCount > 0
              ? ` (${otherPendingCount} other pending host request${otherPendingCount === 1 ? "" : "s"} queued)`
              : ""}
          </div>
        )}

        <div className="space-y-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-2.5 text-[11px]">
          <p className="text-[var(--color-text)]">
            Recognized agents in <strong>DamHopper terminals only</strong> have
            been free (<strong>Idle + Blocked</strong>) for more than{" "}
            <strong>3 hours (10,800s)</strong>.
          </p>
          <p className="text-[10px] text-[var(--color-text-muted)]">
            <strong>Scope notice:</strong> Tracks DamHopper terminals only;
            external work does not block sleep (SSH, tmux, or OS processes
            outside managed terminals are excluded). <strong>Blocked</strong>{" "}
            means waiting for input or approval, not task completion.
          </p>
          <p className="text-[10px] text-[var(--color-warning)]">
            <strong>Host-wide effect:</strong> First valid decision accepted by
            the server wins. Accepting sleep immediately starts final safety
            checks for the entire host and cannot be undone by another client.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded border border-[var(--color-border)] p-2 text-[11px] text-[var(--color-text-muted)]">
          <div>
            Idle / Blocked:{" "}
            <span className="font-mono text-[var(--color-text)]">
              {agentFree.idleCount ?? "Unknown"} /{" "}
              {agentFree.blockedCount ?? "Unknown"}
            </span>
          </div>
          <div>
            Working / Unknown:{" "}
            <span className="font-mono text-[var(--color-text)]">
              {agentFree.workingCount ?? "Unknown"} /{" "}
              {agentFree.unknownCount ?? "Unknown"}
            </span>
          </div>
          <div>
            Connected clients:{" "}
            <span className="font-mono text-[var(--color-text)]">
              {clientPresence.connectionCount}
              {clientPresence.pendingUpgradeCount > 0
                ? ` (+${clientPresence.pendingUpgradeCount} pending)`
                : ""}
            </span>
          </div>
          <div>
            Scheduled wake:{" "}
            <span className="font-mono text-[var(--color-text)]">
              {wakeLabel}
            </span>
          </div>
        </div>

        {!item.isSettled && (
          <div
            aria-live="polite"
            className="flex items-center justify-between rounded bg-[var(--color-warning)]/10 px-2.5 py-1.5 text-[11px] font-medium text-[var(--color-warning)]"
          >
            <span>Unanswered response deadline:</span>
            <span className="font-mono font-bold">{remainingSeconds}s</span>
          </div>
        )}

        {!item.hasReceipt && !item.isSettled && (
          <div
            role="status"
            className="rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-2 text-[11px] text-[var(--color-warning)]"
          >
            Waiting for per-socket decision capability receipt on this
            connection…
          </div>
        )}

        {item.isSettled && (
          <div
            role="status"
            aria-live="polite"
            className="rounded border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 p-2.5 text-[11px] font-medium text-[var(--color-text)]"
          >
            {settledSummary}
          </div>
        )}

        {item.uncertaintyMessage && (
          <div
            role="alert"
            className="rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-2 text-[11px] text-[var(--color-warning)]"
          >
            {item.uncertaintyMessage}
          </div>
        )}

        {item.errorMessage && (
          <div
            role="alert"
            className="rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-2 text-[11px] text-[var(--color-danger)]"
          >
            {item.errorMessage}
          </div>
        )}

        <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {item.isSettled ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void onDismiss(item.actionTarget)}
              className="min-h-11 w-full sm:w-auto px-4 text-xs"
            >
              Close
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                loading={item.isSubmitting && item.pendingDecision === "deny"}
                disabled={item.isSubmitting || !item.hasReceipt}
                onClick={() => void onDeny(item.actionTarget)}
                className="min-h-11 w-full sm:w-auto px-4 text-xs"
              >
                Do not sleep
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={
                  item.isSubmitting && item.pendingDecision === "approve"
                }
                disabled={item.isSubmitting || !item.hasReceipt}
                onClick={() => void onApprove(item.actionTarget)}
                className="min-h-11 w-full sm:w-auto px-4 text-xs"
              >
                Allow sleep
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
