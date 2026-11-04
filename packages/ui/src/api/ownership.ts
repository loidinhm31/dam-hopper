import { normalizeProjectTargetPath } from "@/lib/project-target-path.js";

export type ProfileId = string;

export interface ConnectionRef {
  readonly profileId: ProfileId;
  readonly generation: number;
}

export interface ProjectRef {
  readonly profileId?: ProfileId;
  readonly project: string;
}

export interface ProjectTargetRef extends ProjectRef {
  readonly worktreePath?: string | null;
}

export interface QualifiedProjectRef {
  readonly profileId: ProfileId;
  readonly project: string;
}

export interface QualifiedProjectTargetRef extends QualifiedProjectRef {
  readonly worktreePath?: string | null;
}

export interface TerminalRef {
  readonly profileId: ProfileId;
  readonly id: string;
}

export interface TerminalInstanceRef extends TerminalRef {
  readonly incarnation: number;
}

export interface ResourceBinding {
  readonly serverUrl: string;
  readonly configuredRoot?: string;
}

export type Owned<T> = T & { readonly profileId: ProfileId };

export type FsTargetRef =
  | { readonly kind: "workspace"; readonly profileId: ProfileId; readonly workspaceEpoch?: number }
  | {
      readonly kind: "project";
      readonly profileId: ProfileId;
      readonly project: string;
      readonly worktreePath?: string | null;
    };

export type ServerFsTarget =
  | { type: "workspace"; workspaceEpoch?: number }
  | { type: "project"; project: string; worktreePath?: string };

/** Distinct wire target projection sent to the server. Never spread profileId. */
export interface ServerProjectTarget {
  project: string;
  worktreePath?: string;
}

export type ConnectionErrorReason = "stale" | "unavailable" | "owner-mismatch";

export class ConnectionOwnerError extends Error {
  constructor(
    message: string,
    public readonly reason: ConnectionErrorReason,
  ) {
    super(message);
    this.name = "ConnectionOwnerError";
  }
}

/**
 * Normalizes a qualified project target reference without stripping profileId.
 * Lexically normalizes worktreePath using normalizeProjectTargetPath.
 */
export function normalizeProjectTargetRef(target: ProjectTargetRef): ProjectTargetRef {
  const normalizedWorktree =
    target.worktreePath != null && target.worktreePath.trim() !== ""
      ? normalizeProjectTargetPath(target.worktreePath)
      : null;

  return {
    profileId: target.profileId,
    project: target.project,
    worktreePath: normalizedWorktree,
  };
}

/**
 * Projects a qualified ProjectTargetRef to wire ServerProjectTarget payload.
 * profileId is explicitly omitted.
 */
export function toServerProjectTarget(target: ProjectTargetRef): ServerProjectTarget {
  const normalized = normalizeProjectTargetRef(target);
  if (normalized.worktreePath != null) {
    return {
      project: normalized.project,
      worktreePath: normalized.worktreePath,
    };
  }
  return { project: normalized.project };
}

/** Returns deterministic tuple string: JSON.stringify([profileId, project]) */
export function projectKey(ref: ProjectRef): string {
  return JSON.stringify([ref.profileId, ref.project]);
}

export function parseProjectKey(key: string): QualifiedProjectRef | null {
  try {
    const parsed = JSON.parse(key);
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { profileId: parsed[0], project: parsed[1] };
    }
    return null;
  } catch {
    return null;
  }
}

/** Returns deterministic tuple string: JSON.stringify([profileId, project, worktreePath | null]) */
export function projectTargetKey(ref: ProjectTargetRef): string {
  const normalized = normalizeProjectTargetRef(ref);
  return JSON.stringify([
    normalized.profileId,
    normalized.project,
    normalized.worktreePath ?? null,
  ]);
}
/**
 * Normalizes a qualified filesystem target reference without stripping profileId.
 * Does NOT infer workspace authority from a missing or invalid project.
 */
