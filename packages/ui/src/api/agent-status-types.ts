/**
 * Public types and strict decoders for agent status reporting.
 * Mirrors the canonical v1 server contract defined in server/src/agent_status/types.rs.
 */

export const AGENT_STATUS_PROTOCOL_VERSION = 1;
export const MAX_SAFE_INTEGER = 9_007_199_254_740_991; // 2^53 - 1
export const MAX_IDENTIFIER_LEN = 128;

export type AgentKind = "omp" | "codex" | "claude";
export type AgentObservationSource = "lifecycle" | "hook";

export type AgentState = "unknown" | "idle" | "working" | "blocked";

export type BlockedReason = "approval" | "question" | "error";

export type TurnOutcome = "ended" | "interrupted" | "error" | "unknown";

export type AttentionKind = "turn-ended" | "needs-attention";

export type AgentStatusAvailability =
  | "ready"
  | "unavailable"
  | "platform-unqualified";

export interface TerminalAgentStatusRow {
  readonly id: string;
  readonly incarnation: number;
  readonly agentKind: AgentKind;
  readonly agentSessionId: string;
  readonly reporterEpoch: number;
  readonly state: AgentState;
  readonly source: AgentObservationSource;
  readonly observedAtMs?: number;
  readonly expiresAtMs?: number;
  readonly reason?: BlockedReason;
  readonly turnId?: string;
  readonly attentionRevision: number;
  readonly lastOutcome?: TurnOutcome;
}

export interface AgentAttentionEvent {
  readonly id: string;
  readonly kind: AttentionKind;
  readonly terminalId: string;
  readonly incarnation: number;
  readonly agentKind: AgentKind;
  readonly agentSessionId: string;
  readonly turnId?: string;
  readonly reason?: BlockedReason;
  readonly outcome?: TurnOutcome;
  readonly attentionRevision: number;
  readonly timestampMs: number;
}

export interface AgentStatusSnapshotV1 {
  readonly version: number;
  readonly serverEpoch: number;
  readonly revision: number;
  readonly availability: AgentStatusAvailability;
  readonly terminals: readonly TerminalAgentStatusRow[];
}

export interface AgentStatusChangedPayload {
  readonly serverEpoch: number;
  readonly revision: number;
  readonly row: TerminalAgentStatusRow;
  readonly attention?: AgentAttentionEvent;
}

export interface AgentStatusRemovedPayload {
  readonly serverEpoch: number;
  readonly revision: number;
  readonly terminalId: string;
  readonly incarnation: number;
}

export interface AgentStatusInvalidatedPayload {
  readonly serverEpoch: number;
  readonly revision: number;
}

// ── Validation Helpers ────────────────────────────────────────────────────────

function isSafeNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_SAFE_INTEGER
  );
}

function isBoundedString(
  value: unknown,
  maxLen = MAX_IDENTIFIER_LEN,
): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maxLen
  );
}

function isAgentKind(value: unknown): value is AgentKind {
  return value === "omp" || value === "codex" || value === "claude";
}

function isAgentState(value: unknown): value is AgentState {
  return (
    value === "unknown" ||
    value === "idle" ||
    value === "working" ||
    value === "blocked"
  );
}

function isBlockedReason(value: unknown): value is BlockedReason {
  return value === "approval" || value === "question" || value === "error";
}

function isTurnOutcome(value: unknown): value is TurnOutcome {
  return (
    value === "ended" ||
    value === "interrupted" ||
    value === "error" ||
    value === "unknown"
  );
}

function isAttentionKind(value: unknown): value is AttentionKind {
  return value === "turn-ended" || value === "needs-attention";
}

function isAgentStatusAvailability(
  value: unknown,
): value is AgentStatusAvailability {
  return (
    value === "ready" ||
    value === "unavailable" ||
    value === "platform-unqualified"
  );
}

// ── Decoders ─────────────────────────────────────────────────────────────────

