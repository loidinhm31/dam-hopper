export type WireCounter = string & { readonly __wireCounter: unique symbol };
export type UtcTimestamp = string & { readonly __utcTimestamp: unique symbol };

const COUNTER = /^(?:0|[1-9]\d{0,19})$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_COUNTER = 18446744073709551615n;

export function parseWireCounter(value: unknown): WireCounter | null {
  if (typeof value !== "string" || !COUNTER.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= MAX_COUNTER ? (value as WireCounter) : null;
}
export function wireCounterToBigInt(value: WireCounter): bigint {
  return BigInt(value);
}
export function incrementWireCounter(value: WireCounter): WireCounter | null {
  const next = wireCounterToBigInt(value) + 1n;
  return next <= MAX_COUNTER ? (next.toString() as WireCounter) : null;
}
/** Strict canonical RFC3339 UTC milliseconds, including real calendar dates. */
export function parseUtcTimestamp(value: unknown): UtcTimestamp | null {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) return null;
  const [year, month, day, hour, minute, second] = value
    .slice(0, 19)
    .split(/[-T:]/)
    .map(Number);
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1]! &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
    ? (value as UtcTimestamp)
    : null;
}

export interface DesktopClientContext {
  desktopInstanceId: string;
  managerSessionId: string;
  clientEpoch: WireCounter;
}
export type KnownScopesInput =
  | { status: "available"; ids: string[] }
  | { status: "unavailable" };
export interface SshForwardProfile {
  id: string;
  scopeId: string;
  name: string;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  auth: { mode: "agent" } | { mode: "key"; keyId: string };
  localPort: number;
  targetHost: "127.0.0.1";
  targetPort: number;
  autoStart: boolean;
  reconnect: { enabled: boolean; maxAttempts: number };
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}
export interface SshConnectionProfile {
  id: string;
  scopeId: string;
  name: string;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  auth: { mode: "agent" } | { mode: "key"; keyId: string };
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}
export interface SshForwardRule {
  id: string;
  scopeId: string;
  connectionProfileId: string;
  name: string;
  localPort: number;
  targetHost: "127.0.0.1";
  targetPort: number;
  desiredEnabled: boolean;
  reconnect: { enabled: boolean; maxAttempts: number };
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
}
export type SshConnectionState =
  | "disconnected"
  | "authenticating"
  | "established"
  | "reconnecting"
  | "disconnecting";
export interface SshConnectionRuntime {
  connectionProfileId: string;
  generation: WireCounter;
  state: SshConnectionState;
  retryAttempt: number;
  activeChannels: number;
  stateChangedAt: UtcTimestamp;
  startedAt?: UtcTimestamp;
  errorCode?: SshForwardErrorCode;
}
export type SshForwardRuleState =
  | "off"
  | "opening"
  | "on"
  | "closing"
  | "failed";
export interface SshForwardRuleRuntime {
  ruleId: string;
  connectionProfileId: string;
  connectionGeneration: WireCounter;
  generation: WireCounter;
  state: SshForwardRuleState;
  bindHost: "127.0.0.1";
  localPort: number;
  activeChannels: number;
  stateChangedAt: UtcTimestamp;
  startedAt?: UtcTimestamp;
  errorCode?: SshForwardErrorCode;
}
export type SshForwardCredentialStatus =
  | "none"
  | "saved"
  | "rejected"
  | "expired"
  | "unavailable";
