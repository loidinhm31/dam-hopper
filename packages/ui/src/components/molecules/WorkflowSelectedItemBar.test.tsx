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

  it("renders existing notes and triggers onDeleteNote", () => {
    const node = createMockPlanNode("plan-1", "Refactor Auth");
    node.notes = [
      {
        id: "note-1",
        itemId: "plan-1",
        body: "First preserved note",
        source: "manual",
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
      },
      {
        id: "note-2",
        itemId: "plan-1",
        body: "Second preserved note",
        source: "manual",
        createdAt: "2026-09-01T11:00:00.000Z",
        updatedAt: "2026-09-01T11:00:00.000Z",
      },
    ];

    const handleDeleteNote = vi.fn();
    act(() => {
      root.render(
        <WorkflowSelectedItemBar
          selectedNode={node}
          onDeleteNote={handleDeleteNote}
        />,
      );
    });

    expect(container.textContent).toContain("Notes (2)");
    expect(container.textContent).toContain("First preserved note");
    expect(container.textContent).toContain("Second preserved note");

    const deleteNoteBtns = container.querySelectorAll('button[title="Delete note"]');
    expect(deleteNoteBtns.length).toBe(2);

    act(() => {
      (deleteNoteBtns[0] as HTMLButtonElement).click();
    });

    expect(handleDeleteNote).toHaveBeenCalledWith(node.notes[0]);
  });

  it("opens edit form, submits updated title and summary via onEditItem", () => {
    const node = createMockPlanNode("plan-1", "Refactor Auth");
    node.item.summary = "Initial summary";
    const handleEditItem = vi.fn();

    act(() => {
      root.render(
        <WorkflowSelectedItemBar
          selectedNode={node}
          onEditItem={handleEditItem}
        />,
      );
    });

    const editBtn = container.querySelector('button[title="Edit item"]') as HTMLButtonElement;
    expect(editBtn).not.toBeNull();

    act(() => {
      editBtn.click();
    });

    const titleInput = container.querySelector("#wf-edit-title") as HTMLInputElement;
    const summaryTextarea = container.querySelector("#wf-edit-summary") as HTMLTextAreaElement;
    expect(titleInput).not.toBeNull();
    expect(summaryTextarea).not.toBeNull();
    expect(titleInput.value).toBe("Refactor Auth");
    expect(summaryTextarea.value).toBe("Initial summary");

    act(() => {
      const titleSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      titleSetter?.call(titleInput, "New Plan Title");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      titleInput.dispatchEvent(new Event("change", { bubbles: true }));

      const summarySetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      summarySetter?.call(summaryTextarea, "New Plan Summary");
      summaryTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      summaryTextarea.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Save",
    ) as HTMLButtonElement;

    act(() => {
      saveBtn.click();
    });

    expect(handleEditItem).toHaveBeenCalledWith(node.item, {
      title: "New Plan Title",
      summary: "New Plan Summary",
    });
    expect(container.querySelector("#wf-edit-title")).toBeNull();
  });

  it("cancels edit mode without calling onEditItem", () => {
    const node = createMockPlanNode("plan-1", "Refactor Auth");
    const handleEditItem = vi.fn();

    act(() => {
      root.render(
        <WorkflowSelectedItemBar
          selectedNode={node}
          onEditItem={handleEditItem}
        />,
      );
    });

    const editBtn = container.querySelector('button[title="Edit item"]') as HTMLButtonElement;
    act(() => {
      editBtn.click();
    });

    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Cancel",
    ) as HTMLButtonElement;

    act(() => {
      cancelBtn.click();
    });

    expect(handleEditItem).not.toHaveBeenCalled();
    expect(container.querySelector("#wf-edit-title")).toBeNull();
  });

  it("submits edit form with Enter on title input and cancels with Escape", () => {
    const node = createMockPlanNode("plan-1", "Refactor Auth");
    const handleEditItem = vi.fn();

    act(() => {
      root.render(
        <WorkflowSelectedItemBar
          selectedNode={node}
          onEditItem={handleEditItem}
        />,
      );
    });

    const editBtn = container.querySelector('button[title="Edit item"]') as HTMLButtonElement;
    act(() => {
      editBtn.click();
    });

    let titleInput = container.querySelector("#wf-edit-title") as HTMLInputElement;
    expect(titleInput).not.toBeNull();

    act(() => {
      const titleSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      titleSetter?.call(titleInput, "Title via Enter");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      titleInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Press Enter in title input
    act(() => {
      titleInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(handleEditItem).toHaveBeenCalledWith(node.item, {
      title: "Title via Enter",
      summary: null,
    });
    expect(container.querySelector("#wf-edit-title")).toBeNull();

    // Re-open and cancel on Escape in title input
    const reopenBtn = container.querySelector('button[title="Edit item"]') as HTMLButtonElement;
    act(() => {
      reopenBtn.click();
    });
    titleInput = container.querySelector("#wf-edit-title") as HTMLInputElement;
    expect(titleInput).not.toBeNull();

    act(() => {
      titleInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(container.querySelector("#wf-edit-title")).toBeNull();
  });

  it("submits edit form with Ctrl+Enter on summary textarea and cancels with Escape", () => {
    const node = createMockPlanNode("plan-1", "Refactor Auth");
    const handleEditItem = vi.fn();

    act(() => {
      root.render(
        <WorkflowSelectedItemBar
          selectedNode={node}
          onEditItem={handleEditItem}
        />,
      );
    });

    const editBtn = container.querySelector('button[title="Edit item"]') as HTMLButtonElement;
    act(() => {
      editBtn.click();
    });

    let summaryTextarea = container.querySelector("#wf-edit-summary") as HTMLTextAreaElement;
    expect(summaryTextarea).not.toBeNull();

    act(() => {
      const summarySetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      summarySetter?.call(summaryTextarea, "Summary via Ctrl+Enter");
      summaryTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      summaryTextarea.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Press Ctrl+Enter in summary textarea
    act(() => {
      summaryTextarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
    });

    expect(handleEditItem).toHaveBeenCalledWith(node.item, {
      title: "Refactor Auth",
      summary: "Summary via Ctrl+Enter",
    });
    expect(container.querySelector("#wf-edit-summary")).toBeNull();

    // Re-open and cancel on Escape in summary textarea
    const reopenBtn = container.querySelector('button[title="Edit item"]') as HTMLButtonElement;
    act(() => {
      reopenBtn.click();
    });
    summaryTextarea = container.querySelector("#wf-edit-summary") as HTMLTextAreaElement;
    expect(summaryTextarea).not.toBeNull();

    act(() => {
      summaryTextarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(container.querySelector("#wf-edit-summary")).toBeNull();
  });
});
