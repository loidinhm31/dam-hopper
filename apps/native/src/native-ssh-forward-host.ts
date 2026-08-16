import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  incrementWireCounter,
  parseSshForwardError,
  parseUtcTimestamp,
  parseWireCounter,
  wireCounterToBigInt,
  type DesktopClientContext,
  type KeyInventory,
  type KnownScopesInput,
  type OpenClientResult,
  type ScopeActivation,
  type SshForwardError,
  type SshForwardEventHint,
  type SshForwardHost,
  type SshForwardHostEvent,
  type SshForwardProfile,
  type SshForwardSnapshot,
  type SshForwardTrustRepairMetadata,
  type WireCounter,
} from "@dam-hopper/ui/lib/ssh-forward-host";

export const NATIVE_SSH_FORWARD_COMMANDS = {
  openClient: "ssh_forward_open_client",
  activateScope: "ssh_forward_activate_scope",
  snapshot: "ssh_forward_snapshot",
  createProfile: "ssh_forward_create_profile",
  updateProfile: "ssh_forward_update_profile",
  deleteProfile: "ssh_forward_delete_profile",
  start: "ssh_forward_start",
  stop: "ssh_forward_stop",
  restart: "ssh_forward_restart",
  listKeys: "ssh_forward_list_keys",
  loadKey: "ssh_forward_load_key",
  loadPassword: "ssh_forward_load_password",
  approveHost: "ssh_forward_approve_host",
  purgeScope: "ssh_forward_purge_scope",
} as const satisfies Record<
  Exclude<keyof SshForwardHost, "subscribe" | "dispose">,
  string