export function decodeTerminalAgentStatusRow(
  input: unknown,
): TerminalAgentStatusRow {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid terminal agent status row: expected object");
  }
  const obj = input as Record<string, unknown>;

  if (!isBoundedString(obj.id)) {
    throw new Error(
      "Invalid terminal agent status row: missing or invalid 'id'",
    );
  }
  if (!isSafeNonNegativeInteger(obj.incarnation)) {
    throw new Error(
      "Invalid terminal agent status row: missing or invalid 'incarnation'",
    );
  }
  if (!isAgentKind(obj.agentKind)) {
    throw new Error(
      "Invalid terminal agent status row: missing or invalid 'agentKind'",
    );
  }
  if (!isBoundedString(obj.agentSessionId)) {
    throw new Error(
      "Invalid terminal agent status row: missing or invalid 'agentSessionId'",
    );
  }
  if (!isSafeNonNegativeInteger(obj.reporterEpoch)) {
    throw new Error(
      "Invalid terminal agent status row: missing or invalid 'reporterEpoch'",
    );
  }
  if (!isAgentState(obj.state)) {
    throw new Error(
      "Invalid terminal agent status row: missing or invalid 'state'",
    );
  }
  if (!isSafeNonNegativeInteger(obj.attentionRevision)) {
    throw new Error(
      "Invalid terminal agent status row: missing or invalid 'attentionRevision'",
    );
  }
  const source =
    obj.source === undefined && obj.agentKind === "omp"
      ? "lifecycle"
      : obj.source;
  if (source !== "lifecycle" && source !== "hook") {
    throw new Error("Invalid terminal agent status row: invalid 'source'");
  }
  if ((obj.agentKind === "omp") !== (source === "lifecycle")) {
    throw new Error(
      "Invalid terminal agent status row: source does not match agent",
    );
  }
  const observedAtMs = obj.observedAtMs;
  const expiresAtMs = obj.expiresAtMs;
  if (observedAtMs !== undefined && !isSafeNonNegativeInteger(observedAtMs)) {
    throw new Error(
      "Invalid terminal agent status row: invalid 'observedAtMs'",
    );
  }
  if (expiresAtMs !== undefined && !isSafeNonNegativeInteger(expiresAtMs)) {
    throw new Error("Invalid terminal agent status row: invalid 'expiresAtMs'");
  }
  if (
    source === "hook" &&
    ((obj.state !== "unknown" &&
      (observedAtMs === undefined || expiresAtMs === undefined)) ||
      (obj.state === "unknown" && expiresAtMs !== undefined) ||
      (expiresAtMs !== undefined &&
        (observedAtMs === undefined || expiresAtMs <= observedAtMs)))
  ) {
    throw new Error(
      "Invalid terminal agent status row: invalid hook freshness",
    );
  }
  if (source === "lifecycle" && expiresAtMs !== undefined) {
    throw new Error(
      "Invalid terminal agent status row: lifecycle cannot expire",
    );
  }

  let reason: BlockedReason | undefined;
  if (obj.reason !== undefined && obj.reason !== null) {
    if (!isBlockedReason(obj.reason)) {
      throw new Error("Invalid terminal agent status row: invalid 'reason'");
    }
    reason = obj.reason;
  }
  if (obj.state === "blocked" && !reason) {
    throw new Error(
      "Invalid terminal agent status row: 'reason' is required when state is 'blocked'",
    );
  }
  if (obj.state !== "blocked" && reason !== undefined) {
    throw new Error(
      "Invalid terminal agent status row: 'reason' is only allowed when state is 'blocked'",
    );
  }

  let turnId: string | undefined;
  if (obj.turnId !== undefined && obj.turnId !== null) {
    if (!isBoundedString(obj.turnId)) {
      throw new Error("Invalid terminal agent status row: invalid 'turnId'");
    }
    turnId = obj.turnId;
  }

  let lastOutcome: TurnOutcome | undefined;
  if (obj.lastOutcome !== undefined && obj.lastOutcome !== null) {
    if (!isTurnOutcome(obj.lastOutcome)) {
      throw new Error(
        "Invalid terminal agent status row: invalid 'lastOutcome'",
      );
    }
    lastOutcome = obj.lastOutcome;
  }

  return {
    id: obj.id,
    incarnation: obj.incarnation,
    agentKind: obj.agentKind,
    agentSessionId: obj.agentSessionId,
    reporterEpoch: obj.reporterEpoch,
    state: obj.state,
    source,
    observedAtMs,
    expiresAtMs,
    reason,
    turnId,
    attentionRevision: obj.attentionRevision,
    lastOutcome,
  };
}

