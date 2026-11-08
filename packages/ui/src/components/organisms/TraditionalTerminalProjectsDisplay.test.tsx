// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  useQuery,
} from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import {
  TraditionalTerminalProjectsDisplay,
  type TraditionalTerminalProjectsDisplayProps,
} from "./TraditionalTerminalProjectsDisplay.js";
import type { MountedSession } from "./MultiTerminalDisplay.js";
import type { DisplayTabEntry } from "./TerminalTabBar.js";
import { gitQueryKey } from "@/api/queries.js";
import { normalizeProjectTarget } from "@/api/client.js";

let mockQueryFn: (target: unknown) => Promise<{ files: string[] }>;
let mockTreeProps: { revealRequest?: unknown } | null = null;
let mockFileChangesProps: { onLocateFile?: (filePath: string) => void } | null = null;

interface TestProjectRefObject {
  readonly project?: string;
  readonly profileId?: string;
  readonly worktreePath?: string;
}

function getProjectRefObject(val: unknown): TestProjectRefObject | null {
  if (typeof val === "object" && val !== null) {
    return val as TestProjectRefObject;
  }
  return null;
}

vi.mock("@/components/organisms/MultiTerminalDisplay.js", () => ({
  MultiTerminalDisplay: () => <div data-testid="multi-terminal-display" />,
}));

vi.mock("@/components/organisms/TraditionalProjectWorkspaceTree.js", () => ({
  TraditionalProjectWorkspaceTree: (props: { revealRequest?: unknown }) => {
    mockTreeProps = props;
    return <div data-testid="workspace-tree" />;
  },
}));
vi.mock("@/components/organisms/TraditionalProjectFileChanges.js", () => ({
  TraditionalProjectFileChanges: (props: {
    projectName: string;
    profileId?: string;
    projectRef?: unknown;
    onLocateFile?: (filePath: string) => void;
  }) => {
    mockFileChangesProps = props;
    const ref = getProjectRefObject(props.projectRef);
    const normalizedTarget = normalizeProjectTarget(
      ref
        ? {
            project: ref.project ?? props.projectName,
            profileId: ref.profileId ?? props.profileId,
            worktreePath: ref.worktreePath,
          }
        : {
            project: props.projectName,
            profileId: props.profileId,
          },
    );

    const { data, error } = useQuery({
      queryKey: gitQueryKey("git-diff", normalizedTarget, "*"),
      queryFn: () => mockQueryFn(normalizedTarget),
      retry: false,
    });

    return (
      <div
        data-testid="file-changes-child"
        data-project={props.projectName}
        data-profile={props.profileId}
        data-status={error ? "error" : "success"}
      >
        {data?.files.map((file) => (
          <span key={file} data-testid="file-entry">
            {file}
          </span>
        ))}
      </div>
    );
  },
}));

vi.mock("@/os/use-os-viewport.js", () => ({
  useOsViewport: () => ({ isCompact: false }),
}));

vi.mock("@/api/connections.js", () => ({
  useConnectionSnapshot: () => ({
    status: "connected",
    owner: { profileId: "prof-1", generation: 1 },
  }),
  getConnectionSnapshot: () => ({
    status: "connected",
    owner: { profileId: "prof-1", generation: 1 },
  }),
  subscribeConnections: () => () => {},
}));

vi.mock("@/api/server-config.js", () => ({
  getProfiles: () => [],
  getProfileChangeVersion: () => 0,
  subscribeToProfileChanges: () => () => {},
}));

vi.mock("@/stores/agent-status.js", () => ({
  useAgentStatusStore: (selector?: (state: { statuses: Map<string, unknown> }) => unknown) => {
    const state = { statuses: new Map<string, unknown>() };
    return typeof selector === "function" ? selector(state) : state;
  },
}));

