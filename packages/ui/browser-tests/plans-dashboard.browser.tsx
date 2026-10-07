import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { ConnectionRef } from "@/api/ownership.js";
import type { ProjectTargetRef, ApiClient } from "@/api/client.js";
import type { Transport } from "@/api/transport.js";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
} from "@/api/connections.js";
import type {
  PlanFoldersResponse,
  SelectedPlanResponse,
  FilePlan,
} from "@/api/project-plans-types.js";
import { ProjectPlansDashboard } from "@/components/organisms/ProjectPlansDashboard.js";
import { ProjectPlanTimeline } from "@/components/organisms/ProjectPlanTimeline.js";
import { MarkdownPreview } from "@/components/organisms/MarkdownPreview.js";
import "@/index.css";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Project Plans Dashboard in Chromium", () => {
  let container: HTMLDivElement;
  let root: Root;
  let qc: QueryClient;

  const mockOwner: ConnectionRef = {
    profileId: "test-profile-1",
    generation: 1,
  };

  const mockTarget: ProjectTargetRef = {
    project: "dam-hopper",
    worktreePath: null,
  };

  const dummyRef = { path: "plans/261001-sample/plan.md", lineStart: 1, lineEnd: 1 };

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
      { name: "261001-sample", path: "plans/261001-sample" },
      { name: "261002-other", path: "plans/261002-other" },
    ],
    listing: {
      complete: true,
      entriesVisited: 2,
      limitsReached: [],
    },
    watchPaths: ["plans"],
    diagnostics: [],
  };

  const mockSamplePlanResponseAsFolder: PlanFoldersResponse = {
    target: {
      project: "dam-hopper",
      worktreePath: null,
      targetKey: "dam-hopper",
    },
    path: "plans/261001-sample",
    kind: "plan",
    folderState: "present",
    folders: [],
    listing: {
      complete: true,
      entriesVisited: 0,
      limitsReached: [],
    },
    watchPaths: ["plans/261001-sample"],
    diagnostics: [],
  };

  const mockSamplePlan: FilePlan = {
    id: "plans/261001-sample",
    title: "Chromium Test Plan",
    description: "Plan description for real browser testing",
    metadata: {
      priority: "P1",
      effort: "24h",
      issue: "https://github.com/org/repo/issues/100",
      branch: "feat/sample-chromium",
      tags: ["browser", "e2e"],
    },
    documents: {
      plan: {
        path: "plans/261001-sample/plan.md",
        state: "readable",
        sizeBytes: 1200,
        modifiedAt: "2026-10-06T12:00:00Z",
      },
      progress: {
        path: "plans/261001-sample/progress.md",
        state: "readable",
        sizeBytes: 800,
        modifiedAt: "2026-10-06T12:10:00Z",
      },
    },
    reportedStatus: {
      value: "in-progress",
      authority: "progress",
      raw: "in-progress",
      evidence: [dummyRef],
      captured: [],
    },
    phases: [
      {
        id: "phase-01",
        number: 1,
        title: "Setup and Contracts",
        path: "plans/261001-sample/phase-01.md",
        reportedStatus: {
          value: "completed",
          authority: "progress",
          raw: "completed",
          evidence: [dummyRef],
          captured: [],
        },
        evidenceLinks: [],
      },
    ],
    completion: {
      declared: 1,
      completed: 1,
      unknown: 0,
      conflicted: 0,
      fraction: 1.0,
    },
    dates: {
      created: { value: "2026-10-01", precision: "day", evidence: dummyRef },
      plannedStart: { value: "2026-10-01", precision: "day", evidence: dummyRef },
      plannedEnd: { value: "2026-10-10", precision: "day", evidence: dummyRef },
      actualStart: { value: "2026-10-02", precision: "day", evidence: dummyRef },
      actualEnd: null, // open in-progress
      published: { value: "2026-10-06T12:00:00Z", precision: "instant", evidence: dummyRef },
    },
    lastDocumentUpdate: "2026-10-06T12:10:00Z",
    diagnostics: [],
  };

  const mockSelectedPlanData: SelectedPlanResponse = {
    target: {
      project: "dam-hopper",
      worktreePath: null,
      targetKey: "dam-hopper",
    },
    plan: mockSamplePlan,
    watchPaths: ["plans/261001-sample"],
    diagnostics: [],
  };

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const mockClient = {
      plans: {
        folders: vi.fn().mockImplementation((_target, path) => {
          if (path === "plans/261001-sample") {
            return Promise.resolve(mockSamplePlanResponseAsFolder);
          }
          return Promise.resolve(mockFoldersData);
        }),
        read: vi.fn().mockResolvedValue(mockSelectedPlanData),
      },
      fs: {
        read: vi.fn().mockResolvedValue({
          data: "# Plan Markdown Content\n\n[Relative Link](./phase-01.md)\n\n![Asset](./img.png)",
          mimeType: "text/markdown",
          sizeBytes: 100,
        }),
      },
    };

    const mockTransport = {
      fsSubscribeTree: vi.fn().mockResolvedValue({ sub_id: 1 }),
      fsUnsubscribeTree: vi.fn().mockResolvedValue(undefined),
      onFsEvent: vi.fn().mockReturnValue(() => {}),
      onFsOverflow: vi.fn().mockReturnValue(() => {}),
    };
    __setConnectionSnapshotForTests(mockOwner.profileId, {
      owner: mockOwner,
      status: "connected",
      serverUrl: "http://127.0.0.1:4801",
      transport: mockTransport as unknown as Transport,
      api: mockClient as unknown as ApiClient,
    });

    container = document.createElement("div");
    container.style.width = "800px";
    container.style.height = "600px";
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    resetConnections();
    qc.clear();
  });

  async function mountDashboard() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={qc}>
          <ProjectPlansDashboard owner={mockOwner} target={mockTarget} />
        </QueryClientProvider>,
      );
    });
  }

  it("restores keyboard focus to originating folder row after navigating back from selected plan", async () => {
    await mountDashboard();

    const folderRows = Array.from(
      container.querySelectorAll('button[role="listitem"]'),
    ) as HTMLButtonElement[];
    expect(folderRows).toHaveLength(2);

    const firstRow = folderRows[0];
    expect(firstRow.textContent).toContain("261001-sample");

    // Click the first row to enter selected plan
    await act(async () => {
      firstRow.click();
    });

    // Wait for plan view to render
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Chromium Test Plan");
    });

    const backButton = container.querySelector(
      'button[aria-label="Back to folder browser"]',
    ) as HTMLButtonElement | null;
    expect(backButton).not.toBeNull();

    // Click Back
    await act(async () => {
      backButton?.click();
    });

    // Wait for folder browser to re-appear
    await vi.waitFor(() => {
      expect(container.textContent).toContain("261001-sample");
    });

    // Check originating row focus restoration
    const restoredRow = container.querySelector(
      'button[role="listitem"]',
    ) as HTMLButtonElement | null;
    expect(document.activeElement).toBe(restoredRow);
  });

  it("filters folders immediately by name substring", async () => {
    await mountDashboard();

    const filterInput = container.querySelector(
      'input[placeholder="Filter folders by name..."]',
    ) as HTMLInputElement | null;
    expect(filterInput).not.toBeNull();

    await userEvent.fill(filterInput!, "other");

    expect(container.textContent).toContain("261002-other");
    expect(container.textContent).not.toContain("261001-sample");
  });

  it("switches tabs between Overview, Timeline, and Documents and renders views", async () => {
    await mountDashboard();

    // Select plan
    const firstRow = container.querySelector(
      'button[role="listitem"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      firstRow?.click();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Chromium Test Plan");
    });

    // Switch to Timeline tab
    const timelineTab = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Timeline"),
    );
    expect(timelineTab).not.toBeNull();

    await act(async () => {
      timelineTab?.click();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Planned Schedule");
      expect(container.textContent).toContain("Legend:");
    });

    // Switch to Documents tab
    const docsTab = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Documents"),
    );
    expect(docsTab).not.toBeNull();

    await act(async () => {
      docsTab?.click();
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Plan (plan.md)");
      expect(container.textContent).toContain("Read-Only Snapshot");
    });
  });

  it("renders safe local Markdown links and accessible local image notices", async () => {
    const onNavigate = vi.fn();
    const content = [
      "# Heading 1",
      "",
      "[Go to phase 1](./phase-01.md)",
      "",
      "[Disallowed asset](./binary.bin)",
      "",
      "![Local Diagram](./diagram.png)",
    ].join("\n");

    await act(async () => {
      root.render(
        <MarkdownPreview
          content={content}
          linkPolicy={{
            currentDocumentPath: "plans/261001-sample/plan.md",
            onNavigateLocalMarkdown: onNavigate,
          }}
        />,
      );
    });

    // Heading has id
    const h1 = container.querySelector("h1");
    expect(h1?.id).toBe("heading-1");

    // Local markdown link navigates
    const mdLink = container.querySelector('a[href="#plans/261001-sample/phase-01.md"]') as HTMLAnchorElement | null;
    expect(mdLink).not.toBeNull();

    await act(async () => {
      mdLink?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("plans/261001-sample/phase-01.md", undefined);

    // Non-markdown link is disabled text span
    const badLink = Array.from(container.querySelectorAll("span")).find(
      (s) => s.textContent === "Disallowed asset",
    );
    expect(badLink).not.toBeNull();
    expect(badLink?.closest("a")).toBeNull();

    // Local image notice renders accessible note
    const note = container.querySelector('[role="note"]');
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain("[Image: Local Diagram]");
  });

  it("renders timeline with horizontal scroll container and handles date conflicts gracefully", async () => {
    const conflictPlan: FilePlan = {
      ...mockSamplePlan,
      dates: {
        created: null,
        plannedStart: { value: "2026-10-10", precision: "day", evidence: dummyRef },
        plannedEnd: { value: "2026-10-01", precision: "day", evidence: dummyRef }, // reversed
        actualStart: null,
        actualEnd: null,
        published: null,
      },
      diagnostics: [
        {
          code: "DATE_CONFLICT",
          path: "plans/261001-sample/plan.md",
          line: 12,
          message: "Conflicting date range: end precedes start",
        },
      ],
    };

    await act(async () => {
      root.render(<ProjectPlanTimeline plan={conflictPlan} />);
    });

    // Alert warning rendered
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain("DATE_CONFLICT");

    // Does not crash and remains undated state since range was invalid
    expect(container.textContent).toContain("Undated Plan");
  });
});
