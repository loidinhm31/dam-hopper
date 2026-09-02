// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  filterOverviewByTarget,
  flattenOverviewNodes,
  getTrackedTasksProgressText,
  matchesTarget,
  selectActivePlanOrItem,
  selectAttentionSummary,
  selectRunningSessionForItem,
} from "./workflow-selectors.js";
import type {
  ItemOverviewNodeDto,
  OverviewDto,
} from "./workflow-dto-types.js";

function createMockNode(overrides?: Partial<ItemOverviewNodeDto>): ItemOverviewNodeDto {
  return {
    item: {
      id: "item-1",
      target: { project: "alpha", worktreePath: null },
      kind: "plan",
      title: "Sample Plan",
      status: "in_progress",
      sortOrder: 0,
      source: "manual",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
    notes: [],
    activeSessions: [],
    children: [],
    ...overrides,
  };
}

function createMockOverview(overrides?: Partial<OverviewDto>): OverviewDto {
  return {
    workspace: { id: "ws-1", name: "Default" },
    serverTime: "2026-09-01T12:00:00.000Z",
    projects: [],
    plans: [],
    standaloneTasks: [],
    runningSessions: [],
    recentEvents: [],
    truncated: false,
    ...overrides,
  };
}

describe("workflow-selectors", () => {
  describe("matchesTarget", () => {
    it("matches when filterTarget is null or undefined", () => {
      expect(matchesTarget({ project: "proj-1" }, null)).toBe(true);
      expect(matchesTarget({ project: "proj-1" }, undefined)).toBe(true);
    });

    it("matches project and worktreePath accurately", () => {
      expect(
        matchesTarget(
          { project: "proj-1", worktreePath: "wt-a" },
          { project: "proj-1", worktreePath: "wt-a" },
        ),
      ).toBe(true);

      expect(
        matchesTarget(
          { project: "proj-1", worktreePath: "wt-a" },
          { project: "proj-2", worktreePath: "wt-a" },
        ),
      ).toBe(false);

      expect(
        matchesTarget(
          { project: "proj-1", worktreePath: "wt-a" },
          { project: "proj-1", worktreePath: "wt-b" },
        ),
      ).toBe(false);
    });
  });

  describe("filterOverviewByTarget", () => {
    it("returns all plans and standalone tasks when target is null", () => {
      const p1 = createMockNode({ item: { ...createMockNode().item, id: "p1" } });
      const t1 = createMockNode({ item: { ...createMockNode().item, id: "t1", kind: "task" } });
      const overview = createMockOverview({ plans: [p1], standaloneTasks: [t1] });

      const filtered = filterOverviewByTarget(overview, null);
      expect(filtered.plans).toHaveLength(1);
      expect(filtered.standaloneTasks).toHaveLength(1);
    });

    it("filters by target project", () => {
      const p1 = createMockNode({
        item: { ...createMockNode().item, id: "p1", target: { project: "alpha" } },
      });
      const p2 = createMockNode({
        item: { ...createMockNode().item, id: "p2", target: { project: "beta" } },
      });
      const overview = createMockOverview({ plans: [p1, p2] });

      const filtered = filterOverviewByTarget(overview, { project: "alpha" });
      expect(filtered.plans).toHaveLength(1);
      expect(filtered.plans[0]?.item.id).toBe("p1");
    });
  });

  describe("selectActivePlanOrItem", () => {
    it("returns null for empty overview", () => {
      expect(selectActivePlanOrItem(createMockOverview())).toBeNull();
    });

    it("prioritizes item with running session over in_progress", () => {
      const p1 = createMockNode({
        item: { ...createMockNode().item, id: "p1", status: "in_progress" },
      });
      const p2 = createMockNode({
        item: { ...createMockNode().item, id: "p2", status: "next" },
        activeSessions: [
          {
            id: "s-1",
            target: { project: "alpha" },
            itemId: "p2",
            status: "running",
            startedAt: "2026-09-01T10:00:00.000Z",
            source: "manual",
            createdAt: "2026-09-01T10:00:00.000Z",
            updatedAt: "2026-09-01T10:00:00.000Z",
          },
        ],
      });
      const overview = createMockOverview({ plans: [p1, p2] });

      const active = selectActivePlanOrItem(overview);
      expect(active?.item.id).toBe("p2");
    });

    it("prioritizes in_progress over next or backlog", () => {
      const p1 = createMockNode({
        item: { ...createMockNode().item, id: "p1", status: "backlog" },
      });
      const p2 = createMockNode({
        item: { ...createMockNode().item, id: "p2", status: "in_progress" },
      });
      const overview = createMockOverview({ plans: [p1, p2] });

      const active = selectActivePlanOrItem(overview);
      expect(active?.item.id).toBe("p2");
    });
  });

  describe("getTrackedTasksProgressText", () => {
    it("returns 'Breakdown not tracked' when no progress or totalTrackedTasks is 0", () => {
      const node1 = createMockNode({ progress: null });
      expect(getTrackedTasksProgressText(node1)).toBe("Breakdown not tracked");

      const node2 = createMockNode({ progress: { totalTrackedTasks: 0, completedTrackedTasks: 0 } });
      expect(getTrackedTasksProgressText(node2)).toBe("Breakdown not tracked");
    });

    it("returns factual formatted label when tasks exist", () => {
      const node = createMockNode({ progress: { totalTrackedTasks: 4, completedTrackedTasks: 2 } });
      expect(getTrackedTasksProgressText(node)).toBe("2/4 tracked tasks done");
    });
  });
});
