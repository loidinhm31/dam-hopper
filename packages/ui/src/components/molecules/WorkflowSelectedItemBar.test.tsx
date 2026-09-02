// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemOverviewNodeDto } from "@/api/workflow-dto-types.js";
import { WorkflowSelectedItemBar } from "./WorkflowSelectedItemBar.js";

function createMockPlanNode(id: string, title: string): ItemOverviewNodeDto {
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
    children: [],
  };
}

describe("WorkflowSelectedItemBar", () => {
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

  it("renders selected item title and note trigger", () => {
    const node = createMockPlanNode("plan-1", "Refactor Auth");
    act(() => {
      root.render(
        <WorkflowSelectedItemBar
          selectedNode={node}
          onAddNote={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Selected: Refactor Auth");
    expect(container.textContent).toContain("Note");
  });

  it("opens note textarea when Note button is clicked and submits note", () => {
    const node = createMockPlanNode("plan-1", "Refactor Auth");
    const handleAddNote = vi.fn();
    act(() => {
      root.render(
        <WorkflowSelectedItemBar
          selectedNode={node}
          onAddNote={handleAddNote}
        />,
      );
    });

    const noteBtn = container.querySelector("button:has(svg)") as HTMLButtonElement;
    act(() => {
      noteBtn.click();
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.placeholder).toContain("Next action or note...");

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "Line 1: Next step\nLine 2: Context");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const addBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Add",
    ) as HTMLButtonElement;

    act(() => {
      addBtn?.click();
    });

    expect(handleAddNote).toHaveBeenCalledWith(
      "plan-1",
      "Line 1: Next step\nLine 2: Context",
    );
  });
  it("submits note with Ctrl+Enter and cancels on Escape", () => {
    const node = createMockPlanNode("plan-1", "Refactor Auth");
    const handleAddNote = vi.fn();
    act(() => {
      root.render(
        <WorkflowSelectedItemBar
          selectedNode={node}
          onAddNote={handleAddNote}
        />,
      );
    });

    const noteBtn = container.querySelector("button:has(svg)") as HTMLButtonElement;
    act(() => {
      noteBtn.click();
    });

    let textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "Quick keyboard note");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
    });

    expect(handleAddNote).toHaveBeenCalledWith("plan-1", "Quick keyboard note");

    // Open note again and cancel on Escape
    const reopenNoteBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Note"),
    ) as HTMLButtonElement;
    act(() => {
      reopenNoteBtn?.click();
    });
    textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(container.querySelector("textarea")).toBeNull();
  });
});
