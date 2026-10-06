import { describe, it, expect } from "vitest";
import {
  parseDateToTimestamp,
  formatTimelineDate,
  projectPlanTimeline,
} from "./project-plans-timeline.js";
import type { PlanDates } from "@/api/project-plans-types.js";

describe("project-plans-timeline", () => {
  describe("parseDateToTimestamp", () => {
    it("parses valid YYYY-MM-DD day dates strictly as UTC start of day", () => {
      const ts = parseDateToTimestamp("2026-10-06", "day");
      expect(ts).toBe(Date.UTC(2026, 9, 6));
    });

    it("rejects invalid calendar days like 2026-02-31", () => {
      expect(parseDateToTimestamp("2026-02-31", "day")).toBeNull();
      expect(parseDateToTimestamp("invalid-day", "day")).toBeNull();
      expect(parseDateToTimestamp("2026-13-01", "day")).toBeNull();
    });

    it("parses valid RFC3339 instants with timezone", () => {
      const ts = parseDateToTimestamp("2026-10-06T12:00:00Z", "instant");
      expect(ts).toBe(Date.UTC(2026, 9, 6, 12, 0, 0));
    });

    it("rejects instant strings without explicit timezone", () => {
      expect(parseDateToTimestamp("2026-10-06T12:00:00", "instant")).toBeNull();
    });
  });

  describe("formatTimelineDate", () => {
    it("preserves literal day strings", () => {
      expect(formatTimelineDate("2026-10-06", "day")).toBe("2026-10-06");
    });

    it("formats instant with explicit UTC indicator", () => {
      expect(formatTimelineDate("2026-10-06T12:00:00Z", "instant")).toBe(
        "2026-10-06T12:00:00Z (UTC)",
      );
    });
  });

  describe("projectPlanTimeline", () => {
    const dummyRef = { path: "plans/test/plan.md", lineStart: 1, lineEnd: 1 };

    it("returns isUndated when all date fields are null", () => {
      const dates: PlanDates = {
        created: null,
        plannedStart: null,
        plannedEnd: null,
        actualStart: null,
        actualEnd: null,
        published: null,
      };
      const projection = projectPlanTimeline(dates);
      expect(projection.isUndated).toBe(true);
      expect(projection.plannedBar).toBeNull();
      expect(projection.actualBar).toBeNull();
      expect(projection.milestones).toHaveLength(0);
    });

    it("computes planned and actual closed bars with matching day precision", () => {
      const dates: PlanDates = {
        created: { value: "2026-10-01", precision: "day", evidence: dummyRef },
        plannedStart: { value: "2026-10-01", precision: "day", evidence: dummyRef },
        plannedEnd: { value: "2026-10-10", precision: "day", evidence: dummyRef },
        actualStart: { value: "2026-10-02", precision: "day", evidence: dummyRef },
        actualEnd: { value: "2026-10-08", precision: "day", evidence: dummyRef },
        published: null,
      };

      const projection = projectPlanTimeline(dates);
      expect(projection.isUndated).toBe(false);
      expect(projection.plannedBar).not.toBeNull();
      expect(projection.plannedBar?.isDashed).toBe(true);
      expect(projection.plannedBar?.startValue).toBe("2026-10-01");
      expect(projection.plannedBar?.endValue).toBe("2026-10-10");

      expect(projection.actualBar).not.toBeNull();
      expect(projection.actualBar?.isOpen).toBe(false);
      expect(projection.actualBar?.startValue).toBe("2026-10-02");
      expect(projection.actualBar?.endValue).toBe("2026-10-08");

      expect(projection.milestones.some((m) => m.kind === "created")).toBe(true);
      expect(projection.dominantPrecision).toBe("day");
    });

    it("computes open actual bar when in-progress with no actualEnd", () => {
      const dates: PlanDates = {
        created: null,
        plannedStart: null,
        plannedEnd: null,
        actualStart: { value: "2026-10-01", precision: "day", evidence: dummyRef },
        actualEnd: null,
        published: null,
      };

      const now = Date.UTC(2026, 9, 6, 10, 0, 0);
      const projection = projectPlanTimeline(dates, "in-progress", now);

      expect(projection.isUndated).toBe(false);
      expect(projection.hasActiveOpenBar).toBe(true);
      expect(projection.actualBar).not.toBeNull();
      expect(projection.actualBar?.isOpen).toBe(true);
      expect(projection.actualBar?.endValue).toBe("Today");
    });

    it("rejects mismatched precision between planned start and end", () => {
      const dates: PlanDates = {
        created: null,
        plannedStart: { value: "2026-10-01", precision: "day", evidence: dummyRef },
        plannedEnd: { value: "2026-10-10T12:00:00Z", precision: "instant", evidence: dummyRef },
        actualStart: null,
        actualEnd: null,
        published: null,
      };

      const projection = projectPlanTimeline(dates);
      expect(projection.plannedBar).toBeNull();
      expect(projection.warnings.length).toBeGreaterThan(0);
      // Fallback creates milestones for valid individual dates
      expect(projection.milestones).toHaveLength(2);
    });

    it("treats creation-only as creation milestone", () => {
      const dates: PlanDates = {
        created: { value: "2026-10-06", precision: "day", evidence: dummyRef },
        plannedStart: null,
        plannedEnd: null,
        actualStart: null,
        actualEnd: null,
        published: null,
      };

      const projection = projectPlanTimeline(dates);
      expect(projection.isUndated).toBe(false);
      expect(projection.plannedBar).toBeNull();
      expect(projection.actualBar).toBeNull();
      expect(projection.milestones).toHaveLength(1);
      expect(projection.milestones[0].kind).toBe("created");
    });
  });
});
