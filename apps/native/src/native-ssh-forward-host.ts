import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  parseSshForwardError,
  parseUtcTimestamp,
  parseWireCounter,
  wireCounterToBigInt,
  type DesktopClientContext,
  type KeyInventory,
  type KnownScopesInput,
  type NativeScopeRef,
  type OpenClientResult,
  type ScopeHandle,
  type SshConnectionProfile,
  type SshForwardRule,
  type SshForwardError,
  type SshForwardEventHint,
  type SshForwardHost,
  type SshForwardHostEvent,
  type SshForwardSnapshot,
  type SshForwardTrustRepairMetadata,
  type WireCounter,
} from "@dam-hopper/ui/lib/ssh-forward-host";

export const NATIVE_SSH_FORWARD_COMMANDS = {
  openClient: "ssh_forward_open_client",
  openScope: "ssh_forward_open_scope",
  closeScope: "ssh_forward_close_scope",
  reconcileKnownScopes: "ssh_forward_reconcile_known_scopes",
  snapshot: "ssh_forward_snapshot",
  createConnection: "ssh_forward_create_connection",
  updateConnection: "ssh_forward_update_connection",
  deleteConnection: "ssh_forward_delete_connection",
  createRule: "ssh_forward_create_rule",
  updateRule: "ssh_forward_update_rule",
  deleteRule: "ssh_forward_delete_rule",
  connect: "ssh_forward_connect",
  disconnect: "ssh_forward_disconnect",
  setRuleEnabled: "ssh_forward_set_rule_enabled",
  listKeys: "ssh_forward_list_keys",
  loadKey: "ssh_forward_load_key",
  loadPassword: "ssh_forward_load_password",
  forgetCredential: "ssh_forward_forget_credential",
  approveHost: "ssh_forward_approve_host",
  purgeScope: "ssh_forward_purge_scope",
} as const;

