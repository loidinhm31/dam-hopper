import "@/index.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { __setConnectionSnapshotForTests, resetConnections } from "@/api/connections.js";
import { saveProfiles, type ServerProfile } from "@/api/server-config.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { terminalRegistry } from "@/lib/terminal-registry.js";
import { useHubTerminalMountsStore } from "@/os/agent-hub/hub-terminal-mounts-store.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useAgentStatusStore } from "@/stores/agent-status.js";
import { AgentHubApp } from "@/os/apps/AgentHubApp.js";
import { createAgentHubDesktopTemplate } from "@/os/desktop-templates.js";
import { registerIntentHandler } from "@/os/intents.js";
import { profileQueryKey } from "@/api/query-client.js";
import type { WsTransport } from "@/api/ws-transport.js";
import type { SessionInfo } from "@/api/client.js";
import type { OsWindow } from "@/os/types.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const profileA: ServerProfile = {
  id: "profile-a",
  name: "Host Alpha",
  url: "http://127.0.0.1:4801",
  authType: "none",
  createdAt: 1,
  autoConnect: false,
};

const profileB: ServerProfile = {
  id: "profile-b",
  name: "Host Beta",
  url: "http://127.0.0.1:4802",
  authType: "none",
  createdAt: 2,
  autoConnect: false,
};

function createMockTransport(
  sessionsList: SessionInfo[],
  projectsList: { name: string; path?: string }[] = [],
): WsTransport {
  return {
    invoke: vi.fn().mockImplementation((action: string) => {
      if (
        action === "terminal:listDetailedObservation" ||
        action === "terminal:listDetailed" ||
        action === "terminal:list"
      ) {
        return Promise.resolve({
          sessions: sessionsList.map((s) => ({
            ...s,
            incarnationExact: String(s.incarnation ?? 1),
            terminationState: s.alive ? "live" : "exited",
          })),
          termination: {
            version: 1,
            serverEpoch: "00000000-0000-0000-0000-000000000001",
          },
        });
      }
      if (action === "projects:list" || action === "project:list") {
        return Promise.resolve(projectsList);
      }
      return Promise.resolve([]);
    }),
    request: vi.fn().mockResolvedValue([]),
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    onTerminalData: vi.fn().mockReturnValue(() => {}),
    onTerminalExit: vi.fn().mockReturnValue(() => {}),
    onEvent: vi.fn().mockReturnValue(() => {}),
    onClose: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  } as unknown as WsTransport;
}

