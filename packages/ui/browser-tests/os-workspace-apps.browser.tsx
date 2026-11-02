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
        projectId: "demo-project",
        filePath: "src/main.rs",
      }),
    );

    expect(result.status).toBe("handled");
    if (result.status === "handled") {
      expect(result.targetWindowId).toBe("win-files-reveal");
    }
  });
});
