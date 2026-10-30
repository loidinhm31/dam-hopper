/**
 * Frozen types and runtime decoders for Session Changes review panel.
 * Mirrors server/src/session_changes/types.rs and contracts.md.
 */

export const SESSION_CHANGES_PROTOCOL_VERSION = 1;

export type PrepareMode = "capture" | "lookup";
export type PrepareLifecycle =
  | "initialFresh"
  | "new"
  | "fork"
  | "resume"
  | "unknown";
export type FailureReason =
  | "timeout"
  | "aborted"
  | "protocol"
  | "captureFailed"
  | "identityChanged";
export type SettledOutcome =
  | "completed"
  | "blocked"
  | "error"
  | "aborted"
  | "unknown";

export type CoverageReason =
  | "absenceUnknown"
  | "provenanceLimit"
  | "rootLimit"
  | "inventoryLimit"
  | "pathLimit"
  | "byteLimit"
  | "fileTooLarge"
  | "binary"
  | "nonUtf8"
  | "unreadable"
  | "unstable"
  | "symlink"
  | "gitlink"
  | "nestedRoot"
  | "specialFile"
  | "deadline"
  | "capacity"
  | "textLimit"
  | "diffLimit"
  | "targetUnavailable";

export type CoverageState = "complete" | "incomplete";
export type StatusState =
  | "initializing"
  | "ready"
  | "incomplete"
  | "unavailable"
  | "missing";
export type Origin = "sessionStart" | "fromNow";
export type Acknowledgment = "pending" | "received" | "notApplicable";

export type FileChangeKind =
  | "added"
  | "deleted"
  | "modified"
  | "modeOnly"
  | "unknown";
export type Presence = "present" | "absent" | "unknown";
export type Provenance =
  | "captured"
  | "absentInVerifiedDirectory"
  | "excludedAtCapture"
  | "unproven";
export type FileContentKind = "text" | "binary" | "unsupported" | "unknown";

export type ErrorCode =
  | "invalidRequest"
  | "unauthorized"
  | "terminalMissing"
  | "incarnationMismatch"
  | "sessionMismatch"
  | "rootMismatch"
  | "targetUnavailable"
  | "baselineMissing"
  | "serverRestarted"
  | "originalUnavailable"
  | "registrationExpired"
  | "registrationFailed"
  | "acknowledgmentPending"
  | "capacity"
  | "busy"
  | "deadline"
  | "refreshRequired"
  | "fileMissing"
  | "responseLimit";

export interface Coverage {
  readonly state: CoverageState;
  readonly inventoryComplete: boolean;
  readonly absenceProofComplete: boolean;
  readonly provenanceEntries: number;
  readonly eligibleEntries: number;
  readonly capturedEntries: number;
  readonly omittedEntries: number | null;
  readonly rawBytes: number;
  readonly reasons: readonly CoverageReason[];
}

export interface Comparison {
  readonly serverEpoch: string;
  readonly baselineId: string;
  readonly comparisonRevision: string;
  readonly comparedAtMs: number;
  readonly currentCoverage: Coverage;
  readonly changedFileCount: number;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly countsComplete: boolean;
  readonly settledTurnId: string | null;
}

export interface Status {
  readonly version: 1;
  readonly serverEpoch: string;
  readonly terminalIncarnation: string;
  readonly ompSessionId: string;
  readonly rootId: string | null;
  readonly baselineId: string | null;
  readonly origin: Origin | null;
  readonly state: StatusState;
  readonly acknowledgment: Acknowledgment;
  readonly capturedAtMs: number | null;
  readonly baselineCoverage: Coverage | null;
  readonly comparison: Comparison | null;
  readonly reason: ErrorCode | null;
  readonly sharedWriters: true;
}

export interface FileRow {
  readonly fileId: string;
  readonly path: string;
  readonly change: FileChangeKind;
  readonly originalPresence: Presence;
  readonly originalProvenance: Provenance;
  readonly currentPresence: Presence;
  readonly originalKind: FileContentKind;
  readonly currentKind: FileContentKind;
  readonly originalMode: number | null;
  readonly currentMode: number | null;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly reasons: readonly CoverageReason[];
}

export interface FilePage {
  readonly version: 1;
  readonly comparison: Comparison;
  readonly files: readonly FileRow[];
  readonly nextCursor: string | null;
}

export interface ContentSide {
  readonly presence: Presence;
  readonly content: string | null;
  readonly byteLength: number | null;
  readonly sha256: string | null;
  readonly mode: number | null;
}

export interface FileDetail {
  readonly version: 1;
  readonly serverEpoch: string;
  readonly baselineId: string;
  readonly comparisonRevision: string;
  readonly file: FileRow;
  readonly original: ContentSide;
  readonly current: ContentSide;
  readonly renderable: boolean;
}