describe("os-agent-hub.browser", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let hubWindow: OsWindow;

  beforeEach(() => {
    container = document.createElement("div");
    container.id = "browser-test-root";
    container.style.width = "1280px";
    container.style.height = "800px";
    document.body.appendChild(container);
    root = createRoot(container);

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });
    globalResourceRegistry.clear();
    terminalRegistry.clear();
    useHubTerminalMountsStore.setState({ mountsByHub: {} });
    useCognitoModeStore.getState().reset();

    saveProfiles([profileA], profileA.id);

    const hubTemplate = createAgentHubDesktopTemplate("Hub", "desktop-hub");
    const session = createDefaultOsSession();
    session.desktops = [hubTemplate.desktop];
    session.activeDesktopId = hubTemplate.desktop.id;
    session.windows = {};
    for (const w of hubTemplate.windows) {
      session.windows[w.id] = w;
    }
    useWindowStore.getState().setSession(session);
    hubWindow = hubTemplate.windows[0];
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    resetConnections();
    queryClient.clear();
    globalResourceRegistry.clear();
    terminalRegistry.clear();
    useHubTerminalMountsStore.setState({ mountsByHub: {} });
    useCognitoModeStore.getState().reset();
    useAgentStatusStore.setState({ profiles: new Map() });
    vi.restoreAllMocks();
  });

  it("renders terminal-first Agent Hub with Header and Traditional projects display without roster or filters", async () => {
    const sessionA: SessionInfo = {
      id: "term-1",
      name: "Worker 1",
      command: "bash",
      cwd: "/repo/dam-hopper",
      project: "dam-hopper",
      type: "shell",
      startedAt: Date.now(),
      alive: true,
      incarnation: 1,
    };

    const transportA = createMockTransport([sessionA]);

    __setConnectionSnapshotForTests(
      profileA.id,
      {
        owner: { profileId: profileA.id, generation: 1 },
        status: "connected",
        intent: true,
        serverUrl: profileA.url,
        error: null,
      },
      transportA,
    );

    await act(async () => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <AgentHubApp window={hubWindow} />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    expect(container.querySelector('[data-testid="agent-hub-app"]')).not.toBeNull();

    // Header elements
    const toggleBtn = container.querySelector("button[aria-label='Toggle projects sidebar']");
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn?.getAttribute("aria-expanded")).toBe("true");

    const header = container.querySelector("header");
    expect(header?.textContent).toContain("Agent Hub");
    expect(container.querySelector('[data-testid="agent-hub-context-pill"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-hub-attn-counter"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="agent-hub-work-counter"]')).not.toBeNull();

    // Roster / filter pills / Jump / Open beside MUST NOT exist (B4)
    expect(container.querySelector('[data-testid="agent-hub-card-roster"]')).toBeNull();
    expect(container.querySelector('[data-testid="agent-hub-search-input"]')).toBeNull();
    expect(container.querySelector('button[title="Jump to terminal"]')).toBeNull();
    expect(container.querySelector('button[title="Open beside"]')).toBeNull();

    // TraditionalTerminalProjectsDisplay must be present
    expect(container.querySelector('main[key="terminal-surface"], main#traditional-terminal-project-panel-project\\:dam-hopper, main[role="tabpanel"]')).not.toBeNull();
  });

  it("toggles sidebar visibility while preserving the terminal-surface main container", async () => {
    const transportA = createMockTransport([]);
    __setConnectionSnapshotForTests(
      profileA.id,
      {
        owner: { profileId: profileA.id, generation: 1 },
        status: "connected",
        intent: true,
        serverUrl: profileA.url,
        error: null,
      },
      transportA,
    );

    await act(async () => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <AgentHubApp window={hubWindow} />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });

    const toggleBtn = container.querySelector<HTMLButtonElement>("button[aria-label='Toggle projects sidebar']");
    expect(toggleBtn).not.toBeNull();
    expect(toggleBtn?.getAttribute("aria-expanded")).toBe("true");

    // Click toggle to hide sidebar
    await act(async () => {
      toggleBtn?.click();
    });

    // Sidebar navigator should be hidden
    expect(container.querySelector('nav[aria-label="Terminal projects and agents"]')).toBeNull();

    // But main terminal-surface is still present and preserved!
    expect(container.querySelector('main[role="tabpanel"]')).not.toBeNull();

    // Click toggle again to restore sidebar
    await act(async () => {
      toggleBtn?.click();
    });

    expect(container.querySelector('nav[aria-label="Terminal projects and agents"]')).not.toBeNull();
  });

  it("dispatches recipes:open when clicking Recipes in header", async () => {
    const transportA = createMockTransport([]);
    __setConnectionSnapshotForTests(
      profileA.id,
      {
        owner: { profileId: profileA.id, generation: 1 },
        status: "connected",
        intent: true,
        serverUrl: profileA.url,
        error: null,
      },
      transportA,
    );

    const receivedIntents: unknown[] = [];
    const unregister = registerIntentHandler("recipes:open", (intent) => {
      receivedIntents.push(intent);
      return { handled: true };
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <AgentHubApp window={hubWindow} />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });

    const recipesBtn = container.querySelector<HTMLButtonElement>("button[aria-label='Open Recipes']");
    expect(recipesBtn).not.toBeNull();

    await act(async () => {
      recipesBtn?.click();
    });

    expect(receivedIntents).toHaveLength(1);
    unregister();
  });

  it("renders empty state with New Terminal and Recipes when zero-terminal workspace is open", async () => {
    const hubWithZeroWorkspace: OsWindow = {
      ...hubWindow,
      appState: {
        openWorkspaces: [{ profileId: "profile-a", project: "dam-hopper" }],
        selectedWorkspace: '["profile-a","dam-hopper"]',
      },
    };

    useWindowStore.getState().session.windows[hubWithZeroWorkspace.id] = hubWithZeroWorkspace;

    const transportA = createMockTransport(
      [],
      [{ name: "dam-hopper", path: "/repos/dam-hopper" }],
    );
    __setConnectionSnapshotForTests(
      profileA.id,
      {
        owner: { profileId: profileA.id, generation: 1 },
        status: "connected",
        intent: true,
        serverUrl: profileA.url,
        error: null,
        projects: [{ name: "dam-hopper", path: "/repos/dam-hopper" }],
      },
      transportA,
    );
    queryClient.setQueryData(
      profileQueryKey({ profileId: profileA.id, generation: 1 }, "projects"),
      [{ name: "dam-hopper", path: "/repos/dam-hopper" }],
    );
    await act(async () => {
      root.render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <AgentHubApp window={hubWithZeroWorkspace} />
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await queryClient.refetchQueries();
    });
    const emptyState = container.querySelector('[data-testid="traditional-terminal-empty-workspace"]');
    expect(emptyState).not.toBeNull();
    expect(emptyState?.textContent).toContain("No terminals running in this workspace");
    expect(emptyState?.querySelector("button")?.textContent).toContain("New Terminal");
  });
});