export interface SshForwardCredentialState {
  connectionProfileId: string;
  status: SshForwardCredentialStatus;
  expiresAt?: UtcTimestamp;
}
export interface SshForwardRuntime {
  profileId: string;
  generation: WireCounter;
  state:
    | "stopped"
    | "starting"
    | "running"
    | "reconnecting"
    | "stopping"
    | "failed";
  bindHost: "127.0.0.1";
  localPort: number;
  retryAttempt: number;
  activeChannels: number;
  autoStartDisposition:
    | "notRequested"
    | "queued"
    | "started"
    | "skippedActiveLimit";
  stateChangedAt: UtcTimestamp;
  startedAt?: UtcTimestamp;
  errorCode?: SshForwardErrorCode;
}
export interface HostKeyChallenge {
  challengeId: string;
  connectionProfileId: string;
  /** @deprecated Phase-5 compatibility projection for the legacy UI. */
  profileId?: string;
  scopeId: string;
  generation: WireCounter;
  sshHost: string;
  sshPort: number;
  algorithm: string;
  fingerprint: string;
  expiresAt: UtcTimestamp;
}
export interface SshForwardTrustRepairMetadata {
  trustPath: string;
  executablePath: string;
}
export interface SshForwardSnapshot {
  context: DesktopClientContext;
  scopeId: string;
  activationToken: WireCounter;
  scopeGeneration: WireCounter;
  connectionsRevision: WireCounter;
  rulesRevision: WireCounter;
  profilesRevision: WireCounter;
  trustRevision: WireCounter;
  connections: SshConnectionProfile[];
  rules: SshForwardRule[];
  connectionRuntimes: SshConnectionRuntime[];
  ruleRuntimes: SshForwardRuleRuntime[];
  credentialStates: SshForwardCredentialState[];
  profiles: SshForwardProfile[];
  runtimes: SshForwardRuntime[];
  hostKeyChallenges: HostKeyChallenge[];
  trustRepair?: SshForwardTrustRepairMetadata;
}
export interface ScopeActivation {
  context: DesktopClientContext;
  activationToken: WireCounter;
  scopeId: string | null;
  scopeGeneration: WireCounter;
  snapshot: SshForwardSnapshot | null;
}
export interface OpenClientResult {
  context: DesktopClientContext;
  activationTokenFloor: WireCounter;
  activeScopeId: string | null;
  scopeGeneration: WireCounter;
}
export interface KeyInventory {
  context: DesktopClientContext;
  scopeId: string;
  scopeGeneration: WireCounter;
  keys: Array<{
    keyId: string;
    label: string;
    algorithm: string;
    fingerprint: string;
    encrypted: boolean;
    source: "agent" | "local";
  }>;
}
export type SshForwardErrorCode =
  | "INVALID_ARGUMENT"
  | "UNSUPPORTED_PLATFORM"
  | "IPC_UNAVAILABLE"
  | "DESKTOP_INSTANCE_MISMATCH"
  | "MANAGER_SESSION_MISMATCH"
  | "CLIENT_EPOCH_STALE"
  | "ACTIVATION_SUPERSEDED"
  | "SCOPE_NOT_ACTIVE"
  | "SCOPE_GENERATION_CONFLICT"
  | "SCOPE_ACTIVE"
  | "SCOPE_PURGE_FAILED"
  | "PROFILES_REVISION_CONFLICT"
  | "CONNECTIONS_REVISION_CONFLICT"
  | "RULES_REVISION_CONFLICT"
  | "TRUST_REVISION_CONFLICT"
  | "GENERATION_CONFLICT"
  | "COUNTER_EXHAUSTED"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_ACTIVE"
  | "PROFILE_LIMIT"
  | "ACTIVE_FORWARD_LIMIT"
  | "AUTO_START_SKIPPED_LIMIT"
  | "CONNECTION_REQUIRED"
  | "CONNECTION_LIMIT"
  | "CONNECTION_NOT_ESTABLISHED"
  | "STALE_CONNECTION_GENERATION"
  | "RULE_LIMIT"
  | "STALE_RULE_GENERATION"
  | "PORT_CONFLICT"
  | "CHANNEL_LIMIT"
  | "KEY_NOT_FOUND"
  | "KEY_UNSAFE"
  | "KEY_ENCRYPTED_USE_AGENT"
  | "KEY_PASSPHRASE_INVALID"
  | "AGENT_UNAVAILABLE"
  | "HOST_KEY_APPROVAL_REQUIRED"
  | "HOST_KEY_CHANGED"
  | "HOST_KEY_ALGORITHM_CHANGED"
  | "HOST_KEY_ALGORITHM_UNSUPPORTED"
  | "HOST_KEY_CHALLENGE_NOT_FOUND"
  | "HOST_KEY_CHALLENGE_EXPIRED"
  | "SSH_CONNECT_TIMEOUT"
  | "SSH_CONNECT_FAILED"
  | "AUTH_FAILED"
  | "AUTH_REQUIRED"
  | "CREDENTIAL_VAULT_UNAVAILABLE"
  | "CREDENTIAL_VAULT_CORRUPT"
  | "CREDENTIAL_EXPIRED"
  | "CREDENTIAL_REJECTED"
  | "CREDENTIAL_DELETE_FAILED"
  | "CREDENTIAL_CLEANUP_PENDING"
  | "CREDENTIAL_NOT_SAVED"
  | "LOCAL_PORT_IN_USE"
  | "BIND_FAILED"
  | "CHANNEL_OPEN_TIMEOUT"
  | "TARGET_CONNECT_FAILED"
  | "TARGET_NOT_ALLOWED"
  | "SHUTDOWN_TIMEOUT"
  | "SHUTDOWN_IN_PROGRESS"
  | "STORE_CORRUPT"
  | "STORE_IO"
  | "INTERNAL"
  | "INVALID_COUNTER"
  | "INVALID_TIMESTAMP"
  | "INVALID_PROFILE"
  | "IDENTITY_CORRUPT"
  | "STALE_CLIENT"
  | "STORAGE_UNAVAILABLE";
