import { useIdleSuspendStatus } from "@/api/queries.js";
import type {
  IdleSuspendCoordinatorState,
  IdleSuspendStatusV1,
} from "@/api/client.js";
import { cn } from "@/lib/utils.js";

export interface HostIdleSuspendStatusProps {
  onForceSleep?: (status: IdleSuspendStatusV1) => void;
  isForceSleepPending?: boolean;
}

const STATE_BADGES: Record<
  IdleSuspendCoordinatorState,
  { label: string; className: string }
> = {
  disabled: {
    label: "Disabled",
    className: "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  },
  watching: {
    label: "Watching",
    className: "border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
  },
  armed: {
    label: "Armed",
    className: "border-[var(--color-warning)]/40 bg-[var(--color-warning)]/15 text-[var(--color-warning)] font-semibold",
  },
  finalCheck: {
    label: "Final check",
    className: "border-[var(--color-warning)]/40 bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  },
  handedOff: {
    label: "Handed off",
    className: "border-[var(--color-warning)] bg-[var(--color-warning)]/20 text-[var(--color-warning)] font-bold",
  },
  suppressed: {
    label: "Suppressed",
    className: "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  },
  failed: {
    label: "Failed",
    className: "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
  },
  resumed: {
    label: "Resumed",
    className: "border-[var(--color-success)]/40 bg-[var(--color-success)]/15 text-[var(--color-success)]",
  },
};

export function HostIdleSuspendStatus({
  onForceSleep,
  isForceSleepPending,
}: HostIdleSuspendStatusProps = {}) {
  const { data: status, isLoading, isError } = useIdleSuspendStatus();

  if (isLoading) {
    return (
      <div className="py-2 text-[10px] text-[var(--color-text-muted)]">
        Loading idle suspend status…
      </div>
    );
  }

  if (isError || !status) {
    return (
      <div className="py-2 text-[10px] text-[var(--color-text-muted)]">
        Idle suspend status unavailable.
      </div>
    );
  }

  const badge = STATE_BADGES[status.state] ?? {
    label: status.state,
    className: "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  };

  const fleet = status.fleetSnapshot;
  const sampleTime = new Date(status.timestampMs).toLocaleTimeString();

  return (
    <div
      aria-label="Terminal idle suspend status"
      className="space-y-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-xs text-[var(--color-text)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-[11px] text-[var(--color-text)]">
          Terminal Idle Suspend
        </span>
        <span
          className={cn(
            "rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-[var(--color-text-muted)]">
        <div>
          <span>Fleet: </span>
          <span className="font-mono text-[var(--color-text)]">
            {fleet.liveCount} live / {fleet.creatingCount} creating / {fleet.restartPendingCount} restarting
          </span>
        </div>
        <div>
          <span>Timing: </span>
          <span className="font-mono text-[var(--color-text)]">
            {status.quietPeriodSeconds}s / {status.wakeAfterSeconds}s
          </span>
        </div>
      </div>

      {status.detail && (
        <p className="text-[10px] text-[var(--color-text-muted)]">
          {status.detail}
        </p>
      )}

      <div className="flex items-center justify-between text-[9px] text-[var(--color-text-muted)]">
        <span>Capability: {status.capabilityCode}</span>
        <span>Sampled {sampleTime}</span>
      </div>

      <div className="pt-1">
        <button
          type="button"
          aria-label="Force Machine to Sleep"
          onClick={() => onForceSleep?.(status)}
          disabled={
            !onForceSleep ||
            status.state === "handedOff" ||
            Boolean(fleet.handoffActive) ||
            Boolean(fleet.closing) ||
            Boolean(fleet.disposing) ||
            Boolean(isForceSleepPending)
          }
          title={
            status.state === "handedOff" || Boolean(fleet.handoffActive)
              ? "Host suspend handoff is currently in progress."
              : Boolean(fleet.closing) || Boolean(fleet.disposing)
                ? "Terminal shutdown or disposal is currently in progress."
                : Boolean(isForceSleepPending)
                  ? "Force sleep request is currently in progress."
                  : !onForceSleep
                    ? "Force sleep action is unavailable."
                    : undefined
          }
          className={cn(
            "flex min-h-11 w-full items-center justify-center rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs font-semibold text-[var(--color-danger)] transition-colors cursor-pointer",
            "hover:bg-[var(--color-danger)]/20 focus-visible:outline-2 focus-visible:outline-[var(--color-ring)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          Force Machine to Sleep
        </button>
      </div>
    </div>
  );
}
