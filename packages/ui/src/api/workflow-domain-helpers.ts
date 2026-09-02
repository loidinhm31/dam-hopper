import type {
  ItemDto,
  ItemKind,
  ItemProgressDto,
  ItemStatus,
  ResourceObservedState,
  SessionStatus,
} from "./workflow-dto-types.js";

/** Status predicates */
export function isOpenItemStatus(status: ItemStatus): boolean {
  return (
    status === "backlog" ||
    status === "next" ||
    status === "in_progress" ||
    status === "blocked"
  );
}

export function isCompletedItemStatus(status: ItemStatus): boolean {
  return status === "done";
}

export function isOpenSessionStatus(status: SessionStatus): boolean {
  return status === "running";
}

export function isResourceStateAttentionRequired(
  state: ResourceObservedState,
): boolean {
  return (
    state === "stale" ||
    state === "exited" ||
    state === "crashed" ||
    state === "detached"
  );
}

/** Allowed child kinds for a parent kind */
export function allowedChildKinds(parentKind: ItemKind | null): ItemKind[] {
  if (parentKind === null) {
    return ["plan", "task"];
  }
  if (parentKind === "plan") {
    return ["phase", "task"];
  }
  if (parentKind === "phase") {
    return ["task"];
  }
  return [];
}

/** Hierarchy validation: Plan-first model */
export function isValidParentKind(
  parentKind: ItemKind | null,
  childKind: ItemKind,
): boolean {
  return allowedChildKinds(parentKind).includes(childKind);
}

/** Factual progress label: returns formatted string or null if no tracked tasks exist */
export function formatTrackedTasksProgress(
  progress?: ItemProgressDto | null,
): string | null {
  if (!progress || progress.totalTrackedTasks === 0) {
    return null;
  }
  return `${progress.completedTrackedTasks}/${progress.totalTrackedTasks} tracked tasks done`;
}

/** ISO timestamp helper */
export function getIsoNow(): string {
  return new Date().toISOString();
}

/** Validate ISO timestamp string */
export function isValidIsoTimestamp(value: string): boolean {
  if (!value || typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

/** Validates that endedAt is chronologically on or after startedAt */
export function validateSessionInterval(
  startedAt: string,
  endedAt: string,
): { valid: boolean; error?: string } {
  const startMs = Date.parse(startedAt);
  if (Number.isNaN(startMs)) {
    return { valid: false, error: "Invalid startedAt timestamp" };
  }
  const endMs = Date.parse(endedAt);
  if (Number.isNaN(endMs)) {
    return { valid: false, error: "Invalid endedAt timestamp" };
  }
  if (endMs < startMs) {
    return {
      valid: false,
      error: "Session endedAt cannot be earlier than startedAt",
    };
  }
  return { valid: true };
}

/** Format duration elapsed in human readable format (e.g. 0m, 5m, 1h 24m) */
export function formatElapsedDuration(
  startedAt: number | string,
  endedAt?: number | string | null,
  nowMs?: number,
): string {
  const startMs =
    typeof startedAt === "string" ? Date.parse(startedAt) : startedAt;
  if (Number.isNaN(startMs)) return "0m";

  const endMs =
    endedAt != null
      ? typeof endedAt === "string"
        ? Date.parse(endedAt)
        : endedAt
      : (nowMs ?? Date.now());

  if (Number.isNaN(endMs) || endMs <= startMs) return "0m";

  const diffSeconds = Math.floor((endMs - startMs) / 1000);
  const hours = Math.floor(diffSeconds / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/** Compare workflow items for deterministic UI ordering */
export function compareWorkflowItems(a: ItemDto, b: ItemDto): number {
  if (a.sortOrder !== b.sortOrder) {
    return a.sortOrder - b.sortOrder;
  }
  return a.createdAt.localeCompare(b.createdAt);
}