export function decodeAgentAttentionEvent(input: unknown): AgentAttentionEvent {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid agent attention event: expected object");
  }
  const obj = input as Record<string, unknown>;

  if (!isBoundedString(obj.id, 256)) {
    throw new Error("Invalid agent attention event: missing or invalid 'id'");
  }
  if (!isAttentionKind(obj.kind)) {
    throw new Error("Invalid agent attention event: missing or invalid 'kind'");
  }
  if (!isBoundedString(obj.terminalId)) {
    throw new Error(
      "Invalid agent attention event: missing or invalid 'terminalId'",
    );
  }
  if (!isSafeNonNegativeInteger(obj.incarnation)) {
    throw new Error(
      "Invalid agent attention event: missing or invalid 'incarnation'",
    );
  }
  if (!isAgentKind(obj.agentKind)) {
    throw new Error(
      "Invalid agent attention event: missing or invalid 'agentKind'",
    );
  }
  if (obj.kind === "turn-ended" && obj.agentKind !== "omp") {
    throw new Error(
      "Invalid agent attention event: native Stop is not completion",
    );
  }
  if (!isBoundedString(obj.agentSessionId)) {
    throw new Error(
      "Invalid agent attention event: missing or invalid 'agentSessionId'",
    );
  }
  if (!isSafeNonNegativeInteger(obj.attentionRevision)) {
    throw new Error(
      "Invalid agent attention event: missing or invalid 'attentionRevision'",
    );
  }
  if (!isSafeNonNegativeInteger(obj.timestampMs)) {
    throw new Error(
      "Invalid agent attention event: missing or invalid 'timestampMs'",
    );
  }

  let turnId: string | undefined;
  if (obj.turnId !== undefined && obj.turnId !== null) {
    if (!isBoundedString(obj.turnId)) {
      throw new Error("Invalid agent attention event: invalid 'turnId'");
    }
    turnId = obj.turnId;
  }

  let reason: BlockedReason | undefined;
  if (obj.reason !== undefined && obj.reason !== null) {
    if (!isBlockedReason(obj.reason)) {
      throw new Error("Invalid agent attention event: invalid 'reason'");
    }
    reason = obj.reason;
  }

  let outcome: TurnOutcome | undefined;
  if (obj.outcome !== undefined && obj.outcome !== null) {
    if (!isTurnOutcome(obj.outcome)) {
      throw new Error("Invalid agent attention event: invalid 'outcome'");
    }
    outcome = obj.outcome;
  }

  return {
    id: obj.id,
    kind: obj.kind,
    terminalId: obj.terminalId,
    incarnation: obj.incarnation,
    agentKind: obj.agentKind,
    agentSessionId: obj.agentSessionId,
    turnId,
    reason,
    outcome,
    attentionRevision: obj.attentionRevision,
    timestampMs: obj.timestampMs,
  };
}

