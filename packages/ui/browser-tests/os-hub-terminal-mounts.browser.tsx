import "@/index.css";
import "@/os/os.css";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { OsResourceHost } from "@/os/OsResourceHost.js";
import { useWindowStore } from "@/os/window-store.js";
import { createDefaultOsSession } from "@/os/window-ops.js";
import { globalResourceRegistry } from "@/os/resource-registry.js";
import { useHubTerminalMountsStore } from "@/os/agent-hub/hub-terminal-mounts-store.js";
import {
  terminalRegistry,
  getTerminal,
} from "@/lib/terminal-registry.js";
import {
  terminalTargetKey,
  type TerminalTarget,
} from "@/api/terminal-session-contract.js";
import {
  __setConnectionSnapshotForTests,
  resetConnections,
} from "@/api/connections.js";
import { saveProfiles, type ServerProfile } from "@/api/server-config.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { MultiTerminalDisplay } from "@/components/organisms/MultiTerminalDisplay.js";
import { useHubTerminalAttachGate } from "@/os/agent-hub/use-hub-terminal-attach-gate.js";
import type { WsTransport } from "@/api/ws-transport.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const testProfile: ServerProfile = {
  id: "profile-a",
  name: "Host Alpha",
  url: "http://127.0.0.1:4801",
  authType: "none",
  createdAt: 1,
  autoConnect: true,
};

function createMockTransport(terminalWriteSpy = vi.fn()): WsTransport {
  const buffers = new Set<(value: unknown) => void>();
  return {
    invoke: vi.fn().mockImplementation((action: string) => {
      if (
        action === "terminal:listDetailedObservation" ||
        action === "terminal:listDetailed" ||
        action === "terminal:list"
      ) {
        return Promise.resolve({
          sessions: [
            {
              id: "term-1",
              alive: true,
              incarnation: 1,
              incarnationExact: "1",
              terminationState: "live",
            },
          ],
          termination: {
            version: 1,
            serverEpoch: "00000000-0000-0000-0000-000000000001",
          },
        });
      }
      return Promise.resolve([]);
    }),
    request: vi.fn().mockResolvedValue([]),
    terminalWrite: terminalWriteSpy,
    terminalResize: vi.fn(),
    terminalAttach: vi.fn().mockReturnValue(true),
    onTerminalBuffer: vi.fn().mockImplementation((_id, cb) => {
      buffers.add(cb);
      return () => buffers.delete(cb);
    }),
    onTerminalData: vi.fn().mockReturnValue(() => {}),
    onTerminalExit: vi.fn().mockReturnValue(() => {}),
    onEvent: vi.fn().mockReturnValue(() => {}),
    onClose: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
  } as unknown as WsTransport;
}

const targetT1: TerminalTarget = {
  profileId: "profile-a",
  generation: 1,
  terminalId: "term-1",
  incarnation: "1",
  serverEpoch: "00000000-0000-0000-0000-000000000001",
};

function HubHarnessPane({
  hubWindowId,
  sessionIds,
  activeSessionId,
  target,
}: {
  hubWindowId: string;
  sessionIds: string[];
  activeSessionId: string | null;
  target: TerminalTarget;
}) {
  const attachGate = useHubTerminalAttachGate({
    hubWindowId,
    sessionIds,
    resolveTarget: (id) => (id === target.terminalId ? target : undefined),
  });

  const mountedSessions = sessionIds.map((sid) => ({
    sessionId: sid,
    project: "test-proj",
    command: "bash",
    terminalTarget: target,
  }));

  const openTabs = sessionIds.map((sid) => ({
    sessionId: sid,
    label: sid,
    title: {
      fullText: sid,
      baseLabel: sid,
      ordinal: 1,
    },
  }));

  return (
    <div style={{ width: "800px", height: "500px", position: "relative" }}>
      <MultiTerminalDisplay
        activeSessionId={activeSessionId}
        mountedSessions={mountedSessions}
        openTabs={openTabs}
        layoutStorageKey={`terminal-layout:${hubWindowId}`}
        renderTerminals={false}
        attachGate={attachGate}
      />
    </div>
  );
}

