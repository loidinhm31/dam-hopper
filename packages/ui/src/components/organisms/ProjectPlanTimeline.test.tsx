import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectPlanTimeline } from "./ProjectPlanTimeline.js";
import type { FilePlan, PlanStatus } from "@/api/project-plans-types.js";

describe("ProjectPlanTimeline", () => {
  const dummyRef = { path: "plans/sample/plan.md", lineStart: 1, lineEnd: 1 };

  const createDummyPlan = (dates: FilePlan["dates"], status: PlanStatus = "pending"): FilePlan => ({
    id: "plans/sample",
    title: "Sample Plan",
    description: "Sample description",
    metadata: {
      priority: "P2",
      effort: "40h",
      issue: null,
      branch: "feat/sample",
      tags: ["frontend"],
    },
    documents: {
      plan: {
        path: "plans/sample/plan.md",
        state: "readable",
        sizeBytes: 1024,
        modifiedAt: "2026-10-06T12:00:00Z",
      },
      progress: {
        path: "plans/sample/progress.md",
        state: "absent",
        sizeBytes: null,
        modifiedAt: null,
      },
    },
    reportedStatus: {
      value: status,
      authority: "plan",
      raw: status,
      evidence: [dummyRef],
      captured: [],
    },
    phases: [],
    completion: {
      declared: 0,
      completed: 0,
      unknown: 0,
      conflicted: 0,
      fraction: null,
    },
    dates,
    lastDocumentUpdate: "2026-10-06T12:00:00Z",
    diagnostics: [],
  });

  it("renders Undated Plan state when all dates are absent", () => {
    const plan = createDummyPlan({
      created: null,
      plannedStart: null,
      plannedEnd: null,
      actualStart: null,
      actualEnd: null,
      published: null,
    });

    const html = renderToStaticMarkup(<ProjectPlanTimeline plan={plan} />);

    expect(html).toContain("Undated Plan");
    expect(html).toContain("No explicit creation, planned schedule, or actual execution dates");
    expect(html).toContain("[- - -] Outlined (Planned)");
    expect(html).toContain("[━━━] Solid (Actual)");
  });

  it("renders planned and actual bars with precision indicators", () => {
    const plan = createDummyPlan({
      created: { value: "2026-10-01", precision: "day", evidence: dummyRef },
      plannedStart: { value: "2026-10-01", precision: "day", evidence: dummyRef },
      plannedEnd: { value: "2026-10-10", precision: "day", evidence: dummyRef },
      actualStart: { value: "2026-10-02", precision: "day", evidence: dummyRef },
      actualEnd: { value: "2026-10-08", precision: "day", evidence: dummyRef },
      published: null,
    });

    const html = renderToStaticMarkup(<ProjectPlanTimeline plan={plan} />);

    expect(html).toContain("Planned Schedule");
    expect(html).toContain("2026-10-01 → 2026-10-10");
    expect(html).toContain("Actual Execution");
    expect(html).toContain("2026-10-02 → 2026-10-08");
    expect(html).toContain("Declared Date Evidence");
    expect(html).toContain("Calendar Day (Inclusive)");
  });

  it("renders open in-progress bar extending to Today when status is in-progress", () => {
    const plan = createDummyPlan(
      {
        created: null,
        plannedStart: null,
        plannedEnd: null,
        actualStart: { value: "2026-10-01", precision: "day", evidence: dummyRef },
        actualEnd: null,
        published: null,
      },
      "in-progress",
    );

    const now = Date.UTC(2026, 9, 6, 12, 0, 0);
    const html = renderToStaticMarkup(<ProjectPlanTimeline plan={plan} nowMs={now} />);

    expect(html).toContain("Actual Execution");
    expect(html).toContain("In Progress");
    expect(html).toContain("open in-progress");
  });

  it("renders milestones for standalone points", () => {
    const plan = createDummyPlan({
      created: { value: "2026-10-01", precision: "day", evidence: dummyRef },
      plannedStart: null,
      plannedEnd: null,
      actualStart: null,
      actualEnd: null,
      published: null,
    });

    const html = renderToStaticMarkup(<ProjectPlanTimeline plan={plan} />);

    expect(html).toContain("Milestones [◆]");
    expect(html).toContain("Created:");
    expect(html).toContain("2026-10-01");
  });
});