export interface SshForwardError {
  code: SshForwardErrorCode;
  message: string;
  retryable: boolean;
  scopeId?: string;
  profileId?: string;
  connectionProfileId?: string;
  ruleId?: string;
  currentProfilesRevision?: WireCounter;
  currentConnectionsRevision?: WireCounter;
  currentRulesRevision?: WireCounter;
  currentTrustRevision?: WireCounter;
  currentScopeGeneration?: WireCounter;
  currentGeneration?: WireCounter;
}
const SSH_FORWARD_ERROR_CODES: readonly SshForwardErrorCode[] = [
  "INVALID_ARGUMENT",
  "UNSUPPORTED_PLATFORM",
  "IPC_UNAVAILABLE",
  "DESKTOP_INSTANCE_MISMATCH",
  "MANAGER_SESSION_MISMATCH",
  "CLIENT_EPOCH_STALE",
  "ACTIVATION_SUPERSEDED",
  "SCOPE_NOT_ACTIVE",
  "SCOPE_GENERATION_CONFLICT",
  "SCOPE_ACTIVE",
  "SCOPE_PURGE_FAILED",
  "PROFILES_REVISION_CONFLICT",
  "CONNECTIONS_REVISION_CONFLICT",
  "RULES_REVISION_CONFLICT",
  "TRUST_REVISION_CONFLICT",
  "GENERATION_CONFLICT",
  "COUNTER_EXHAUSTED",
  "PROFILE_NOT_FOUND",
  "PROFILE_ACTIVE",
  "PROFILE_LIMIT",
  "ACTIVE_FORWARD_LIMIT",
  "AUTO_START_SKIPPED_LIMIT",
  "CONNECTION_REQUIRED",
  "CONNECTION_LIMIT",
  "CONNECTION_NOT_ESTABLISHED",
  "STALE_CONNECTION_GENERATION",
  "RULE_LIMIT",
  "STALE_RULE_GENERATION",
  "PORT_CONFLICT",
  "CHANNEL_LIMIT",
  "KEY_NOT_FOUND",
  "KEY_UNSAFE",
  "KEY_ENCRYPTED_USE_AGENT",
  "KEY_PASSPHRASE_INVALID",
  "AGENT_UNAVAILABLE",
  "HOST_KEY_APPROVAL_REQUIRED",
  "HOST_KEY_CHANGED",
  "HOST_KEY_ALGORITHM_CHANGED",
  "HOST_KEY_ALGORITHM_UNSUPPORTED",
  "HOST_KEY_CHALLENGE_NOT_FOUND",
  "HOST_KEY_CHALLENGE_EXPIRED",
  "SSH_CONNECT_TIMEOUT",
  "SSH_CONNECT_FAILED",
  "AUTH_FAILED",
  "AUTH_REQUIRED",
  "CREDENTIAL_VAULT_UNAVAILABLE",
  "CREDENTIAL_VAULT_CORRUPT",
  "CREDENTIAL_EXPIRED",
  "CREDENTIAL_REJECTED",
  "CREDENTIAL_DELETE_FAILED",
  "CREDENTIAL_CLEANUP_PENDING",
  "CREDENTIAL_NOT_SAVED",
  "LOCAL_PORT_IN_USE",
  "BIND_FAILED",
  "CHANNEL_OPEN_TIMEOUT",
  "TARGET_CONNECT_FAILED",
  "TARGET_NOT_ALLOWED",
  "SHUTDOWN_TIMEOUT",
  "SHUTDOWN_IN_PROGRESS",
  "STORE_CORRUPT",
  "STORE_IO",
  "INTERNAL",
  "INVALID_COUNTER",
  "INVALID_TIMESTAMP",
  "INVALID_PROFILE",
  "IDENTITY_CORRUPT",
  "STALE_CLIENT",
  "STORAGE_UNAVAILABLE",
];
/** Accept only the redacted native error shape; discard unknown fields/details. */
export function parseSshForwardError(value: unknown): SshForwardError | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.code !== "string" ||
    !SSH_FORWARD_ERROR_CODES.includes(raw.code as SshForwardErrorCode) ||
    typeof raw.message !== "string" ||
    typeof raw.retryable !== "boolean"
  )
    return null;
  const counter = (candidate: unknown) =>
    candidate === undefined || Boolean(parseWireCounter(candidate));
  if (
    !counter(raw.currentProfilesRevision) ||
    !counter(raw.currentConnectionsRevision) ||
    !counter(raw.currentRulesRevision) ||
    !counter(raw.currentTrustRevision) ||
    !counter(raw.currentScopeGeneration) ||
    !counter(raw.currentGeneration)
  )
    return null;
  if (
    (raw.scopeId !== undefined && typeof raw.scopeId !== "string") ||
    (raw.profileId !== undefined && typeof raw.profileId !== "string")
    ||
    (raw.connectionProfileId !== undefined &&
      typeof raw.connectionProfileId !== "string") ||
    (raw.ruleId !== undefined && typeof raw.ruleId !== "string")
  )
    return null;
  return {
    code: raw.code as SshForwardErrorCode,
    message: raw.message,
    retryable: raw.retryable,
    ...(typeof raw.scopeId === "string" ? { scopeId: raw.scopeId } : {}),
    ...(typeof raw.profileId === "string" ? { profileId: raw.profileId } : {}),
    ...(typeof raw.connectionProfileId === "string"
      ? { connectionProfileId: raw.connectionProfileId }
      : {}),
    ...(typeof raw.ruleId === "string" ? { ruleId: raw.ruleId } : {}),
    ...(parseWireCounter(raw.currentProfilesRevision)
      ? {
          currentProfilesRevision: parseWireCounter(
            raw.currentProfilesRevision,
          )!,
        }
      : {}),
    ...(parseWireCounter(raw.currentConnectionsRevision)
      ? {
          currentConnectionsRevision: parseWireCounter(
            raw.currentConnectionsRevision,
          )!,
        }
      : {}),
    ...(parseWireCounter(raw.currentRulesRevision)
      ? {
          currentRulesRevision: parseWireCounter(raw.currentRulesRevision)!,
        }
      : {}),
    ...(parseWireCounter(raw.currentTrustRevision)
      ? { currentTrustRevision: parseWireCounter(raw.currentTrustRevision)! }
      : {}),
    ...(parseWireCounter(raw.currentScopeGeneration)
      ? {
          currentScopeGeneration: parseWireCounter(raw.currentScopeGeneration)!,
        }
      : {}),
    ...(parseWireCounter(raw.currentGeneration)
      ? { currentGeneration: parseWireCounter(raw.currentGeneration)! }
      : {}),
  };
}
export interface SshForwardEventHint {
  desktopInstanceId: string;
  managerSessionId: string;
  clientEpoch: WireCounter;
  activationToken: WireCounter;
  scopeId: string;
  scopeGeneration: WireCounter;
  connectionsRevision: WireCounter;
  rulesRevision: WireCounter;
  profilesRevision: WireCounter;
  trustRevision: WireCounter;
  connectionProfileId?: string;
  ruleId?: string;
  connectionGeneration?: WireCounter;
  ruleGeneration?: WireCounter;
  profileId?: string;
  generation?: WireCounter;
  reason:
    | "profilesChanged"
    | "connectionsChanged"
    | "rulesChanged"
    | "runtimeChanged"
    | "trustChanged";
}
export type SshForwardHostEvent = {
  type: "changed";
  hint: SshForwardEventHint;
  snapshot?: SshForwardSnapshot;
};

