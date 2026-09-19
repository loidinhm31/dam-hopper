// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryEditor } from "./MemoryEditor.js";

const mockUpdateMemoryMutate = vi.fn();
const mockApplyTemplateMutate = vi.fn();

vi.mock("@/api/queries.js", () => ({
  useMemoryFile: vi.fn(() => ({
    data: "Initial content",
    isLoading: false,
    isFetching: false,
  })),
  useMemoryTemplates: vi.fn(() => ({
    data: [
      {
        name: "template-1",
        description: "Template 1",
        content: "Template content",
      },
    ],
  })),
  useUpdateMemoryFile: vi.fn(() => ({
    mutateAsync: mockUpdateMemoryMutate,
    isPending: false,
  })),
  useApplyMemoryTemplate: vi.fn(() => ({
    mutateAsync: mockApplyTemplateMutate,
    isPending: false,
  })),
}));

describe("MemoryEditor", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  const mockProjects = [
    { name: "project-1", path: "/path/1" },
    { name: "project-2", path: "/path/2" },
  ];

  beforeEach(() => {
    mockUpdateMemoryMutate.mockReset();
    mockApplyTemplateMutate.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it("shows ConfirmDialog when switching project with unsaved changes", async () => {
    await act(async () => {
      root?.render(<MemoryEditor projects={mockProjects} />);
    });

    const textarea = container?.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).toBeTruthy();

    // Type into textarea to make it dirty
    const setTextValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      if (textarea) {
        setTextValue?.call(textarea, "Modified content");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    // Try switching project
    const projectSelect = container?.querySelector<HTMLSelectElement>("select");
    expect(projectSelect).toBeTruthy();

    await act(async () => {
      if (projectSelect) {
        projectSelect.value = "project-2";
        projectSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    // Confirm dialog should open
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(
      "Switch project? Your unsaved draft will be lost.",
    );

    // Click cancel in dialog
    const cancelBtn = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((btn) => btn.textContent?.includes("Cancel"));
    expect(cancelBtn).toBeTruthy();

    await act(async () => {
      cancelBtn?.click();
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows ConfirmDialog when switching agent with unsaved changes and switches on confirm", async () => {
    await act(async () => {
      root?.render(<MemoryEditor projects={mockProjects} />);
    });

    const textarea = container?.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).toBeTruthy();

    // Type into textarea to make it dirty
    const setTextValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      if (textarea) {
        setTextValue?.call(textarea, "Modified content");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    // Find Gemini button to switch agent
    const geminiBtn = [
      ...(container?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ].find((btn) => btn.textContent?.includes("Gemini"));
    expect(geminiBtn).toBeTruthy();

    await act(async () => {
      geminiBtn?.click();
    });

    // Confirm dialog should open
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(
      "Switch agent? Your unsaved draft will be lost.",
    );

    // Click confirm (Switch) in dialog
    const switchBtn = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
    ].find((btn) => btn.textContent?.includes("Switch"));
    expect(switchBtn).toBeTruthy();

    await act(async () => {
      switchBtn?.click();
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
