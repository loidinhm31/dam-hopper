// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowContextSheet } from "./WorkflowContextSheet.js";

describe("WorkflowContextSheet", () => {
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

  it("renders when isOpen is true with segmented navigation", () => {
    act(() => {
      root.render(
        <WorkflowContextSheet
          isOpen={true}
          onOpenChange={vi.fn()}
          projects={[]}
          plans={[]}
          standaloneTasks={[]}
          sessions={[]}
          onSelectTarget={vi.fn()}
          onSelectItem={vi.fn()}
        />,
      );
    });

    expect(document.body.textContent).toContain("Workflow Context");
    expect(document.body.textContent).toContain("Projects");
    expect(document.body.textContent).toContain("Plans");
    expect(document.body.textContent).toContain("Execution");
  });

  it("switches segment when clicking segment buttons", () => {
    const handleSegmentChange = vi.fn();
    act(() => {
      root.render(
        <WorkflowContextSheet
          isOpen={true}
          onOpenChange={vi.fn()}
          projects={[]}
          plans={[]}
          standaloneTasks={[]}
          sessions={[]}
          onSegmentChange={handleSegmentChange}
          onSelectTarget={vi.fn()}
          onSelectItem={vi.fn()}
        />,
      );
    });

    const projectsBtn = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Projects"),
    );

    act(() => {
      projectsBtn?.click();
    });

    expect(handleSegmentChange).toHaveBeenCalledWith("projects");
  });
  it("passes onDeleteItem to WorkflowItemList in items segment and renders delete button", () => {
    const handleDeleteItem = vi.fn();
    const mockPlan = {
      item: {
        id: "plan-1",
        target: { project: "p1" },
        kind: "plan" as const,
        title: "Mobile Plan to delete",
        status: "in_progress" as const,
        sortOrder: 0,
        source: "manual" as const,
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
      },
      notes: [],
      activeSessions: [],
      children: [],
    };

    act(() => {
      root.render(
        <WorkflowContextSheet
          isOpen={true}
          onOpenChange={vi.fn()}
          projects={[]}
          plans={[mockPlan]}
          standaloneTasks={[]}
          sessions={[]}
          selectedItemId="plan-1"
          activeSegment="items"
          onSelectTarget={vi.fn()}
          onSelectItem={vi.fn()}
          onDeleteItem={handleDeleteItem}
        />,
      );
    });

    const deleteBtn = document.body.querySelector('button[title="Delete item"]') as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();

    act(() => {
      deleteBtn.click();
    });

    expect(handleDeleteItem).toHaveBeenCalledWith(mockPlan.item);
  });
});
