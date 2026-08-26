import type { ServerProfile } from "@/api/server-config.js";
import type {
  SshConnectionProfile,
  SshForwardError,
  SshForwardRule,
} from "@/lib/ssh-forward-host.js";
import { generateUUID } from "@/lib/utils.js";

export type SshForwardAuthMode = "agent" | "key";

export interface SshConnectionProfileDraft {
  name: string;
  sshHost: string;
  sshPort: string;
  sshUser: string;
  authMode: SshForwardAuthMode;
  keyId: string;
  reviewed: boolean;
}

export interface SshForwardRuleDraft {
  name: string;
  localPort: string;
  targetPort: string;
  desiredEnabled: boolean;
  reconnectEnabled: boolean;
  reconnectMaxAttempts: string;
  reviewed: boolean;
}

export type SshConnectionProfileField =
  | keyof SshConnectionProfileDraft
  | "form";
export type SshForwardRuleField = keyof SshForwardRuleDraft | "form";
export type SshConnectionProfileErrors = Partial<
  Record<SshConnectionProfileField, string>
>;
export type SshForwardRuleErrors = Partial<Record<SshForwardRuleField, string>>;

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

export function newSshConnectionDraft(
  source: ServerProfile | null,
): SshConnectionProfileDraft {
  return {
    name: source?.name ?? "",
    sshHost: sshHostFromServerProfile(source),
    sshPort: "22",
    sshUser: "",
    authMode: "agent",
    keyId: "",
    reviewed: false,
  };
}

export function draftFromSshConnectionProfile(
  connection: SshConnectionProfile,
): SshConnectionProfileDraft {
  return {
    name: connection.name,
    sshHost: connection.sshHost,
    sshPort: String(connection.sshPort),
    sshUser: connection.sshUser,
    authMode: connection.auth.mode,
    keyId: connection.auth.mode === "key" ? connection.auth.keyId : "",
    reviewed: false,
  };
}

export function newSshForwardRuleDraft(): SshForwardRuleDraft {
  return {
    name: "",
    localPort: "",
    targetPort: "",
    desiredEnabled: false,
    reconnectEnabled: true,
    reconnectMaxAttempts: "5",
    reviewed: false,
  };
}

export function draftFromSshForwardRule(
  rule: SshForwardRule,
): SshForwardRuleDraft {
  return {
    name: rule.name,
    localPort: String(rule.localPort),
    targetPort: String(rule.targetPort),
    desiredEnabled: rule.desiredEnabled,
    reconnectEnabled: rule.reconnect.enabled,
    reconnectMaxAttempts: String(rule.reconnect.maxAttempts || 5),
    reviewed: false,
  };
}

export function validateSshConnectionDraft(
  draft: SshConnectionProfileDraft,
): SshConnectionProfileErrors {
  const errors: SshConnectionProfileErrors = {};
  const name = draft.name.trim();
  const sshUser = draft.sshUser.trim();
  if (!name || name.length > 64 || hasControlCharacter(name))
    errors.name =
      "Name is required, must be 64 characters or fewer, and contain no control characters.";
  if (!isSafeSshHost(draft.sshHost))
    errors.sshHost = "Use a safe ASCII SSH hostname or IPv4 address.";
  if (parsePort(draft.sshPort) === null) errors.sshPort = portMessage("SSH");
  if (!sshUser || sshUser.length > 64 || hasControlCharacter(sshUser))
    errors.sshUser =
      "SSH user is required, must be 64 characters or fewer, and contain no control characters.";
  if (draft.authMode === "key" && !isSafeKeyId(draft.keyId))
    errors.keyId = "Select a local SSH key from the native inventory.";
  if (!draft.reviewed)
    errors.reviewed = "Review the SSH endpoint before saving.";
  return errors;
}

export function validateSshForwardRuleDraft(
  draft: SshForwardRuleDraft,
): SshForwardRuleErrors {
  const errors: SshForwardRuleErrors = {};
  const name = draft.name.trim();
  if (!name || name.length > 64 || hasControlCharacter(name))
    errors.name =
      "Name is required, must be 64 characters or fewer, and contain no control characters.";
  if (parsePort(draft.localPort) === null)
    errors.localPort = portMessage("Local");
  if (parsePort(draft.targetPort) === null)
    errors.targetPort = portMessage("Target");
  if (draft.reconnectEnabled) {
    const attempts = parsePort(draft.reconnectMaxAttempts);
    if (attempts === null || attempts > 5)
      errors.reconnectMaxAttempts = "Choose a reconnect limit from 1 to 5.";
  }
  if (!draft.reviewed)
    errors.reviewed = "Review the loopback rule before saving.";
  return errors;
}

export function buildSshConnectionProfile(
  draft: SshConnectionProfileDraft,
  scopeId: string,
  existing?: SshConnectionProfile,
): SshConnectionProfile | null {
  if (Object.keys(validateSshConnectionDraft(draft)).length > 0) return null;
  const now = new Date().toISOString() as SshConnectionProfile["createdAt"];
  return {
    id: existing?.id ?? generateUUID(),
    scopeId,
    name: draft.name.trim(),
    sshHost: canonicalizeSshHost(draft.sshHost),
    sshPort: parsePort(draft.sshPort)!,
    sshUser: draft.sshUser.trim(),
    auth:
      draft.authMode === "key"
        ? { mode: "key", keyId: draft.keyId.trim() }
        : { mode: "agent" },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function buildSshForwardRule(
  draft: SshForwardRuleDraft,
  scopeId: string,
  connectionProfileId: string,
  existing?: SshForwardRule,
): SshForwardRule | null {
  if (Object.keys(validateSshForwardRuleDraft(draft)).length > 0) return null;
  const now = new Date().toISOString() as SshForwardRule["createdAt"];
  return {
    id: existing?.id ?? generateUUID(),
    scopeId,
    connectionProfileId,
    name: draft.name.trim(),
    localPort: parsePort(draft.localPort)!,
    targetHost: "127.0.0.1",
    targetPort: parsePort(draft.targetPort)!,
    desiredEnabled: draft.desiredEnabled,
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

/** Map safe native errors to the field that can resolve them. */
export function mapSshForwardErrorToFields(
  error: unknown,
  kind: "connection" | "rule",
): SshConnectionProfileErrors | SshForwardRuleErrors {
  const code = (error as Partial<SshForwardError> | null)?.code;
  if (code === "PORT_CONFLICT" || code === "LOCAL_PORT_IN_USE")
    return kind === "rule"
      ? { localPort: "This local port is already in use." }
      : {};
  if (code === "KEY_NOT_FOUND" || code === "KEY_UNSAFE")
    return kind === "connection"
      ? { keyId: "Choose another key from the native inventory." }
      : {};
  if (code === "TARGET_NOT_ALLOWED")
    return kind === "rule"
      ? { targetPort: "Only remote 127.0.0.1 is allowed." }
      : {};
  return { form: "Review the latest native state and try again." };
}

export function isSafeSshHost(value: string): boolean {
  const host = value.trim().toLowerCase().replace(/\.+$/, "");
  if (!host || host.length > 253 || !/^[\x00-\x7f]+$/.test(host)) return false;
  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    return host
      .split(".")
      .every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
  }
  if (/^\d+(?:\.\d+)*$/.test(host)) return false;
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

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}
