import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectPlanDocument } from "./ProjectPlanDocument.js";
import type { FilePlan } from "@/api/project-plans-types.js";

describe("ProjectPlanDocument", () => {
  const dummyRef = { path: "plans/sample/plan.md", lineStart: 1, lineEnd: 1 };

  const samplePlan: FilePlan = {
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
      value: "pending",
      authority: "plan",
      raw: "pending",
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
    dates: {
      created: null,
      plannedStart: null,
      plannedEnd: null,
      actualStart: null,
      actualEnd: null,
      published: null,
    },
    lastDocumentUpdate: "2026-10-06T12:00:00Z",
    diagnostics: [],
  };

  it("renders plan and progress tabs with snapshot banner", () => {
    const html = renderToStaticMarkup(
      <ProjectPlanDocument
        plan={samplePlan}
        currentDocumentPath="plans/sample/plan.md"
        documentContent="# Sample Plan Markdown Content"
        isDocumentLoading={false}
        documentError={null}
        onNavigateDocument={vi.fn()}
        onRetryDocument={vi.fn()}
      />,
    );

    expect(html).toContain("Plan (plan.md)");
    expect(html).toContain("Progress (progress.md)");
    expect(html).toContain("Read-Only Snapshot");
    expect(html).toContain("plans/sample/plan.md");
    expect(html).toContain("Sample Plan Markdown Content");
  });

  it("renders absent notice when viewing absent progress.md", () => {
    const html = renderToStaticMarkup(
      <ProjectPlanDocument
        plan={samplePlan}
        currentDocumentPath="plans/sample/progress.md"
        documentContent=""
        isDocumentLoading={false}
        documentError={null}
        onNavigateDocument={vi.fn()}
        onRetryDocument={vi.fn()}
      />,
    );

    expect(html).toContain("Document is absent");
    expect(html).toContain("Progress tracking has not been opted into");
  });

  it("renders oversize banner when document state is oversize", () => {
    const oversizePlan: FilePlan = {
      ...samplePlan,
      documents: {
        ...samplePlan.documents,
        plan: {
          ...samplePlan.documents.plan,
          state: "oversize",
        },
      },
    };

    const html = renderToStaticMarkup(
      <ProjectPlanDocument
        plan={oversizePlan}
        currentDocumentPath="plans/sample/plan.md"
        documentContent=""
        isDocumentLoading={false}
        documentError={null}
        onNavigateDocument={vi.fn()}
        onRetryDocument={vi.fn()}
      />,
    );

    expect(html).toContain("Document exceeds size limit");
    expect(html).toContain("64 KiB maximum allowed");
  });

  it("renders loading state when isDocumentLoading is true", () => {
    const html = renderToStaticMarkup(
      <ProjectPlanDocument
        plan={samplePlan}
        currentDocumentPath="plans/sample/plan.md"
        isDocumentLoading={true}
        documentError={null}
        onNavigateDocument={vi.fn()}
        onRetryDocument={vi.fn()}
      />,
    );

    expect(html).toContain("Loading document content...");
  });

  it("renders error state when documentError is provided", () => {
    const html = renderToStaticMarkup(
      <ProjectPlanDocument
        plan={samplePlan}
        currentDocumentPath="plans/sample/plan.md"
        isDocumentLoading={false}
        documentError={new Error("Failed to load document")}
        onNavigateDocument={vi.fn()}
        onRetryDocument={vi.fn()}
      />,
    );

    expect(html).toContain("Failed to read document");
    expect(html).toContain("Failed to load document");
  });
});