export interface ErrorBody {
  readonly version: 1;
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly currentRevision: string | null;
  readonly reason: string;
}

export interface RetainedSessionEntry {
  readonly ompSessionId: string;
  readonly rootId: string | null;
  readonly baselineId: string | null;
  readonly origin: Origin | null;
  readonly state: StatusState;
  readonly capturedAtMs: number | null;
}

export interface RetainedSessionList {
  readonly version: 1;
  readonly serverEpoch: string;
  readonly terminalIncarnation: string;
  readonly sessions: readonly RetainedSessionEntry[];
}

export interface FromNowRequest {
  readonly version: 1;
  readonly terminalIncarnation: string;
  readonly ompSessionId: string;
  readonly rootId: string;
  readonly requestId: string;
  readonly expectedServerEpoch?: string | null;
}

export interface RefreshRequest {
  readonly version: 1;
  readonly terminalIncarnation: string;
  readonly ompSessionId: string;
  readonly serverEpoch: string;
  readonly baselineId: string;
  readonly requestId: string;
}

// ---------------------------------------------------------------------------
// Helpers and Validators
// ---------------------------------------------------------------------------

export function isCanonicalDecimalString(val: unknown): val is string {
  if (typeof val !== "string" || val.length === 0) return false;
  if (val.length > 1 && val.startsWith("0")) return false;
  return /^\d+$/.test(val);
}

/**
 * Compare two canonical unsigned decimal strings safely without precision loss.
 * Returns negative if a < b, 0 if a == b, positive if a > b.
 */
export function compareDecimalStrings(a: string, b: string): number {
  if (!isCanonicalDecimalString(a) || !isCanonicalDecimalString(b)) {
    throw new Error(
      `Cannot compare invalid decimal strings: '${a}' and '${b}'`
    );
  }
  const bigA = BigInt(a);
  const bigB = BigInt(b);
  if (bigA < bigB) return -1;
  if (bigA > bigB) return 1;
  return 0;
}

export function validateStatusInvariants(status: Status): void {
  if (status.version !== 1) {
    throw new Error(`Invalid Status version: ${status.version}`);
  }
  if (status.sharedWriters !== true) {
    throw new Error("sharedWriters must be true");
  }
  if (!isCanonicalDecimalString(status.terminalIncarnation)) {
    throw new Error(
      `terminalIncarnation must be a canonical unsigned decimal string: got '${status.terminalIncarnation}'`
    );
  }
  if (
    status.comparison &&
    !isCanonicalDecimalString(status.comparison.comparisonRevision)
  ) {
    throw new Error(
      `comparisonRevision must be a canonical unsigned decimal string: got '${status.comparison.comparisonRevision}'`
    );
  }

  const { origin, state, acknowledgment } = status;

  if (origin === "sessionStart") {
    if (state === "initializing") {
      if (acknowledgment !== "pending") {
        throw new Error(
          `sessionStart initializing requires pending acknowledgment, got ${acknowledgment}`
        );
      }
    } else if (state === "ready") {
      if (acknowledgment !== "received") {
        throw new Error(
          `sessionStart ready requires received acknowledgment, got ${acknowledgment}`
        );
      }
      if (!status.baselineId || status.capturedAtMs == null) {
        throw new Error("sessionStart ready requires baselineId and capturedAtMs");
      }
      if (status.baselineCoverage?.state !== "complete") {
        throw new Error("sessionStart ready requires complete baselineCoverage");
      }
    } else if (state === "incomplete") {
      if (acknowledgment !== "received") {
        throw new Error(
          `sessionStart incomplete requires received acknowledgment, got ${acknowledgment}`
        );
      }
      if (!status.baselineId || status.capturedAtMs == null) {
        throw new Error(
          "sessionStart incomplete requires baselineId and capturedAtMs"
        );
      }
      if (status.baselineCoverage?.state !== "incomplete") {
        throw new Error(
          "sessionStart incomplete requires incomplete baselineCoverage"
        );
      }
    } else if (state === "unavailable") {
      if (acknowledgment !== "pending" && acknowledgment !== "received") {
        throw new Error(
          `sessionStart unavailable allows pending or received, got ${acknowledgment}`
        );
      }
    } else {
      throw new Error(`Invalid state for sessionStart: ${state}`);
    }
  } else if (origin === "fromNow") {
    if (acknowledgment !== "notApplicable") {
      throw new Error(
        `fromNow requires notApplicable acknowledgment, got ${acknowledgment}`
      );
    }
    if (state === "ready") {
      if (!status.baselineId || status.capturedAtMs == null) {
        throw new Error("fromNow ready requires baselineId and capturedAtMs");
      }
      if (status.baselineCoverage?.state !== "complete") {
        throw new Error("fromNow ready requires complete baselineCoverage");
      }
    } else if (state === "incomplete") {
      if (!status.baselineId || status.capturedAtMs == null) {
        throw new Error(
          "fromNow incomplete requires baselineId and capturedAtMs"
        );
      }
      if (status.baselineCoverage?.state !== "incomplete") {
        throw new Error(
          "fromNow incomplete requires incomplete baselineCoverage"
        );
      }
    } else if (state !== "initializing" && state !== "unavailable") {
      throw new Error(`Invalid state for fromNow: ${state}`);
    }
  } else if (origin === null) {
    if (state === "missing" || state === "unavailable") {
      if (acknowledgment !== "notApplicable") {
        throw new Error(
          `null origin ${state} requires notApplicable, got ${acknowledgment}`
        );
      }
      if (status.baselineId != null || status.baselineCoverage != null) {
        throw new Error(
          `null origin ${state} must not have baselineId or baselineCoverage`
        );
      }
    } else {
      throw new Error(`null origin invalid with state ${state}`);
    }
  } else {
    throw new Error(`Invalid origin: ${origin}`);
  }
}

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

