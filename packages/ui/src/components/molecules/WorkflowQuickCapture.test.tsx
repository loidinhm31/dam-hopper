// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowQuickCapture } from "./WorkflowQuickCapture.js";

describe("WorkflowQuickCapture", () => {
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

  it("renders with default plan kind", () => {
    act(() => {
      root.render(
        <WorkflowQuickCapture
          target={{ project: "proj-1" }}
          onSubmit={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("New Plan");
    expect(container.textContent).toContain("Title *");
  });

  it("validates empty title on submit", async () => {
    const handleSubmit = vi.fn();
    act(() => {
      root.render(
        <WorkflowQuickCapture
          target={{ project: "proj-1" }}
          onSubmit={handleSubmit}
        />,
      );
    });

    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(handleSubmit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Title is required");
  });

  it("submits valid form with target and title", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);
    act(() => {
      root.render(
        <WorkflowQuickCapture
          target={{ project: "proj-1", worktreePath: "wt-1" }}
          onSubmit={handleSubmit}
        />,
      );
    });

    const titleInput = container.querySelector("#wf-cap-title") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(titleInput, "New Feature Plan");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      titleInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(handleSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { project: "proj-1", worktreePath: "wt-1" },
        title: "New Feature Plan",
        kind: "plan",
        status: "backlog",
      }),
    );
  });
});
