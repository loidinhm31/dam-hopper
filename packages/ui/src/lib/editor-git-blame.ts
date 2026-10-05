import type {
  GitBlameCommit,
  GitBlameRange,
  GitBlameResponse,
  VcsRoot,
} from "@/api/client.js";

/** 5 MiB maximum UTF-8 buffer threshold for blame operations. */
export const GIT_BLAME_MAX_BUFFER_BYTES = 5 * 1024 * 1024;

/** Edit debounce threshold (250 ms) after user buffer keystrokes. */
export const GIT_BLAME_DEBOUNCE_MS = 250;

/**
 * Computes Monaco display line count: empty string = 1, each \n adds a display line.
 */
export function computeMonacoLineCount(content: string): number {
  if (content.length === 0) return 1;
  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) {
      lines++;
    }
  }
  return lines;
}

/**
 * Checks if a string exceeds the 5 MiB buffer limit in UTF-8 bytes.
 */
export function isBufferOverLimit(content: string): boolean {
  if (content.length > GIT_BLAME_MAX_BUFFER_BYTES) return true;
  const bytes = new TextEncoder().encode(content).length;
  return bytes >= GIT_BLAME_MAX_BUFFER_BYTES;
}

export interface BlameValidationOptions {
  expectedSnapshotId?: string;
  expectedModelVersion?: number;
  expectedBufferLineCount?: number;
}

export type BlameValidationResult =
  | { valid: true; response: GitBlameResponse }
  | { valid: false; reason: string };

/**
 * Validates the raw blame response against strict structural invariants:
 * - snapshotId echo and modelVersion echo
 * - bufferLineCount matches expected
 * - ranges form an ordered, non-overlapping partition covering exactly 1..bufferLineCount
 * - commitIndex is either null (uncommitted) or within [0, commits.length)
 */
export function validateBlameResponse(
  raw: unknown,
  options?: BlameValidationOptions,
): BlameValidationResult {
  if (typeof raw !== "object" || raw === null) {
    return { valid: false, reason: "Response is not an object" };
  }
  const r = raw as Partial<GitBlameResponse>;

  if (typeof r.snapshotId !== "string" || r.snapshotId.length === 0) {
    return { valid: false, reason: "Missing or invalid snapshotId" };
  }
  if (
    options?.expectedSnapshotId &&
    r.snapshotId !== options.expectedSnapshotId
  ) {
    return {
      valid: false,
      reason: `Snapshot ID mismatch: expected ${options.expectedSnapshotId}, got ${r.snapshotId}`,
    };
  }

  if (
    typeof r.modelVersion !== "number" ||
    !Number.isSafeInteger(r.modelVersion) ||
    r.modelVersion < 1
  ) {
    return { valid: false, reason: "Missing or invalid modelVersion" };
  }
  if (
    options?.expectedModelVersion !== undefined &&
    r.modelVersion !== options.expectedModelVersion
  ) {
    return {
      valid: false,
      reason: `Model version mismatch: expected ${options.expectedModelVersion}, got ${r.modelVersion}`,
    };
  }

  if (typeof r.rootId !== "string" || typeof r.rootRelativePath !== "string") {
    return { valid: false, reason: "Missing rootId or rootRelativePath" };
  }

  if (
    typeof r.bufferLineCount !== "number" ||
    !Number.isSafeInteger(r.bufferLineCount) ||
    r.bufferLineCount < 1
  ) {
    return { valid: false, reason: "Invalid bufferLineCount" };
  }
  if (
    options?.expectedBufferLineCount !== undefined &&
    r.bufferLineCount !== options.expectedBufferLineCount
  ) {
    return {
      valid: false,
      reason: `Buffer line count mismatch: expected ${options.expectedBufferLineCount}, got ${r.bufferLineCount}`,
    };
  }

  if (
    r.status !== "ready" &&
    r.status !== "uncommitted" &&
    r.status !== "empty"
  ) {
    return { valid: false, reason: `Invalid status: ${String(r.status)}` };
  }

  if (!Array.isArray(r.commits)) {
    return { valid: false, reason: "Commits must be an array" };
  }
  for (let i = 0; i < r.commits.length; i++) {
    const c = r.commits[i];
    if (
      typeof c !== "object" ||
      c === null ||
      typeof c.hash !== "string" ||
      c.hash.length === 0 ||
      typeof c.authorName !== "string" ||
      typeof c.authorTimestamp !== "number" ||
      typeof c.authorTimezoneOffsetMinutes !== "number" ||
      typeof c.subject !== "string"
    ) {
      return { valid: false, reason: `Invalid commit record at index ${i}` };
    }
  }

  if (!Array.isArray(r.ranges)) {
    return { valid: false, reason: "Ranges must be an array" };
  }

  const ranges = r.ranges;
  const numCommits = r.commits.length;
  const totalLines = r.bufferLineCount;

  // Empty status handling
  if (r.status === "empty") {
    if (ranges.length === 0) {
      return { valid: true, response: r as GitBlameResponse };
    }
    if (ranges.length === 1) {
      const first = ranges[0];
      if (
        first &&
        first.startLine === 1 &&
        first.lineCount === 1 &&
        first.commitIndex === null
      ) {
        return { valid: true, response: r as GitBlameResponse };
      }
    }
    return {
      valid: false,
      reason: "Empty status must have 0 ranges or 1 uncommitted range",
    };
  }

  if (ranges.length === 0) {
    return {
      valid: false,
      reason: "Ranges array cannot be empty when status is not empty",
    };
  }

  let expectedNextLine = 1;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    if (
      typeof range !== "object" ||
      range === null ||
      typeof range.startLine !== "number" ||
      typeof range.lineCount !== "number" ||
      range.lineCount < 1
    ) {
      return { valid: false, reason: `Invalid range bounds at index ${i}` };
    }

    if (range.startLine !== expectedNextLine) {
      return {
        valid: false,
        reason: `Range partition gap or overlap at index ${i}: expected line ${expectedNextLine}, got ${range.startLine}`,
      };
    }

    if (range.commitIndex !== null) {
      if (
        typeof range.commitIndex !== "number" ||
        !Number.isSafeInteger(range.commitIndex) ||
        range.commitIndex < 0 ||
        range.commitIndex >= numCommits
      ) {
        return {
          valid: false,
          reason: `Range at index ${i} has out-of-bounds commitIndex ${range.commitIndex}`,
        };
      }
      if (r.status === "uncommitted") {
        return {
          valid: false,
          reason: `Status is uncommitted but range at index ${i} has commitIndex ${range.commitIndex}`,
        };
      }
    }

    expectedNextLine = range.startLine + range.lineCount;
  }

  if (expectedNextLine - 1 !== totalLines) {
    return {
      valid: false,
      reason: `Range partition covers ${expectedNextLine - 1} lines, but bufferLineCount is ${totalLines}`,
    };
  }

  return { valid: true, response: r as GitBlameResponse };
}

