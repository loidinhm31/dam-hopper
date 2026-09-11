import { useEffect, useState } from "react";
import { useIdleSuspendStatus } from "@/api/queries.js";
import type {
  IdleSuspendActivityMeasurementState,
  IdleSuspendActivityReasonCode,
  IdleSuspendCoordinatorState,
  IdleSuspendMeasurementWarningReasonCode,
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
    className:
      "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  },
  watching: {
    label: "Watching",
    className:
      "border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
  },
  armed: {
    label: "Armed",
    className:
      "border-[var(--color-warning)]/40 bg-[var(--color-warning)]/15 text-[var(--color-warning)] font-semibold",
  },
  finalCheck: {
    label: "Final check",
    className:
      "border-[var(--color-warning)]/40 bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  },
  handedOff: {
    label: "Handed off",
    className:
      "border-[var(--color-warning)] bg-[var(--color-warning)]/20 text-[var(--color-warning)] font-bold",
  },
  suppressed: {
    label: "Suppressed",
    className:
      "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  },
  failed: {
    label: "Failed",
    className:
      "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
  },
  resumed: {
    label: "Resumed",
    className:
      "border-[var(--color-success)]/40 bg-[var(--color-success)]/15 text-[var(--color-success)]",
  },
};

const MEASUREMENT_STATE_BADGES: Record<
  IdleSuspendActivityMeasurementState,
  { label: string; className: string }
> = {
  initializing: {
    label: "Initializing",
    className:
      "border-[var(--color-warning)]/40 bg-[var(--color-warning)]/15 text-[var(--color-warning)]",
  },
  available: {
    label: "Available",
    className:
      "border-[var(--color-success)]/40 bg-[var(--color-success)]/15 text-[var(--color-success)]",
  },
  unavailable: {
    label: "Unavailable",
    className:
      "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
  },
};

const ACTIVITY_REASON_LABELS: Record<IdleSuspendActivityReasonCode, string> = {
  recentInput: "Recent terminal input",
  recentOutput: "Recent terminal output",
  recentNetwork: "Recent TCP network activity",
  agentChanged: "Agent process state changed",
  lifecycleBusy: "Process lifecycle busy",
  quiet: "Quiet (suspend candidate)",
  procAccess: "Process inspection restricted",
  scanLimit: "Process scan limit reached",
  scanTimeout: "Process scan timed out",
  socketDiagnostics: "Socket diagnostics error",
  unsupportedTransport: "Unsupported socket transport",
  namespaceMismatch: "Network namespace mismatch",
  staleObservation: "Observation stale",
  identityUncertain: "Agent identity uncertain",
  counterOverflow: "Byte counter overflow",
  reconciling: "Reconciling observation baseline",
  epochSpent: "Idle epoch spent",
};

const WARNING_REASON_LABELS: Record<
  IdleSuspendMeasurementWarningReasonCode,
  string
> = {
  procAccess: "Process inspection restricted",
  scanLimit: "Process scan limit reached",
  scanTimeout: "Process scan timed out",
  socketDiagnostics: "Socket diagnostics error",
  unsupportedTransport: "Unsupported socket transport",
  namespaceMismatch: "Network namespace mismatch",
  staleObservation: "Observation stale",
  identityUncertain: "Agent identity uncertain",
  counterOverflow: "Byte counter overflow",
  reconciling: "Reconciling observation baseline",
};

export function HostIdleSuspendStatus({
  onForceSleep,
  isForceSleepPending,
}: HostIdleSuspendStatusProps = {}) {
  const { data: status, isLoading, isError } = useIdleSuspendStatus();
  const [nowMs, setNowMs] = useState(() => Date.now());

  const hasArmDeadline =
    status?.armDeadlineMs !== null && status?.armDeadlineMs !== undefined;
  const hasMeasurementWarning =
    status?.activity?.measurementWarning !== null &&
    status?.activity?.measurementWarning !== undefined;

  useEffect(() => {
    if (!hasArmDeadline && !hasMeasurementWarning) {
      return;
    }
    setNowMs(Date.now());
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [hasArmDeadline, hasMeasurementWarning]);

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
    className:
      "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  };

  const fleet = status.fleetSnapshot;
  const sampleTime = new Date(status.timestampMs).toLocaleTimeString();
  const isAgentMode = status.automaticPolicy === "agent-activity";
  const policyLabel = isAgentMode ? "Agent Activity" : "Legacy empty-fleet";

  const remainingCountdownSeconds =
    status.armDeadlineMs !== null && status.armDeadlineMs !== undefined
      ? Math.max(0, Math.ceil((status.armDeadlineMs - nowMs) / 1000))
      : null;

  const activity = status.activity;
  const measurementBadge = activity
    ? (MEASUREMENT_STATE_BADGES[activity.measurementState] ?? {
        label: activity.measurementState,
        className:
          "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
      })
    : null;

  const activityReason = activity?.reasonCode
    ? (ACTIVITY_REASON_LABELS[activity.reasonCode] ?? activity.reasonCode)
    : null;

  const warning = activity?.measurementWarning;
  const warningReason = warning
    ? (WARNING_REASON_LABELS[warning.reasonCode] ?? warning.reasonCode)
    : null;
  const warningElapsedSeconds = warning
    ? Math.max(0, Math.floor((nowMs - warning.blockedSinceMs) / 1000))
    : null;

  return (
    <div
      aria-label="Terminal idle suspend status"
      className="space-y-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-xs text-[var(--color-text)]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-[11px] text-[var(--color-text)]">
          Terminal Idle Suspend
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--color-text-muted)]">
            Policy: {policyLabel}
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
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-[var(--color-text-muted)]">
        <div>
          <span>Fleet: </span>
          <span className="font-mono text-[var(--color-text)]">
            {fleet.liveCount} live / {fleet.creatingCount} creating /{" "}
            {fleet.restartPendingCount} restarting
          </span>
        </div>
        <div>
          <span>Timing: </span>
          <span className="font-mono text-[var(--color-text)]">
            {status.quietPeriodSeconds}s / {status.wakeAfterSeconds}s
          </span>
        </div>
      </div>

      {remainingCountdownSeconds !== null && (
        <div
          aria-live="polite"
          className="flex items-center justify-between rounded bg-[var(--color-warning)]/10 px-2 py-1 text-[11px] font-medium text-[var(--color-warning)]"
        >
          <span>Arm Countdown:</span>
          <span className="font-mono font-bold">
            {remainingCountdownSeconds}s
          </span>
        </div>
      )}

      {status.detail && (
        <p className="text-[10px] text-[var(--color-text-muted)]">
          {status.detail}
        </p>
      )}

      {isAgentMode && activity && (
        <div className="space-y-1.5 rounded border border-[var(--color-border)]/60 bg-[var(--color-surface-2)]/40 p-2 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">
              Activity Observation
            </span>
            {measurementBadge && (
              <span
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide",
                  measurementBadge.className,
                )}
              >
                {measurementBadge.label}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-[var(--color-text-muted)]">
            <div>
              <span>Recognized agents: </span>
              <span className="font-mono text-[var(--color-text)]">
                {activity.recognizedAgentCount !== null
                  ? activity.recognizedAgentCount
                  : "Unknown"}
              </span>
            </div>
            <div>
              <span>Monitored terminals: </span>
              <span className="font-mono text-[var(--color-text)]">
                {activity.monitoredTerminalCount !== null
                  ? activity.monitoredTerminalCount
                  : "Unknown"}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
            <span>
              Reason:{" "}
              <span className="text-[var(--color-text)]">
                {activityReason ?? "None"}
              </span>
            </span>
            <span className="font-mono text-[9px] uppercase">
              {activity.networkCoverage}
            </span>
          </div>

          {warning && (
            <div
              role="alert"
              className="space-y-1 rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-1.5 text-[10px] text-[var(--color-danger)]"
            >
              <div className="flex items-center justify-between font-semibold">
                <span>Measurement Blocked: {warningReason}</span>
                <span className="font-mono">
                  Blocked for {warningElapsedSeconds}s
                </span>
              </div>
              <div>
                {warning.processes.length === 0 ? (
                  <div className="italic text-[9px]">
                    Attribution unavailable
                  </div>
                ) : (
                  <div className="space-y-0.5 font-mono text-[9px]">
                    {warning.processes.map((p) => (
                      <div key={p.pid}>
                        PID {p.pid}:{" "}
                        {p.executableIdentity ?? "Identity unavailable"}
                      </div>
                    ))}
                    {warning.processesTruncated && (
                      <div className="italic">
                        (examples truncated, list incomplete)
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="rounded bg-[var(--color-surface-2)] p-1.5 text-[9px] leading-tight text-[var(--color-text-muted)]">
            <span className="font-semibold text-[var(--color-text)]">
              Notice:{" "}
            </span>
            Silence does not prove agent completion; measurement covers
            attributable TCP4/TCP6 only; service-only terminals may still be
            suspended.
          </div>
        </div>
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