const IPC_UNAVAILABLE: SshForwardError = {
  code: "IPC_UNAVAILABLE",
  message: "Native SSH forwarding is temporarily unavailable.",
  retryable: true,
};
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/;
const STATES = new Set([
  "stopped",
  "starting",
  "running",
  "reconnecting",
  "stopping",
  "failed",
]);
const DISPOSITIONS = new Set([
  "notRequested",
  "queued",
  "started",
  "skippedActiveLimit",
]);
const REASONS = new Set([
  "profilesChanged",
  "connectionsChanged",
  "rulesChanged",
  "runtimeChanged",
  "trustChanged",
]);
const CONNECTION_STATES = new Set([
  "disconnected",
  "authenticating",
  "established",
  "reconnecting",
  "disconnecting",
]);
const RULE_STATES = new Set(["off", "opening", "on", "closing", "failed"]);
const CREDENTIAL_STATUSES = new Set([
  "none",
  "saved",
  "rejected",
  "expired",
  "unavailable",
]);
const ALGORITHMS = new Set([
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
]);
const KEY_SOURCES = new Set(["agent", "local"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every(
      (key) => required.includes(key) || optional.includes(key),
    )
  );
}
function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}
function counter(value: unknown): value is WireCounter {
  return Boolean(parseWireCounter(value));
}
function port(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
  );
}
function boundedText(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    [...value].length <= limit &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function safeAscii(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= limit &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}
function fingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT.test(value);
}
function canonicalHost(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 253 ||
    value !== value.toLowerCase() ||
    value.endsWith(".")
  )
    return false;
  if (/^\d+(?:\.\d+){3}$/.test(value))
    return value
      .split(".")
      .every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
  if (/^\d+$/.test(value)) return false;
  if (/^\d+(?:\.\d+)+$/.test(value)) return false;
  return value
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
function validContext(value: unknown): value is DesktopClientContext {
  const raw = record(value);
  return (
    !!raw &&
    exactKeys(raw, ["desktopInstanceId", "managerSessionId", "clientEpoch"]) &&
    uuid(raw.desktopInstanceId) &&
    uuid(raw.managerSessionId) &&
    counter(raw.clientEpoch)
  );
}
function sameContext(
  left: DesktopClientContext,
  right: DesktopClientContext,
): boolean {
  return (
    left.desktopInstanceId === right.desktopInstanceId &&
    left.managerSessionId === right.managerSessionId &&
    left.clientEpoch === right.clientEpoch
  );
}
function validProfile(value: unknown): boolean {
  const raw = record(value);
  if (
    !raw ||
    !exactKeys(raw, [
      "id",
      "scopeId",
      "name",
      "sshHost",
      "sshPort",
      "sshUser",
      "auth",
      "localPort",
      "targetHost",
      "targetPort",
      "autoStart",
      "reconnect",
      "createdAt",
      "updatedAt",
    ])
  )
    return false;
  const auth = record(raw.auth),
    reconnect = record(raw.reconnect);
  return (
    uuid(raw.id) &&
    uuid(raw.scopeId) &&
    boundedText(raw.name, 64) &&
    canonicalHost(raw.sshHost) &&
    port(raw.sshPort) &&
    boundedText(raw.sshUser, 64) &&
    raw.targetHost === "127.0.0.1" &&
    port(raw.localPort) &&
    port(raw.targetPort) &&
    typeof raw.autoStart === "boolean" &&
    !!reconnect &&
    exactKeys(reconnect, ["enabled", "maxAttempts"]) &&
    typeof reconnect.enabled === "boolean" &&
    typeof reconnect.maxAttempts === "number" &&
    Number.isInteger(reconnect.maxAttempts) &&
    reconnect.maxAttempts >= 0 &&
    reconnect.maxAttempts <= 5 &&
    !!auth &&
    ((exactKeys(auth, ["mode"]) && auth.mode === "agent") ||
      (exactKeys(auth, ["mode", "keyId"]) &&
        auth.mode === "key" &&
        safeAscii(auth.keyId, 128))) &&
    validTimestamp(raw.createdAt) &&
    validTimestamp(raw.updatedAt)
  );
}
function validTimestamp(value: unknown): boolean {
  return Boolean(parseUtcTimestamp(value));
}
function validTrustRepair(
  value: unknown,
): value is SshForwardTrustRepairMetadata {
  const raw = record(value);
  return (
    !!raw &&
    exactKeys(raw, ["trustPath", "executablePath"]) &&
    boundedText(raw.trustPath, 4096) &&
    boundedText(raw.executablePath, 4096)
  );
}
function validAuth(value: unknown): boolean {
  const auth = record(value);
  return (
    !!auth &&
    ((exactKeys(auth, ["mode"]) && auth.mode === "agent") ||
      (exactKeys(auth, ["mode", "keyId"]) &&
        auth.mode === "key" &&
        safeAscii(auth.keyId, 128)))
  );
}
function validConnection(value: unknown): value is SshConnectionProfile {
  const raw = record(value);
  return (
    !!raw &&
    exactKeys(raw, [
      "id",
      "scopeId",
      "name",
      "sshHost",
      "sshPort",
      "sshUser",
      "auth",
      "createdAt",
      "updatedAt",
    ]) &&
    uuid(raw.id) &&
    uuid(raw.scopeId) &&
    boundedText(raw.name, 64) &&
    canonicalHost(raw.sshHost) &&
    port(raw.sshPort) &&
    boundedText(raw.sshUser, 64) &&
    validAuth(raw.auth) &&
    validTimestamp(raw.createdAt) &&
    validTimestamp(raw.updatedAt)
  );
}
function validRule(value: unknown): value is SshForwardRule {
  const raw = record(value);
  const reconnect = raw ? record(raw.reconnect) : null;
  return (
    !!raw &&
    exactKeys(raw, [
      "id",
      "scopeId",
      "connectionProfileId",
      "name",
      "localPort",
      "targetHost",
      "targetPort",
      "desiredEnabled",
      "reconnect",
      "createdAt",
      "updatedAt",
    ]) &&
    uuid(raw.id) &&
    uuid(raw.scopeId) &&
    uuid(raw.connectionProfileId) &&
    boundedText(raw.name, 64) &&
    port(raw.localPort) &&
    raw.targetHost === "127.0.0.1" &&
    port(raw.targetPort) &&
    typeof raw.desiredEnabled === "boolean" &&
    !!reconnect &&
    exactKeys(reconnect, ["enabled", "maxAttempts"]) &&
    typeof reconnect.enabled === "boolean" &&
    typeof reconnect.maxAttempts === "number" &&
    Number.isInteger(reconnect.maxAttempts) &&
    reconnect.maxAttempts >= 0 &&
    reconnect.maxAttempts <= 5 &&
    validTimestamp(raw.createdAt) &&
    validTimestamp(raw.updatedAt)
  );
}
function validRuntimeError(value: unknown): boolean {
  return (
    value === undefined ||
    !!parseSshForwardError({ code: value, message: "", retryable: false })
  );
}
function validSnapshot(
  value: unknown,
  context: DesktopClientContext,
  token: WireCounter,
  scopeId: string,
  scopeGeneration: WireCounter,
): value is SshForwardSnapshot {
  const raw = record(value);
  if (
    !raw ||
    !exactKeys(
      raw,
      [
        "context",
        "scopeId",
        "activationToken",
        "scopeGeneration",
        "connectionsRevision",
        "rulesRevision",
        "profilesRevision",
        "trustRevision",
        "connections",
        "rules",
        "connectionRuntimes",
        "ruleRuntimes",
        "credentialStates",
        "profiles",
        "runtimes",
        "hostKeyChallenges",
      ],
      ["trustRepair"],
    ) ||
    !validContext(raw.context) ||
    !sameContext(raw.context, context) ||
    raw.scopeId !== scopeId ||
    raw.activationToken !== token ||
    raw.scopeGeneration !== scopeGeneration ||
    !counter(raw.connectionsRevision) ||
    !counter(raw.rulesRevision) ||
    !counter(raw.profilesRevision) ||
    !counter(raw.trustRevision) ||
    !Array.isArray(raw.connections) ||
    !Array.isArray(raw.rules) ||
    !Array.isArray(raw.connectionRuntimes) ||
    !Array.isArray(raw.ruleRuntimes) ||
    !Array.isArray(raw.credentialStates) ||
    !Array.isArray(raw.profiles) ||
    !Array.isArray(raw.runtimes) ||
    !Array.isArray(raw.hostKeyChallenges) ||
    !raw.profiles.every(
      (profile) => validProfile(profile) && profile.scopeId === scopeId,
    ) ||
    (raw.trustRepair !== undefined && !validTrustRepair(raw.trustRepair))
  )
    return false;
  const connectionIds = new Set(
    raw.connections.filter(validConnection).map((connection) => connection.id),
  );
  const ruleIds = new Set(raw.rules.filter(validRule).map((rule) => rule.id));
  const legacyProfileIds = new Set(
    raw.profiles.filter(validProfile).map((profile) => profile.id),
  );
  const legacyRuntimeProfileIds = new Set(
    raw.runtimes.map((runtime) => record(runtime)?.profileId),
  );
  const ruleParents = new Map(
    raw.rules
      .filter(validRule)
      .map((rule) => [rule.id, rule.connectionProfileId]),
  );
  const credentialStateIds = new Set(
    raw.credentialStates.map(
      (credential) => record(credential)?.connectionProfileId,
    ),
  );
  const connectionRuntimeIds = new Set(
    raw.connectionRuntimes.map(
      (runtime) => record(runtime)?.connectionProfileId,
    ),
  );
  const ruleRuntimeIds = new Set(
    raw.ruleRuntimes.map((runtime) => record(runtime)?.ruleId),
  );
  const challengeIds = new Set(
    raw.hostKeyChallenges.map((challenge) => record(challenge)?.challengeId),
  );
  const connectionRuntimeGenerations = new Map<string, unknown>(
    raw.connectionRuntimes
      .map(record)
      .filter(
        (runtime): runtime is Record<string, unknown> =>
          runtime !== null &&
          typeof runtime.connectionProfileId === "string" &&
          typeof runtime.generation === "string",
      )
      .map(
        (runtime) =>
          [runtime.connectionProfileId as string, runtime.generation] as [
            string,
            unknown,
          ],
      ),
  );
  return (
    raw.connections.length <= 64 &&
    raw.rules.length <= 64 &&
    raw.profiles.length <= 64 &&
    raw.runtimes.length <= 64 &&
    raw.connectionRuntimes.length <= 16 &&
    raw.ruleRuntimes.length <= 64 &&
    raw.credentialStates.length <= 64 &&
    raw.hostKeyChallenges.length <= 64 &&
    connectionIds.size === raw.connections.length &&
    ruleIds.size === raw.rules.length &&
    legacyProfileIds.size === raw.profiles.length &&
    legacyRuntimeProfileIds.size === raw.runtimes.length &&
    credentialStateIds.size === raw.credentialStates.length &&
    raw.credentialStates.length === raw.connections.length &&
    connectionRuntimeIds.size === raw.connectionRuntimes.length &&
    ruleRuntimeIds.size === raw.ruleRuntimes.length &&
    challengeIds.size === raw.hostKeyChallenges.length &&
    raw.connections.every(
      (connection) =>
        validConnection(connection) && connection.scopeId === scopeId,
    ) &&
    raw.rules.every(
      (rule) =>
        validRule(rule) &&
        rule.scopeId === scopeId &&
        connectionIds.has(rule.connectionProfileId),
    ) &&
    raw.connectionRuntimes.every((runtime) => {
      const item = record(runtime);
      return (
        !!item &&
        exactKeys(
          item,
          [
            "connectionProfileId",
            "generation",
            "state",
            "retryAttempt",
            "activeChannels",
            "stateChangedAt",
          ],
          ["startedAt", "errorCode"],
        ) &&
        uuid(item.connectionProfileId) &&
        connectionIds.has(item.connectionProfileId) &&
        counter(item.generation) &&
        typeof item.state === "string" &&
        CONNECTION_STATES.has(item.state) &&
        typeof item.retryAttempt === "number" &&
        Number.isInteger(item.retryAttempt) &&
        item.retryAttempt >= 0 &&
        item.retryAttempt <= 5 &&
        typeof item.activeChannels === "number" &&
        Number.isInteger(item.activeChannels) &&
        item.activeChannels >= 0 &&
        item.activeChannels <= 65535 &&
        validTimestamp(item.stateChangedAt) &&
        (item.startedAt === undefined || validTimestamp(item.startedAt)) &&
        validRuntimeError(item.errorCode)
      );
    }) &&
    raw.ruleRuntimes.every((runtime) => {
      const item = record(runtime);
      return (
        !!item &&
        exactKeys(
          item,
          [
            "ruleId",
            "connectionProfileId",
            "connectionGeneration",
            "generation",
            "state",
            "bindHost",
            "localPort",
            "activeChannels",
            "stateChangedAt",
          ],
          ["startedAt", "errorCode"],
        ) &&
        uuid(item.ruleId) &&
        ruleIds.has(item.ruleId) &&
        uuid(item.connectionProfileId) &&
        connectionIds.has(item.connectionProfileId) &&
        ruleParents.get(item.ruleId) === item.connectionProfileId &&
        connectionRuntimeGenerations.get(item.connectionProfileId) ===
          item.connectionGeneration &&
        counter(item.connectionGeneration) &&
        counter(item.generation) &&
        typeof item.state === "string" &&
        RULE_STATES.has(item.state) &&
        item.bindHost === "127.0.0.1" &&
        port(item.localPort) &&
        typeof item.activeChannels === "number" &&
        Number.isInteger(item.activeChannels) &&
        item.activeChannels >= 0 &&
        item.activeChannels <= 65535 &&
        validTimestamp(item.stateChangedAt) &&
        (item.startedAt === undefined || validTimestamp(item.startedAt)) &&
        validRuntimeError(item.errorCode)
      );
    }) &&
    raw.credentialStates.every((credential) => {
      const item = record(credential);
      return (
        !!item &&
        exactKeys(item, ["connectionProfileId", "status"], ["expiresAt"]) &&
        uuid(item.connectionProfileId) &&
        connectionIds.has(item.connectionProfileId) &&
        typeof item.status === "string" &&
        CREDENTIAL_STATUSES.has(item.status) &&
        (item.expiresAt === undefined || validTimestamp(item.expiresAt))
      );
    }) &&
    raw.runtimes.every((runtime) => {
      const item = record(runtime);
      return (
        !!item &&
        exactKeys(
          item,
          [
            "profileId",
            "generation",
            "state",
            "bindHost",
            "localPort",
            "retryAttempt",
            "activeChannels",
            "autoStartDisposition",
            "stateChangedAt",
          ],
          ["startedAt", "errorCode"],
        ) &&
        uuid(item.profileId) &&
        legacyProfileIds.has(item.profileId) &&
        counter(item.generation) &&
        typeof item.state === "string" &&
        STATES.has(item.state) &&
        item.bindHost === "127.0.0.1" &&
        port(item.localPort) &&
        typeof item.retryAttempt === "number" &&
        Number.isInteger(item.retryAttempt) &&
        item.retryAttempt >= 0 &&
        item.retryAttempt <= 5 &&
        typeof item.activeChannels === "number" &&
        Number.isInteger(item.activeChannels) &&
        item.activeChannels >= 0 &&
        item.activeChannels <= 65535 &&
        typeof item.autoStartDisposition === "string" &&
        DISPOSITIONS.has(item.autoStartDisposition) &&
        validTimestamp(item.stateChangedAt) &&
        (item.startedAt === undefined || validTimestamp(item.startedAt)) &&
        (item.errorCode === undefined ||
          !!parseSshForwardError({
            code: item.errorCode,
            message: "",
            retryable: false,
          }))
      );
    }) &&
    raw.hostKeyChallenges.every((challenge) => {
      const item = record(challenge);
      return (
        !!item &&
        exactKeys(item, [
          "challengeId",
          "connectionProfileId",
          "scopeId",
          "generation",
          "sshHost",
          "sshPort",
          "algorithm",
          "fingerprint",
          "expiresAt",
        ]) &&
        uuid(item.challengeId) &&
        uuid(item.connectionProfileId) &&
        connectionIds.has(item.connectionProfileId) &&
        item.scopeId === scopeId &&
        counter(item.generation) &&
        canonicalHost(item.sshHost) &&
        port(item.sshPort) &&
        typeof item.algorithm === "string" &&
        ALGORITHMS.has(item.algorithm) &&
        fingerprint(item.fingerprint) &&
        validTimestamp(item.expiresAt)
      );
    })
  );
}
function validKeys(
  value: unknown,
  context: DesktopClientContext,
  scopeId: string,
  scopeGeneration: WireCounter,
): value is KeyInventory {
  const raw = record(value);
  return (
    !!raw &&
    exactKeys(raw, ["context", "scopeId", "scopeGeneration", "keys"]) &&
    validContext(raw.context) &&
    sameContext(raw.context, context) &&
    raw.scopeId === scopeId &&
    raw.scopeGeneration === scopeGeneration &&
    Array.isArray(raw.keys) &&
    raw.keys.length <= 256 &&
    raw.keys.every((key) => {
      const item = record(key);
      return (
        !!item &&
        exactKeys(item, [
          "keyId",
          "label",
          "algorithm",
          "fingerprint",
          "encrypted",
          "source",
        ]) &&
        safeAscii(item.keyId, 128) &&
        boundedText(item.label, 255) &&
        typeof item.algorithm === "string" &&
        ALGORITHMS.has(item.algorithm) &&
        fingerprint(item.fingerprint) &&
        typeof item.encrypted === "boolean" &&
        typeof item.source === "string" &&
        KEY_SOURCES.has(item.source)
      );
    })
  );
}

