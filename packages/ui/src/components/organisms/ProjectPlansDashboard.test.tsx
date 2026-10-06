// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionRef } from "@/api/ownership.js";
import type { ApiClient } from "@/api/client.js";
import type { Transport } from "@/api/transport.js";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
} from "@/api/connections.js";
import type {
  PlanFoldersResponse,
  SelectedPlanResponse,
} from "@/api/project-plans-types.js";
import { ProjectPlansDashboard } from "./ProjectPlansDashboard.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ProjectPlansDashboard", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let qc: QueryClient;

  const mockOwner: ConnectionRef = {
    profileId: "test-profile-1",
    generation: 1,
  };

  const mockTarget = {
    project: "dam-hopper",
    worktreePath: null,
  };

  const dummyRef = { path: "plans/plan-a/plan.md", lineStart: 1, lineEnd: 1 };

  const mockFoldersData: PlanFoldersResponse = {
    target: {
      project: "dam-hopper",
      worktreePath: null,
      targetKey: "dam-hopper",
    },
    path: "plans",
    kind: "collection",
    folderState: "present",
    folders: [
      { name: "261001-plan-a", path: "plans/261001-plan-a" },
    ],
    listing: {
      complete: true,
      entriesVisited: 1,
      limitsReached: [],
    },
    watchPaths: ["plans"],
    diagnostics: [],
  };

  const mockPlanFoldersResponseAsPlan: PlanFoldersResponse = {
    target: {
      project: "dam-hopper",
      worktreePath: null,
      targetKey: "dam-hopper",
    },
    path: "plans/261001-plan-a",
    kind: "plan",
    folderState: "present",
    folders: [],
    listing: {
      complete: true,
      entriesVisited: 0,
      limitsReached: [],
    },
    watchPaths: ["plans/261001-plan-a"],
    diagnostics: [],
  };

  const mockSelectedPlanData: SelectedPlanResponse = {
    target: {
      project: "dam-hopper",
      worktreePath: null,
      targetKey: "dam-hopper",
    },
    plan: {
      id: "plans/261001-plan-a",
      title: "Plan A Title",
      description: "Description of Plan A",
      metadata: {
        priority: "P1",
        effort: "10h",
        issue: null,
        branch: "feat/a",
        tags: ["core"],
      },
      documents: {
        plan: {
          path: "plans/261001-plan-a/plan.md",
          state: "readable",
          sizeBytes: 100,
          modifiedAt: "2026-10-06T12:00:00Z",
        },
        progress: {
          path: "plans/261001-plan-a/progress.md",
          state: "absent",
          sizeBytes: null,
          modifiedAt: null,
        },
      },
      reportedStatus: {
        value: "in-progress",
        authority: "plan",
        raw: "in-progress",
        evidence: [dummyRef],
        captured: [],
      },
      phases: [],
      completion: {
        declared: 0,
        completed: 0,
        unknown: 0,
        conflicted: 0,
        fraction: null,
      },
      dates: {
        created: null,
        plannedStart: null,
        plannedEnd: null,
        actualStart: null,
        actualEnd: null,
        published: null,
      },
      lastDocumentUpdate: "2026-10-06T12:00:00Z",
      diagnostics: [],
    },
    watchPaths: ["plans/261001-plan-a"],
    diagnostics: [],
  };

  let mockClient: unknown;
  let mockTransport: unknown;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    mockClient = {
      plans: {
        folders: vi.fn().mockImplementation((_target, path) => {
          if (path === "plans/261001-plan-a") {
            return Promise.resolve(mockPlanFoldersResponseAsPlan);
          }
          return Promise.resolve(mockFoldersData);
        }),
        read: vi.fn().mockResolvedValue(mockSelectedPlanData),
      },
      fs: {
        read: vi.fn().mockResolvedValue({
          data: "# Plan A Content",
          mimeType: "text/markdown",
          sizeBytes: 16,
        }),
      },
    };

    mockTransport = {
      fsSubscribeTree: vi.fn().mockResolvedValue({ sub_id: 1 }),
      fsUnsubscribeTree: vi.fn().mockResolvedValue(undefined),
      onFsEvent: vi.fn().mockReturnValue(() => {}),
      onFsOverflow: vi.fn().mockReturnValue(() => {}),
    };

    __setConnectionSnapshotForTests(mockOwner.profileId, {
      owner: mockOwner,
      status: "connected",
      serverUrl: "http://127.0.0.1:4801",
      transport: mockTransport as Transport,
      api: mockClient as ApiClient,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    if (container && document.body.contains(container)) {
      document.body.removeChild(container);
      container = null;
    }
    resetConnections();
    qc.clear();
  });

  it("renders folder browser initially and shows folder entries", async () => {
    await act(async () => {
      root?.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(ProjectPlansDashboard, {
            owner: mockOwner,
            target: mockTarget,
          }),
        ),
      );
    });

    expect(container?.innerHTML).toContain("261001-plan-a");
    expect(container?.innerHTML).toContain("plans");
  });

  it("navigates into plan when folder item is clicked", async () => {
    await act(async () => {
      root?.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(ProjectPlansDashboard, {
            owner: mockOwner,
            target: mockTarget,
          }),
        ),
      );
    });

    expect(container?.innerHTML).toContain("261001-plan-a");

    const folderButton = container?.querySelector(
      'button[role="listitem"]',
    ) as HTMLButtonElement | null;
    expect(folderButton).not.toBeNull();

    await act(async () => {
      folderButton?.click();
    });

    // Wait for selected plan query to resolve and view to update
    await act(async () => {
      await Promise.resolve();
    });

    expect(container?.innerHTML).toContain("Plan A Title");
    expect(container?.innerHTML).toContain("Overview");
    expect(container?.innerHTML).toContain("Timeline");
    expect(container?.innerHTML).toContain("Documents");

    // Click back button to return to folders
    const backBtn = container?.querySelector('button[aria-label="Back to folder browser"]') as HTMLButtonElement | null;
    expect(backBtn).not.toBeNull();

    await act(async () => {
      backBtn?.click();
    });

    expect(container?.innerHTML).toContain("261001-plan-a");
  });
});