export function decodeCoverage(raw: unknown): Coverage {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Coverage must be an object");
  }
  const r = raw as Record<string, unknown>;
  if (r.state !== "complete" && r.state !== "incomplete") {
    throw new Error(`Invalid Coverage state: ${r.state}`);
  }
  return {
    state: r.state,
    inventoryComplete: Boolean(r.inventoryComplete),
    absenceProofComplete: Boolean(r.absenceProofComplete),
    provenanceEntries: Number(r.provenanceEntries ?? 0),
    eligibleEntries: Number(r.eligibleEntries ?? 0),
    capturedEntries: Number(r.capturedEntries ?? 0),
    omittedEntries:
      r.omittedEntries != null ? Number(r.omittedEntries) : null,
    rawBytes: Number(r.rawBytes ?? 0),
    reasons: Array.isArray(r.reasons) ? (r.reasons as CoverageReason[]) : [],
  };
}

export function decodeComparison(raw: unknown): Comparison {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Comparison must be an object");
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.serverEpoch !== "string") {
    throw new Error("serverEpoch must be a string");
  }
  if (typeof r.baselineId !== "string") {
    throw new Error("baselineId must be a string");
  }
  if (!isCanonicalDecimalString(r.comparisonRevision)) {
    throw new Error("comparisonRevision must be a canonical decimal string");
  }
  return {
    serverEpoch: r.serverEpoch,
    baselineId: r.baselineId,
    comparisonRevision: r.comparisonRevision,
    comparedAtMs: Number(r.comparedAtMs ?? 0),
    currentCoverage: decodeCoverage(r.currentCoverage),
    changedFileCount: Number(r.changedFileCount ?? 0),
    additions: r.additions != null ? Number(r.additions) : null,
    deletions: r.deletions != null ? Number(r.deletions) : null,
    countsComplete: Boolean(r.countsComplete),
    settledTurnId:
      typeof r.settledTurnId === "string" ? r.settledTurnId : null,
  };
}

export function decodeStatus(raw: unknown): Status {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Status must be an object");
  }
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) {
    throw new Error(`Unsupported Status version: ${r.version}`);
  }
  if (typeof r.serverEpoch !== "string") {
    throw new Error("serverEpoch must be a string");
  }
  if (!isCanonicalDecimalString(r.terminalIncarnation)) {
    throw new Error(
      `terminalIncarnation must be a canonical decimal string: ${r.terminalIncarnation}`
    );
  }
  if (typeof r.ompSessionId !== "string") {
    throw new Error("ompSessionId must be a string");
  }
  if (r.sharedWriters !== true) {
    throw new Error("sharedWriters must be true");
  }

  const status: Status = {
    version: 1,
    serverEpoch: r.serverEpoch,
    terminalIncarnation: r.terminalIncarnation,
    ompSessionId: r.ompSessionId,
    rootId: typeof r.rootId === "string" ? r.rootId : null,
    baselineId: typeof r.baselineId === "string" ? r.baselineId : null,
    origin: (r.origin as Origin) ?? null,
    state: r.state as StatusState,
    acknowledgment: r.acknowledgment as Acknowledgment,
    capturedAtMs: r.capturedAtMs != null ? Number(r.capturedAtMs) : null,
    baselineCoverage:
      r.baselineCoverage != null ? decodeCoverage(r.baselineCoverage) : null,
    comparison:
      r.comparison != null ? decodeComparison(r.comparison) : null,
    reason: (r.reason as ErrorCode) ?? null,
    sharedWriters: true,
  };

  validateStatusInvariants(status);
  return status;
}

