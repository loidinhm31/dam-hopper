import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectPlanOverview } from "./ProjectPlanOverview.js";
import type { FilePlan } from "@/api/project-plans-types.js";

describe("ProjectPlanOverview", () => {
  const dummyRef = { path: "plans/my-feature/plan.md", lineStart: 1, lineEnd: 1 };

  const samplePlan: FilePlan = {
    id: "plans/my-feature",
    title: "Awesome Feature",
    description: "This is a detailed description of the awesome feature.",
    metadata: {
      priority: "P1",
      effort: "16h",
      issue: "https://github.com/org/repo/issues/42",
      branch: "feat/my-feature",
      tags: ["frontend", "core"],
    },
    documents: {
      plan: {
        path: "plans/my-feature/plan.md",
        state: "readable",
        sizeBytes: 2048,
        modifiedAt: "2026-10-06T12:00:00Z",
      },
      progress: {
        path: "plans/my-feature/progress.md",
        state: "readable",
        sizeBytes: 1024,
        modifiedAt: "2026-10-06T12:05:00Z",
      },
    },
    reportedStatus: {
      value: "in-progress",
      authority: "progress",
      raw: "in-progress",
      evidence: [dummyRef],
      captured: [],
    },
    phases: [
      {
        id: "phase-01",
        number: 1,
        title: "Setup and Architecture",
        path: "plans/my-feature/phase-01.md",
        reportedStatus: {
          value: "completed",
          authority: "progress",
          raw: "completed",
          evidence: [dummyRef],
          captured: [],
        },
        evidenceLinks: ["plans/my-feature/receipt-01.md"],
      },
      {
        id: "phase-02",
        number: 2,
        title: "Implementation",
        path: "plans/my-feature/phase-02.md",
        reportedStatus: {
          value: "in-progress",
          authority: "progress",
          raw: "in-progress",
          evidence: [dummyRef],
          captured: [],
        },
        evidenceLinks: [],
      },
    ],
    completion: {
      declared: 2,
      completed: 1,
      unknown: 0,
      conflicted: 0,
      fraction: 0.5,
    },
    dates: {
      created: null,
      plannedStart: null,
      plannedEnd: null,
      actualStart: null,
      actualEnd: null,
      published: null,
    },
    lastDocumentUpdate: "2026-10-06T12:05:00Z",
    diagnostics: [],
  };

  it("renders plan title, description, priority, tags, branch, and safe issue URL", () => {
    const html = renderToStaticMarkup(
      <ProjectPlanOverview plan={samplePlan} onNavigateDocument={vi.fn()} />,
    );

    expect(html).toContain("Awesome Feature");
    expect(html).toContain("This is a detailed description of the awesome feature.");
    expect(html).toContain("P1");
    expect(html).toContain("16h");
    expect(html).toContain("feat/my-feature");
    expect(html).toContain("href=\"https://github.com/org/repo/issues/42\"");
    expect(html).toContain("#frontend");
    expect(html).toContain("#core");
  });

  it("renders phase inventory and progress fraction", () => {
    const html = renderToStaticMarkup(
      <ProjectPlanOverview plan={samplePlan} onNavigateDocument={vi.fn()} />,
    );

    expect(html).toContain("50%");
    expect(html).toContain("Setup and Architecture");
    expect(html).toContain("Implementation");
    expect(html).toContain("plans/my-feature/receipt-01.md");
  });

  it("renders labelled directory identifier when title is null", () => {
    const planNoTitle: FilePlan = {
      ...samplePlan,
      title: null,
    };
    const html = renderToStaticMarkup(
      <ProjectPlanOverview plan={planNoTitle} onNavigateDocument={vi.fn()} />,
    );

    expect(html).toContain("[Directory: plans/my-feature]");
  });
});
