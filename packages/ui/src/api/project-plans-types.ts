// Project Plans Dashboard DTO types and validators — Phase 03
// Aligned with contracts.md section 2 and server/src/plans/dto.rs

import type { ProjectTargetInput } from "./client.js";

// Diagnostic error codes frozen in contracts.md section 5
export const DIAG_INVALID_METADATA = "INVALID_METADATA" as const;
export const DIAG_INVALID_DOCUMENT = "INVALID_DOCUMENT" as const;
export const DIAG_FIELD_TOO_LARGE = "FIELD_TOO_LARGE" as const;
export const DIAG_PHASE_INVENTORY_INVALID = "PHASE_INVENTORY_INVALID" as const;
export const DIAG_PHASE_UNREPORTED = "PHASE_UNREPORTED" as const;
export const DIAG_PHASE_UNMATCHED = "PHASE_UNMATCHED" as const;
export const DIAG_STATUS_CONFLICT = "STATUS_CONFLICT" as const;
export const DIAG_UNSUPPORTED_STATUS = "UNSUPPORTED_STATUS" as const;
export const DIAG_PROGRESS_MISSING = "PROGRESS_MISSING" as const;
export const DIAG_PROGRESS_UNREADABLE = "PROGRESS_UNREADABLE" as const;
export const DIAG_DOCUMENT_TOO_LARGE = "DOCUMENT_TOO_LARGE" as const;
export const DIAG_DOCUMENT_CHANGED = "DOCUMENT_CHANGED" as const;
export const DIAG_LINK_REJECTED = "LINK_REJECTED" as const;
export const DIAG_INVALID_DATE = "INVALID_DATE" as const;
export const DIAG_DATE_CONFLICT = "DATE_CONFLICT" as const;
export const DIAG_SCAN_LIMIT = "SCAN_LIMIT" as const;
export const DIAG_DIAGNOSTICS_LIMIT = "DIAGNOSTICS_LIMIT" as const;

export type PlanStatus =
  | "pending"
  | "in-progress"
  | "completed"
  | "cancelled"
  | "blocked"
  | "unknown"
  | "conflict";

export type PlanAuthority = "plan" | "progress";

export interface SourceRef {
  /** Target-relative path */
  path: string;
  /** 1-based inclusive start line */
  lineStart: number;
  /** 1-based inclusive end line */
  lineEnd: number;
}

export interface Diagnostic {
  code: string;
  path: string | null;
  line: number | null;
  message: string;
}

export interface StatusEvidence {
  value: PlanStatus;
  raw: string;
  evidence: SourceRef;
}

export interface ReportedStatus {
  value: PlanStatus;
  authority: PlanAuthority;
  raw: string | null;
  evidence: SourceRef[];
  captured: StatusEvidence[];
}

export type PlanDocumentState =
  | "absent"
  | "readable"
  | "unreadable"
  | "oversize"
  | "invalid"
  | "changed";

export interface PlanDocument {
  path: string;
  state: PlanDocumentState;
  sizeBytes: number | null;
  modifiedAt: string | null;
}

export type DatePrecision = "day" | "instant";

export interface DateEvidence {
  value: string;
  precision: DatePrecision;
  evidence: SourceRef;
}

export interface FilePlanPhase {
  id: string;
  number: number | null;
  title: string | null;
  path: string | null;
  reportedStatus: ReportedStatus;
  evidenceLinks: string[];
}

export interface FilePlanMetadata {
  priority: string | null;
  effort: string | null;
  issue: string | null;
  branch: string | null;
  tags: string[];
}

export interface PlanDocuments {
  plan: PlanDocument;
  progress: PlanDocument;
}

export interface PlanCompletion {
  declared: number | null;
  completed: number;
  unknown: number;
  conflicted: number;
  fraction: number | null;
}

export interface PlanDates {
  created: DateEvidence | null;
  plannedStart: DateEvidence | null;
  plannedEnd: DateEvidence | null;
  actualStart: DateEvidence | null;
  actualEnd: DateEvidence | null;
  published: DateEvidence | null;
}

