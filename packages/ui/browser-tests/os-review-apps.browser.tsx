import "@/index.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OsShell } from "@/os/OsShell.js";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { profileQueryKey } from "@/api/query-client.js";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import { __setConnectionSnapshotForTests, resetConnections } from "@/api/connections.js";
import { saveProfiles, type ServerProfile } from "@/api/server-config.js";
import type { WsTransport } from "@/api/ws-transport.js";
import type { ApiClient } from "@/api/client.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const testProfile: ServerProfile = {
  id: "review-profile",
  name: "Review test profile",
  url: "http://127.0.0.1:4801",
  authType: "none",
  createdAt: 1,
  autoConnect: false,
};

function createTestTransport(): WsTransport {
  return {
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    terminalAttach: vi.fn().mockReturnValue(true),
    onTerminalData: vi.fn().mockReturnValue(() => {}),
    onTerminalBuffer: vi.fn().mockReturnValue(() => {}),
    onTerminalExit: vi.fn().mockReturnValue(() => {}),
    onTerminalLifecycle: vi.fn().mockReturnValue(() => {}),
    onProcessRestarted: vi.fn().mockReturnValue(() => {}),
    onEvent: vi.fn().mockReturnValue(() => {}),
    onStatusChange: vi.fn().mockReturnValue(() => {}),
    fsSubscribeTree: vi.fn().mockResolvedValue({ sub_id: 1 }),
    fsUnsubscribeTree: vi.fn().mockResolvedValue(undefined),
    onFsEvent: vi.fn().mockReturnValue(() => {}),
  } as unknown as WsTransport;
};