describe("TraditionalTerminalProjectsDisplay - File Changes Refresh", () => {
  let queryClient: QueryClient;
  let container: HTMLDivElement;
  let root: Root;

  const sampleMountedSessions: MountedSession[] = [
    {
      sessionId: "sess-1",
      title: "bash",
      command: "bash",
      project: "demo-project",
      profileId: "prof-1",
      cwd: "/projects/demo",
    },
  ];

  const sampleTerminalTabs: DisplayTabEntry[] = [
    {
      sessionId: "sess-1",
      label: "demo-project",
      title: {
        baseLabel: "demo-project",
        ordinal: 1,
        fullText: "demo-project #1",
      },
      projectName: "demo-project",
      profileId: "prof-1",
    },
  ];

  async function renderDisplay(
    overrides?: Partial<TraditionalTerminalProjectsDisplayProps>,
  ) {
    const props: TraditionalTerminalProjectsDisplayProps = {
      activeSessionId: "sess-1",
      mountedSessions: sampleMountedSessions,
      terminalTabs: sampleTerminalTabs,
      currentProjectId: "demo-project",
      currentProjectRevision: 1,
      onSelectTab: vi.fn(),
      onCloseTab: vi.fn(),
      onToggleFileTree: vi.fn(),
      fileTreeHidden: false,
      isCompact: false,
      ...overrides,
    };

    await act(async () => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <TraditionalTerminalProjectsDisplay {...props} />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  beforeEach(() => {
    mockQueryFn = vi.fn().mockResolvedValue({ files: ["file-v1.ts"] });
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it("renders exactly one refresh button inside the file changes section header with proper attributes", async () => {
    await renderDisplay();

    // Locate the file changes header specifically
    const headers = Array.from(
      container.querySelectorAll("div.flex.h-7.shrink-0"),
    );
    const fileChangesHeader = headers.find((h) =>
      h.textContent?.includes("file changes"),
    );
    expect(fileChangesHeader).toBeDefined();

    const buttons = fileChangesHeader?.querySelectorAll(
      'button[aria-label="Refresh file changes"]',
    );
    expect(buttons).toHaveLength(1);

    const refreshBtn = buttons?.[0] as HTMLButtonElement;
    expect(refreshBtn.type).toBe("button");
    expect(refreshBtn.title).toBe("Refresh file changes");
    expect(refreshBtn.disabled).toBe(false);

    const svg = refreshBtn.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("class")).not.toContain("animate-spin");
  });

  it("invalidates git-diff prefix on click and updates child query with fresh data", async () => {
    await renderDisplay();

    expect(container.textContent).toContain("file-v1.ts");

    // Prepare fresh data for refetch
    mockQueryFn = vi
      .fn()
      .mockResolvedValue({ files: ["file-v1.ts", "file-v2-new.ts"] });

    const refreshBtn = container.querySelector(
      'button[aria-label="Refresh file changes"]',
    ) as HTMLButtonElement;
    expect(refreshBtn).not.toBeNull();

    await act(async () => {
      refreshBtn.click();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(container.textContent).toContain("file-v2-new.ts");
    expect(refreshBtn.disabled).toBe(false);
    expect(refreshBtn.querySelector("svg")?.getAttribute("class")).not.toContain(
      "animate-spin",
    );
  });

  it("disables and spins during manual invalidation and prevents duplicate concurrent dispatches", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { promise: invalidatePromise, resolve: resolveInvalidate } =
      Promise.withResolvers<void>();
    invalidateSpy.mockImplementation(() => invalidatePromise);

    await renderDisplay();

    const refreshBtn = container.querySelector(
      'button[aria-label="Refresh file changes"]',
    ) as HTMLButtonElement;
    expect(refreshBtn).not.toBeNull();

    await act(async () => {
      refreshBtn.click();
    });

    const expectedTarget = normalizeProjectTarget({
      project: "demo-project",
      profileId: "prof-1",
    });
    const expectedKey = gitQueryKey("git-diff", expectedTarget);

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: expectedKey,
    });

    // While invalidation promise is pending, button should be disabled and spinning
    expect(refreshBtn.disabled).toBe(true);
    expect(refreshBtn.querySelector("svg")?.getAttribute("class")).toContain(
      "animate-spin",
    );

    // Second click during pending state should not dispatch again
    await act(async () => {
      refreshBtn.click();
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    // Resolve the invalidation
    await act(async () => {
      resolveInvalidate();
    });

    expect(refreshBtn.disabled).toBe(false);
    expect(refreshBtn.querySelector("svg")?.getAttribute("class")).not.toContain(
      "animate-spin",
    );
  });

  it("disables and spins the button when an active background diff fetch is in flight", async () => {
    await renderDisplay();

    const refreshBtn = container.querySelector(
      'button[aria-label="Refresh file changes"]',
    ) as HTMLButtonElement;
    expect(refreshBtn).not.toBeNull();
    expect(refreshBtn.disabled).toBe(false);

    const target = normalizeProjectTarget({
      project: "demo-project",
      profileId: "prof-1",
    });
    const key = gitQueryKey("git-diff", target, "*");

    const { promise: deferredPromise, resolve: resolveDeferred } =
      Promise.withResolvers<{ files: string[] }>();
    mockQueryFn = vi.fn().mockImplementation(() => deferredPromise);

    // Trigger background refetch directly on the queryClient (simulating background poll / external trigger)
    const refetchPromise = queryClient.refetchQueries({ queryKey: key });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Button should be disabled and spinning via useIsFetching
    expect(refreshBtn.disabled).toBe(true);
    expect(refreshBtn.querySelector("svg")?.getAttribute("class")).toContain(
      "animate-spin",
    );

    // Settle the query
    await act(async () => {
      resolveDeferred({ files: ["deferred.ts"] });
      await refetchPromise;
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(refreshBtn.disabled).toBe(false);
    expect(refreshBtn.querySelector("svg")?.getAttribute("class")).not.toContain(
      "animate-spin",
    );
  });

  it("isolates invalidation: refetches active selected query but leaves active alternate queries untouched", async () => {
    const alternateTarget = normalizeProjectTarget({
      project: "alternate-project",
      profileId: "prof-1",
    });
    const alternateKey = gitQueryKey("git-diff", alternateTarget, "*");
    const alternateQueryFn = vi.fn().mockResolvedValue({ files: ["alt.ts"] });

    // Mount an active observer for the alternate query
    const observer = new QueryObserver(queryClient, {
      queryKey: alternateKey,
      queryFn: alternateQueryFn,
    });
    const unsubscribe = observer.subscribe(() => {});

    await renderDisplay();

    // Both queries fetched initially
    expect(mockQueryFn).toHaveBeenCalledTimes(1);
    expect(alternateQueryFn).toHaveBeenCalledTimes(1);

    const refreshBtn = container.querySelector(
      'button[aria-label="Refresh file changes"]',
    ) as HTMLButtonElement;

    await act(async () => {
      refreshBtn.click();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Selected query refetched
    expect(mockQueryFn).toHaveBeenCalledTimes(2);
    // Alternate query was NOT invalidated / refetched
    expect(alternateQueryFn).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("handles query refetch failure and retains error state while re-enabling refresh button", async () => {
    await renderDisplay();

    // Query rejects on refetch
    mockQueryFn = vi.fn().mockRejectedValue(new Error("Git diff failed"));

    const refreshBtn = container.querySelector(
      'button[aria-label="Refresh file changes"]',
    ) as HTMLButtonElement;

    const target = normalizeProjectTarget({
      project: "demo-project",
      profileId: "prof-1",
    });
    const key = gitQueryKey("git-diff", target, "*");

    await act(async () => {
      refreshBtn.click();
    });

    await act(async () => {
      const query = queryClient.getQueryCache().find({ queryKey: key });
      await query?.promise?.catch(() => {});
    });

    // Button clears busy state and remains interactive
    expect(refreshBtn.disabled).toBe(false);
    expect(refreshBtn.querySelector("svg")?.getAttribute("class")).not.toContain(
      "animate-spin",
    );

    // Child surfaces error state
    const child = container.querySelector('[data-testid="file-changes-child"]');
    expect(child?.getAttribute("data-status")).toBe("error");
  });

  it("normalizes target with projectRef precedence including worktree path", async () => {
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const worktreeMounted: MountedSession[] = [
      {
        sessionId: "sess-wt",
        title: "bash",
        command: "bash",
        project: "override-project",
        profileId: "override-prof",
        cwd: "/worktrees/feature",
      },
    ];

    const worktreeTabs: DisplayTabEntry[] = [
      {
        sessionId: "sess-wt",
        label: "override-project",
        title: {
          baseLabel: "override-project",
          ordinal: 1,
          fullText: "override-project #1",
        },
        projectName: "override-project",
        profileId: "override-prof",
      },
    ];

    await renderDisplay({
      activeSessionId: "sess-wt",
      mountedSessions: worktreeMounted,
      terminalTabs: worktreeTabs,
      currentProjectId: "override-project",
    });

    const refreshBtn = container.querySelector(
      'button[aria-label="Refresh file changes"]',
    ) as HTMLButtonElement;
    expect(refreshBtn).not.toBeNull();

    await act(async () => {
      refreshBtn.click();
    });

    const expectedTarget = normalizeProjectTarget({
      project: "override-project",
      profileId: "override-prof",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: gitQueryKey("git-diff", expectedTarget),
    });
  });

  it("does not render refresh button when there is no selected project group", async () => {
    await renderDisplay({
      activeSessionId: null,
      mountedSessions: [],
      terminalTabs: [],
    });
    const refreshBtn = container.querySelector(
      'button[aria-label="Refresh file changes"]',
    );
    expect(refreshBtn).toBeNull();
  });

  it("does not render refresh button when fileTreeHidden is true", async () => {
    await renderDisplay({ fileTreeHidden: true });
    const refreshBtn = container.querySelector(
      'button[aria-label="Refresh file changes"]',
    );
    expect(refreshBtn).toBeNull();
  });

  it("does not render refresh button when onToggleFileTree is undefined", async () => {
    await renderDisplay({ onToggleFileTree: undefined });
    const refreshBtn = container.querySelector(
      'button[aria-label="Refresh file changes"]',
    );
    expect(refreshBtn).toBeNull();
  });

  it("does not render refresh button when isCompact is true", async () => {
    await renderDisplay({ isCompact: true });
    const refreshBtn = container.querySelector(
      'button[aria-label="Refresh file changes"]',
    );
    expect(refreshBtn).toBeNull();
  });

  it("renders Open Changes panel button and calls onOpenChanges on click", async () => {
    const onOpenChanges = vi.fn();
    await renderDisplay({ onOpenChanges });

    const openChangesBtn = container.querySelector(
      'button[aria-label="Open Changes panel"]',
    ) as HTMLButtonElement;
    expect(openChangesBtn).not.toBeNull();
    expect(openChangesBtn.title).toBe("Open Changes panel");

    await act(async () => {
      openChangesBtn.click();
    });
    expect(onOpenChanges).toHaveBeenCalledOnce();
  });

  it("handles onLocateFile by forwarding revealRequest to workspace tree", async () => {
    const onToggleFileTree = vi.fn();
    await renderDisplay({ onToggleFileTree });

    expect(mockFileChangesProps?.onLocateFile).toBeDefined();

    await act(async () => {
      mockFileChangesProps?.onLocateFile?.("src/target-file.ts");
    });

    expect(mockTreeProps?.revealRequest).toEqual(
      expect.objectContaining({
        project: "demo-project",
        path: "src/target-file.ts",
      }),
    );
  });
});