export class NativeSshForwardHost implements SshForwardHost {
  private context: DesktopClientContext | null = null;
  private readonly scopes = new Map<string, ScopeHandle>();
  private readonly hintFreshness = new Map<
    string,
    [WireCounter, WireCounter, WireCounter, WireCounter, WireCounter]
  >();
  private knownScopes: KnownScopesInput = { status: "unavailable" };
  private operation = 0;
  private readonly mutationInFlight = new Map<string, number>();
  private readonly mutationWaiters = new Map<string, Array<() => void>>();
  private readonly snapshotRequestSequence = new Map<string, number>();
  private readonly acceptedSnapshotRequest = new Map<string, number>();
  private readonly snapshotInFlight = new Map<string, boolean>();
  private readonly snapshotTrailing = new Map<string, boolean>();
  private readonly snapshotTrailingHint = new Map<string, SshForwardEventHint | null>();
  private readonly listeners = new Set<(event: SshForwardHostEvent) => void>();
  private unlisten: UnlistenFn | null = null;
  private listening: Promise<void> | null = null;
  private disposed = false;

  async openClient(knownScopes: KnownScopesInput): Promise<OpenClientResult> {
    this.knownScopes = knownScopes;
    const operation = ++this.operation;
    await this.installListener();
    const result = await this.invoke<OpenClientResult>(
      NATIVE_SSH_FORWARD_COMMANDS.openClient,
      { input: { knownScopes } },
    );
    const raw = record(result);
    if (
      !raw ||
      !exactKeys(raw, ["context"]) ||
      !validContext(raw.context) ||
      this.disposed ||
      operation !== this.operation
    )
      throw IPC_UNAVAILABLE;
    this.context = raw.context;
    this.scopes.clear();
    this.hintFreshness.clear();
    this.mutationInFlight.clear();
    this.mutationWaiters.clear();
    this.snapshotRequestSequence.clear();
    this.acceptedSnapshotRequest.clear();
    this.snapshotInFlight.clear();
    this.snapshotTrailing.clear();
    this.snapshotTrailingHint.clear();
    return result;
  }