export function normalizeFsTarget(
  target: FsTargetRef | ServerFsTarget | ProjectTargetRef | ProjectRef | string,
  defaultProfileId?: ProfileId,
): FsTargetRef {
  if (typeof target === "string") {
    const project = target.trim();
    if (!project) {
      throw new Error("Project target cannot be empty");
    }
    return {
      kind: "project",
      profileId: defaultProfileId ?? "",
      project,
      worktreePath: null,
    };
  }
  if (typeof target === "object" && target !== null) {
    if ("type" in target) {
      if (target.type === "workspace") {
        return {
          kind: "workspace",
          profileId: defaultProfileId ?? "",
          ...(target.workspaceEpoch !== undefined ? { workspaceEpoch: target.workspaceEpoch } : {}),
        };
      }
      if (target.type === "project") {
        const project = target.project.trim();
        if (!project) {
          throw new Error("Project target cannot be empty");
        }
        const normalizedWorktree =
          target.worktreePath != null && target.worktreePath.trim() !== ""
            ? normalizeProjectTargetPath(target.worktreePath)
            : null;
        return {
          kind: "project",
          profileId: defaultProfileId ?? "",
          project,
          worktreePath: normalizedWorktree,
        };
      }
    }
    if ("kind" in target) {
      if (target.kind === "workspace") {
        return {
          kind: "workspace",
          profileId: target.profileId || defaultProfileId || "",
          ...(target.workspaceEpoch !== undefined ? { workspaceEpoch: target.workspaceEpoch } : {}),
        };
      }
      if (target.kind === "project") {
        const project = target.project?.trim();
        if (!project) {
          throw new Error("Project target cannot be empty");
        }
        const normalizedWorktree =
          target.worktreePath != null && target.worktreePath.trim() !== ""
            ? normalizeProjectTargetPath(target.worktreePath)
            : null;
        return {
          kind: "project",
          profileId: target.profileId || defaultProfileId || "",
          project,
          worktreePath: normalizedWorktree,
        };
      }
    }
    if ("project" in target && typeof target.project === "string") {
      const project = target.project.trim();
      if (!project) {
        throw new Error("Project target cannot be empty");
      }
      const rawWorktree =
        "worktreePath" in target && typeof target.worktreePath === "string"
          ? target.worktreePath
          : null;
      const normalizedWorktree =
        rawWorktree != null && rawWorktree.trim() !== ""
          ? normalizeProjectTargetPath(rawWorktree)
          : null;
      const profileId =
        "profileId" in target && typeof target.profileId === "string"
          ? target.profileId
          : defaultProfileId ?? "";
      return {
        kind: "project",
        profileId,
        project,
        worktreePath: normalizedWorktree,
      };
    }
  }
  throw new Error("Invalid filesystem target reference");
}

/**
 * Projects an FsTargetRef to wire ServerFsTarget payload ({ type: "workspace" } or { type: "project", ... }).
 * profileId is explicitly omitted.
 */
export function toServerFsTarget(
  target: FsTargetRef | ServerFsTarget | ProjectTargetRef | string,
): ServerFsTarget {
  if (typeof target === "object" && target !== null && "type" in target) {
    return target;
  }
  const normalized = normalizeFsTarget(target as FsTargetRef);
  if (normalized.kind === "workspace") {
    return {
      type: "workspace",
      ...(normalized.workspaceEpoch !== undefined ? { workspaceEpoch: normalized.workspaceEpoch } : {}),
    };
  }
  if (normalized.worktreePath != null) {
    return {
      type: "project",
      project: normalized.project,
      worktreePath: normalized.worktreePath,
    };
  }
  return { type: "project", project: normalized.project };
}

/** Returns distinct deterministic tuple string for FsTargetRef. */
export function fsTargetKey(target: FsTargetRef): string {
  if (target.kind === "workspace") {
    return JSON.stringify(["workspace", target.profileId]);
  }
  const normalizedWorktree =
    target.worktreePath != null && target.worktreePath.trim() !== ""
      ? normalizeProjectTargetPath(target.worktreePath)
      : null;
  return JSON.stringify([
    "project",
    target.profileId,
    target.project,
    normalizedWorktree,
  ]);
}