describe("OS Review Apps Browser Tests", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    resetConnections();
    globalResourceRegistry.clear();
    saveProfiles([testProfile]);
    useWindowStore.getState().setSession(createDefaultOsSession());
    const mockApiClient = {
      config: vi.fn().mockResolvedValue({
        server: { sessionChangesEnabled: true },
        workspace: { name: "review-workspace" },
      }),
    };

    __setConnectionSnapshotForTests(testProfile.id, {
      status: "connected",
      profileId: testProfile.id,
      serverUrl: testProfile.url,
      generation: 1,
      owner: { profileId: testProfile.id, generation: 1 },
      transport: createTestTransport(),
      api: mockApiClient as unknown as ApiClient,
    });

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      },
    });
    queryClient.setQueryData(
      profileQueryKey({ profileId: testProfile.id, generation: 1 }, "config"),
      {
        server: { sessionChangesEnabled: true },
        workspace: { name: "review-workspace" },
      },
    );
    container = document.createElement("div");
    container.style.width = "1280px";
    container.style.height = "800px";
    container.style.position = "relative";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container?.parentElement) {
      container.parentElement.removeChild(container);
      container = null;
    }
  });

  const renderOs = async () => {
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <OsShell />
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });
  };

  it("mounts GitApp window with target context", async () => {
    await renderOs();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-git-1",
        appId: "git",
        title: "Git",
        ctx: { profileId: testProfile.id, projectId: "review-repo" },
        mode: "tile",
      });
    });

    const gitEl = container?.querySelector('[data-os-git-app="win-git-1"]');
    expect(gitEl).not.toBeNull();
  });

  it("mounts ConflictResolverApp and shows fail-closed no-operation view when no conflicts active", async () => {
    await renderOs();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-resolver-1",
        appId: "conflict-resolver",
        title: "Conflict Resolver",
        ctx: { profileId: testProfile.id, projectId: "review-repo" },
        mode: "float",
      });
    });

    const resolverEl = container?.querySelector(
      '[data-os-conflict-resolver-app="win-resolver-1"]',
    );
    expect(resolverEl).not.toBeNull();
  });

  it("mounts ConflictResolverApp and shows operation mismatch when explicit requested operation is unavailable", async () => {
    await renderOs();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-resolver-mismatch",
        appId: "conflict-resolver",
        title: "Conflict Resolver",
        ctx: { profileId: testProfile.id, projectId: "review-repo", operation: "merge" },
        mode: "float",
      });
    });

    const mismatchEl = container?.querySelector(
      '[data-testid="conflict-resolver-operation-mismatch"]',
    );
    expect(mismatchEl).not.toBeNull();
  });

  it("mounts SessionChangesApp, verifies tuple requirements and traps input", async () => {
    await renderOs();

    // 1. Open with incomplete tuple -> shows incomplete identity warning
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-session-incomplete",
        appId: "session-changes",
        title: "Session Review",
        ctx: { profileId: testProfile.id },
        mode: "float",
        appState: {
          terminalId: "term-1",
          // missing incarnation and ompSessionId
        },
      });
    });

    const incompleteEl = container?.querySelector(
      '[data-os-session-changes-app="win-session-incomplete"]',
    );
    expect(incompleteEl).not.toBeNull();
    expect(incompleteEl?.textContent).toContain("Incomplete Session Identity");

    // 2. Open with complete 8-tuple
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-session-complete",
        appId: "session-changes",
        title: "Session Review",
        ctx: { profileId: testProfile.id },
        mode: "float",
        appState: {
          profileId: testProfile.id,
          generation: 1,
          terminalId: "term-1",
          terminalIncarnation: "inc-1",
          ompSessionId: "omp-session-123",
          serverEpoch: "epoch-123",
          rootId: "root-123",
          baselineId: "base-123",
        },
      });
    });

    const completeEl = container?.querySelector(
      '[data-os-session-changes-app="win-session-complete"]',
    );
    expect(completeEl).not.toBeNull();

    // Test input isolation: event propagation is stopped
    let eventLeaked = false;
    const leakDetector = () => {
      eventLeaked = true;
    };
    window.addEventListener("keydown", leakDetector);

    const keyEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    completeEl?.dispatchEvent(keyEvent);

    expect(eventLeaked).toBe(false);
    window.removeEventListener("keydown", leakDetector);
  });

  it("purges cache and unmounts live viewer when session changes is disabled", async () => {
    await renderOs();

    const owner = { profileId: testProfile.id, generation: 1 };
    queryClient.setQueryData(profileQueryKey(owner, "session-changes"), {
      cached: "sensitive-diff-data",
    });

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-session-to-close",
        appId: "session-changes",
        title: "Session To Close",
        ctx: { profileId: testProfile.id },
        mode: "float",
        appState: {
          profileId: testProfile.id,
          generation: 1,
          terminalId: "term-1",
          terminalIncarnation: "inc-1",
          ompSessionId: "omp-session-123",
          serverEpoch: "epoch-123",
          rootId: "root-123",
          baselineId: "base-123",
        },
      });
    });

    expect(
      useWindowStore.getState().session.windows["win-session-to-close"],
    ).toBeDefined();

    // Trigger disable by updating config in queryClient
    await act(async () => {
      queryClient.setQueryData(profileQueryKey(owner, "config"), {
        server: { sessionChangesEnabled: false },
        workspace: { name: "review-workspace" },
      });
    });

    // Verify query cache purged and content-free explanation rendered (window stays for explicit close)
    expect(
      queryClient.getQueryData(profileQueryKey(owner, "session-changes")),
    ).toBeUndefined();
    const appEl = container?.querySelector(
      '[data-os-session-changes-app="win-session-to-close"]',
    );
    expect(appEl?.textContent).toContain("Session Review Unavailable");
  });

  it("preserves sibling review cache when closing a single review window under same owner", async () => {
    await renderOs();

    const owner = { profileId: testProfile.id, generation: 1 };
    const siblingKey = [
      "profile",
      testProfile.id,
      1,
      "session-changes",
      "status",
      "term-sibling",
      "inc-sibling",
      "omp-sibling",
      "root-sibling",
    ];
    queryClient.setQueryData(siblingKey, {
      state: "ready",
      data: "sibling-data",
    });

    const targetKey = [
      "profile",
      testProfile.id,
      1,
      "session-changes",
      "status",
      "term-target",
      "inc-target",
      "omp-target",
      "root-target",
    ];
    queryClient.setQueryData(targetKey, {
      state: "ready",
      data: "target-data",
    });

    // Open target window
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-session-single-close",
        appId: "session-changes",
        title: "Single Close",
        ctx: { profileId: testProfile.id },
        mode: "float",
        appState: {
          profileId: testProfile.id,
          generation: 1,
          terminalId: "term-target",
          terminalIncarnation: "inc-target",
          ompSessionId: "omp-target",
          serverEpoch: "epoch-target",
          rootId: "root-target",
          baselineId: "base-target",
        },
      });
    });

    const appEl = container?.querySelector(
      '[data-os-session-changes-app="win-session-single-close"]',
    );
    expect(appEl).not.toBeNull();

    // Close single window via Escape key
    const keyEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      appEl?.dispatchEvent(keyEvent);
    });

    // Window closed
    expect(
      useWindowStore.getState().session.windows["win-session-single-close"],
    ).toBeUndefined();
    // Target query cache MUST be removed for the closed review identity
    expect(queryClient.getQueryData(targetKey)).toBeUndefined();

    // Sibling cache MUST be preserved under the same owner!
    expect(queryClient.getQueryData(siblingKey)).toEqual({
      state: "ready",
      data: "sibling-data",
    });
  });

  it("proves multi-profile project collision isolation: identical project names across two profiles maintain separate resource claims", async () => {
    const profileB: ServerProfile = {
      id: "review-profile-b",
      name: "Review profile B",
      url: "http://127.0.0.1:4802",
      authType: "none",
      createdAt: 2,
      autoConnect: false,
    };
    saveProfiles([testProfile, profileB]);
    __setConnectionSnapshotForTests(profileB.id, {
      status: "connected",
      profileId: profileB.id,
      serverUrl: profileB.url,
      generation: 1,
      owner: { profileId: profileB.id, generation: 1 },
      transport: createTestTransport(),
    });

    await renderOs();

    // Open window on profile A for project "shared-repo"
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-conflict-profA",
        appId: "conflict-resolver",
        title: "Resolver A",
        ctx: { profileId: testProfile.id, projectId: "shared-repo" },
        mode: "float",
      });
    });

    // Open window on profile B for SAME project name "shared-repo"
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-conflict-profB",
        appId: "conflict-resolver",
        title: "Resolver B",
        ctx: { profileId: profileB.id, projectId: "shared-repo" },
        mode: "float",
      });
    });

    // Both claims succeed independently because profileIds differ
    const claimA = globalResourceRegistry.getClaimsForWindow("win-conflict-profA");
    const claimB = globalResourceRegistry.getClaimsForWindow("win-conflict-profB");
    expect(claimA.length).toBeGreaterThan(0);
    expect(claimB.length).toBeGreaterThan(0);
    expect(claimA[0].key.profileId).toBe(testProfile.id);
    expect(claimB[0].key.profileId).toBe(profileB.id);
  });
});