  async openScope(scopeId: string): Promise<ScopeHandle> {
    if (!this.context || !uuid(scopeId)) throw IPC_UNAVAILABLE;
    const context = this.context;
    const operation = this.operation;
    const result = await this.invoke<ScopeHandle>(
      NATIVE_SSH_FORWARD_COMMANDS.openScope,
      { input: { context, scopeId } },
    );
    if (!this.validScopeHandle(result, context, scopeId)) throw IPC_UNAVAILABLE;
    if (this.disposed || operation !== this.operation) {
      throw {
        ...IPC_UNAVAILABLE,
        code: "ACTIVATION_SUPERSEDED" as const,
        message: "Activation was superseded by a newer scope request.",
        retryable: true,
      };
    }
    const handle: ScopeHandle = {
      ref: result.ref,
      snapshot: this.normaliseSnapshot(result.snapshot),
    };
    this.scopes.set(scopeId, handle);
    this.hintFreshness.set(scopeId, [
      handle.snapshot.scopeGeneration,
      handle.snapshot.connectionsRevision,
      handle.snapshot.rulesRevision,
      handle.snapshot.profilesRevision,
      handle.snapshot.trustRevision,
    ]);
    return handle;
  }

  async closeScope(scope: NativeScopeRef): Promise<void> {
    if (
      !this.context ||
      !sameContext(this.context, scope.context) ||
      !uuid(scope.scopeId) ||
      !counter(scope.scopeGeneration) ||
      !counter(scope.activationToken)
    )
      throw IPC_UNAVAILABLE;
    const operation = this.operation;
    this.scopes.delete(scope.scopeId);
    this.hintFreshness.delete(scope.scopeId);
    this.mutationInFlight.delete(scope.scopeId);
    this.mutationWaiters.delete(scope.scopeId);
    this.snapshotRequestSequence.delete(scope.scopeId);
    this.acceptedSnapshotRequest.delete(scope.scopeId);
    this.snapshotInFlight.delete(scope.scopeId);
    this.snapshotTrailing.delete(scope.scopeId);
    this.snapshotTrailingHint.delete(scope.scopeId);
    await this.invoke<void>(NATIVE_SSH_FORWARD_COMMANDS.closeScope, {
      input: {
        context: scope.context,
        activationToken: scope.activationToken,
        scopeId: scope.scopeId,
        scopeGeneration: scope.scopeGeneration,
      },
    });
    if (this.disposed || operation !== this.operation) throw IPC_UNAVAILABLE;
  }