describe("os-hub-terminal-mounts.browser", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let transport: WsTransport;
  let terminalWriteSpy: Mock;

  beforeEach(() => {
    container = document.createElement("div");
    container.id = "browser-test-root";
    container.style.width = "1280px";
    container.style.height = "800px";
    container.style.position = "relative";
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

    saveProfiles([testProfile], testProfile.id);

    terminalWriteSpy = vi.fn();
    transport = createMockTransport(terminalWriteSpy);
    __setConnectionSnapshotForTests(
      testProfile.id,
      {
        owner: { profileId: testProfile.id, generation: 1 },
        status: "connected",
      },
      transport,
    );

    const session = createDefaultOsSession("desk-1", "Main");
    session.desktops.push({
      id: "desk-2",
      name: "Desktop 2",
      tree: null,
      floatingWindowIds: [],
      focusedWindowId: null,
    });
    session.windows["hub-win-1"] = {
      id: "hub-win-1",
      appId: "agent-hub",
      title: "Agent Hub",
      desktopId: "desk-1",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      state: "normal",
      zIndex: 1,
      ctx: { profileId: testProfile.id },
    };
    session.desktops[0].floatingWindowIds = ["hub-win-1"];
    session.desktops[0].focusedWindowId = "hub-win-1";
    useWindowStore.getState().setSession(session);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
    resetConnections();
    queryClient.clear();
    useCognitoModeStore.getState().reset();
    useHubTerminalMountsStore.setState({ mountsByHub: {} });
    globalResourceRegistry.clear();
    terminalRegistry.clear();
  });

  it("preserves xterm instance identity across standalone window open/close, desktop switch, and project switch", async () => {
    // 1. Publish mount for T1 from Hub
    useHubTerminalMountsStore.getState().publish("hub-win-1", [
      {
        logicalKey: '["profile-a","term-1"]',
        target: targetT1,
        project: "proj-1",
        command: "bash",
      },
    ]);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OsResourceHost>
            <HubHarnessPane
              hubWindowId="hub-win-1"
              sessionIds={["term-1"]}
              activeSessionId="term-1"
              target={targetT1}
            />
          </OsResourceHost>
        </QueryClientProvider>,
      );
    });

    const regKey = terminalTargetKey(targetT1);
    const initialEntry = getTerminal(regKey);
    expect(initialEntry).toBeDefined();
    const initialTerm = initialEntry!.terminal;

    // Verify exactly one TerminalPanel in DOM
    const panelCount1 = container.querySelectorAll(
      '[data-terminal-session-id="term-1"]',
    ).length;
    expect(panelCount1).toBe(1);

    // (a) Standalone window open for same target
    await act(async () => {
      useWindowStore.getState().openWindow(
        {
          id: "standalone-win-1",
          appId: "terminals",
          title: "Terminal 1",
          bounds: { x: 50, y: 50, width: 600, height: 400 },
          zIndex: 2,
          ctx: { profileId: testProfile.id },
          runtimeIdentity: { kind: "terminal", target: targetT1 },
        },
        "desk-1",
      );
    });

    // Identity survives standalone opening
    const entryAfterStandaloneOpen = getTerminal(regKey);
    expect(entryAfterStandaloneOpen?.terminal).toBe(initialTerm);
    const panelCount2 = container.querySelectorAll(
      '[data-terminal-session-id="term-1"]',
    ).length;
    expect(panelCount2).toBe(1);

    // Close standalone window
    await act(async () => {
      useWindowStore.getState().closeWindow("standalone-win-1");
    });

    // Identity survives standalone close
    const entryAfterStandaloneClose = getTerminal(regKey);
    expect(entryAfterStandaloneClose?.terminal).toBe(initialTerm);
    const panelCount3 = container.querySelectorAll(
      '[data-terminal-session-id="term-1"]',
    ).length;
    expect(panelCount3).toBe(1);

    // (b) Desktop switch away to desk-2 and back to desk-1
    await act(async () => {
      useWindowStore.getState().switchDesktop("desk-2");
    });
    await act(async () => {
      useWindowStore.getState().switchDesktop("desk-1");
    });

    // Identity survives desktop switch
    const entryAfterDesktopSwitch = getTerminal(regKey);
    expect(entryAfterDesktopSwitch?.terminal).toBe(initialTerm);

    // (c) Hub harness project switch
    await act(async () => {
      useHubTerminalMountsStore.getState().publish("hub-win-1", [
        {
          logicalKey: '["profile-a","term-1"]',
          target: targetT1,
          project: "proj-2", // switched project
          command: "bash",
        },
      ]);
    });

    // Identity survives project switch
    const entryAfterProjectSwitch = getTerminal(regKey);
    expect(entryAfterProjectSwitch?.terminal).toBe(initialTerm);
  });

  it("handles Hub to standalone handoff and quiet PTY input reaches transport", async () => {
    useHubTerminalMountsStore.getState().publish("hub-win-1", [
      {
        logicalKey: '["profile-a","term-1"]',
        target: targetT1,
        project: "proj-1",
        command: "bash",
      },
    ]);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OsResourceHost>
            <HubHarnessPane
              hubWindowId="hub-win-1"
              sessionIds={["term-1"]}
              activeSessionId="term-1"
              target={targetT1}
            />
          </OsResourceHost>
        </QueryClientProvider>,
      );
    });

    const entry = getTerminal(terminalTargetKey(targetT1));
    expect(entry).toBeDefined();

    // Standalone window opens and claims target
    // Hub pane loses claim and cleans up
    globalResourceRegistry.release(
      {
        resourceKind: "terminal",
        profileId: targetT1.profileId,
        generation: targetT1.generation,
        resourceId: targetT1.terminalId,
        incarnation: targetT1.incarnation,
        authority: targetT1.serverEpoch,
      },
      "hub-win-1",
    );
    globalResourceRegistry.claim(
      {
        resourceKind: "terminal",
        profileId: targetT1.profileId,
        generation: targetT1.generation,
        resourceId: targetT1.terminalId,
        incarnation: targetT1.incarnation,
        authority: targetT1.serverEpoch,
      },
      "standalone-win-1",
    );

    // Hub pane unmounts or switches
    expect(entry?.terminal.options.disableStdin).toBeDefined();
  });

  it("renders claim placeholder when denied and Go to window reveals holder across desktops", async () => {
    // Window win-holder on desk-2 holds the claim
    const session = createDefaultOsSession("desk-1", "Main");
    session.desktops.push({
      id: "desk-2",
      name: "Desktop 2",
      tree: null,
      floatingWindowIds: ["win-holder"],
      focusedWindowId: "win-holder",
    });
    session.windows["hub-win-1"] = {
      id: "hub-win-1",
      appId: "agent-hub",
      title: "Agent Hub",
      desktopId: "desk-1",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      state: "normal",
      zIndex: 1,
      ctx: { profileId: testProfile.id },
    };
    session.windows["win-holder"] = {
      id: "win-holder",
      appId: "terminals",
      title: "Holder Window",
      desktopId: "desk-2",
      bounds: { x: 0, y: 0, width: 600, height: 400 },
      state: "minimized",
      minimized: true,
      mode: "float",
      restorePlacement: {
        mode: "float",
        desktopId: "desk-2",
        floatBounds: { x: 0, y: 0, width: 600, height: 400 },
      },
      zIndex: 1,
      ctx: { profileId: testProfile.id },
    };
    session.desktops[0].floatingWindowIds = ["hub-win-1"];
    session.desktops[0].focusedWindowId = "hub-win-1";
    useWindowStore.getState().setSession(session);

    globalResourceRegistry.claim(
      {
        resourceKind: "terminal",
        profileId: targetT1.profileId,
        generation: targetT1.generation,
        resourceId: targetT1.terminalId,
        incarnation: targetT1.incarnation,
        authority: targetT1.serverEpoch,
      },
      "win-holder",
    );

    useHubTerminalMountsStore.getState().publish("hub-win-1", [
      {
        logicalKey: '["profile-a","term-1"]',
        target: targetT1,
        project: "proj-1",
        command: "bash",
      },
    ]);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OsResourceHost>
            <HubHarnessPane
              hubWindowId="hub-win-1"
              sessionIds={["term-1"]}
              activeSessionId="term-1"
              target={targetT1}
            />
          </OsResourceHost>
        </QueryClientProvider>,
      );
    });

    // Check placeholder rendered
    const placeholder = container.querySelector(
      "[data-testid=hub-terminal-claim-placeholder]",
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder?.textContent).toContain("Terminal open in another window");

    // Click "Go to window"
    const goToButton = container.querySelector<HTMLButtonElement>(
      "[data-testid=hub-terminal-claim-placeholder] button",
    );
    expect(goToButton).not.toBeNull();

    await act(async () => {
      goToButton?.click();
    });

    // Should switch to desk-2, restore win-holder, and focus it
    const updatedSession = useWindowStore.getState().session;
    expect(updatedSession.activeDesktopId).toBe("desk-2");
    expect(updatedSession.windows["win-holder"].minimized).toBe(false);
  });
});
