import { useEffect, useState } from "react";
import { useIdleSuspendStatus, type OwnerInput } from "@/api/queries.js";
import type {
  AgentFreePhase,
  AgentFreeReasonCode,
  IdleSuspendActivityMeasurementState,
  IdleSuspendActivityReasonCode,
  IdleSuspendCoordinatorState,
  IdleSuspendMeasurementWarningReasonCode,
  IdleSuspendStatusV1,
} from "@/api/client.js";
import { cn } from "@/lib/utils.js";
import { getProbeDiagnosticsMessage } from "@/lib/force-sleep-dialog-utils.js";
export interface HostIdleSuspendStatusProps {
  onForceSleep?: (status: IdleSuspendStatusV1) => void;
  isForceSleepPending?: boolean;
  owner?: OwnerInput;
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

const AGENT_FREE_PHASE_LABELS: Record<AgentFreePhase, string> = {
  blocked: "Blocked",
  tracking: "Tracking (>3h)",
  awaitingConsent: "Awaiting consent",
  approved: "Approved",
  finalCheck: "Final check",
  handedOff: "Handed off",
  deferred: "Deferred",
  reconciling: "Reconciling",
};

const AGENT_FREE_REASON_LABELS: Record<AgentFreeReasonCode, string> = {
  idle: "Agents idle",
  blocked: "Agents blocked (waiting for user/error)",
  working: "Agent actively working",
  unknown: "Agent state unknown",
  expired: "Observation lease expired",
  disconnected: "Provider disconnected",
  unavailable: "Observation unavailable",
  ambiguous: "Ambiguous agent owner",
  reconciling: "Reconciling baseline",
  noAgents: "No recognized agents in managed terminals",
  allFree: "All recognized agents free (Idle + Blocked)",
  unansweredTimeout: "Consent unanswered (deferred 3h)",
  clientRefusal: "Client declined sleep (deferred 3h)",
  lastClientDisconnected: "Last client disconnected (deferred 3h)",
  safetyInvalidation: "Final safety check invalidated",
  decisionAlreadySettled: "Consent decision already settled",
};

export function HostIdleSuspendStatus({
  onForceSleep,
  isForceSleepPending,
  owner,
}: HostIdleSuspendStatusProps = {}) {
  const { data: status, isLoading, isError } = useIdleSuspendStatus(true, owner);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const hasArmDeadline =
    status?.armDeadlineMs !== null && status?.armDeadlineMs !== undefined;
  const hasMeasurementWarning =
    status?.activity?.measurementWarning !== null &&
    status?.activity?.measurementWarning !== undefined;
  const hasAgentFreeDeadline =
    status?.automaticPolicy === "agent-free" &&
    Boolean(
      status.enabled &&
        (status.agentFree?.eligibleAtMs != null ||
          status.agentFree?.deferredUntilMs != null ||
          (status.consent?.state === "pending" &&
            status.consent?.expiresAtMs != null)),
    );

  useEffect(() => {
    if (!hasArmDeadline && !hasMeasurementWarning && !hasAgentFreeDeadline) {
      return;
    }
    const initialTimer = setTimeout(() => {
      setNowMs(Date.now());
    }, 0);
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [hasArmDeadline, hasMeasurementWarning, hasAgentFreeDeadline]);
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

  const fleet = status.fleetSnapshot ?? {
    liveCount: 0,
    creatingCount: 0,
    restartPendingCount: 0,
  };
  const sampleTime = new Date(status.timestampMs).toLocaleTimeString();
  const isAgentMode = status.automaticPolicy === "agent-activity";
  const isAgentFreeMode = status.automaticPolicy === "agent-free";
  const policyLabel = isAgentMode
    ? "Agent Activity"
    : isAgentFreeMode
      ? "Agent Free (>3h)"
      : "Legacy empty-fleet";
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

  const agentFree = status.agentFree;
  const clientPresence = status.clientPresence;
  const consent = status.consent;
  const agentFreePhaseLabel = agentFree
    ? (AGENT_FREE_PHASE_LABELS[agentFree.phase] ?? agentFree.phase)
    : null;
  const agentFreeReasonLabel = agentFree?.reasonCode
    ? (AGENT_FREE_REASON_LABELS[agentFree.reasonCode] ?? agentFree.reasonCode)
    : null;
  const eligibleRemainingSeconds =
    status.enabled &&
    agentFree?.phase === "tracking" &&
    agentFree.eligibleAtMs != null
      ? Math.max(0, Math.ceil((agentFree.eligibleAtMs - nowMs) / 1000))
      : null;
  const deferredRemainingSeconds =
    status.enabled &&
    agentFree?.phase === "deferred" &&
    agentFree.deferredUntilMs != null
      ? Math.max(0, Math.ceil((agentFree.deferredUntilMs - nowMs) / 1000))
      : null;
  const consentRemainingSeconds =
    status.enabled &&
    consent?.state === "pending" &&
    consent.expiresAtMs != null
      ? Math.max(0, Math.ceil((consent.expiresAtMs - nowMs) / 1000))
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
      {isAgentFreeMode && agentFree && clientPresence && (
        <div className="space-y-1.5 rounded border border-[var(--color-border)]/60 bg-[var(--color-surface-2)]/40 p-2 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">
              Semantic Agent-Free Eligibility
            </span>
            <span className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-text)]">
              {agentFreePhaseLabel} ({agentFree.inventoryState})
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-[var(--color-text-muted)]">
            <div>
              <span>Idle / Blocked: </span>
              <span className="font-mono text-[var(--color-text)]">
                {agentFree.idleCount ?? "Unknown"} /{" "}
                {agentFree.blockedCount ?? "Unknown"}
              </span>
            </div>
            <div>
              <span>Working / Unknown: </span>
              <span className="font-mono text-[var(--color-text)]">
                {agentFree.workingCount ?? "Unknown"} /{" "}
                {agentFree.unknownCount ?? "Unknown"}
              </span>
            </div>
            <div>
              <span>Public clients: </span>
              <span className="font-mono text-[var(--color-text)]">
                {clientPresence.available
                  ? `${clientPresence.connectionCount} live${
                      clientPresence.pendingUpgradeCount > 0
                        ? ` (+${clientPresence.pendingUpgradeCount} pending)`
                        : ""
                    }`
                  : "Unavailable (blocking)"}
              </span>
            </div>
            <div>
              <span>Threshold: </span>
              <span className="font-mono text-[var(--color-text)]">
                &gt;10,800s (3h)
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)]">
            <span>
              Status:{" "}
              <span className="text-[var(--color-text)]">
                {agentFreeReasonLabel ?? "None"}
              </span>
            </span>
            <span className="font-mono text-[9px]">
              {agentFree.scope}
            </span>
          </div>