export function decodeFileRow(raw: unknown): FileRow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("FileRow must be an object");
  }
  const r = raw as Record<string, unknown>;
  return {
    fileId: String(r.fileId),
    path: String(r.path),
    change: r.change as FileChangeKind,
    originalPresence: r.originalPresence as Presence,
    originalProvenance: r.originalProvenance as Provenance,
    currentPresence: r.currentPresence as Presence,
    originalKind: r.originalKind as FileContentKind,
    currentKind: r.currentKind as FileContentKind,
    originalMode: r.originalMode != null ? Number(r.originalMode) : null,
    currentMode: r.currentMode != null ? Number(r.currentMode) : null,
    additions: r.additions != null ? Number(r.additions) : null,
    deletions: r.deletions != null ? Number(r.deletions) : null,
    reasons: Array.isArray(r.reasons) ? (r.reasons as CoverageReason[]) : [],
  };
}

export function decodeFilePage(raw: unknown): FilePage {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("FilePage must be an object");
  }
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) {
    throw new Error(`Unsupported FilePage version: ${r.version}`);
  }
  if (!Array.isArray(r.files)) {
    throw new Error("FilePage files must be an array");
  }
  return {
    version: 1,
    comparison: decodeComparison(r.comparison),
    files: r.files.map(decodeFileRow),
    nextCursor: typeof r.nextCursor === "string" ? r.nextCursor : null,
  };
}

export function decodeContentSide(raw: unknown): ContentSide {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("ContentSide must be an object");
  }
  const r = raw as Record<string, unknown>;
  return {
    presence: r.presence as Presence,
    content: typeof r.content === "string" ? r.content : null,
    byteLength: r.byteLength != null ? Number(r.byteLength) : null,
    sha256: typeof r.sha256 === "string" ? r.sha256 : null,
    mode: r.mode != null ? Number(r.mode) : null,
  };
}

export function decodeFileDetail(raw: unknown): FileDetail {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("FileDetail must be an object");
  }
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) {
    throw new Error(`Unsupported FileDetail version: ${r.version}`);
  }
  if (typeof r.serverEpoch !== "string") {
    throw new Error("serverEpoch must be a string");
  }
  if (typeof r.baselineId !== "string") {
    throw new Error("baselineId must be a string");
  }
  if (!isCanonicalDecimalString(r.comparisonRevision)) {
    throw new Error("comparisonRevision must be a canonical decimal string");
  }
  return {
    version: 1,
    serverEpoch: r.serverEpoch,
    baselineId: r.baselineId,
    comparisonRevision: r.comparisonRevision,
    file: decodeFileRow(r.file),
    original: decodeContentSide(r.original),
    current: decodeContentSide(r.current),
    renderable: Boolean(r.renderable),
  };
}

export function decodeErrorBody(raw: unknown): ErrorBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("ErrorBody must be an object");
  }
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) {
    throw new Error(`Unsupported ErrorBody version: ${r.version}`);
  }
  return {
    version: 1,
    code: r.code as ErrorCode,
    retryable: Boolean(r.retryable),
    currentRevision:
      typeof r.currentRevision === "string" ? r.currentRevision : null,
    reason: String(r.reason ?? ""),
  };
}

export function decodeRetainedSessionList(raw: unknown): RetainedSessionList {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("RetainedSessionList must be an object");
  }
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) {
    throw new Error(`Unsupported RetainedSessionList version: ${r.version}`);
  }
  if (typeof r.serverEpoch !== "string") {
    throw new Error("serverEpoch must be a string");
  }
  if (!isCanonicalDecimalString(r.terminalIncarnation)) {
    throw new Error(
      "terminalIncarnation must be a canonical decimal string"
    );
  }
  if (!Array.isArray(r.sessions)) {
    throw new Error("sessions must be an array");
  }
  return {
    version: 1,
    serverEpoch: r.serverEpoch,
    terminalIncarnation: r.terminalIncarnation,
    sessions: r.sessions.map((s) => {
      if (!s || typeof s !== "object" || Array.isArray(s)) {
        throw new Error("Session entry must be an object");
      }
      const so = s as Record<string, unknown>;
      return {
        ompSessionId: String(so.ompSessionId),
        rootId: typeof so.rootId === "string" ? so.rootId : null,
        baselineId: typeof so.baselineId === "string" ? so.baselineId : null,
        origin: (so.origin as Origin) ?? null,
        state: so.state as StatusState,
        capturedAtMs:
          so.capturedAtMs != null ? Number(so.capturedAtMs) : null,
      };
    }),
  };
}
