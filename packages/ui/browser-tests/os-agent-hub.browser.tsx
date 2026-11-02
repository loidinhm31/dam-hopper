import "@/index.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import { __setConnectionSnapshotForTests, resetConnections } from "@/api/connections.js";
import { saveProfiles, type ServerProfile } from "@/api/server-config.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { useAgentStatusStore } from "@/stores/agent-status.js";
import { AgentHubApp } from "@/os/apps/AgentHubApp.js";
import { createAgentHubDesktopTemplate } from "@/os/desktop-templates.js";
import type { WsTransport } from "@/api/ws-transport.js";
import type { SessionInfo } from "@/api/client.js";
import type { TerminalAgentStatusRow } from "@/api/agent-status-types.js";

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
  autoConnect: true,
};

const profileB: ServerProfile = {
  id: "profile-b",
  name: "Host Beta",
  url: "http://127.0.0.1:4802",
  authType: "none",
  createdAt: 2,
  autoConnect: true,
};

function createMockTransport(sessionsList: SessionInfo[]): WsTransport {
  return {
    invoke: vi.fn().mockImplementation((action: string) => {
      if (action === "terminal:listDetailed" || action === "terminal:list") {
        return Promise.resolve(sessionsList);
      }
      return Promise.resolve([]);
    }),
    request: vi.fn().mockResolvedValue([]),
    terminalWrite: vi.fn(),
    terminalResize: vi.fn(),
    onEvent: vi.fn().mockReturnValue(() => {}),
    onClose: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  } as unknown as WsTransport;
}

describe("os-agent-hub.browser", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

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

    saveProfiles([profileA, profileB], profileA.id);

    // Initial OS window store setup with Agent Hub template
    const hubTemplate = createAgentHubDesktopTemplate("Hub", "desktop-hub");
    const session = createDefaultOsSession();
    session.desktops = [hubTemplate.desktop];
    session.activeDesktopId = hubTemplate.desktop.id;
    session.windows = {};
    for (const w of hubTemplate.windows) {
      session.windows[w.id] = w;
    }
    useWindowStore.getState().setSession(session);

    // Reset Cognito mode
    useCognitoModeStore.getState().reset();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    resetConnections();
    queryClient.clear();
    useAgentStatusStore.setState({ profiles: new Map() });
    useCognitoModeStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("renders multi-profile Agent Hub with urgency grouping and filters", async () => {
    const sessionA: SessionInfo = {
      id: "term-omp-1",
      name: "OMP Worker",
      command: "omp task",
      cwd: "/repo/alpha",
      type: "shell",
      startedAt: Date.now(),
      alive: true,
      incarnation: 1,
    };
    const sessionB: SessionInfo = {
      id: "term-codex-1",
      name: "Codex Agent",
      command: "codex exec",
      cwd: "/repo/beta",
      type: "shell",
      startedAt: Date.now(),
      alive: true,
      incarnation: 1,
    };

    const transportA = createMockTransport([sessionA]);
    const transportB = createMockTransport([sessionB]);

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

    __setConnectionSnapshotForTests(
      profileB.id,
      {
        owner: { profileId: profileB.id, generation: 1 },
        status: "connected",
        intent: true,
        serverUrl: profileB.url,
        error: null,
      },
      transportB,
    );

    // Populate agent status store:
    // term-omp-1 is Idle
    // term-codex-1 is Blocked (Needs attention)
    const statusRowA: TerminalAgentStatusRow = {
      id: "term-omp-1",
      incarnation: 1,
      agentKind: "omp",
      agentSessionId: "omp-session-1",
      reporterEpoch: 1,
      state: "idle",
      source: "lifecycle",
      attentionRevision: 0,
    };

    const statusRowB: TerminalAgentStatusRow = {
      id: "term-codex-1",
      incarnation: 1,
      agentKind: "codex",
      agentSessionId: "codex-session-1",
      reporterEpoch: 1,
      state: "blocked",
      reason: "approval",
      source: "hook",
      attentionRevision: 1,
    };

    useAgentStatusStore.setState({
      profiles: new Map([
        [
          profileA.id,
          {
            owner: { profileId: profileA.id, generation: 1 },
            epoch: 1,
            revision: 1,
            availability: "ready",
            rows: new Map([["term-omp-1", statusRowA]]),
            cursors: new Map(),
          },
        ],
        [
          profileB.id,
          {
            owner: { profileId: profileB.id, generation: 1 },
            epoch: 1,
            revision: 1,
            availability: "ready",
            rows: new Map([["term-codex-1", statusRowB]]),
            cursors: new Map(),
          },
        ],
      ]),
    });

    queryClient.setQueryData(
      ["profile", profileA.id, 1, "terminal-sessions"],
      [{ ...sessionA, profileId: profileA.id }],
    );
    queryClient.setQueryData(
      ["profile", profileB.id, 1, "terminal-sessions"],
      [{ ...sessionB, profileId: profileB.id }],
    );

    const hubWindow = Object.values(useWindowStore.getState().session.windows)[0];

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <AgentHubApp window={hubWindow} />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    // Verify Agent Hub rendered
    const hubRoot = container.querySelector(`[data-os-agent-hub="${hubWindow.id}"]`);
    expect(hubRoot).not.toBeNull();

    // Verify Urgency Summary Pills
    const filterAll = container.querySelector('[data-testid="agent-hub-filter-all"]');
    expect(filterAll?.textContent).toContain("All");

    const filterNeedsAttention = container.querySelector(
      '[data-testid="agent-hub-filter-needs-attention"]',
    );
    expect(filterNeedsAttention?.textContent).toContain("Needs Attention");

    // Needs attention group should be rendered
    const needsAttentionGroup = container.querySelector(
      '[data-testid="agent-hub-group-needs-attention"]',
    );
    expect(needsAttentionGroup).not.toBeNull();
  });

  it("masks agent titles when Cognito Privacy Mode is activated", async () => {
    const sessionA: SessionInfo = {
      id: "term-secret-1",
      name: "Super Secret Project Terminal",
      command: "secret-cmd",
      cwd: "/repo/secret",
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

    useAgentStatusStore.setState({
      profiles: new Map([
        [
          profileA.id,
          {
            owner: { profileId: profileA.id, generation: 1 },
            epoch: 1,
            revision: 1,
            availability: "ready",
            rows: new Map([
              [
                "term-secret-1",
                {
                  id: "term-secret-1",
                  incarnation: 1,
                  agentKind: "omp",
                  agentSessionId: "s-1",
                  reporterEpoch: 1,
                  state: "working",
                  source: "lifecycle",
                  attentionRevision: 0,
                },
              ],
            ]),
            cursors: new Map(),
          },
        ],
      ]),
    });

    queryClient.setQueryData(
      ["profile", profileA.id, 1, "terminal-sessions"],
      [{ ...sessionA, profileId: profileA.id }],
    );

    const hubWindow = Object.values(useWindowStore.getState().session.windows)[0];

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <AgentHubApp window={hubWindow} />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    // Initially title is visible
    expect(container.textContent).toContain("Super Secret Project Terminal");

    // Activate Cognito Privacy Mode
    await act(async () => {
      useCognitoModeStore.getState().toggle("Ctrl+Shift+C");
    });

    // Title should be masked as [Protected Agent]
    expect(container.textContent).toContain("[Protected Agent]");
    expect(container.textContent).not.toContain("Super Secret Project Terminal");
  });
});
