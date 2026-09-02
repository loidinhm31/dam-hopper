// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemOverviewNodeDto } from "@/api/workflow-dto-types.js";
import { WorkflowContextRibbon } from "./WorkflowContextRibbon.js";

function createMockActiveNode(title: string): ItemOverviewNodeDto {
  return {
    item: {
      id: "p-1",
      target: { project: "hopper-core" },
      kind: "plan",
      title,
      status: "in_progress",
      sortOrder: 0,
      source: "manual",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
    notes: [{ id: "n-1", body: "Complete Step 2 implementation", source: "manual", createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z" }],
    activeSessions: [],
    children: [],
  };
}

describe("WorkflowContextRibbon", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders loading skeleton when isLoading is true", () => {
    act(() => {
      root.render(
        <WorkflowContextRibbon
          isOpen={false}
          onToggle={vi.fn()}
          isLoading={true}
        />,
      );
    });

    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("renders error state with retry button", () => {
    const handleRetry = vi.fn();
    act(() => {
      root.render(
        <WorkflowContextRibbon
          isOpen={false}
          onToggle={vi.fn()}
          error="Network timeout"
          onRetry={handleRetry}
        />,
      );
    });

    expect(container.textContent).toContain("Workflow error: Network timeout");
    const retryBtn = container.querySelector("button");
    act(() => {
      retryBtn?.click();
    });
    expect(handleRetry).toHaveBeenCalled();
  });

  it("explains profile-scoped workflow unavailability without controls", () => {
    act(() => {
      root.render(
        <WorkflowContextRibbon
          isOpen={true}
          onToggle={vi.fn()}
          onOpenQuickCapture={vi.fn()}
          isUnavailable={true}
        />,
      );
    });

    expect(container.textContent).toContain(
      "Workflow tracking is unavailable for this profile.",
    );
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("renders active plan title and next note preview", () => {
    const activeNode = createMockActiveNode("Surface Redesign");
    act(() => {
      root.render(
        <WorkflowContextRibbon
          target={{ project: "hopper-core" }}
          activeNode={activeNode}
          isOpen={false}
          onToggle={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("hopper-core");
    expect(container.textContent).toContain("Surface Redesign");
    expect(container.textContent).toContain("Next: Complete Step 2 implementation");
  });

  it("toggles deck on click", () => {
    const handleToggle = vi.fn();
    act(() => {
      root.render(
        <WorkflowContextRibbon
          target={{ project: "hopper-core" }}
          isOpen={false}
          onToggle={handleToggle}
        />,
      );
    });

    const trigger = container.querySelector('[role="button"]') as HTMLElement;
    act(() => {
      trigger?.click();
    });

    expect(handleToggle).toHaveBeenCalled();
  });
});