export interface FilePlan {
  id: string;
  title: string | null;
  description: string | null;
  metadata: FilePlanMetadata;
  documents: PlanDocuments;
  reportedStatus: ReportedStatus;
  phases: FilePlanPhase[];
  completion: PlanCompletion;
  dates: PlanDates;
  lastDocumentUpdate: string | null;
  diagnostics: Diagnostic[];
}

export interface PlanTarget {
  project: string;
  worktreePath: string | null;
  targetKey: string;
}

export type PlanFolderKind = "collection" | "group" | "plan";

export type PlanFolderState = "present" | "missing";

export interface FolderEntry {
  path: string;
  name: string;
}

export interface FolderListing {
  complete: boolean;
  entriesVisited: number;
  limitsReached: string[];
}

export interface PlanFoldersResponse {
  target: PlanTarget;
  path: string;
  kind: PlanFolderKind;
  folderState: PlanFolderState;
  folders: FolderEntry[];
  listing: FolderListing;
  watchPaths: string[];
  diagnostics: Diagnostic[];
}

export interface SelectedPlanResponse {
  target: PlanTarget;
  plan: FilePlan;
  watchPaths: string[];
  diagnostics: Diagnostic[];
}

// ── Coverage & Lifecycle Types ──────────────────────────────────────────────

export type PlanCoverageStatus =
  | "live"
  | "reconciling"
  | "degraded"
  | "unsupported";

export interface PlanCoverageState {
  status: PlanCoverageStatus;
  reason?: string | null;
  failedWatchPaths?: string[];
}

export interface PlanFoldersParams {
  target: ProjectTargetInput;
  path?: string;
}

export interface SelectedPlanParams {
  target: ProjectTargetInput;
  planPath: string;
}

export interface PlanDocumentParams {
  target: ProjectTargetInput;
  documentPath: string;
}

// ── Runtime Type Guards & Decoders ──────────────────────────────────────────

export function isPlanFoldersResponse(
  val: unknown,
): val is PlanFoldersResponse {
  if (val === null || typeof val !== "object" || Array.isArray(val)) return false;
  const obj = val as Record<string, unknown>;
  return (
    obj.target !== null &&
    typeof obj.target === "object" &&
    !Array.isArray(obj.target) &&
    typeof (obj.target as Record<string, unknown>).project === "string" &&
    typeof obj.path === "string" &&
    typeof obj.kind === "string" &&
    typeof obj.folderState === "string" &&
    Array.isArray(obj.folders) &&
    obj.listing !== null &&
    typeof obj.listing === "object" &&
    !Array.isArray(obj.listing) &&
    typeof (obj.listing as Record<string, unknown>).complete === "boolean" &&
    Array.isArray(obj.watchPaths) &&
    Array.isArray(obj.diagnostics)
  );
}

export function isSelectedPlanResponse(
  val: unknown,
): val is SelectedPlanResponse {
  if (val === null || typeof val !== "object" || Array.isArray(val)) return false;
  const obj = val as Record<string, unknown>;
  return (
    obj.target !== null &&
    typeof obj.target === "object" &&
    !Array.isArray(obj.target) &&
    typeof (obj.target as Record<string, unknown>).project === "string" &&
    obj.plan !== null &&
    typeof obj.plan === "object" &&
    !Array.isArray(obj.plan) &&
    typeof (obj.plan as Record<string, unknown>).id === "string" &&
    (obj.plan as Record<string, unknown>).reportedStatus !== null &&
    typeof (obj.plan as Record<string, unknown>).reportedStatus === "object" &&
    Array.isArray((obj.plan as Record<string, unknown>).phases) &&
    Array.isArray(obj.watchPaths) &&
    Array.isArray(obj.diagnostics)
  );
}

export function decodePlanFoldersResponse(val: unknown): PlanFoldersResponse {
  if (!isPlanFoldersResponse(val)) {
    throw new Error("Invalid PlanFoldersResponse shape from server");
  }
  return val;
}

export function decodeSelectedPlanResponse(val: unknown): SelectedPlanResponse {
  if (!isSelectedPlanResponse(val)) {
    throw new Error("Invalid SelectedPlanResponse shape from server");
  }
  return val;
}
