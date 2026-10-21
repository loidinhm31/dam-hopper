import "@/index.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type {
  ApiClient,
  ConflictSnapshot,
  OperationStatusResponse,
} from "@/api/client.js";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
} from "@/api/connections.js";
import * as serverConfig from "@/api/server-config.js";
import type { ServerProfile } from "@/api/server-config.js";
import { ConflictResolverPanel } from "@/components/organisms/ConflictResolverPanel.js";
import { conflictDraftStore } from "@/lib/conflict-draft-store.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const serverProfile: ServerProfile = {
  id: "floating-resolver-profile",
  name: "Floating Resolver Browser Test",
  url: "http://127.0.0.1:4801",
  authType: "none",
  createdAt: 1,
  autoConnect: false,
};
const target = { profileId: serverProfile.id, project: "demo-repo" };

const conflictSummary = {
  conflictId: "conflict-floating-monaco",
  path: "src/conflict.ts",
  status: "both_modified" as const,
};

// Snapshot has an unchanged prefix line followed by a conflict
const snapshot: ConflictSnapshot = {
  conflictId: conflictSummary.conflictId,
  path: conflictSummary.path,
  repositoryRoot: "/repo",
  worktreeRoot: "/repo",
  snapshotVersion: "snapshot-floating-1",
  fullIndexFingerprint: "index-floating-1",
  status: "bothModified",
  stages: {
    base: {
      stage: 1,
      oid: "base-oid-12345678",
      mode: 0o100644,
      byteSize: 30,
      kind: "text",
      textTokens: ["// prefix header\n", "line 1 base\n"],
    },
    ours: {
      stage: 2,
      oid: "ours-oid-12345678",
      mode: 0o100644,
      byteSize: 30,
      kind: "text",
      textTokens: ["// prefix header\n", "line 1 ours\n"],
    },
    theirs: {
      stage: 3,
      oid: "theirs-oid-12345678",
      mode: 0o100644,
      byteSize: 32,
      kind: "text",
      textTokens: ["// prefix header\n", "line 1 theirs\n"],
    },
  },
  worktree: {
    exists: true,
    kind: "regular",
    mode: 0o100644,
    byteLength: 65,
    textTokens: [
      "// prefix header\n",
      "<<<<<<< HEAD\n",
      "line 1 ours\n",
      "=======\n",
      "line 1 theirs\n",
      ">>>>>>> branch\n",
    ],
    hasConflictMarkers: true,
    isDirtyVsStages: true,
  },
  effectiveAttributes: { ident: false, filterQualified: true },
};

function mockOperationStatus(): OperationStatusResponse {
  return {
    operation: "rebase",
    canContinue: true,
    canAbort: true,
    operationFingerprint: "op-fp-1",
    fullIndexFingerprint: "index-fp-1",
    stageRoleLabels: {
      ours: "onto",
      theirs: "replayed",
      base: "ancestor",
    },
  };
}

async function delayTurn(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 60);
  await promise;
}