  async reconcileKnownScopes(knownScopes: KnownScopesInput): Promise<void> {
    if (!this.context) throw IPC_UNAVAILABLE;
    this.knownScopes = knownScopes;
    await this.invoke<void>(NATIVE_SSH_FORWARD_COMMANDS.reconcileKnownScopes, {
      input: { context: this.context, knownScopes },
    });
  }

  async snapshot(scope: NativeScopeRef): Promise<SshForwardSnapshot> {
    await this.waitForMutationsToSettle(scope.scopeId);
    const nextSeq = (this.snapshotRequestSequence.get(scope.scopeId) ?? 0) + 1;
    this.snapshotRequestSequence.set(scope.scopeId, nextSeq);
    return this.command(
      scope,
      NATIVE_SSH_FORWARD_COMMANDS.snapshot,
      {},
      true,
      false,
      nextSeq,
    );
  }

  createConnection(
    scope: NativeScopeRef,
    connection: SshConnectionProfile,
  ): Promise<SshForwardSnapshot> {
    return this.command(scope, NATIVE_SSH_FORWARD_COMMANDS.createConnection, {
      expectedConnectionsRevision: this.requireSnapshot(scope.scopeId).connectionsRevision,
      connection,
    });
  }

  updateConnection(
    scope: NativeScopeRef,
    connectionProfileId: string,
    expectedGeneration: WireCounter,
    connection: SshConnectionProfile,
  ): Promise<SshForwardSnapshot> {
    return this.command(scope, NATIVE_SSH_FORWARD_COMMANDS.updateConnection, {
      expectedConnectionsRevision: this.requireSnapshot(scope.scopeId).connectionsRevision,
      connectionProfileId,
      expectedGeneration,
      connection,
    });
  }

  deleteConnection(
    scope: NativeScopeRef,
    connectionProfileId: string,
    expectedGeneration: WireCounter,
  ): Promise<SshForwardSnapshot> {
    return this.command(scope, NATIVE_SSH_FORWARD_COMMANDS.deleteConnection, {
      expectedConnectionsRevision: this.requireSnapshot(scope.scopeId).connectionsRevision,
      connectionProfileId,
      expectedGeneration,
    });
  }

  createRule(
    scope: NativeScopeRef,
    connectionProfileId: string,
    expectedConnectionGeneration: WireCounter,
    rule: SshForwardRule,
  ): Promise<SshForwardSnapshot> {
    return this.command(scope, NATIVE_SSH_FORWARD_COMMANDS.createRule, {
      expectedRulesRevision: this.requireSnapshot(scope.scopeId).rulesRevision,
      connectionProfileId,
      expectedConnectionGeneration,
      rule,
    });
  }

  updateRule(
    scope: NativeScopeRef,
    connectionProfileId: string,
    expectedConnectionGeneration: WireCounter,
    ruleId: string,
    expectedRuleGeneration: WireCounter,
    rule: SshForwardRule,
  ): Promise<SshForwardSnapshot> {
    return this.command(scope, NATIVE_SSH_FORWARD_COMMANDS.updateRule, {
      expectedRulesRevision: this.requireSnapshot(scope.scopeId).rulesRevision,
      connectionProfileId,
      expectedConnectionGeneration,
      ruleId,
      expectedRuleGeneration,
      rule,
    });
  }

  deleteRule(
    scope: NativeScopeRef,
    connectionProfileId: string,
    expectedConnectionGeneration: WireCounter,
    ruleId: string,
    expectedRuleGeneration: WireCounter,
  ): Promise<SshForwardSnapshot> {
    return this.command(scope, NATIVE_SSH_FORWARD_COMMANDS.deleteRule, {
      expectedRulesRevision: this.requireSnapshot(scope.scopeId).rulesRevision,
      connectionProfileId,
      expectedConnectionGeneration,
      ruleId,
      expectedRuleGeneration,
    });
  }

  connect(
    scope: NativeScopeRef,
    connectionProfileId: string,
    expectedGeneration: WireCounter,
    credentialAttemptId?: string,
  ): Promise<SshForwardSnapshot> {
    return this.command(scope, NATIVE_SSH_FORWARD_COMMANDS.connect, {
      connectionProfileId,
      expectedGeneration,
      ...(credentialAttemptId ? { credentialAttemptId } : {}),
    });
  }

  disconnect(
    scope: NativeScopeRef,
    connectionProfileId: string,
    expectedGeneration: WireCounter,
  ): Promise<SshForwardSnapshot> {
    return this.command(scope, NATIVE_SSH_FORWARD_COMMANDS.disconnect, {
      connectionProfileId,
      expectedGeneration,
    });
  }

  setRuleEnabled(
    scope: NativeScopeRef,
    connectionProfileId: string,
    expectedConnectionGeneration: WireCounter,
    ruleId: string,
    expectedRuleGeneration: WireCounter,
    enabled: boolean,
  ): Promise<SshForwardSnapshot> {
    return this.command(scope, NATIVE_SSH_FORWARD_COMMANDS.setRuleEnabled, {
      connectionProfileId,
      expectedConnectionGeneration,
      ruleId,
      expectedRuleGeneration,
      enabled,
    });
  }

