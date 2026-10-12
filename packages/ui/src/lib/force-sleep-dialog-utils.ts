import {
  ApiRequestError,
  type IdleSuspendStatusV1,
  type IdleSuspendFleetSnapshot,
  type SafeProbeReasonCode,
} from "@/api/client.js";

export function formatDurationText(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return "0 seconds";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} second${s === 1 ? "" : "s"}`;
  if (s === 0) return `${m} minute${m === 1 ? "" : "s"}`;
  return `${m} minute${m === 1 ? "" : "s"} ${s} second${s === 1 ? "" : "s"}`;
}

export function getActiveSessionCount(
  fleet?: IdleSuspendFleetSnapshot | null,
): number {
  if (!fleet) return 0;
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
        return "Host lacks required sleep or timed-wake capability.";
      case "idleSuspendHelperUnavailable":
        return "Idle suspend helper is unavailable or unreachable. Check helper service.";
      case "idleSuspendProbeTimeout":
        return "Idle suspend capability probe timed out.";
      case "idleSuspendInhibited":
        return "Host sleep is blocked by an active system inhibitor.";
      case "idleSuspendRtcBusy":
        return "Host wake timer is currently in use.";
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
export function getProbeDiagnosticsMessage(
  reasonCode?: SafeProbeReasonCode | string | null,
): string | null {
  if (!reasonCode || reasonCode === "supported") return null;
  switch (reasonCode) {
    case "socketNotFound":
      return "Helper communication socket is missing. Ensure the privileged helper service is running.";
    case "socketPermissionDenied":
      return "Access to the helper communication socket was denied. Verify socket permissions.";
    case "connectionRefused":
      return "Connection refused to the helper socket. The daemon process may have stopped.";
    case "peerAuthFailed":
      return "Peer authentication failed on the helper socket.";
    case "ipcIoError":
    case "ipcProtocolError":
    case "protocolVersionMismatch":
    case "probeExecutionError":
    case "unknownHelperFailure":
      return "Internal helper IPC communication or protocol negotiation failed.";
    case "probeTimeout":
      return "Capability probe timed out contacting the privileged helper.";
    case "executorUnavailable":
      return "Idle suspend executor is unavailable on this host platform.";
    case "suspendStateUnsupported":
      return "Host kernel or system power management does not support suspend.";
    case "rtcAlarmMissing":
      return "Host does not have a functional RTC wake alarm device.";
    case "inhibitorPresent":
      return "Host suspend is currently blocked by an active system inhibitor lock.";
    case "rtcAlarmBusy":
      return "Host RTC wake alarm is currently busy or reserved.";
    default:
      return "Host power management reported an unrecognized diagnostic condition.";
  }
}

export function getInitialTimedWakeSeconds(status: IdleSuspendStatusV1): number {
  const seed = status.wakeAfterSeconds > 0 ? status.wakeAfterSeconds : 600;
  return Math.min(
    Math.max(seed, status.minWakeAfterSeconds),
    status.maxWakeAfterSeconds,
  );
}
