import type { ServerProfile } from "@/api/server-config.js";
import type { SshForwardProfile } from "@/lib/ssh-forward-host.js";

export type SshForwardAuthMode = "agent" | "key";

export interface SshForwardProfileDraft {
  name: string;
  sshHost: string;
  sshPort: string;
  sshUser: string;
  authMode: SshForwardAuthMode;
  keyId: string;
  localPort: string;
  targetPort: string;
  autoStart: boolean;
  reconnectEnabled: boolean;
  reconnectMaxAttempts: string;
  reviewed: boolean;
}

export type SshForwardProfileField = keyof SshForwardProfileDraft | "form";
export type SshForwardProfileErrors = Partial<
  Record<SshForwardProfileField, string>
>;

export function sshHostFromServerProfile(
  profile: ServerProfile | null,
): string {
  if (!profile) return "";
  try {
    const hostname = new URL(profile.url).hostname.trim().toLowerCase();
    return isSafeSshHost(hostname) ? hostname : "";
  } catch {
    return "";
  }
}

export function newSshForwardDraft(
  source: ServerProfile | null,
): SshForwardProfileDraft {
  return {
    name: source?.name ?? "",
    sshHost: sshHostFromServerProfile(source),
    sshPort: "22",
    sshUser: "",
    authMode: "agent",
    keyId: "",
    localPort: "",
    targetPort: "",
    autoStart: false,
    reconnectEnabled: true,
    reconnectMaxAttempts: "5",
    reviewed: false,
  };
}

export function draftFromSshForwardProfile(
  profile: SshForwardProfile,
): SshForwardProfileDraft {
  return {
    name: profile.name,
    sshHost: profile.sshHost,
    sshPort: String(profile.sshPort),
    sshUser: profile.sshUser,
    authMode: profile.auth.mode,
    keyId: profile.auth.mode === "key" ? profile.auth.keyId : "",
    localPort: String(profile.localPort),
    targetPort: String(profile.targetPort),
    autoStart: profile.autoStart,
    reconnectEnabled: profile.reconnect.enabled,
    reconnectMaxAttempts: String(profile.reconnect.maxAttempts || 5),
    reviewed: false,
  };
}

export function validateSshForwardDraft(
  draft: SshForwardProfileDraft,
): SshForwardProfileErrors {
  const errors: SshForwardProfileErrors = {};
  if (!draft.name.trim() || draft.name.trim().length > 64) {
    errors.name = "Name is required and must be 64 characters or fewer.";
  }
  if (!isSafeSshHost(draft.sshHost)) {
    errors.sshHost = "Use a safe ASCII SSH hostname or IPv4 address.";
  }
  if (parsePort(draft.sshPort) === null) errors.sshPort = portMessage("SSH");
  if (!draft.sshUser.trim() || draft.sshUser.trim().length > 64) {
    errors.sshUser = "SSH user is required and must be 64 characters or fewer.";
  }
  if (parsePort(draft.localPort) === null)
    errors.localPort = portMessage("Local");
  if (parsePort(draft.targetPort) === null)
    errors.targetPort = portMessage("Target");
  if (draft.authMode === "key" && !isSafeKeyId(draft.keyId)) {
    errors.keyId = "Select a local SSH key from the native inventory.";
  }
  if (draft.reconnectEnabled) {
    const attempts = parsePort(draft.reconnectMaxAttempts);
    if (attempts === null || attempts > 5) {
      errors.reconnectMaxAttempts = "Choose a reconnect limit from 1 to 5.";
    }
  }
  if (!draft.reviewed)
    errors.reviewed = "Review the SSH endpoint before saving.";
  return errors;
}

export function buildSshForwardProfile(
  draft: SshForwardProfileDraft,
  scopeId: string,
  existing?: SshForwardProfile,
): SshForwardProfile | null {
  if (Object.keys(validateSshForwardDraft(draft)).length > 0) return null;
  const now = new Date().toISOString() as SshForwardProfile["createdAt"];
  const auth =
    draft.authMode === "key"
      ? { mode: "key" as const, keyId: draft.keyId.trim() }
      : { mode: "agent" as const };
  return {
    id: existing?.id ?? crypto.randomUUID(),
    scopeId,
    name: draft.name.trim(),
    sshHost: canonicalizeSshHost(draft.sshHost),
    sshPort: parsePort(draft.sshPort)!,
    sshUser: draft.sshUser.trim(),
    auth,
    localPort: parsePort(draft.localPort)!,
    targetHost: "127.0.0.1",
    targetPort: parsePort(draft.targetPort)!,
    autoStart: draft.autoStart,
    reconnect: {
      enabled: draft.reconnectEnabled,
      maxAttempts: draft.reconnectEnabled
        ? parsePort(draft.reconnectMaxAttempts)!
        : 0,
    },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function isSafeSshHost(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/\.+$/, "");
  if (!host || host.length > 253 || !/^[\x00-\x7f]+$/.test(host)) return false;
  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    return host
      .split(".")
      .every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
  }
  return host
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function canonicalizeSshHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, "");
}

function isSafeKeyId(value: string): boolean {
  return (
    value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function parsePort(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function portMessage(label: string): string {
  return `${label} port must be an integer from 1 to 65535.`;
}