  listKeys(scope: NativeScopeRef): Promise<KeyInventory> {
    return this.command(
      scope,
      NATIVE_SSH_FORWARD_COMMANDS.listKeys,
      {},
      false,
      false,
    );
  }

  loadKey(
    scope: NativeScopeRef,
    profileId: string,
    keyId: string,
    passphrase: string,
    expectedGeneration?: WireCounter,
    rememberForDays: 0 | 30 = 0,
  ): Promise<SshForwardSnapshot> {
    return this.command(scope, NATIVE_SSH_FORWARD_COMMANDS.loadKey, {
      connectionProfileId: profileId,
      expectedGeneration:
        expectedGeneration ?? this.connectionGeneration(scope.scopeId, profileId),
      rememberForDays,
      keyId,
      passphrase,
    });
  }

  loadPassword(
    scope: NativeScopeRef,
    profileId: string,
    username: string,
    password: string,
    credentialAttemptId: string,
    expectedGeneration?: WireCounter,
    rememberForDays: 0 | 30 = 0,
  ): Promise<SshForwardSnapshot> {
    return this.command(scope, NATIVE_SSH_FORWARD_COMMANDS.loadPassword, {
      connectionProfileId: profileId,
      expectedGeneration:
        expectedGeneration ?? this.connectionGeneration(scope.scopeId, profileId),
      rememberForDays,
      username,
      password,
      credentialAttemptId,
    });
  }

  approveHost(
    scope: NativeScopeRef,
    profileId: string,
    expectedGeneration: WireCounter,
    challengeId: string,
    algorithm: string,
    fingerprintValue: string,
  ): Promise<SshForwardSnapshot> {
    return this.command(scope, NATIVE_SSH_FORWARD_COMMANDS.approveHost, {
      connectionProfileId: profileId,
      expectedGeneration,
      challengeId,
      algorithm,
      fingerprint: fingerprintValue,
      expectedTrustRevision: this.requireSnapshot(scope.scopeId).trustRevision,
    });
  }

  forgetCredential(
    scope: NativeScopeRef,
    connectionProfileId: string,
    expectedGeneration: WireCounter,
  ): Promise<SshForwardSnapshot> {
    return this.command(scope, NATIVE_SSH_FORWARD_COMMANDS.forgetCredential, {
      connectionProfileId,
      expectedGeneration,
    });
  }

  async purgeScope(
    scopeId: string,
    knownScopes: KnownScopesInput,
  ): Promise<{ scopeId: string; purged: boolean }> {
    if (!this.context || !uuid(scopeId)) throw IPC_UNAVAILABLE;
    const context = this.context,
      operation = ++this.operation;
    const result = await this.invoke<{ scopeId: string; purged: boolean }>(
      NATIVE_SSH_FORWARD_COMMANDS.purgeScope,
      { input: { context, scopeId, knownScopes } },
    );
    const raw = record(result);
    if (
      !raw ||
      !exactKeys(raw, ["scopeId", "purged"]) ||
      raw.scopeId !== scopeId ||
      typeof raw.purged !== "boolean" ||
      this.disposed ||
      operation !== this.operation ||
      !this.context ||
      !sameContext(this.context, context)
    )
      throw IPC_UNAVAILABLE;
    return result;
  }

  subscribe(listener: (event: SshForwardHostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      ++this.operation;
      for (const waiters of this.mutationWaiters.values()) {
        for (const resolve of waiters.splice(0)) resolve();
      }
      this.mutationWaiters.clear();
      this.unlisten?.();
      this.unlisten = null;
    }
  }

  private async command<T>(
    scope: NativeScopeRef,
    command: string,
    extra: Record<string, unknown>,
    mayReplaySnapshot = false,
    mutating = true,
    snapshotRequest?: number,
  ): Promise<T> {
    if (
      !this.context ||
      !sameContext(this.context, scope.context) ||
      !uuid(scope.scopeId) ||
      !counter(scope.scopeGeneration) ||
      !counter(scope.activationToken)
    )
      throw IPC_UNAVAILABLE;
    const context = scope.context,
      token = scope.activationToken,
      scopeId = scope.scopeId,
      scopeGeneration = scope.scopeGeneration,
      operation = mutating ? ++this.operation : this.operation;
    if (mutating) {
      this.mutationInFlight.set(
        scopeId,
        (this.mutationInFlight.get(scopeId) ?? 0) + 1,
      );
    }
    try {
      const result = await this.invoke<T>(command, {
        input: {
          context,
          activationToken: token,
          scopeId,
          scopeGeneration,
          ...extra,
        },
      });
      if (
        !this.validResult(result, context, token, scopeId, scopeGeneration) ||
        !this.isCurrent(context, token, scopeId, operation, scopeGeneration)
      )
        throw IPC_UNAVAILABLE;
      if (this.isSnapshot(result)) {
        this.acceptSnapshot(scopeId, result, snapshotRequest);
        const handle = this.scopes.get(scopeId);
        if (!handle) throw IPC_UNAVAILABLE;
        return handle.snapshot as T;
      }
      return result;
    } catch (error) {
      const parsed = parseSshForwardError(error);
      if (
        parsed?.code !== "MANAGER_SESSION_MISMATCH" ||
        !this.isCurrent(context, token, scopeId, operation, scopeGeneration)
      )
        throw error;
      if (mayReplaySnapshot)
        return this.command<T>(
          scope,
          command,
          extra,
          false,
          mutating,
          snapshotRequest,
        );
      throw parsed;
    } finally {
      if (mutating) this.finishMutation(scopeId);
    }
  }