describe("Git Conflict Resolver floating Monaco surface in Chromium", () => {
  let queryClient: QueryClient;
  let container: HTMLDivElement;
  let root: Root;
  let api: ApiClient;
  let previousProfiles: ServerProfile[];
  let previousActiveProfileId: string | null;

  beforeEach(() => {
    previousProfiles = serverConfig.getProfiles();
    previousActiveProfileId = serverConfig.getActiveProfileId();
    resetConnections();
    conflictDraftStore.resetForTesting();
    serverConfig.saveProfiles([serverProfile]);
    serverConfig.setActiveProfile(serverProfile.id);

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    api = {
      git: {
        conflicts: vi.fn(async () => ({
          targetRevision: "head-rev",
          entries: [conflictSummary],
          truncated: false,
        })),
        conflictFile: vi.fn(async () => snapshot),
        fileDiff: vi.fn(async () => ({
          path: snapshot.path,
          language: "typescript",
          hunks: [],
          lineChanges: [],
          isBinary: false,
        })),
        operationStatus: vi.fn(async () => mockOperationStatus()),
        resolve: vi.fn(),
      },
    } as unknown as ApiClient;

    __setConnectionSnapshotForTests(serverProfile.id, {
      owner: { profileId: serverProfile.id, generation: 1 },
      status: "connected",
      serverUrl: serverProfile.url,
      api,
    });

    container = document.createElement("div");
    container.style.width = "1200px";
    container.style.height = "800px";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await page.viewport(1280, 800);
    act(() => root.unmount());
    await queryClient.cancelQueries();
    container.remove();
    queryClient.clear();
    conflictDraftStore.resetForTesting();
    resetConnections();
    serverConfig.saveProfiles(previousProfiles);
    if (
      previousActiveProfileId &&
      previousProfiles.some((profile) => profile.id === previousActiveProfileId)
    ) {
      serverConfig.setActiveProfile(previousActiveProfileId);
    } else {
      serverConfig.clearActiveProfile();
    }
    vi.restoreAllMocks();
  });

  it("renders floating ConflictResolverPanel with title, rebase badge, and editors", async () => {
    const onHide = vi.fn();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ConflictResolverPanel
            open={true}
            project="demo-repo"
            target={target}
            targetAvailable={true}
            onHide={onHide}
          />
        </QueryClientProvider>,
      );
      await delayTurn();
    });

    const panel = container.querySelector('[data-testid="conflict-resolver-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("Git Conflict Resolver");
    expect(panel?.textContent).toContain("REBASE");
    expect(panel?.textContent).toContain("demo-repo");

    // Check that headers exist
    expect(panel?.textContent).toContain("Theirs");
    expect(panel?.textContent).toContain("Result");
    expect(panel?.textContent).toContain("Ours");
  });

  it("applies per-conflict accept action targeting conflict region even with stable prefix", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ConflictResolverPanel
            open={true}
            project="demo-repo"
            target={target}
            targetAvailable={true}
            onHide={() => {}}
          />
        </QueryClientProvider>,
      );
      await delayTurn();
    });

    // Find the accept-theirs button (←T) in the conflict nav
    const acceptTheirsBtn = container.querySelector(
      'button[title="Accept incoming (theirs)"]',
    ) as HTMLButtonElement;
    expect(acceptTheirsBtn).not.toBeNull();

    // Click it and verify no exception is thrown
    await act(async () => {
      acceptTheirsBtn.click();
      await delayTurn();
    });

    // Check that error banner was NOT displayed
    const errorBanner = container.querySelector('[role="alert"]');
    expect(errorBanner?.textContent ?? "").not.toContain("stable region");
  });

  it("toggles maximize layout and restores prior geometry", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ConflictResolverPanel
            open={true}
            project="demo-repo"
            target={target}
            targetAvailable={true}
            onHide={() => {}}
          />
        </QueryClientProvider>,
      );
      await delayTurn();
    });

    const panel = container.querySelector('[data-testid="conflict-resolver-panel"]') as HTMLElement;
    expect(panel).not.toBeNull();
    const initialWidth = panel.offsetWidth;

    // Click maximize
    const maximizeBtn = container.querySelector('button[aria-label="Maximize resolver window"]') as HTMLButtonElement;
    expect(maximizeBtn).not.toBeNull();

    await act(async () => {
      maximizeBtn.click();
      await delayTurn();
    });

    const maximizedWidth = panel.offsetWidth;
    expect(maximizedWidth).toBeGreaterThanOrEqual(initialWidth);

    // Check restore button is now shown
    const restoreBtn = container.querySelector('button[aria-label="Restore resolver window"]') as HTMLButtonElement;
    expect(restoreBtn).not.toBeNull();

    // Click restore
    await act(async () => {
      restoreBtn.click();
      await delayTurn();
    });

    const restoredMaximizeBtn = container.querySelector('button[aria-label="Maximize resolver window"]');
    expect(restoredMaximizeBtn).not.toBeNull();
    expect(panel.offsetWidth).toBe(initialWidth);
  });

  it("activates narrow tabbed mode in narrow viewport and switches tabs", async () => {
    // Resize container to 500px width
    container.style.width = "500px";

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ConflictResolverPanel
            open={true}
            project="demo-repo"
            target={target}
            targetAvailable={true}
            onHide={() => {}}
          />
        </QueryClientProvider>,
      );
      await delayTurn();
    });

    // In narrow mode, the tablist should be rendered
    const tablist = container.querySelector('div[role="tablist"]');
    expect(tablist).not.toBeNull();

    const tabs = container.querySelectorAll('button[role="tab"]');
    expect(tabs.length).toBeGreaterThanOrEqual(3);

    // Click Theirs tab
    const theirsTab = Array.from(tabs).find((t) => t.textContent?.includes("Theirs")) as HTMLButtonElement;
    expect(theirsTab).not.toBeUndefined();

    await act(async () => {
      theirsTab.click();
      await delayTurn();
    });

    expect(theirsTab.getAttribute("aria-selected")).toBe("true");
  });

  it("hides resolver when Escape is pressed while topmost and focused", async () => {
    const onHide = vi.fn();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ConflictResolverPanel
            open={true}
            project="demo-repo"
            target={target}
            targetAvailable={true}
            isTopmost={true}
            onHide={onHide}
          />
        </QueryClientProvider>,
      );
      await delayTurn();
    });

    // Focus inside the panel
    const panel = container.querySelector('[data-testid="conflict-resolver-panel"]') as HTMLElement;
    panel.focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onHide).toHaveBeenCalledOnce();
  });

  it("does not hide resolver on Escape when not topmost or when focus is outside", async () => {
    const onHide = vi.fn();

    // Create an external input button and focus it
    const outsideBtn = document.createElement("button");
    document.body.appendChild(outsideBtn);
    outsideBtn.focus();

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ConflictResolverPanel
            open={true}
            project="demo-repo"
            target={target}
            targetAvailable={true}
            isTopmost={false}
            onHide={onHide}
          />
        </QueryClientProvider>,
      );
      await delayTurn();
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onHide).not.toHaveBeenCalled();

    outsideBtn.remove();
  });

  it("renders wide 3-pane layout at 1400px without narrow tab list", async () => {
    await page.viewport(1400, 900);
    container.style.width = "1400px";
    container.style.height = "900px";

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ConflictResolverPanel
            open={true}
            project="demo-repo"
            target={target}
            targetAvailable={true}
            isTopmost={true}
            zIndex={24}
            onHide={() => {}}
          />
        </QueryClientProvider>,
      );
      await delayTurn();
      await delayTurn();
    });

    // In wide mode (>= 768px), narrow tablist should NOT be present
    const tablist = container.querySelector('div[role="tablist"]');
    expect(tablist).toBeNull();

    // The panel and wide headers (Theirs, Result, Ours) must be present
    const panel = container.querySelector('[data-testid="conflict-resolver-panel"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("Theirs");
    expect(panel?.textContent).toContain("Result");
    expect(panel?.textContent).toContain("Ours");
    await page.viewport(1280, 800);
  });

  it("arbitrates multi-panel z-order underneath TopNav (z-50)", async () => {
    const topNav = document.createElement("header");
    topNav.className = "z-50 fixed top-0 left-0 right-0 h-12";
    topNav.style.zIndex = "50";
    topNav.style.position = "fixed";
    topNav.style.top = "0";
    topNav.style.left = "0";
    topNav.style.width = "100%";
    topNav.style.height = "48px";
    topNav.dataset.testid = "app-topnav";
    const navBtn = document.createElement("button");
    navBtn.textContent = "Profile Select";
    topNav.appendChild(navBtn);
    document.body.appendChild(topNav);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ConflictResolverPanel
            open={true}
            project="demo-repo"
            target={target}
            targetAvailable={true}
            isTopmost={true}
            zIndex={24}
            onHide={() => {}}
          />
        </QueryClientProvider>,
      );
      await delayTurn();
    });

    const overlayEl = container.querySelector('[data-testid="conflict-resolver-overlay"]') as HTMLElement;
    expect(overlayEl).not.toBeNull();
    expect(getComputedStyle(overlayEl).zIndex).toBe("24");
    // TopNav at z-50 must be above panel at (20, 20)
    const elementAtNav = document.elementFromPoint(20, 20);
    expect(topNav.contains(elementAtNav)).toBe(true);

    topNav.remove();
  });
});
