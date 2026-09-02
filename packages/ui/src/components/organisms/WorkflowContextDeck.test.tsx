// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowContextDeck } from "./WorkflowContextDeck.js";

describe("WorkflowContextDeck", () => {
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

  it("does not render when isOpen is false", () => {
    act(() => {
      root.render(
        <WorkflowContextDeck
          isOpen={false}
          onClose={vi.fn()}
          projects={[]}
          plans={[]}
          standaloneTasks={[]}
          sessions={[]}
          onSelectTarget={vi.fn()}
          onSelectItem={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toBe("");
  });

  it("renders when isOpen is true and restores focus before close button", () => {
    const handleClose = vi.fn();
    const handleCloseAutoFocus = vi.fn();
    act(() => {
      root.render(
        <WorkflowContextDeck
          isOpen={true}
          onClose={handleClose}
          onCloseAutoFocus={handleCloseAutoFocus}
          projects={[]}
          plans={[]}
          standaloneTasks={[]}
          sessions={[]}
          onSelectTarget={vi.fn()}
          onSelectItem={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Workflow Deck");

    const closeBtn = container.querySelector('button[aria-label="Close workflow deck"]') as HTMLButtonElement;
    act(() => {
      closeBtn?.click();
    });

    expect(handleCloseAutoFocus).toHaveBeenCalledOnce();
    expect(handleClose).toHaveBeenCalledOnce();
  });

  it("restores focus before closing on Escape", () => {
    const handleClose = vi.fn();
    const handleCloseAutoFocus = vi.fn();
    act(() => {
      root.render(
        <WorkflowContextDeck
          isOpen={true}
          onClose={handleClose}
          onCloseAutoFocus={handleCloseAutoFocus}
          projects={[]}
          plans={[]}
          standaloneTasks={[]}
          sessions={[]}
          onSelectTarget={vi.fn()}
          onSelectItem={vi.fn()}
        />,
      );
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(handleCloseAutoFocus).toHaveBeenCalledOnce();
    expect(handleClose).toHaveBeenCalledOnce();
  });
});