  private waitForMutationsToSettle(scopeId: string): Promise<void> {
    if ((this.mutationInFlight.get(scopeId) ?? 0) === 0) return Promise.resolve();
    let waiters = this.mutationWaiters.get(scopeId);
    if (!waiters) {
      waiters = [];
      this.mutationWaiters.set(scopeId, waiters);
    }
    return new Promise((resolve) => waiters!.push(resolve));
  }

  private finishMutation(scopeId: string): void {
    const count = (this.mutationInFlight.get(scopeId) ?? 1) - 1;
    if (count <= 0) {
      this.mutationInFlight.delete(scopeId);
      const waiters = this.mutationWaiters.get(scopeId);
      if (waiters) {
        for (const resolve of waiters.splice(0)) resolve();
      }
      const handle = this.scopes.get(scopeId);
      if (handle) {
        this.flushTrailingSnapshot(handle.ref);
      }
    } else {
      this.mutationInFlight.set(scopeId, count);
    }
  }

  private isCurrent(
    context: DesktopClientContext,
    token: WireCounter,
    scopeId: string,
    operation: number,
    scopeGeneration?: WireCounter,
  ): boolean {
    const handle = this.scopes.get(scopeId);
    return (
      !this.disposed &&
      operation === this.operation &&
      this.context !== null &&
      sameContext(this.context, context) &&
      handle !== undefined &&
      handle.ref.activationToken === token &&
      handle.ref.scopeId === scopeId &&
      (scopeGeneration === undefined ||
        handle.ref.scopeGeneration === scopeGeneration)
    );
  }

  private validScopeHandle(
    value: unknown,
    context: DesktopClientContext,
    scopeId: string,
  ): value is ScopeHandle {
    const raw = record(value);
    if (!raw || !exactKeys(raw, ["ref", "snapshot"])) return false;
    const ref = record(raw.ref);
    if (
      !ref ||
      !exactKeys(ref, [
        "context",
        "scopeId",
        "scopeGeneration",
        "activationToken",
      ]) ||
      !validContext(ref.context) ||
      !sameContext(ref.context, context) ||
      ref.scopeId !== scopeId ||
      !counter(ref.scopeGeneration) ||
      !counter(ref.activationToken)
    )
      return false;
    return validSnapshot(
      raw.snapshot,
      context,
      ref.activationToken as WireCounter,
      scopeId,
      ref.scopeGeneration as WireCounter,
    );
  }

  private validResult(
    value: unknown,
    context: DesktopClientContext,
    token: WireCounter,
    scopeId: string,
    scopeGeneration: WireCounter,
  ): boolean {
    return (
      validSnapshot(value, context, token, scopeId, scopeGeneration) ||
      validKeys(value, context, scopeId, scopeGeneration)
    );
  }

  private requireSnapshot(scopeId: string): SshForwardSnapshot {
    const handle = this.scopes.get(scopeId);
    if (!handle) throw IPC_UNAVAILABLE;
    return handle.snapshot;
  }

  private connectionGeneration(
    scopeId: string,
    connectionProfileId: string,
    snapshot = this.requireSnapshot(scopeId),
  ): WireCounter {
    return (
      snapshot.connectionRuntimes.find(
        (runtime) => runtime.connectionProfileId === connectionProfileId,
      )?.generation ?? ("0" as WireCounter)
    );
  }

  private ruleGeneration(
    scopeId: string,
    ruleId: string,
    snapshot = this.requireSnapshot(scopeId),
  ): WireCounter {
    return (
      snapshot.ruleRuntimes.find((runtime) => runtime.ruleId === ruleId)
        ?.generation ?? ("0" as WireCounter)
    );
  }

  private isSnapshot(value: unknown): value is SshForwardSnapshot {
    const raw = record(value);
    return (
      raw !== null && "connectionsRevision" in raw && "rulesRevision" in raw
    );
  }

  private acceptSnapshot(
    scopeId: string,
    snapshot: SshForwardSnapshot | null,
    snapshotRequest?: number,
  ): void {
    if (!snapshot) {
      this.scopes.delete(scopeId);
      this.hintFreshness.delete(scopeId);
      return;
    }
    const lastAccepted = this.acceptedSnapshotRequest.get(scopeId) ?? 0;
    if (
      snapshotRequest !== undefined &&
      snapshotRequest < lastAccepted
    )
      return;
    if (snapshotRequest !== undefined)
      this.acceptedSnapshotRequest.set(scopeId, snapshotRequest);
    const normalised = this.normaliseSnapshot(snapshot);
    const existing = this.scopes.get(scopeId);
    if (existing) {
      existing.snapshot = normalised;
    }
    this.hintFreshness.set(scopeId, [
      normalised.scopeGeneration,
      normalised.connectionsRevision,
      normalised.rulesRevision,
      normalised.profilesRevision,
      normalised.trustRevision,
    ]);
  }

  private normaliseSnapshot(snapshot: SshForwardSnapshot): SshForwardSnapshot {
    return {
      ...snapshot,
      hostKeyChallenges: snapshot.hostKeyChallenges.map((challenge) => ({
        ...challenge,
        profileId: challenge.connectionProfileId,
      })),
    };
  }