/**
 * Binary search for the GitBlameRange containing the given 1-based lineNumber.
 * Ranges must be an ordered partition. Returns null if out of range or not found.
 */
export function findBlameRangeForLine(
  ranges: GitBlameRange[],
  lineNumber: number,
): GitBlameRange | null {
  if (lineNumber < 1 || ranges.length === 0) return null;
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const r = ranges[mid];
    if (!r) break;
    const start = r.startLine;
    const end = start + r.lineCount - 1;
    if (lineNumber >= start && lineNumber <= end) {
      return r;
    }
    if (lineNumber < start) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return null;
}

/**
 * Looks up the commit for a given range.
 * Returns null if the range is uncommitted (commitIndex is null) or out of bounds.
 */
export function findCommitForRange(
  commits: GitBlameCommit[],
  range: GitBlameRange | null | undefined,
): GitBlameCommit | null {
  if (!range || range.commitIndex === null || range.commitIndex === undefined) {
    return null;
  }
  if (range.commitIndex >= 0 && range.commitIndex < commits.length) {
    return commits[range.commitIndex] ?? null;
  }
  return null;
}

/**
 * Resolves the deepest matching VCS root for a project-relative path.
 * Returns null if no root matches or if the owning root is missing.
 */
export function findOwningVcsRoot(
  roots: VcsRoot[],
  projectRelativePath: string,
): VcsRoot | null {
  const normPath = projectRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const matching = roots.filter((r) => {
    if (r.rootId === ".") return true;
    const normRoot = r.rootId.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return normPath === normRoot || normPath.startsWith(`${normRoot}/`);
  });
  if (matching.length === 0) return null;

  const deepest = matching.reduce((best, curr) =>
    curr.rootId.length > best.rootId.length ? curr : best,
  );

  if (deepest.mappingState === "missing") return null;
  return deepest;
}

/**
 * Formats epoch seconds into YYYY-MM-DD.
 */
export function formatBlameDate(timestampSeconds: number): string {
  const d = new Date(timestampSeconds * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats full timestamp with original author timezone offset.
 * e.g. "2026-10-05 14:32:00 +0700"
 */
export function formatBlameFullTimestamp(
  timestampSeconds: number,
  tzOffsetMinutes: number,
): string {
  // Convert UTC timestamp to author local time by adding offset minutes
  const authorTimeMs = (timestampSeconds + tzOffsetMinutes * 60) * 1000;
  const d = new Date(authorTimeMs);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  const seconds = String(d.getUTCSeconds()).padStart(2, "0");

  const sign = tzOffsetMinutes >= 0 ? "+" : "-";
  const absOffset = Math.abs(tzOffsetMinutes);
  const tzHours = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const tzMins = String(absOffset % 60).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} ${sign}${tzHours}${tzMins}`;
}