          {eligibleRemainingSeconds !== null && (
            <div
              aria-live="polite"
              className="flex items-center justify-between rounded bg-[var(--color-primary)]/10 px-2 py-1 text-[10px] font-medium text-[var(--color-text)]"
            >
              <span>Free eligibility countdown:</span>
              <span className="font-mono font-bold">
                {eligibleRemainingSeconds}s
              </span>
            </div>
          )}

          {deferredRemainingSeconds !== null && (
            <div
              aria-live="polite"
              className="flex items-center justify-between rounded bg-[var(--color-warning)]/10 px-2 py-1 text-[10px] font-medium text-[var(--color-warning)]"
            >
              <span>Deferral remaining:</span>
              <span className="font-mono font-bold">
                {deferredRemainingSeconds}s
              </span>
            </div>
          )}

          {consent && (
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 text-[10px] text-[var(--color-text-muted)]">
              <div className="flex items-center justify-between">
                <span>
                  Consent:{" "}
                  <strong className="uppercase text-[var(--color-text)]">
                    {consent.state}
                  </strong>
                  {consent.decision ? ` (${consent.decision})` : ""}
                </span>
                <span className="font-mono">
                  Wake: {consent.wakeAfterSeconds}s
                </span>
              </div>
              {consentRemainingSeconds !== null && (
                <div className="mt-0.5 flex items-center justify-between text-[var(--color-warning)]">
                  <span>Response deadline:</span>
                  <span className="font-mono font-bold">
                    {consentRemainingSeconds}s
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="rounded bg-[var(--color-surface-2)] p-1.5 text-[9px] leading-tight text-[var(--color-text-muted)]">
            <span className="font-semibold text-[var(--color-text)]">
              Scope:{" "}
            </span>
            Tracks DamHopper terminals only; external work does not block sleep.
            Free = Idle + Blocked (waiting for input/approval, not task
            completion); Working or Unknown blocks automatic sleep.
          </div>
        </div>
      )}
      {status.probeReasonCode && status.probeReasonCode !== "supported" && (
        <div
          role="note"
          aria-label="Capability diagnostic"
          className="rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-1.5 text-[10px] text-[var(--color-warning)]"
        >
          <span className="font-semibold">Capability probe notice: </span>
          <span>{getProbeDiagnosticsMessage(status.probeReasonCode) ?? status.probeReasonCode}</span>
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
