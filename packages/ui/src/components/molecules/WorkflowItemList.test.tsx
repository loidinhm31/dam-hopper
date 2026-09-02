// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemOverviewNodeDto } from "@/api/workflow-dto-types.js";
import { WorkflowItemList } from "./WorkflowItemList.js";

function createMockPlanNode(id: string, title: string, children: ItemOverviewNodeDto[] = []): ItemOverviewNodeDto {
  return {
    item: {
      id,
      target: { project: "demo" },
      kind: "plan",
      title,
      status: "in_progress",
      sortOrder: 0,
      source: "manual",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    },
    notes: [],
    activeSessions: [],
    children,
  };
}

describe("WorkflowItemList", () => {
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

  it("renders empty state when no plans or tasks are provided", () => {
    act(() => {
      root.render(
        <WorkflowItemList
          plans={[]}
          standaloneTasks={[]}
          onSelectItem={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("No plans or tasks tracked yet.");
  });

  it("renders plans and nested children", () => {
    const task = createMockPlanNode("task-1", "Implement auth hook");
    task.item.kind = "task";
    const plan = createMockPlanNode("plan-1", "Auth Feature", [task]);

    act(() => {
      root.render(
        <WorkflowItemList
          plans={[plan]}
          standaloneTasks={[]}
          onSelectItem={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Auth Feature");
    expect(container.textContent).toContain("Implement auth hook");
  });

  it("triggers onSelectItem when clicking a row", () => {
    const plan = createMockPlanNode("plan-1", "Auth Feature");
    const handleSelect = vi.fn();

    act(() => {
      root.render(
        <WorkflowItemList
          plans={[plan]}
          standaloneTasks={[]}
          onSelectItem={handleSelect}
        />,
      );
    });

    const row = container.querySelector('[role="button"]') as HTMLElement;
    act(() => {
      row?.click();
    });

    expect(handleSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "plan-1", title: "Auth Feature" }),
    );
  });
});
