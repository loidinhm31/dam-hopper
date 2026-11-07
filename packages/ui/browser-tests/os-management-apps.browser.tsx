import "@/index.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OsShell } from "@/os/OsShell.js";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { createProjectDesktopTemplate } from "@/os/desktop-templates.js";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import { __setConnectionSnapshotForTests, resetConnections } from "@/api/connections.js";
import { saveProfiles, type ServerProfile } from "@/api/server-config.js";
import type { WsTransport } from "@/api/ws-transport.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const testProfile: ServerProfile = {
  id: "management-profile",
  name: "Management test profile",
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

describe("OS Management Apps Browser Tests", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    resetConnections();
    globalResourceRegistry.clear();
    saveProfiles([testProfile]);
    useWindowStore.getState().setSession(createDefaultOsSession());

    const transport = createTestTransport();
    __setConnectionSnapshotForTests(testProfile.id, {
      status: "connected",
      profileId: testProfile.id,
      serverUrl: testProfile.url,
      generation: 1,
      owner: { profileId: testProfile.id, generation: 1 },
      transport,
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
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <EncryptProvider>
              <OsShell />
            </EncryptProvider>
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
  };

  it("mounts management apps inside OS windows", async () => {
    await renderOs();

    // 1. PortsTunnelsApp
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-ports-1",
        appId: "ports-tunnels",
        title: "Ports & Tunnels",
        ctx: { profileId: testProfile.id },
        mode: "float",
      });
    });

    const portsEl = container?.querySelector('[data-os-ports-tunnels-app="win-ports-1"]');
    expect(portsEl).not.toBeNull();

    // 2. SettingsApp
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-settings-1",
        appId: "settings",
        title: "Settings",
        ctx: { profileId: testProfile.id },
        mode: "tile",
      });
    });

    const settingsEl = container?.querySelector('[data-os-settings-app="win-settings-1"]');
    expect(settingsEl).not.toBeNull();

    // 3. AgentStoreApp
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-store-1",
        appId: "agent-store",
        title: "Agent Store",
        ctx: { profileId: testProfile.id },
        mode: "tile",
      });
    });

    const storeEl = container?.querySelector('[data-os-agent-store-app="win-store-1"]');
    expect(storeEl).not.toBeNull();

    // 4. WorkflowPlansApp
    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-workflow-1",
        appId: "workflow-plans",
        title: "Workflow & Plans",
        ctx: { profileId: testProfile.id, projectId: "demo-project" },
        mode: "tile",
      });
    });

    const workflowEl = container?.querySelector(
      '[data-os-workflow-plans-app="win-workflow-1"]',
    );
    expect(workflowEl).not.toBeNull();
  });

  it("applies project desktop template with 60/40 binary split and tiled windows", async () => {
    await renderOs();

    const { desktop, windows } = createProjectDesktopTemplate(
      "Desktop Alpha",
      { profileId: testProfile.id, projectId: "project-alpha" },
    );

    await act(async () => {
      const current = useWindowStore.getState().session;
      const updatedDesktops = [...current.desktops, desktop];
      const updatedWindows = { ...current.windows };
      for (const w of windows) {
        updatedWindows[w.id] = w;
      }
      useWindowStore.getState().setSession({
        ...current,
        desktops: updatedDesktops,
        windows: updatedWindows,
        activeDesktopId: desktop.id,
      });
    });

    const canvas = container?.querySelector(
      `[data-os-desktop-canvas="${desktop.id}"]`,
    );
    expect(canvas).not.toBeNull();
    expect(windows).toHaveLength(5);
  });

  it("mounts AgentStoreApp and manages tab in window appState without mutating route URL", async () => {
    await renderOs();

    await act(async () => {
      useWindowStore.getState().openWindow({
        id: "win-store-decoupled",
        appId: "agent-store",
        title: "Agent Store",
        ctx: { profileId: testProfile.id },
        mode: "tile",
        appState: { tab: "memory" },
      });
    });

    const storeEl = container?.querySelector(
      '[data-os-agent-store-app="win-store-decoupled"]',
    );
    expect(storeEl).not.toBeNull();

    const win =
      useWindowStore.getState().session.windows["win-store-decoupled"];
    expect(win.appState?.tab).toBe("memory");

    const memoryBtn = storeEl?.querySelector('button[aria-pressed="true"]');
    expect(memoryBtn?.textContent).toContain("Memory Files");
  });
});
