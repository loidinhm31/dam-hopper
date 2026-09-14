import {
  ApiRequestError,
  type IdleSuspendStatusV1,
  type IdleSuspendFleetSnapshot,
} from "@/api/client.js";

export function formatDurationText(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return "0 seconds";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} second${s === 1 ? "" : "s"}`;
  if (s === 0) return `${m} minute${m === 1 ? "" : "s"}`;
  return `${m} minute${m === 1 ? "" : "s"} ${s} second${s === 1 ? "" : "s"}`;
}

export function getActiveSessionCount(fleet: IdleSuspendFleetSnapshot): number {
  return (
    (fleet.liveCount ?? 0) +
    (fleet.creatingCount ?? 0) +
    (fleet.restartPendingCount ?? 0)
  );
}

export function getForceSleepErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case "idleSuspendActiveFleetConfirmationRequired":
        return "Active managed sessions require explicit confirmation before sleeping.";
      case "idleSuspendFleetChanged":
        return "Fleet activity changed during review. Please review updated sessions and confirm.";
      case "idleSuspendHandoffInProgress":
        return "Host suspend handoff is already in progress. Further requests are blocked until resume.";
      case "idleSuspendDisabledNoAuth":
        return "Manual sleep is disabled in --no-auth development mode.";
      case "actorDisabled":
        return "Your account is disabled. Sleep action is not permitted.";
      case "unauthorized":
        return "Authentication expired or required. Please log in again.";
      case "idleSuspendCapabilityUnavailable":
        return "Host lacks sleep or RTC wake capability.";
      case "idleSuspendAuditUnavailable":
        return "Audit logging is unavailable on the server. Request rejected for security.";
      case "idleSuspendShuttingDown":
        return "Server coordinator is shutting down.";
      case "idleSuspendDisabled":
        return "Idle suspend coordinator is disabled.";
      case "invalidForceSuspendPayload":
        return "Invalid sleep request payload.";
      default:
        return error.message || "Failed to force sleep.";
    }
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function getInitialTimedWakeSeconds(status: IdleSuspendStatusV1): number {
  const seed = status.wakeAfterSeconds > 0 ? status.wakeAfterSeconds : 600;
  return Math.min(
    Math.max(seed, status.minWakeAfterSeconds),
    status.maxWakeAfterSeconds,
  );
}