  private async invoke<T>(
    command: string,
    input: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await invoke<T>(command, input);
    } catch (error) {
      throw parseSshForwardError(error) ?? IPC_UNAVAILABLE;
    }
  }

  private async installListener(): Promise<void> {
    if (!this.listening)
      this.listening = listen<SshForwardEventHint>(
        "ssh-forward:changed",
        (event) => this.handleHint(event.payload),
      ).then((unlisten) => {
        if (this.disposed) unlisten();
        else this.unlisten = unlisten;
      });
    return this.listening;
  }

  private handleHint(hint: SshForwardEventHint): void {
    const context = this.context,
      raw = record(hint);
    if (
      !context ||
      !raw ||
      !exactKeys(
        raw,
        [
          "desktopInstanceId",
          "managerSessionId",
          "clientEpoch",
          "activationToken",
          "scopeId",
          "scopeGeneration",
          "connectionsRevision",
          "rulesRevision",
          "profilesRevision",
          "trustRevision",
          "reason",
        ],
        [
          "profileId",
          "generation",
          "connectionProfileId",
          "connectionGeneration",
          "ruleId",
          "ruleGeneration",
        ],
      ) ||
      raw.desktopInstanceId !== context.desktopInstanceId ||
      raw.managerSessionId !== context.managerSessionId ||
      raw.clientEpoch !== context.clientEpoch ||
      typeof raw.scopeId !== "string" ||
      !counter(raw.activationToken) ||
      !counter(raw.scopeGeneration) ||
      !counter(raw.connectionsRevision) ||
      !counter(raw.rulesRevision) ||
      !counter(raw.profilesRevision) ||
      !counter(raw.trustRevision) ||
      (raw.profileId !== undefined && !uuid(raw.profileId)) ||
      (raw.generation !== undefined && !counter(raw.generation)) ||
      (raw.connectionProfileId !== undefined &&
        !uuid(raw.connectionProfileId)) ||
      (raw.ruleId !== undefined && !uuid(raw.ruleId)) ||
      (raw.connectionGeneration !== undefined &&
        !counter(raw.connectionGeneration)) ||
      (raw.ruleGeneration !== undefined && !counter(raw.ruleGeneration)) ||
      typeof raw.reason !== "string" ||
      !REASONS.has(raw.reason)
    )
      return;
    const handle = this.scopes.get(raw.scopeId);
    if (!handle) return;
    if (
      handle.ref.activationToken !== raw.activationToken ||
      handle.ref.scopeGeneration !== raw.scopeGeneration
    )
      return;

    const current = this.hintFreshness.get(raw.scopeId) ?? [
      handle.snapshot.scopeGeneration,
      handle.snapshot.connectionsRevision,
      handle.snapshot.rulesRevision,
      handle.snapshot.profilesRevision,
      handle.snapshot.trustRevision,
    ];
    const next: [
      WireCounter,
      WireCounter,
      WireCounter,
      WireCounter,
      WireCounter,
    ] = [
      raw.scopeGeneration,
      raw.connectionsRevision,
      raw.rulesRevision,
      raw.profilesRevision,
      raw.trustRevision,
    ];
    if (
      next.some(
        (value, index) =>
          wireCounterToBigInt(value) < wireCounterToBigInt(current[index]!),
      ) ||
      (raw.reason !== "runtimeChanged" &&
        !next.some(
          (value, index) =>
            wireCounterToBigInt(value) > wireCounterToBigInt(current[index]!),
        ))
    )
      return;
    this.requestHintSnapshot(handle.ref, hint);
  }

  private requestHintSnapshot(
    scope: NativeScopeRef,
    hint: SshForwardEventHint,
    retry = 0,
  ): void {
    const scopeId = scope.scopeId;
    if ((this.mutationInFlight.get(scopeId) ?? 0) > 0) {
      this.snapshotTrailing.set(scopeId, true);
      this.snapshotTrailingHint.set(scopeId, hint);
      return;
    }
    if (this.snapshotInFlight.get(scopeId)) {
      this.snapshotTrailing.set(scopeId, true);
      this.snapshotTrailingHint.set(scopeId, hint);
      return;
    }
    this.snapshotInFlight.set(scopeId, true);
    void this.snapshot(scope)
      .then((snapshot) => {
        for (const listener of this.listeners)
          listener({ type: "changed", hint, snapshot });
      })
      .catch(() => {
        if (
          !this.disposed &&
          retry < 1 &&
          !this.snapshotTrailing.get(scopeId)
        )
          queueMicrotask(() => this.requestHintSnapshot(scope, hint, retry + 1));
      })
      .finally(() => {
        this.snapshotInFlight.set(scopeId, false);
        this.flushTrailingSnapshot(scope, hint);
      });
  }

  private flushTrailingSnapshot(
    scope: NativeScopeRef,
    fallbackHint?: SshForwardEventHint,
  ): void {
    const scopeId = scope.scopeId;
    if (
      !this.snapshotTrailing.get(scopeId) ||
      this.snapshotInFlight.get(scopeId) ||
      (this.mutationInFlight.get(scopeId) ?? 0) > 0
    )
      return;
    const nextHint = this.snapshotTrailingHint.get(scopeId) ?? fallbackHint;
    this.snapshotTrailing.set(scopeId, false);
    this.snapshotTrailingHint.set(scopeId, null);
    if (nextHint && this.shouldRefreshHint(scopeId, nextHint))
      this.requestHintSnapshot(scope, nextHint);
  }

  private shouldRefreshHint(scopeId: string, hint: SshForwardEventHint): boolean {
    const handle = this.scopes.get(scopeId);
    if (!handle) return true;
    const current = this.hintFreshness.get(scopeId) ?? [
      handle.snapshot.scopeGeneration,
      handle.snapshot.connectionsRevision,
      handle.snapshot.rulesRevision,
      handle.snapshot.profilesRevision,
      handle.snapshot.trustRevision,
    ];
    const next = [
      hint.scopeGeneration,
      hint.connectionsRevision,
      hint.rulesRevision,
      hint.profilesRevision,
      hint.trustRevision,
    ];
    if (
      next.some(
        (value, index) =>
          wireCounterToBigInt(value) < wireCounterToBigInt(current[index]!),
      )
    )
      return false;
    return (
      hint.reason === "runtimeChanged" ||
      next.some(
        (value, index) =>
          wireCounterToBigInt(value) > wireCounterToBigInt(current[index]!),
      )
    );
  }
}
/** SSH forwarding native capability has currently shipped only on Windows. */
export function createNativeSshForwardHost(
  platform: string,
  enabled = true,
): NativeSshForwardHost | null {
  return enabled && platform === "windows" ? new NativeSshForwardHost() : null;
}
