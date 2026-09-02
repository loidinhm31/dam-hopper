import { describe, expect, it } from "vitest";
import {
  allowedChildKinds,
  compareWorkflowItems,
  formatElapsedDuration,
  formatTrackedTasksProgress,
  getIsoNow,
  isCompletedItemStatus,
  isOpenItemStatus,
  isOpenSessionStatus,
  isResourceStateAttentionRequired,
  isValidIsoTimestamp,
  isValidParentKind,
  validateSessionInterval,
  type ItemDto,
} from "./workflow-types.js";

describe("workflow-types domain helpers", () => {
  describe("hierarchy validation", () => {
    it("returns correct allowed child kinds for root, plan, phase, and task", () => {
      expect(allowedChildKinds(null)).toEqual(["plan", "task"]);
      expect(allowedChildKinds("plan")).toEqual(["phase", "task"]);
      expect(allowedChildKinds("phase")).toEqual(["task"]);
      expect(allowedChildKinds("task")).toEqual([]);
    });

    it("validates parent-child relationships correctly", () => {
      expect(isValidParentKind(null, "plan")).toBe(true);
      expect(isValidParentKind(null, "task")).toBe(true);
      expect(isValidParentKind(null, "phase")).toBe(false);

      expect(isValidParentKind("plan", "phase")).toBe(true);
      expect(isValidParentKind("plan", "task")).toBe(true);
      expect(isValidParentKind("plan", "plan")).toBe(false);

      expect(isValidParentKind("phase", "task")).toBe(true);
      expect(isValidParentKind("phase", "plan")).toBe(false);
      expect(isValidParentKind("phase", "phase")).toBe(false);

      expect(isValidParentKind("task", "task")).toBe(false);
      expect(isValidParentKind("task", "phase")).toBe(false);
      expect(isValidParentKind("task", "plan")).toBe(false);
    });
  });

  describe("status predicates", () => {
    it("identifies open item statuses", () => {
      expect(isOpenItemStatus("backlog")).toBe(true);
      expect(isOpenItemStatus("next")).toBe(true);
      expect(isOpenItemStatus("in_progress")).toBe(true);
      expect(isOpenItemStatus("blocked")).toBe(true);
      expect(isOpenItemStatus("done")).toBe(false);
      expect(isOpenItemStatus("canceled")).toBe(false);
    });

    it("identifies completed item status", () => {
      expect(isCompletedItemStatus("done")).toBe(true);
      expect(isCompletedItemStatus("in_progress")).toBe(false);
      expect(isCompletedItemStatus("canceled")).toBe(false);
    });

    it("identifies open session status", () => {
      expect(isOpenSessionStatus("running")).toBe(true);
      expect(isOpenSessionStatus("ended")).toBe(false);
      expect(isOpenSessionStatus("abandoned")).toBe(false);
    });

    it("identifies resource states requiring attention", () => {
      expect(isResourceStateAttentionRequired("stale")).toBe(true);
      expect(isResourceStateAttentionRequired("exited")).toBe(true);
      expect(isResourceStateAttentionRequired("crashed")).toBe(true);
      expect(isResourceStateAttentionRequired("detached")).toBe(true);
      expect(isResourceStateAttentionRequired("attached")).toBe(false);
      expect(isResourceStateAttentionRequired("unknown")).toBe(false);
    });
  });

  describe("factual progress formatting", () => {
    it("returns null when progress is missing or has 0 tracked tasks", () => {
      expect(formatTrackedTasksProgress(null)).toBeNull();
      expect(formatTrackedTasksProgress(undefined)).toBeNull();
      expect(
        formatTrackedTasksProgress({
          totalTrackedTasks: 0,
          completedTrackedTasks: 0,
        }),
      ).toBeNull();
    });

    it("returns factual label when tracked tasks exist without percentage inference", () => {
      expect(
        formatTrackedTasksProgress({
          totalTrackedTasks: 5,
          completedTrackedTasks: 3,
        }),
      ).toBe("3/5 tracked tasks done");
      expect(
        formatTrackedTasksProgress({
          totalTrackedTasks: 1,
          completedTrackedTasks: 0,
        }),
      ).toBe("0/1 tracked tasks done");
      expect(
        formatTrackedTasksProgress({
          totalTrackedTasks: 4,
          completedTrackedTasks: 4,
        }),
      ).toBe("4/4 tracked tasks done");
    });
  });

  describe("timestamp validation and elapsed calculation", () => {
    it("validates ISO timestamp strings", () => {
      expect(isValidIsoTimestamp("2026-09-02T12:00:00.000Z")).toBe(true);
      expect(isValidIsoTimestamp("2026-09-02T12:00:00Z")).toBe(true);
      expect(isValidIsoTimestamp("invalid")).toBe(false);
      expect(isValidIsoTimestamp("")).toBe(false);
    });

    it("validates session intervals", () => {
      const start = "2026-09-02T10:00:00.000Z";
      const endValid = "2026-09-02T11:30:00.000Z";
      const endEqual = "2026-09-02T10:00:00.000Z";
      const endInvalid = "2026-09-02T09:00:00.000Z";

      expect(validateSessionInterval(start, endValid)).toEqual({ valid: true });
      expect(validateSessionInterval(start, endEqual)).toEqual({ valid: true });
      expect(validateSessionInterval(start, endInvalid).valid).toBe(false);
      expect(validateSessionInterval("bad", endValid).valid).toBe(false);
      expect(validateSessionInterval(start, "bad").valid).toBe(false);
    });

    it("generates ISO now string", () => {
      const now = getIsoNow();
      expect(isValidIsoTimestamp(now)).toBe(true);
    });

    it("formats elapsed duration cleanly", () => {
      const startMs = 1_000_000;
      expect(formatElapsedDuration(startMs, startMs + 30_000)).toBe("0m");
      expect(formatElapsedDuration(startMs, startMs + 65_000)).toBe("1m");
      expect(formatElapsedDuration(startMs, startMs + 3_600_000)).toBe("1h 0m");
      expect(formatElapsedDuration(startMs, startMs + 5_040_000)).toBe("1h 24m");
      expect(formatElapsedDuration(startMs, startMs - 1000)).toBe("0m");
      expect(formatElapsedDuration("invalid")).toBe("0m");
    });
  });

  describe("item ordering", () => {
    it("sorts by sortOrder first, then createdAt", () => {
      const base: Omit<ItemDto, "id" | "sortOrder" | "createdAt"> = {
        target: { project: "demo" },
        kind: "task",
        title: "Test",
        status: "backlog",
        source: "manual",
        updatedAt: "2026-09-02T10:00:00.000Z",
      };

      const itemA: ItemDto = {
        ...base,
        id: "a",
        sortOrder: 1,
        createdAt: "2026-09-02T10:00:00.000Z",
      };
      const itemB: ItemDto = {
        ...base,
        id: "b",
        sortOrder: 2,
        createdAt: "2026-09-02T09:00:00.000Z",
      };
      const itemC: ItemDto = {
        ...base,
        id: "c",
        sortOrder: 1,
        createdAt: "2026-09-02T11:00:00.000Z",
      };

      const list = [itemB, itemC, itemA];
      list.sort(compareWorkflowItems);

      expect(list.map((i) => i.id)).toEqual(["a", "c", "b"]);
    });
  });
});
