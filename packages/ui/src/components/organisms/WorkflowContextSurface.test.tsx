// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api } from "@/api/client.js";
import type { OverviewDto } from "@/api/workflow-dto-types.js";
import { WorkflowContextSurface } from "./WorkflowContextSurface.js";

const mockOverview: OverviewDto = {
  workspace: { id: "ws-1", name: "Default" },
  serverTime: "2026-09-01T12:00:00.000Z",
  projects: [
    {
      project: "hopper-core",
      target: { project: "hopper-core", worktreePath: null },
      planCount: 2,
      taskCount: 5,
      runningSessionCount: 1,
      lastActivityAt: "2026-09-01T12:00:00.000Z",
    },
  ],
  plans: [
    {
      item: {
        id: "plan-1",
        target: { project: "hopper-core", worktreePath: null },
        kind: "plan",
        title: "Workflow Context UI",
        summary: "Build responsive surface",
        status: "in_progress",
        sortOrder: 0,
        source: "manual",
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
      },
      notes: [
        {
          id: "n-1",
          body: "Implement Step 2.9 Surface",
          source: "manual",
          createdAt: "2026-09-01T10:00:00.000Z",
          updatedAt: "2026-09-01T10:00:00.000Z",
        },
      ],
      activeSessions: [
        {
          id: "s-1",
          target: { project: "hopper-core", worktreePath: null },
          itemId: "plan-1",
          status: "running",
          startedAt: "2026-09-01T11:00:00.000Z",
          source: "manual",
          createdAt: "2026-09-01T11:00:00.000Z",
          updatedAt: "2026-09-01T11:00:00.000Z",
        },
      ],
      children: [],
      progress: {
        totalTrackedTasks: 0,
        completedTrackedTasks: 0,
      },
    },
  ],
  standaloneTasks: [],
  runningSessions: [],
  recentEvents: [],
  truncated: false,
};

describe("WorkflowContextSurface", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.spyOn(api.workflow, "overview").mockResolvedValue(mockOverview);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders ribbon and responds to toggle to show desktop deck", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <WorkflowContextSurface target={{ project: "hopper-core" }} />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("hopper-core");
      expect(container.textContent).toContain("Workflow Context UI");
    });

    // Initially deck is closed
    expect(container.querySelector("#workflow-context-deck")).toBeNull();

    // Toggle ribbon
    const ribbonTrigger = container.querySelector('[role="button"]') as HTMLElement;
    await act(async () => {
      ribbonTrigger?.click();
    });

    expect(container.querySelector("#workflow-context-deck")).not.toBeNull();
  });

  it("hides workflow controls when this profile lacks the overview route", async () => {
    vi.mocked(api.workflow.overview).mockRejectedValueOnce(
      new ApiRequestError("workflow route unavailable", 404),
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <WorkflowContextSurface
            target={{ project: "hopper-core" }}
            isOpen={true}
          />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        "Workflow tracking is unavailable for this profile.",
      );
    });
    expect(container.querySelector("#workflow-context-deck")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("handles keyboard shortcut Mod+Shift+W to toggle surface", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <WorkflowContextSurface target={{ project: "hopper-core" }} />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("hopper-core");
    });

    expect(container.querySelector("#workflow-context-deck")).toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "W",
          code: "KeyW",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });

    expect(container.querySelector("#workflow-context-deck")).not.toBeNull();
  });
});
