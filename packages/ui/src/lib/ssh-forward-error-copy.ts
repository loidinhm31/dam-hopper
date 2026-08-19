import {
  parseSshForwardError,
  type SshForwardError,
  type SshForwardErrorCode,
} from "@/lib/ssh-forward-host.js";
import {
  FIXED_SSH_FORWARD_ERRORS,
  LEGACY_SSH_FORWARD_ERROR_CODES,
  type ErrorDefinition,
  type FixedSshForwardErrorCode,
  type SshForwardErrorPresentation,
} from "@/lib/ssh-forward-error-definitions.js";

export {
  type FixedSshForwardErrorCode,
  type SshForwardErrorPresentation,
} from "@/lib/ssh-forward-error-definitions.js";

export const SSH_FORWARD_REMEDIATION_COPY =
  "Connection blocked because the saved SSH host identity no longer matches. Do not approve it yet. Disconnect all affected connections, quit DamHopper, verify the expected fingerprint with the server administrator, then run the displayed trust-repair command. Reopen DamHopper, press Connect, compare the fingerprint exactly, approve it, then press Connect again.";

export function normalizeSshForwardErrorCode(
  code: SshForwardErrorCode,
): FixedSshForwardErrorCode {
  return LEGACY_SSH_FORWARD_ERROR_CODES.has(code)
    ? "INVALID_ARGUMENT"
    : (code as FixedSshForwardErrorCode);
}

export function getSshForwardErrorPresentation(
  error: unknown,
): SshForwardErrorPresentation {
  const parsed = parseSshForwardError(error);
  const code = normalizeSshForwardErrorCode(parsed?.code ?? "IPC_UNAVAILABLE");
  return { code, ...FIXED_SSH_FORWARD_ERRORS[code] };
}

export function getFixedSshForwardError(
  code: SshForwardErrorCode,
): ErrorDefinition & { code: FixedSshForwardErrorCode } {
  const normalized = normalizeSshForwardErrorCode(code);
  return { code: normalized, ...FIXED_SSH_FORWARD_ERRORS[normalized] };
}

export function toSshForwardError(error: unknown): SshForwardError {
  const parsed = parseSshForwardError(error);
  return (
    parsed ?? {
      code: "IPC_UNAVAILABLE",
      message: FIXED_SSH_FORWARD_ERRORS.IPC_UNAVAILABLE.message,
      retryable: true,
    }
  );
}