export interface SshForwardHost {
  openClient(knownScopes: KnownScopesInput): Promise<OpenClientResult>;
  activateScope(scopeId: string | null): Promise<ScopeActivation>;
  snapshot(): Promise<SshForwardSnapshot>;
  createConnection(connection: SshConnectionProfile): Promise<SshForwardSnapshot>;
  updateConnection(
    connectionProfileId: string,
    expectedGeneration: WireCounter,
    connection: SshConnectionProfile,
  ): Promise<SshForwardSnapshot>;
  deleteConnection(
    connectionProfileId: string,
    expectedGeneration: WireCounter,
  ): Promise<SshForwardSnapshot>;
  createRule(
    connectionProfileId: string,
    expectedConnectionGeneration: WireCounter,
    rule: SshForwardRule,
  ): Promise<SshForwardSnapshot>;
  updateRule(
    connectionProfileId: string,
    expectedConnectionGeneration: WireCounter,
    ruleId: string,
    expectedRuleGeneration: WireCounter,
    rule: SshForwardRule,
  ): Promise<SshForwardSnapshot>;
  deleteRule(
    connectionProfileId: string,
    expectedConnectionGeneration: WireCounter,
    ruleId: string,
    expectedRuleGeneration: WireCounter,
  ): Promise<SshForwardSnapshot>;
  connect(
    connectionProfileId: string,
    expectedGeneration: WireCounter,
    credentialAttemptId?: string,
  ): Promise<SshForwardSnapshot>;
  disconnect(
    connectionProfileId: string,
    expectedGeneration: WireCounter,
  ): Promise<SshForwardSnapshot>;
  setRuleEnabled(
    connectionProfileId: string,
    expectedConnectionGeneration: WireCounter,
    ruleId: string,
    expectedRuleGeneration: WireCounter,
    enabled: boolean,
  ): Promise<SshForwardSnapshot>;
  createProfile(profile: SshForwardProfile): Promise<SshForwardSnapshot>;
  updateProfile(
    profileId: string,
    expectedGeneration: WireCounter,
    profile: SshForwardProfile,
  ): Promise<SshForwardSnapshot>;
  deleteProfile(
    profileId: string,
    expectedGeneration: WireCounter,
  ): Promise<SshForwardSnapshot>;
  start(
    profileId: string,
    expectedGeneration: WireCounter,
    credentialAttemptId?: string,
  ): Promise<SshForwardSnapshot>;
  stop(
    profileId: string,
    expectedGeneration: WireCounter,
  ): Promise<SshForwardSnapshot>;
  restart(
    profileId: string,
    expectedGeneration: WireCounter,
    credentialAttemptId?: string,
  ): Promise<SshForwardSnapshot>;
  listKeys(): Promise<KeyInventory>;
  loadKey(
    profileId: string,
    keyId: string,
    passphrase: string,
    expectedGeneration?: WireCounter,
    rememberForDays?: 0 | 30,
  ): Promise<SshForwardSnapshot>;
  loadPassword(
    profileId: string,
    username: string,
    password: string,
    credentialAttemptId: string,
    expectedGeneration?: WireCounter,
    rememberForDays?: 0 | 30,
  ): Promise<SshForwardSnapshot>;
  approveHost(
    profileId: string,
    expectedGeneration: WireCounter,
    challengeId: string,
    algorithm: string,
    fingerprint: string,
  ): Promise<SshForwardSnapshot>;
  forgetCredential(
    connectionProfileId: string,
    expectedGeneration: WireCounter,
  ): Promise<SshForwardSnapshot>;
  purgeScope(
    scopeId: string,
    knownScopes: KnownScopesInput,
  ): Promise<{ scopeId: string; purged: boolean }>;
  subscribe(listener: (event: SshForwardHostEvent) => void): () => void;
  dispose(): void;
}
