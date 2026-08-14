import type { SshForwardErrorCode } from "@/lib/ssh-forward-host.js";

export type FixedSshForwardErrorCode = Exclude<
  SshForwardErrorCode,
  | "INVALID_COUNTER"
  | "INVALID_TIMESTAMP"
  | "INVALID_PROFILE"
  | "IDENTITY_CORRUPT"
  | "STALE_CLIENT"
  | "STORAGE_UNAVAILABLE"
>;
export interface SshForwardErrorPresentation {
  code: FixedSshForwardErrorCode;
  message: string;
  retryable: boolean;
}
export type ErrorDefinition = Omit<SshForwardErrorPresentation, "code">;

export const FIXED_SSH_FORWARD_ERRORS: Record<
  FixedSshForwardErrorCode,
  ErrorDefinition
> = {
  INVALID_ARGUMENT: {
    message: "Invalid SSH forwarding request.",
    retryable: false,
  },
  UNSUPPORTED_PLATFORM: {
    message: "SSH forwarding requires the desktop app.",
    retryable: false,
  },
  IPC_UNAVAILABLE: {
    message: "Native SSH forwarding is temporarily unavailable.",
    retryable: true,
  },
  DESKTOP_INSTANCE_MISMATCH: {
    message: "This request belongs to another desktop installation.",
    retryable: false,
  },
  MANAGER_SESSION_MISMATCH: {
    message: "The native runtime restarted; reload forwarding state.",
    retryable: true,
  },
  CLIENT_EPOCH_STALE: {
    message: "A newer desktop view owns forwarding control.",
    retryable: true,
  },
  ACTIVATION_SUPERSEDED: {
    message: "A newer server-profile activation replaced this request.",
    retryable: true,
  },
  SCOPE_NOT_ACTIVE: {
    message: "The requested server-profile scope is not active.",
    retryable: true,
  },
  SCOPE_GENERATION_CONFLICT: {
    message: "The server-profile scope changed; reload forwarding state.",
    retryable: true,
  },
  SCOPE_ACTIVE: {
    message: "Stop and deactivate this scope before purging it.",
    retryable: false,
  },
  SCOPE_PURGE_FAILED: {
    message: "The inactive forwarding scope could not be removed.",
    retryable: true,
  },
  PROFILES_REVISION_CONFLICT: {
    message: "Forward profiles changed; review the latest version and retry.",
    retryable: true,
  },
  TRUST_REVISION_CONFLICT: {
    message: "Trusted host records changed; review and retry.",
    retryable: true,
  },
  GENERATION_CONFLICT: {
    message: "Forward runtime changed; reload its latest state.",
    retryable: true,
  },
  COUNTER_EXHAUSTED: {
    message:
      "A native forwarding counter is exhausted; reset requires maintenance.",
    retryable: false,
  },
  PROFILE_NOT_FOUND: {
    message: "The forward profile no longer exists.",
    retryable: false,
  },
  PROFILE_ACTIVE: {
    message: "Stop the forward before editing or deleting it.",
    retryable: false,
  },
  PROFILE_LIMIT: {
    message: "This server profile already has the maximum number of forwards.",
    retryable: false,
  },
  ACTIVE_FORWARD_LIMIT: {
    message: "Stop another forward before starting this one.",
    retryable: true,
  },
  AUTO_START_SKIPPED_LIMIT: {
    message:
      "Auto-start was skipped because the active-forward limit was reached.",
    retryable: true,
  },
  KEY_NOT_FOUND: {
    message: "The selected key is no longer in the safe key inventory.",
    retryable: false,
  },
  KEY_UNSAFE: {
    message: "The selected key file does not meet native safety checks.",
    retryable: false,
  },
  KEY_ENCRYPTED_USE_AGENT: {
    message:
      "Load this encrypted key in the OS SSH agent, then use agent authentication.",
    retryable: false,
  },
  AGENT_UNAVAILABLE: {
    message: "Start the OS SSH agent and load an identity before retrying.",
    retryable: false,
  },
  HOST_KEY_APPROVAL_REQUIRED: {
    message:
      "Verify and approve the SSH host fingerprint before starting again.",
    retryable: false,
  },
  HOST_KEY_CHANGED: {
    message:
      "SSH host identity changed. Connection blocked; use stopped-app trust repair.",
    retryable: false,
  },
  HOST_KEY_ALGORITHM_CHANGED: {
    message:
      "SSH host-key algorithm changed. Connection blocked; use stopped-app trust repair.",
    retryable: false,
  },
  HOST_KEY_ALGORITHM_UNSUPPORTED: {
    message: "The SSH server offered an unsupported host-key algorithm.",
    retryable: false,
  },
  HOST_KEY_CHALLENGE_NOT_FOUND: {
    message: "The host-key approval request is no longer current; start again.",
    retryable: true,
  },
  HOST_KEY_CHALLENGE_EXPIRED: {
    message:
      "The host-key approval expired; start again to request a new fingerprint.",
    retryable: true,
  },
  SSH_CONNECT_TIMEOUT: {
    message: "The SSH connection timed out.",
    retryable: true,
  },
  SSH_CONNECT_FAILED: {
    message: "The SSH server could not be reached.",
    retryable: true,
  },
  AUTH_FAILED: {
    message: "SSH authentication failed for the selected method.",
    retryable: false,
  },
  LOCAL_PORT_IN_USE: {
    message: "The desktop loopback port is already in use.",
    retryable: true,
  },
  BIND_FAILED: {
    message: "The desktop loopback listener could not start.",
    retryable: true,
  },
  CHANNEL_OPEN_TIMEOUT: {
    message: "The remote target channel timed out.",
    retryable: true,
  },
  TARGET_CONNECT_FAILED: {
    message: "The remote loopback target refused the connection.",
    retryable: true,
  },
  TARGET_NOT_ALLOWED: {
    message: "V1 forwards only to remote 127.0.0.1.",
    retryable: false,
  },
  SHUTDOWN_TIMEOUT: {
    message: "Native forwarding exceeded its shutdown grace period.",
    retryable: true,
  },
  SHUTDOWN_IN_PROGRESS: {
    message: "The desktop app is shutting down.",
    retryable: false,
  },
  STORE_CORRUPT: {
    message: "Native forwarding storage is invalid and requires maintenance.",
    retryable: false,
  },
  STORE_IO: {
    message: "Native forwarding storage is temporarily unavailable.",
    retryable: true,
  },
  INTERNAL: {
    message: "Native SSH forwarding failed safely.",
    retryable: false,
  },
};

export const LEGACY_SSH_FORWARD_ERROR_CODES = new Set<string>([
  "INVALID_COUNTER",
  "INVALID_TIMESTAMP",
  "INVALID_PROFILE",
  "IDENTITY_CORRUPT",
  "STALE_CLIENT",
  "STORAGE_UNAVAILABLE",
]);