>;

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
const REASONS = new Set(["profilesChanged", "runtimeChanged", "trustChanged"]);
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
        "profilesRevision",
        "trustRevision",
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
    !counter(raw.profilesRevision) ||
    !counter(raw.trustRevision) ||
    !Array.isArray(raw.profiles) ||
    !Array.isArray(raw.runtimes) ||
    !Array.isArray(raw.hostKeyChallenges) ||
    !raw.profiles.every(validProfile) ||
    (raw.trustRepair !== undefined && !validTrustRepair(raw.trustRepair))
  )
    return false;
  return (
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
          "profileId",
          "scopeId",
          "generation",
          "sshHost",
          "sshPort",
          "algorithm",
          "fingerprint",
          "expiresAt",
        ]) &&
        uuid(item.challengeId) &&
        uuid(item.profileId) &&
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
  private activationToken: WireCounter | null = null;
  private scopeId: string | null = null;
  private scopeGeneration: WireCounter | null = null;
  private snapshotState: SshForwardSnapshot | null = null;
  private hintFreshness: [WireCounter, WireCounter, WireCounter] | null = null;
  private knownScopes: KnownScopesInput = { status: "unavailable" };
  private operation = 0;
  private mutationInFlight = 0;
  private mutationWaiters: Array<() => void> = [];
  private reopening = false;
  private snapshotInFlight = false;
  private snapshotTrailing = false;
  private snapshotTrailingHint: SshForwardEventHint | null = null;
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
      !exactKeys(raw, [
        "context",
        "activationTokenFloor",
        "activeScopeId",
        "scopeGeneration",
      ]) ||
      !validContext(raw.context) ||
      !counter(raw.activationTokenFloor) ||
      !counter(raw.scopeGeneration) ||
      (raw.activeScopeId !== null && !uuid(raw.activeScopeId)) ||
      this.disposed ||
      operation !== this.operation
    )
      throw IPC_UNAVAILABLE;
    this.context = raw.context;
    this.activationToken = raw.activationTokenFloor;
    this.scopeId = raw.activeScopeId;
    this.scopeGeneration = raw.scopeGeneration;
    this.snapshotState = null;
    this.hintFreshness = null;
    return result;
  }
  async activateScope(scopeId: string | null): Promise<ScopeActivation> {
    if (
      !this.context ||
      !this.activationToken ||
      (scopeId !== null && !uuid(scopeId))
    )
      throw IPC_UNAVAILABLE;
    const token = incrementWireCounter(this.activationToken);
    if (!token)
      throw { ...IPC_UNAVAILABLE, code: "COUNTER_EXHAUSTED" as const };
    const operation = ++this.operation,
      context = this.context;
    this.activationToken = token;
    this.scopeId = scopeId;
    this.snapshotState = null;
    const result = await this.invoke<ScopeActivation>(
      NATIVE_SSH_FORWARD_COMMANDS.activateScope,
      { input: { context, activationToken: token, scopeId } },
    );
    if (!this.validActivation(result, context, token, scopeId))
      throw IPC_UNAVAILABLE;
    if (!this.isCurrent(context, token, scopeId, operation))
      throw {
        ...IPC_UNAVAILABLE,
        code: "ACTIVATION_SUPERSEDED" as const,
        message: "Activation was superseded by a newer scope request.",
        retryable: true,
      };
    this.scopeGeneration = result.scopeGeneration;
    this.acceptSnapshot(result.snapshot);
    return result;
  }
  async snapshot(): Promise<SshForwardSnapshot> {
    await this.waitForMutationsToSettle();
    return this.command(NATIVE_SSH_FORWARD_COMMANDS.snapshot, {}, true, false);
  }
  createProfile(profile: SshForwardProfile): Promise<SshForwardSnapshot> {
    return this.command(NATIVE_SSH_FORWARD_COMMANDS.createProfile, {
      profile,
      expectedProfilesRevision: this.requireSnapshot().profilesRevision,
    });
  }
  updateProfile(
    profileId: string,
    expectedGeneration: WireCounter,
    profile: SshForwardProfile,
  ): Promise<SshForwardSnapshot> {
    return this.command(NATIVE_SSH_FORWARD_COMMANDS.updateProfile, {
      profileId,
      expectedGeneration,
      profile,
      expectedProfilesRevision: this.requireSnapshot().profilesRevision,
    });
  }
  deleteProfile(
    profileId: string,
    expectedGeneration: WireCounter,
  ): Promise<SshForwardSnapshot> {
    return this.command(NATIVE_SSH_FORWARD_COMMANDS.deleteProfile, {
      profileId,
      expectedGeneration,
      expectedProfilesRevision: this.requireSnapshot().profilesRevision,
    });
  }
  start(
    profileId: string,
    expectedGeneration: WireCounter,
    credentialAttemptId?: string,
  ): Promise<SshForwardSnapshot> {
    return this.command(NATIVE_SSH_FORWARD_COMMANDS.start, {
      profileId,
      expectedGeneration,
      ...(credentialAttemptId ? { credentialAttemptId } : {}),
    });
  }
  stop(
    profileId: string,
    expectedGeneration: WireCounter,
  ): Promise<SshForwardSnapshot> {
    return this.command(NATIVE_SSH_FORWARD_COMMANDS.stop, {
      profileId,
      expectedGeneration,
    });
  }
  restart(
    profileId: string,
    expectedGeneration: WireCounter,
    credentialAttemptId?: string,
  ): Promise<SshForwardSnapshot> {
    return this.command(NATIVE_SSH_FORWARD_COMMANDS.restart, {
      profileId,
      expectedGeneration,
      ...(credentialAttemptId ? { credentialAttemptId } : {}),
    });
  }
  listKeys(): Promise<KeyInventory> {
    return this.command(NATIVE_SSH_FORWARD_COMMANDS.listKeys, {}, false, false);
  }
  loadKey(
    profileId: string,
    keyId: string,
    passphrase: string,
  ): Promise<SshForwardSnapshot> {
    return this.command(NATIVE_SSH_FORWARD_COMMANDS.loadKey, {
      profileId,
      keyId,
      passphrase,
    });
  }
  loadPassword(
    profileId: string,
    username: string,
    password: string,
    credentialAttemptId: string,
  ): Promise<SshForwardSnapshot> {
    return this.command(NATIVE_SSH_FORWARD_COMMANDS.loadPassword, {
      profileId,
      username,
      password,
      credentialAttemptId,
    });
  }
  approveHost(
    profileId: string,
    expectedGeneration: WireCounter,
    challengeId: string,
    algorithm: string,
    fingerprintValue: string,
  ): Promise<SshForwardSnapshot> {
    return this.command(NATIVE_SSH_FORWARD_COMMANDS.approveHost, {
      profileId,
      expectedGeneration,
      challengeId,
      algorithm,
      fingerprint: fingerprintValue,
      expectedTrustRevision: this.requireSnapshot().trustRevision,
    });
  }
  async purgeScope(
    scopeId: string,
    knownScopes: KnownScopesInput,
  ): Promise<{ scopeId: string; purged: boolean }> {
    if (!this.context || !this.activationToken || !uuid(scopeId))
      throw IPC_UNAVAILABLE;
    const context = this.context,
      token = this.activationToken,
      operation = ++this.operation;
    const result = await this.invoke<{ scopeId: string; purged: boolean }>(
      NATIVE_SSH_FORWARD_COMMANDS.purgeScope,
      { input: { context, activationToken: token, scopeId, knownScopes } },
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
      !sameContext(this.context, context) ||
      this.activationToken !== token
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
      for (const resolve of this.mutationWaiters.splice(0)) resolve();
      this.unlisten?.();
      this.unlisten = null;
    }
  }

  private async command<T>(
    command: string,
    extra: Record<string, unknown>,
    mayReplaySnapshot = false,
    mutating = true,
  ): Promise<T> {
    if (
      !this.context ||
      !this.activationToken ||
      !this.scopeId ||
      !this.scopeGeneration
    )
      throw IPC_UNAVAILABLE;
    const context = this.context,
      token = this.activationToken,
      scopeId = this.scopeId,
      scopeGeneration = this.scopeGeneration,
      operation = mutating ? ++this.operation : this.operation;
    if (mutating) this.mutationInFlight += 1;
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
      if (this.isSnapshot(result)) this.acceptSnapshot(result);
      return result;
    } catch (error) {
      const parsed = parseSshForwardError(error);
      if (
        parsed?.code !== "MANAGER_SESSION_MISMATCH" ||
        this.reopening ||
        !this.isCurrent(context, token, scopeId, operation, scopeGeneration)
      )
        throw error;
      try {
        await this.rehydrateAfterRestart(scopeId);
      } catch {
        /* Preserve the original restart signal when rehydration is unavailable. */
      }
      if (mayReplaySnapshot)
        return this.command<T>(command, extra, false, mutating);
      throw parsed;
    } finally {
      if (mutating) this.finishMutation();
    }
  }
  private waitForMutationsToSettle(): Promise<void> {
    if (this.mutationInFlight === 0) return Promise.resolve();
    return new Promise((resolve) => this.mutationWaiters.push(resolve));
  }
  private finishMutation(): void {
    this.mutationInFlight -= 1;
    if (this.mutationInFlight > 0) return;
    for (const resolve of this.mutationWaiters.splice(0)) resolve();
    this.flushTrailingSnapshot();
  }
  private async rehydrateAfterRestart(scopeId: string): Promise<void> {
    this.reopening = true;
    try {
      await this.openClient(this.knownScopes);
      await this.activateScope(scopeId);
      if (this.scopeId && this.scopeGeneration) {
        try {
          await this.command<SshForwardSnapshot>(
            NATIVE_SSH_FORWARD_COMMANDS.snapshot,
            {},
            false,
            false,
          );
        } catch {
          /* State refresh is best-effort; the mutation still reports its original mismatch. */
        }
      }
    } finally {
      this.reopening = false;
    }
  }
  private isCurrent(
    context: DesktopClientContext,
    token: WireCounter,
    scopeId: string | null,
    operation: number,
    scopeGeneration?: WireCounter,
  ): boolean {
    return (
      !this.disposed &&
      operation === this.operation &&
      this.context !== null &&
      sameContext(this.context, context) &&
      this.activationToken === token &&
      this.scopeId === scopeId &&
      (scopeGeneration === undefined ||
        this.scopeGeneration === scopeGeneration)
    );
  }
  private validActivation(
    value: unknown,
    context: DesktopClientContext,
    token: WireCounter,
    scopeId: string | null,
  ): value is ScopeActivation {
    const raw = record(value);
    return (
      !!raw &&
      exactKeys(raw, [
        "context",
        "activationToken",
        "scopeId",
        "scopeGeneration",
        "snapshot",
      ]) &&
      validContext(raw.context) &&
      sameContext(raw.context, context) &&
      raw.activationToken === token &&
      raw.scopeId === scopeId &&
      counter(raw.scopeGeneration) &&
      (raw.snapshot === null ||
        (scopeId !== null &&
          validSnapshot(
            raw.snapshot,
            context,
            token,
            scopeId,
            raw.scopeGeneration,
          )))
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
  private requireSnapshot(): SshForwardSnapshot {
    if (!this.snapshotState) throw IPC_UNAVAILABLE;
    return this.snapshotState;
  }
  private isSnapshot(value: unknown): value is SshForwardSnapshot {
    const raw = record(value);
    return raw !== null && "profilesRevision" in raw && "trustRevision" in raw;
  }
  private acceptSnapshot(snapshot: SshForwardSnapshot | null): void {
    this.snapshotState = snapshot;
    if (snapshot)
      this.hintFreshness = [
        snapshot.scopeGeneration,
        snapshot.profilesRevision,
        snapshot.trustRevision,
      ];
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
      snapshot = this.snapshotState,
      raw = record(hint);
    if (
      !context ||
      !snapshot ||
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
          "profilesRevision",
          "trustRevision",
          "reason",
        ],
        ["profileId", "generation"],
      ) ||
      raw.desktopInstanceId !== context.desktopInstanceId ||
      raw.managerSessionId !== context.managerSessionId ||
      raw.clientEpoch !== context.clientEpoch ||
      raw.activationToken !== this.activationToken ||
      raw.scopeId !== this.scopeId ||
      !counter(raw.scopeGeneration) ||
      !counter(raw.profilesRevision) ||
      !counter(raw.trustRevision) ||
      (raw.profileId !== undefined && !uuid(raw.profileId)) ||
      (raw.generation !== undefined && !counter(raw.generation)) ||
      typeof raw.reason !== "string" ||
      !REASONS.has(raw.reason)
    )
      return;
    const current: [WireCounter, WireCounter, WireCounter] = this
        .hintFreshness ?? [
        snapshot.scopeGeneration,
        snapshot.profilesRevision,
        snapshot.trustRevision,
      ],
      next: [WireCounter, WireCounter, WireCounter] = [
        raw.scopeGeneration,
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
    if (
      next.some(
        (value, index) =>
          wireCounterToBigInt(value) > wireCounterToBigInt(current[index]!),
      )
    )
      this.hintFreshness = next;
    this.requestHintSnapshot(hint);
  }
  private requestHintSnapshot(hint: SshForwardEventHint): void {
    if (this.mutationInFlight > 0) {
      this.snapshotTrailing = true;
      this.snapshotTrailingHint = hint;
      return;
    }
    if (this.snapshotInFlight) {
      this.snapshotTrailing = true;
      this.snapshotTrailingHint = hint;
      return;
    }
    this.snapshotInFlight = true;
    void this.snapshot()
      .then((snapshot) => {
        for (const listener of this.listeners)
          listener({ type: "changed", hint, snapshot });
      })
      .catch(() => {})
      .finally(() => {
        this.snapshotInFlight = false;
        this.flushTrailingSnapshot(hint);
      });
  }
  private flushTrailingSnapshot(fallbackHint?: SshForwardEventHint): void {
    if (
      !this.snapshotTrailing ||
      this.snapshotInFlight ||
      this.mutationInFlight > 0
    )
      return;
    const nextHint = this.snapshotTrailingHint ?? fallbackHint;
    this.snapshotTrailing = false;
    this.snapshotTrailingHint = null;
    if (nextHint) this.requestHintSnapshot(nextHint);
  }
}
/** SSH forwarding native capability has currently shipped only on Windows. */
export function createNativeSshForwardHost(
  platform: string,
  enabled = true,
): NativeSshForwardHost | null {
  return enabled && platform === "windows" ? new NativeSshForwardHost() : null;
}