export function decodeAgentStatusSnapshot(
  input: unknown,
): AgentStatusSnapshotV1 {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid agent status snapshot: expected object");
  }
  const obj = input as Record<string, unknown>;

  if (obj.version !== AGENT_STATUS_PROTOCOL_VERSION) {
    throw new Error(
      `Unsupported agent status version: expected ${AGENT_STATUS_PROTOCOL_VERSION}, got ${String(obj.version)}`,
    );
  }
  if (!isSafeNonNegativeInteger(obj.serverEpoch)) {
    throw new Error(
      "Invalid agent status snapshot: missing or invalid 'serverEpoch'",
    );
  }
  if (!isSafeNonNegativeInteger(obj.revision)) {
    throw new Error(
      "Invalid agent status snapshot: missing or invalid 'revision'",
    );
  }
  if (!isAgentStatusAvailability(obj.availability)) {
    throw new Error(
      "Invalid agent status snapshot: missing or invalid 'availability'",
    );
  }
  if (!Array.isArray(obj.terminals)) {
    throw new Error(
      "Invalid agent status snapshot: 'terminals' must be an array",
    );
  }

  const terminals = obj.terminals.map((item) =>
    decodeTerminalAgentStatusRow(item),
  );

  return {
    version: obj.version,
    serverEpoch: obj.serverEpoch,
    revision: obj.revision,
    availability: obj.availability,
    terminals,
  };
}

export function decodeAgentStatusChangedPayload(
  input: unknown,
): AgentStatusChangedPayload {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid agent status changed payload: expected object");
  }
  const obj = input as Record<string, unknown>;

  if (!isSafeNonNegativeInteger(obj.serverEpoch)) {
    throw new Error(
      "Invalid agent status changed payload: missing or invalid 'serverEpoch'",
    );
  }
  if (!isSafeNonNegativeInteger(obj.revision)) {
    throw new Error(
      "Invalid agent status changed payload: missing or invalid 'revision'",
    );
  }

  const row = decodeTerminalAgentStatusRow(obj.row);

  let attention: AgentAttentionEvent | undefined;
  if (obj.attention !== undefined && obj.attention !== null) {
    attention = decodeAgentAttentionEvent(obj.attention);
    if (
      attention.terminalId !== row.id ||
      attention.incarnation !== row.incarnation ||
      attention.agentKind !== row.agentKind ||
      attention.agentSessionId !== row.agentSessionId ||
      attention.attentionRevision !== row.attentionRevision ||
      attention.id !==
        `${obj.serverEpoch}:${row.id}:${row.incarnation}:${attention.attentionRevision}` ||
      (attention.kind === "turn-ended" &&
        (attention.outcome !== "ended" || row.state !== "idle")) ||
      (attention.kind === "needs-attention" &&
        (attention.reason === undefined || row.state !== "blocked"))
    ) {
      throw new Error(
        "Invalid agent status changed payload: inconsistent attention",
      );
    }
  }

  return {
    serverEpoch: obj.serverEpoch,
    revision: obj.revision,
    row,
    attention,
  };
}

export function decodeAgentStatusRemovedPayload(
  input: unknown,
): AgentStatusRemovedPayload {
  if (typeof input !== "object" || input === null) {
    throw new Error("Invalid agent status removed payload: expected object");
  }
  const obj = input as Record<string, unknown>;

  if (!isSafeNonNegativeInteger(obj.serverEpoch)) {
    throw new Error(
      "Invalid agent status removed payload: missing or invalid 'serverEpoch'",
    );
  }
  if (!isSafeNonNegativeInteger(obj.revision)) {
    throw new Error(
      "Invalid agent status removed payload: missing or invalid 'revision'",
    );
  }
  if (!isBoundedString(obj.terminalId)) {
    throw new Error(
      "Invalid agent status removed payload: missing or invalid 'terminalId'",
    );
  }
  if (!isSafeNonNegativeInteger(obj.incarnation)) {
    throw new Error(
      "Invalid agent status removed payload: missing or invalid 'incarnation'",
    );
  }

  return {
    serverEpoch: obj.serverEpoch,
    revision: obj.revision,
    terminalId: obj.terminalId,
    incarnation: obj.incarnation,
  };
}