export function parseFsTargetKey(key: string): FsTargetRef | null {
  try {
    const parsed = JSON.parse(key);
    if (!Array.isArray(parsed) || typeof parsed[1] !== "string") {
      return null;
    }
    if (parsed[0] === "workspace" && parsed.length === 2) {
      return { kind: "workspace", profileId: parsed[1] };
    }
    if (
      parsed[0] === "project" &&
      parsed.length === 4 &&
      typeof parsed[2] === "string" &&
      (parsed[3] === null || typeof parsed[3] === "string")
    ) {
      return {
        kind: "project",
        profileId: parsed[1],
        project: parsed[2],
        worktreePath: parsed[3] ?? null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function isSameFsTarget(a: FsTargetRef, b: FsTargetRef): boolean {
  return fsTargetKey(a) === fsTargetKey(b);
}


/** Returns deterministic tuple string: JSON.stringify([profileId, id]) */
export function terminalKey(ref: TerminalRef): string {
  return JSON.stringify([ref.profileId, ref.id]);
}

/** Returns deterministic tuple string: JSON.stringify([profileId, id, incarnation]) */
export function terminalInstanceKey(ref: TerminalInstanceRef): string {
  return JSON.stringify([ref.profileId, ref.id, ref.incarnation]);
}

export function parseTerminalKey(key: string): TerminalRef | null {
  try {
    const parsed = JSON.parse(key);
    if (
      Array.isArray(parsed) &&
      parsed.length >= 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return { profileId: parsed[0], id: parsed[1] };
    }
  } catch {
    // Malformed terminal key
  }
  return null;
}

export function parseTerminalInstanceKey(
  key: string,
): TerminalInstanceRef | null {
  try {
    const parsed = JSON.parse(key);
    if (
      Array.isArray(parsed) &&
      parsed.length >= 3 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      typeof parsed[2] === "number"
    ) {
      return { profileId: parsed[0], id: parsed[1], incarnation: parsed[2] };
    }
  } catch {
    // Malformed terminal instance key
  }
  return null;
}

export function toTerminalKey(
  target: TerminalRef | string,
  defaultProfileId?: ProfileId,
): string {
  if (typeof target === "string") {
    if (target.startsWith("[")) {
      const parsed = parseTerminalKey(target);
      if (parsed) return target;
    }
    if (defaultProfileId) {
      return terminalKey({ profileId: defaultProfileId, id: target });
    }
    return target;
  }
  return terminalKey(target);
}

export function toTerminalRef(
  target: TerminalRef | string,
  defaultProfileId?: ProfileId,
): TerminalRef {
  if (
    typeof target === "object" &&
    target !== null &&
    "profileId" in target &&
    "id" in target
  ) {
    return { profileId: target.profileId, id: target.id };
  }
  if (typeof target === "string" && target.startsWith("[")) {
    const parsed = parseTerminalKey(target);
    if (parsed) return parsed;
  }
  return {
    profileId: defaultProfileId ?? "",
    id: typeof target === "string" ? target : "",
  };
}

/** Returns deterministic tuple string: JSON.stringify([profileId, generation]) */
export function connectionKey(ref: ConnectionRef): string {
  return JSON.stringify([ref.profileId, ref.generation]);
}

export function extractProfileId(
  target: ProfileId | ConnectionRef | ProjectRef | TerminalRef | FsTargetRef,
): ProfileId | undefined {
  if (typeof target === "string") return target;
  return target.profileId;
}


export function isOwnerMatch(
  expected: ProfileId | ConnectionRef,
  actual: ProfileId | ConnectionRef | ProjectRef | TerminalRef | FsTargetRef,
): boolean {

  const expectedProfileId = extractProfileId(expected);
  const actualProfileId = extractProfileId(actual);
  if (expectedProfileId && actualProfileId && expectedProfileId !== actualProfileId) {
    return false;
  }
  if (
    typeof expected === "object" &&
    "generation" in expected &&
    typeof actual === "object" &&
    "generation" in actual
  ) {
    return expected.generation === actual.generation;
  }
  return true;
}

export function assertOwnerMatch(
  expected: ProfileId | ConnectionRef,
  actual: ProfileId | ConnectionRef | ProjectRef | TerminalRef | FsTargetRef,
  operation?: string,
): void {
  if (!isOwnerMatch(expected, actual)) {
    const op = operation ? ` for ${operation}` : "";
    const exp =
      typeof expected === "object" && "generation" in expected
        ? `${expected.profileId}@${expected.generation}`
        : (extractProfileId(expected) ?? "unknown");
    const act =
      typeof actual === "object" && "generation" in actual
        ? `${actual.profileId}@${actual.generation}`
        : (extractProfileId(actual) ?? "unspecified");
    throw new ConnectionOwnerError(
      `Owner mismatch${op}: expected ${exp}, got ${act}`,
      "owner-mismatch",
    );
  }
}
