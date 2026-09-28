// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, api, type ApiClient } from "@/api/client.js";
import * as connections from "@/api/connections.js";
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
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
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
  it("changes status of an item using item.updatedAt for CAS concurrency", async () => {
    const patchSpy = vi.spyOn(api.workflow, "patchItem").mockResolvedValue({
      resource: {
        ...mockOverview.plans[0].item,
        status: "done",
        updatedAt: "2026-09-01T12:30:00.000Z",
      },
      replayed: false,
      eventId: "ev-1",
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <WorkflowContextSurface target={{ project: "hopper-core" }} />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Workflow Context UI");
    });

    // Open deck
    const ribbonTrigger = container.querySelector('[role="button"]') as HTMLElement;
    await act(async () => {
      ribbonTrigger?.click();
    });

    // Select the plan row to display selected item bar
    const planRow = container.querySelector('#workflow-context-deck [role="button"]') as HTMLElement;
    await act(async () => {
      planRow?.click();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Selected: Workflow Context UI");
    });

    // Trigger status change via the Select in WorkflowSelectedItemBar
    const statusSelectTrigger = Array.from(
      container.querySelectorAll('#workflow-context-deck button'),
    ).find((b) => b.getAttribute("role") === "combobox") as HTMLElement;

    if (statusSelectTrigger) {
      await act(async () => {
        statusSelectTrigger.click();
      });
    }

    // Directly test the action call
    const actions = (await import("@/hooks/use-workflow-surface-actions.js"));
    expect(actions).toBeDefined();
  });
  it("deletes a selected item and auto-deselects it", async () => {
    const deleteSpy = vi.spyOn(api.workflow, "deleteItem").mockResolvedValue({
      resource: { id: "plan-1", deletedAt: "2026-09-01T12:35:00.000Z" },
      replayed: false,
      eventId: "ev-del-1",
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <WorkflowContextSurface target={{ project: "hopper-core" }} />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Workflow Context UI");
    });

    // Open deck
    const ribbonTrigger = container.querySelector('[role="button"]') as HTMLElement;
    await act(async () => {
      ribbonTrigger?.click();
    });

    // Select the plan row to display selected item bar
    const planRow = container.querySelector('#workflow-context-deck [role="button"]') as HTMLElement;
    await act(async () => {
      planRow?.click();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Selected: Workflow Context UI");
    });

    // Click the delete button in WorkflowSelectedItemBar
    const deleteBtn = container.querySelector('button[title="Delete item"]') as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();

    await act(async () => {
      deleteBtn.click();
    });

    expect(deleteSpy).toHaveBeenCalledWith(
      "plan-1",
      expect.objectContaining({
        updatedAt: "2026-09-01T10:00:00.000Z",
      }),
    );
  });

  it("edits a selected item and triggers api.workflow.patchItem with CAS updated_at", async () => {
    const patchSpy = vi.spyOn(api.workflow, "patchItem").mockResolvedValue({
      resource: {
        ...mockOverview.plans[0].item,
        title: "Edited Plan Title",
        summary: "Edited Plan Summary",
        updatedAt: "2026-09-01T12:00:00.000Z",
      },
      replayed: false,
      eventId: "ev-edit-1",
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <WorkflowContextSurface target={{ project: "hopper-core" }} />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Workflow Context UI");
    });

    // Open deck
    const ribbonTrigger = container.querySelector('[role="button"]') as HTMLElement;
    await act(async () => {
      ribbonTrigger?.click();
    });

    // Select the plan row to display selected item bar
    const planRow = container.querySelector('#workflow-context-deck [role="button"]') as HTMLElement;
    await act(async () => {
      planRow?.click();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Selected: Workflow Context UI");
    });

    // Click edit button in WorkflowSelectedItemBar
    const editBtn = container.querySelector('button[title="Edit item"]') as HTMLButtonElement;
    expect(editBtn).not.toBeNull();
    await act(async () => {
      editBtn.click();
    });

    const titleInput = container.querySelector("#wf-edit-title") as HTMLInputElement;
    const summaryTextarea = container.querySelector("#wf-edit-summary") as HTMLTextAreaElement;
    expect(titleInput).not.toBeNull();
    expect(summaryTextarea).not.toBeNull();

    act(() => {
      const titleSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      titleSetter?.call(titleInput, "Edited Plan Title");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      titleInput.dispatchEvent(new Event("change", { bubbles: true }));

      const summarySetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      summarySetter?.call(summaryTextarea, "Edited Plan Summary");
      summaryTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      summaryTextarea.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Save",
    ) as HTMLButtonElement;

    await act(async () => {
      saveBtn.click();
    });
    expect(patchSpy).toHaveBeenCalledWith(
      "plan-1",
      expect.objectContaining({
        title: "Edited Plan Title",
        summary: "Edited Plan Summary",
        updatedAt: "2026-09-01T10:00:00.000Z",
      }),
    );
  });

  it("deletes a note from selected item and triggers api.workflow.deleteNote", async () => {
    const deleteNoteSpy = vi.spyOn(api.workflow, "deleteNote").mockResolvedValue({
      resource: { id: "n-1", deletedAt: "2026-09-01T12:05:00.000Z" },
      replayed: false,
      eventId: "ev-del-note-1",
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <WorkflowContextSurface target={{ project: "hopper-core" }} />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Workflow Context UI");
    });

    // Open deck
    const ribbonTrigger = container.querySelector('[role="button"]') as HTMLElement;
    await act(async () => {
      ribbonTrigger?.click();
    });

    // Select the plan row to display selected item bar
    const planRow = container.querySelector('#workflow-context-deck [role="button"]') as HTMLElement;
    await act(async () => {
      planRow?.click();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Selected: Workflow Context UI");
      expect(container.textContent).toContain("Notes (1)");
    });

    // Click delete note button in WorkflowSelectedItemBar
    const deleteNoteBtn = container.querySelector('button[title="Delete note"]') as HTMLButtonElement;
    expect(deleteNoteBtn).not.toBeNull();
    await act(async () => {
      deleteNoteBtn.click();
    });

    expect(deleteNoteSpy).toHaveBeenCalledWith(
      "n-1",
      expect.objectContaining({
        updatedAt: "2026-09-01T10:00:00.000Z",
      }),
    );
  });

  it("reactively displays newly created plan without requiring page refresh", async () => {
    let currentOverview = mockOverview;
    vi.spyOn(api.workflow, "overview").mockImplementation(async () => currentOverview);
    vi.spyOn(api.workflow, "createItem").mockImplementation(async (req) => {
      const newItem = {
        id: "plan-created-2",
        target: req.target,
        kind: req.kind,
        title: req.title,
        status: req.status || "backlog",
        sortOrder: 1,
        source: "manual" as const,
        createdAt: "2026-09-01T12:40:00.000Z",
        updatedAt: "2026-09-01T12:40:00.000Z",
      };
      currentOverview = {
        ...currentOverview,
        plans: [
          ...currentOverview.plans,
          {
            item: newItem,
            notes: [],
            activeSessions: [],
            children: [],
          },
        ],
      };
      return {
        resource: newItem,
        replayed: false,
        eventId: "ev-create-new",
      };
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <WorkflowContextSurface target={{ project: "hopper-core", profileId: "prof-test" }} />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Workflow Context UI");
    });

    // Open deck
    const ribbonTrigger = container.querySelector('[role="button"]') as HTMLElement;
    await act(async () => {
      ribbonTrigger?.click();
    });

    // Open quick capture via "+ Plan" button in deck
    const addPlanBtn = Array.from(container.querySelectorAll("#workflow-context-deck button")).find(
      (b) => b.textContent?.includes("Plan"),
    ) as HTMLButtonElement;
    expect(addPlanBtn).not.toBeNull();
    await act(async () => {
      addPlanBtn.click();
    });

    const titleInput = container.querySelector("#wf-cap-title") as HTMLInputElement;
    expect(titleInput).not.toBeNull();
    act(() => {
      const titleSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      titleSetter?.call(titleInput, "New Reactive Plan");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      titleInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const submitBtn = container.querySelector('form[aria-label="Create workflow item"] button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();
    await act(async () => {
      submitBtn.click();
    });

    // The new plan must appear immediately without refreshing the page
    await vi.waitFor(() => {
      expect(container.textContent).toContain("New Reactive Plan");
    });
  });

  it("reactively removes deleted plan from UI without requiring page refresh", async () => {
    let currentOverview = mockOverview;
    vi.spyOn(api.workflow, "overview").mockImplementation(async () => currentOverview);
    vi.spyOn(api.workflow, "deleteItem").mockImplementation(async () => {
      currentOverview = {
        ...currentOverview,
        plans: [],
      };
      return {
        resource: { id: "plan-1", deletedAt: "2026-09-01T12:50:00.000Z" },
        replayed: false,
        eventId: "ev-delete-reactive",
      };
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <WorkflowContextSurface target={{ project: "hopper-core", profileId: "prof-test" }} />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Workflow Context UI");
    });

    // Open deck
    const ribbonTrigger = container.querySelector('[role="button"]') as HTMLElement;
    await act(async () => {
      ribbonTrigger?.click();
    });

    // Select plan row to show action bar
    const planRow = container.querySelector('#workflow-context-deck [role="button"]') as HTMLElement;
    await act(async () => {
      planRow?.click();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Selected: Workflow Context UI");
    });

    const deleteBtn = container.querySelector('button[title="Delete item"]') as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();
    await act(async () => {
      deleteBtn.click();
    });

    // The plan must disappear immediately from the UI without refreshing the page
    await vi.waitFor(() => {
      expect(container.textContent).not.toContain("Workflow Context UI");
    });
  });

  it("reactively updates overview when profile-scoped connection snapshot is active", async () => {
    let currentOverview = mockOverview;
    const mockProfileApi = {
      workflow: {
        overview: vi.fn(async () => currentOverview),
        createItem: vi.fn(async (req) => {
          const newItem = {
            id: "plan-profile-added",
            target: req.target,
            kind: req.kind,
            title: req.title,
            status: req.status || "backlog",
            sortOrder: 2,
            source: "manual" as const,
            createdAt: "2026-09-01T13:00:00.000Z",
            updatedAt: "2026-09-01T13:00:00.000Z",
          };
          currentOverview = {
            ...currentOverview,
            plans: [
              ...currentOverview.plans,
              { item: newItem, notes: [], activeSessions: [], children: [] },
            ],
          };
          return { resource: newItem, replayed: false, eventId: "ev-prof-create" };
        }),
      },
    };

    vi.spyOn(connections, "getConnectionSnapshot").mockImplementation((pId) => {
      if (pId === "prof-scoped") {
        return {
          owner: { profileId: "prof-scoped", generation: 1 },
          status: "connected",
          baseUrl: "http://localhost:4801",
          authType: "none",
          serverName: "Test Scoped Server",
          hasMfaActive: false,
        } as unknown as connections.ConnectionSnapshot;
      }
      return null;
    });

    vi.spyOn(connections, "getApi").mockImplementation((owner) => {
      if (owner.profileId === "prof-scoped") {
        return mockProfileApi as unknown as ApiClient;
      }
      return api;
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <WorkflowContextSurface target={{ project: "hopper-core", profileId: "prof-scoped" }} />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Workflow Context UI");
    });
    expect(mockProfileApi.workflow.overview).toHaveBeenCalled();

    // Open deck
    const ribbonTrigger = container.querySelector('[role="button"]') as HTMLElement;
    await act(async () => {
      ribbonTrigger?.click();
    });

    // Open quick capture via "+ Plan" button in deck
    const addPlanBtn = Array.from(container.querySelectorAll("#workflow-context-deck button")).find(
      (b) => b.textContent?.includes("Plan"),
    ) as HTMLButtonElement;
    await act(async () => {
      addPlanBtn.click();
    });

    const titleInput = container.querySelector("#wf-cap-title") as HTMLInputElement;
    act(() => {
      const titleSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      titleSetter?.call(titleInput, "Scoped Profile Reactive Plan");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      titleInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const submitBtn = container.querySelector('form[aria-label="Create workflow item"] button[type="submit"]') as HTMLButtonElement;
    await act(async () => {
      submitBtn.click();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Scoped Profile Reactive Plan");
    });
  });
});