export function decodeAgentStatusInvalidatedPayload(
  input: unknown,
): AgentStatusInvalidatedPayload {
  if (typeof input !== "object" || input === null) {
    throw new Error(
      "Invalid agent status invalidated payload: expected object",
    );
  }
  const obj = input as Record<string, unknown>;

  if (!isSafeNonNegativeInteger(obj.serverEpoch)) {
    throw new Error(
      "Invalid agent status invalidated payload: missing or invalid 'serverEpoch'",
    );
  }
  if (!isSafeNonNegativeInteger(obj.revision)) {
    throw new Error(
      "Invalid agent status invalidated payload: missing or invalid 'revision'",
    );
  }

  return {
    serverEpoch: obj.serverEpoch,
    revision: obj.revision,
  };
}

export type ManagedExtensionStatus =
  | "absent"
  | "current"
  | "outdated"
  | "modified";

export interface ExtensionStatusReport {
  status: ManagedExtensionStatus;
  targetPath: string;
  version: string | null;
  bundledVersion: string;
  contentHash: string | null;
  bundledHash: string;
}

export function decodeExtensionStatusReport(
  input: unknown,
): ExtensionStatusReport {
  if (typeof input !== "object" || input === null) {
    throw new Error("ExtensionStatusReport must be an object");
  }
  const obj = input as Record<string, unknown>;
  const status = obj.status;
  if (
    status !== "absent" &&
    status !== "current" &&
    status !== "outdated" &&
    status !== "modified"
  ) {
    throw new Error(`Invalid extension status: ${String(status)}`);
  }
  return {
    status,
    targetPath: String(obj.targetPath ?? obj.target_path ?? ""),
    version: obj.version != null ? String(obj.version) : null,
    bundledVersion: String(
      obj.bundledVersion ?? obj.bundled_version ?? "1.0.0",
    ),
    contentHash:
      obj.contentHash != null
        ? String(obj.contentHash)
        : obj.content_hash != null
          ? String(obj.content_hash)
          : null,
    bundledHash: String(obj.bundledHash ?? obj.bundled_hash ?? ""),
  };
}

export interface AgentPathsVerification {
  effectiveHome: string;
  ompInstallDir: string;
  ompNotificationDir: string;
  ompStatus: ManagedExtensionStatus;
  ompCanEnable: boolean;
  ompReason?: string;
  codexConfigDir: string;
  codexNotificationDir: string;
  codexConfigExists: boolean;
  codexCanEnable: boolean;
  codexReason?: string;
}

export function decodeAgentPathsVerification(
  input: unknown,
): AgentPathsVerification {
  if (typeof input !== "object" || input === null) {
    throw new Error("AgentPathsVerification must be an object");
  }
  const obj = input as Record<string, unknown>;
  const rawOmpStatus = String(obj.ompStatus ?? obj.omp_status ?? "absent");
  const ompStatus: ManagedExtensionStatus =
    rawOmpStatus === "current" ||
    rawOmpStatus === "outdated" ||
    rawOmpStatus === "modified"
      ? rawOmpStatus
      : "absent";

  return {
    effectiveHome: String(obj.effectiveHome ?? obj.effective_home ?? ""),
    ompInstallDir: String(obj.ompInstallDir ?? obj.omp_install_dir ?? ""),
    ompNotificationDir: String(
      obj.ompNotificationDir ?? obj.omp_notification_dir ?? "",
    ),
    ompStatus,
    ompCanEnable: Boolean(obj.ompCanEnable ?? obj.omp_can_enable),
    ompReason:
      obj.ompReason != null
        ? String(obj.ompReason)
        : obj.omp_reason != null
          ? String(obj.omp_reason)
          : undefined,
    codexConfigDir: String(obj.codexConfigDir ?? obj.codex_config_dir ?? ""),
    codexNotificationDir: String(
      obj.codexNotificationDir ?? obj.codex_notification_dir ?? "",
    ),
    codexConfigExists: Boolean(
      obj.codexConfigExists ?? obj.codex_config_exists,
    ),
    codexCanEnable: Boolean(obj.codexCanEnable ?? obj.codex_can_enable),
    codexReason:
      obj.codexReason != null
        ? String(obj.codexReason)
        : obj.codex_reason != null
          ? String(obj.codex_reason)
          : undefined,
  };
}
