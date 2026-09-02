// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionDto } from "@/api/workflow-dto-types.js";
import { WorkflowExecutionList } from "./WorkflowExecutionList.js";

function createMockSession(id: string, status: "running" | "ended"): SessionDto {
  return {
    id,
    target: { project: "proj-1" },
    itemId: "item-1",
    status,
    startedAt: "2026-09-01T10:00:00.000Z",
    endedAt: status === "ended" ? "2026-09-01T11:00:00.000Z" : null,
    source: "manual",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
}

describe("WorkflowExecutionList", () => {
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

  it("renders empty sessions notice when empty", () => {
    act(() => {
      root.render(
        <WorkflowExecutionList
          sessions={[]}
          onStartSession={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("No sessions recorded");
    expect(container.textContent).toContain("Start New Session");
  });

  it("renders running session and triggers end", () => {
    const session = createMockSession("s-1", "running");
    const handleEnd = vi.fn();

    act(() => {
      root.render(
        <WorkflowExecutionList
          sessions={[session]}
          onEndSession={handleEnd}
        />,
      );
    });

    expect(container.textContent).toContain("Active Session");

    const endBtn = container.querySelector('button[aria-label="End session"]') as HTMLButtonElement;
    act(() => {
      endBtn?.click();
    });

    expect(handleEnd).toHaveBeenCalledWith("s-1", expect.any(String));
  });

  it("triggers start session callback with timestamp", () => {
    const handleStart = vi.fn();

    act(() => {
      root.render(
        <WorkflowExecutionList
          sessions={[]}
          onStartSession={handleStart}
          selectedItemId="item-123"
        />,
      );
    });

    const startBtn = container.querySelectorAll("button")[1]; // Start button
    act(() => {
      startBtn?.click();
    });

    expect(handleStart).toHaveBeenCalledWith(expect.any(String), "item-123");
  });
});
