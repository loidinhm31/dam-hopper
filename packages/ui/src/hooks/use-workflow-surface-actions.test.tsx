// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client.js";
import type { ItemDto } from "@/api/workflow-dto-types.js";
import {
  useWorkflowSurfaceActions,
  type WorkflowSurfaceActions,
} from "./use-workflow-surface-actions.js";

const mockItem: ItemDto = {
  id: "item-1",
  target: { project: "test-proj" },
  kind: "task",
  title: "Test Task",
  status: "next",
  sortOrder: 0,
  source: "manual",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:15:00.000Z",
};

describe("useWorkflowSurfaceActions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("passes item.updatedAt for CAS optimistic concurrency on status change", async () => {
    const patchSpy = vi.spyOn(api.workflow, "patchItem").mockResolvedValue({
      resource: { ...mockItem, status: "in_progress", updatedAt: "2026-09-01T10:20:00.000Z" },
      replayed: false,
      eventId: "ev-patch-1",
    });

    let actionsResult!: WorkflowSurfaceActions;

    function TestComponent() {
      actionsResult = useWorkflowSurfaceActions({ project: "test-proj" });
      return null;
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TestComponent />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await actionsResult.handleStatusChange(mockItem, "in_progress");
    });

    expect(patchSpy).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({
        status: "in_progress",
        updatedAt: "2026-09-01T10:15:00.000Z", // exact item.updatedAt, NOT a new timestamp
      }),
    );
  });

  it("adds note with generated request id", async () => {
    const noteSpy = vi.spyOn(api.workflow, "createNote").mockResolvedValue({
      resource: {
        id: "note-1",
        itemId: "item-1",
        body: "Test note body",
        source: "manual",
        createdAt: "2026-09-01T10:20:00.000Z",
        updatedAt: "2026-09-01T10:20:00.000Z",
      },
      replayed: false,
      eventId: "ev-note-1",
    });

    let actionsResult!: WorkflowSurfaceActions;

    function TestComponent() {
      actionsResult = useWorkflowSurfaceActions({ project: "test-proj" });
      return null;
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TestComponent />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await actionsResult.handleAddNote("item-1", "Test note body");
    });

    expect(noteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "item-1",
        body: "Test note body",
      }),
    );
  });
  it("deletes item passing item.updatedAt for CAS optimistic concurrency", async () => {
    const deleteSpy = vi.spyOn(api.workflow, "deleteItem").mockResolvedValue({
      resource: { id: "item-1", deletedAt: "2026-09-01T10:25:00.000Z" },
      replayed: false,
      eventId: "ev-delete-1",
    });

    let actionsResult!: WorkflowSurfaceActions;

    function TestComponent() {
      actionsResult = useWorkflowSurfaceActions({ project: "test-proj" });
      return null;
    }

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <TestComponent />
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await actionsResult.handleDeleteItem(mockItem);
    });

    expect(deleteSpy).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({
        updatedAt: "2026-09-01T10:15:00.000Z", // exact item.updatedAt for CAS check
      }),
    );
  });
});
