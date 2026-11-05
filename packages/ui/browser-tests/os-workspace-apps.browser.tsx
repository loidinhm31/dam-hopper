import "@/index.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OsShell } from "@/os/OsShell.js";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { dispatchIntent, createIntent } from "@/os/intents.js";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import { __setConnectionSnapshotForTests, resetConnections } from "@/api/connections.js";
import { saveProfiles, type ServerProfile } from "@/api/server-config.js";
import type { WsTransport } from "@/api/ws-transport.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const testProfile: ServerProfile = {
  id: "workspace-profile",
  name: "Workspace test profile",
  url: "http://127.0.0.1:4801",
  authType: "none",
  createdAt: 1,
  autoConnect: false,
};

function createTestTransport(): WsTransport {
  return {
    invoke: vi.fn().mockResolvedValue([]),
    request: vi.fn().mockResolvedValue([]),
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
}

describe("OS Workspace Apps Browser Tests", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    resetConnections();
    globalResourceRegistry.clear();
    saveProfiles([testProfile]);
    useWindowStore.getState().setSession(createDefaultOsSession());

    __setConnectionSnapshotForTests(testProfile.id, {
      status: "connected",
      profileId: testProfile.id,
      serverUrl: testProfile.url,
      generation: 1,
      owner: { profileId: testProfile.id, generation: 1 },
      transport: createTestTransport(),
    });

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

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

  it("mounts workspace apps inside OS windows with context", async () => {
    await renderOs();

    // 1. Open FilesApp window
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-files-1",
        appId: "files",
        title: "Files",
        ctx: { profileId: testProfile.id, projectId: "demo-project" },
        mode: "tile",
      });
    });

    const filesEl = container?.querySelector('[data-os-files-app="win-files-1"]');
    expect(filesEl).not.toBeNull();

    // 2. Open SearchApp window
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-search-1",
        appId: "search",
        title: "Search",
        ctx: { profileId: testProfile.id, projectId: "demo-project" },
        mode: "tile",
      });
    });

    const searchEl = container?.querySelector('[data-os-search-app="win-search-1"]');
    expect(searchEl).not.toBeNull();

    // 3. Open ChangesApp window
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-changes-1",
        appId: "changes",
        title: "Changes",
        ctx: { profileId: testProfile.id, projectId: "demo-project" },
        mode: "tile",
      });
    });

    const changesEl = container?.querySelector('[data-os-changes-app="win-changes-1"]');
    expect(changesEl).not.toBeNull();

    // 4. Open ProjectInfoApp window
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-proj-1",
        appId: "project-info",
        title: "Project Info",
        ctx: { profileId: testProfile.id, projectId: "demo-project" },
        mode: "float",
      });
    });

    const projEl = container?.querySelector('[data-os-project-info-app="win-proj-1"]');
    expect(projEl).not.toBeNull();
  });

  it("handles typed file:reveal intent targeting FilesApp window", async () => {
    await renderOs();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-files-reveal",
        appId: "files",
        title: "Files",
        ctx: { profileId: testProfile.id, projectId: "demo-project" },
        mode: "tile",
      });
    });

    // Dispatch file:reveal intent
    const result = await dispatchIntent(
      createIntent("file:reveal", {
        profileId: testProfile.id,
        generation: 1,
        target: {
          kind: "project",
          profileId: testProfile.id,
          project: "demo-project",
        },
        projectId: "demo-project",
        filePath: "src/main.rs",
      }),
    );

    expect(result.status).toBe("handled");
    if (result.status === "handled") {
      expect(result.targetWindowId).toBe("win-files-reveal");
    }
  });

  it("handles search:query intent by launching and delivering query to SearchApp", async () => {
    await renderOs();

    const result = await dispatchIntent(
      createIntent("search:query", {
        profileId: testProfile.id,
        generation: 1,
        target: {
          kind: "project",
          profileId: testProfile.id,
          project: "demo-project",
        },
        projectId: "demo-project",
        mode: "text",
        query: "mySearchQuery",
      }),
    );

    expect(result.status).toBe("handled");
    if (result.status === "handled") {
      const win = useWindowStore.getState().session.windows[result.targetWindowId];
      expect(win).toBeDefined();
      expect(win.appId).toBe("search");
      expect(win.appState?.query).toBe("mySearchQuery");
    }
  });

  it("handles changes:diff intent by selecting file and switching to diff tab", async () => {
    await renderOs();

    const result = await dispatchIntent(
      createIntent("changes:diff", {
        profileId: testProfile.id,
        projectId: "demo-project",
        filePath: "src/utils.ts",
      }),
    );

    expect(result.status).toBe("handled");
    if (result.status === "handled") {
      const win = useWindowStore.getState().session.windows[result.targetWindowId];
      expect(win).toBeDefined();
      expect(win.appId).toBe("changes");
      expect(win.appState?.filePath).toBe("src/utils.ts");
      expect(win.appState?.activeTab).toBe("diff");
    }
  });

  it("handles terminal:focus safely by rejecting unknown terminal without creating PTY", async () => {
    await renderOs();

    const result = await dispatchIntent(
      createIntent("terminal:focus", {
        profileId: testProfile.id,
        terminalId: "nonexistent-terminal",
      }),
    );

    expect(result.status).toBe("unhandled");
  });

  it("rejects terminal:focus for unknown terminal without disturbing existing terminal window", async () => {
    await renderOs();

    // Open existing terminal window
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-term-existing",
        appId: "terminals",
        title: "Terminal",
        ctx: { profileId: testProfile.id },
        mode: "tile",
        appState: { sessionId: "valid-session", terminalId: "valid-session" },
      });
    });

    const result = await dispatchIntent(
      createIntent("terminal:focus", {
        profileId: testProfile.id,
        terminalId: "unknown-session",
      }),
    );

    expect(result.status).toBe("unhandled");

    // Existing terminal window's appState was NOT mutated
    const existing =
      useWindowStore.getState().session.windows["win-term-existing"];
    expect(existing.appState?.sessionId).toBe("valid-session");
  });

  it("reactivates diff tab on repeated identical changes:diff intent", async () => {
    await renderOs();

    // First changes:diff
    const result1 = await dispatchIntent(
      createIntent("changes:diff", {
        profileId: testProfile.id,
        projectId: "demo-project",
        filePath: "src/utils.ts",
        status: "M",
      }),
    );
    expect(result1.status).toBe("handled");
    const targetWinId = (result1 as { targetWindowId: string }).targetWindowId;

    // Switch tab to "changes"
    await act(async () => {
      useWindowStore.getState().updateAppState(targetWinId, {
        activeTab: "changes",
      });
    });
    expect(
      useWindowStore.getState().session.windows[targetWinId]?.appState
        ?.activeTab,
    ).toBe("changes");

    // Second changes:diff with identical filePath
    const result2 = await dispatchIntent(
      createIntent("changes:diff", {
        profileId: testProfile.id,
        projectId: "demo-project",
        filePath: "src/utils.ts",
        status: "M",
      }),
    );
    expect(result2.status).toBe("handled");

    // Must be reactivated to "diff"
    const win = useWindowStore.getState().session.windows[targetWinId];
    expect(win.appState?.activeTab).toBe("diff");
    expect(win.appState?.filePath).toBe("src/utils.ts");
  });
});
