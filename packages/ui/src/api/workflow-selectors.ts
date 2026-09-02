import type { ProjectTargetRef } from "./client.js";
import { isResourceStateAttentionRequired } from "./workflow-domain-helpers.js";
import type {
  ItemDto,
  ItemOverviewNodeDto,
  ItemStatus,
  OverviewDto,
  SessionDto,
  TargetDto,
} from "./workflow-dto-types.js";

export interface AttentionSummary {
  hasRunningSessions: boolean;
  hasBlockedItems: boolean;
  hasResourceAttention: boolean;
  runningSessionCount: number;
  blockedItemCount: number;
  resourceAttentionCount: number;
}

/** Check if item target matches filtered project target */
export function matchesTarget(
  itemTarget: TargetDto,
  filterTarget?: ProjectTargetRef | null,
): boolean {
  if (!filterTarget) return true;
  if (itemTarget.project !== filterTarget.project) return false;
  if (
    filterTarget.worktreePath != null &&
    filterTarget.worktreePath !== "" &&
    itemTarget.worktreePath !== filterTarget.worktreePath
  ) {
    return false;
  }
  return true;
}

/** Flatten a tree of ItemOverviewNodeDto */
export function flattenOverviewNodes(
  nodes: ItemOverviewNodeDto[],
): ItemOverviewNodeDto[] {
  const result: ItemOverviewNodeDto[] = [];
  function recurse(list: ItemOverviewNodeDto[]) {
    for (const node of list) {
      result.push(node);
      if (node.children && node.children.length > 0) {
        recurse(node.children);
      }
    }
  }
  recurse(nodes);
  return result;
}

/** Filter overview plans and standalone tasks by target */
export function filterOverviewByTarget(
  overview?: OverviewDto | null,
  target?: ProjectTargetRef | null,
): { plans: ItemOverviewNodeDto[]; standaloneTasks: ItemOverviewNodeDto[] } {
  if (!overview) {
    return { plans: [], standaloneTasks: [] };
  }
  const plans = target
    ? overview.plans.filter((p) => matchesTarget(p.item.target, target))
    : overview.plans;
  const standaloneTasks = target
    ? overview.standaloneTasks.filter((t) =>
        matchesTarget(t.item.target, target),
      )
    : overview.standaloneTasks;
  return { plans, standaloneTasks };
}

const STATUS_PRIORITY: Record<ItemStatus, number> = {
  in_progress: 1,
  next: 2,
  backlog: 3,
  blocked: 4,
  done: 5,
  canceled: 6,
};

/** Select active plan or standalone item matching priority */
export function selectActivePlanOrItem(
  overview?: OverviewDto | null,
  target?: ProjectTargetRef | null,
): ItemOverviewNodeDto | null {
  const { plans, standaloneTasks } = filterOverviewByTarget(overview, target);
  const allCandidates = [...plans, ...standaloneTasks];
  if (allCandidates.length === 0) return null;

  // 1. Any candidate with a running session
  const withRunning = allCandidates.find(
    (c) =>
      c.activeSessions.some((s) => s.status === "running") ||
      flattenOverviewNodes(c.children).some((child) =>
        child.activeSessions.some((s) => s.status === "running"),
      ),
  );
  if (withRunning) return withRunning;

  // 2. Sort by status priority, then updatedAt desc
  const sorted = [...allCandidates].sort((a, b) => {
    const pA = STATUS_PRIORITY[a.item.status] ?? 99;
    const pB = STATUS_PRIORITY[b.item.status] ?? 99;
    if (pA !== pB) return pA - pB;
    return (
      new Date(b.item.updatedAt).getTime() -
      new Date(a.item.updatedAt).getTime()
    );
  });

  return sorted[0] ?? null;
}

/** Select running session attached to item or its children */
export function selectRunningSessionForItem(
  node?: ItemOverviewNodeDto | null,
): SessionDto | null {
  if (!node) return null;
  const direct = node.activeSessions.find((s) => s.status === "running");
  if (direct) return direct;
  for (const child of node.children) {
    const childSession = selectRunningSessionForItem(child);
    if (childSession) return childSession;
  }
  return null;
}

/** Compute attention summary across target or workspace */
export function selectAttentionSummary(
  overview?: OverviewDto | null,
  target?: ProjectTargetRef | null,
): AttentionSummary {
  if (!overview) {
    return {
      hasRunningSessions: false,
      hasBlockedItems: false,
      hasResourceAttention: false,
      runningSessionCount: 0,
      blockedItemCount: 0,
      resourceAttentionCount: 0,
    };
  }

  const { plans, standaloneTasks } = filterOverviewByTarget(overview, target);
  const allNodes = flattenOverviewNodes([...plans, ...standaloneTasks]);

  let runningSessionCount = 0;
  let blockedItemCount = 0;

  for (const node of allNodes) {
    if (node.item.status === "blocked") {
      blockedItemCount++;
    }
    runningSessionCount += node.activeSessions.filter(
      (s) => s.status === "running",
    ).length;
  }

  return {
    hasRunningSessions: runningSessionCount > 0,
    hasBlockedItems: blockedItemCount > 0,
    hasResourceAttention: false,
    runningSessionCount,
    blockedItemCount,
    resourceAttentionCount: 0,
  };
}

/** Factual progress label: returns count done or neutral 'Breakdown not tracked' */
export function getTrackedTasksProgressText(
  node?: ItemOverviewNodeDto | null,
): string {
  if (!node || !node.progress || node.progress.totalTrackedTasks === 0) {
    return "Breakdown not tracked";
  }
  return `${node.progress.completedTrackedTasks}/${node.progress.totalTrackedTasks} tracked tasks done`;
}
