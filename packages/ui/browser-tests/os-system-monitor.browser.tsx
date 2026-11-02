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
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import { __setConnectionSnapshotForTests, resetConnections } from "@/api/connections.js";
import { saveProfiles, type ServerProfile } from "@/api/server-config.js";
import { useHostResourceAlertPresentationStore } from "@/hooks/use-host-resource-alert-presentation.js";
import { useCognitoModeStore } from "@/stores/cognito-mode.js";
import { dispatchIntent, createIntent, registerIntentHandler } from "@/os/intents.js";
import { SystemMonitorApp } from "@/os/apps/SystemMonitorApp.js";
import { MonitorTray } from "@/os/MonitorTray.js";
import { ingestIpcActivityEvent, useOsNotificationStore } from "@/os/notifications.js";
import type { WsTransport } from "@/api/ws-transport.js";
import type { ApiClient, SessionInfo } from "@/api/client.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const profileA: ServerProfile = {
  id: "profile-a",
  name: "Production EU",
  url: "http://127.0.0.1:4801",
  authType: "none",
  createdAt: 1,
  autoConnect: true,
};

const profileB: ServerProfile = {
  id: "profile-b",
  name: "Staging US",
  url: "http://127.0.0.1:4802",
  authType: "none",
  createdAt: 2,
  autoConnect: true,
};

const identicalId = "terminal-duplicate-123";

function createMockTransport(
  sessionsList: SessionInfo[],
  killFn?: (id: string) => Promise<void>,
): WsTransport {
  return {
    invoke: vi.fn().mockImplementation((action: string, payload: unknown) => {
      if (action === "terminal:kill") {
        return killFn ? killFn(payload as string) : Promise.resolve();
      }
      if (action === "terminal:listDetailed") {
        return Promise.resolve(sessionsList);
      }
      return Promise.resolve([]);
    }),
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

describe("OS System Monitor & Tray Browser Tests", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let queryClient: QueryClient;
  let killCallsA: string[] = [];
  let killCallsB: string[] = [];
  let sessionsA: SessionInfo[] = [];
  let sessionsB: SessionInfo[] = [];

  beforeEach(() => {
    localStorage.clear();
    resetConnections();
    globalResourceRegistry.clear();
    useCognitoModeStore.getState().reset();
    useHostResourceAlertPresentationStore.getState().reset();
    saveProfiles([profileA, profileB]);
    useWindowStore.getState().setSession(createDefaultOsSession());

    killCallsA = [];
    killCallsB = [];

    sessionsA = [
      {
        id: identicalId,
        command: "npm start",
        project: "app-prod",
        cwd: "/prod",
        type: "terminal",
        alive: true,
        startedAt: Date.now() - 60000,
        incarnation: 10,
      },
    ];

    sessionsB = [
      {
        id: identicalId,
        command: "cargo test",
        project: "api-staging",
        cwd: "/staging",
        type: "terminal",
        alive: true,
        startedAt: Date.now() - 30000,
        incarnation: 20,
      },
    ];

    const transportA = createMockTransport(sessionsA, async (id) => {
      killCallsA.push(id);
    });
    const transportB = createMockTransport(sessionsB, async (id) => {
      killCallsB.push(id);
    });

    const apiA = {
      terminal: {
        kill: vi.fn().mockImplementation(async (id: string) => {
          killCallsA.push(id);
        }),
      },
    } as unknown as ApiClient;

    const apiB = {
      terminal: {
        kill: vi.fn().mockImplementation(async (id: string) => {
          killCallsB.push(id);
        }),
      },
    } as unknown as ApiClient;

    __setConnectionSnapshotForTests(profileA.id, {
      status: "connected",
      intent: true,
      owner: { profileId: profileA.id, generation: 1 },
      transport: transportA,
      api: apiA,
    });

    __setConnectionSnapshotForTests(profileB.id, {
      status: "connected",
      intent: true,
      owner: { profileId: profileB.id, generation: 1 },
      transport: transportB,
      api: apiB,
    });

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });

    queryClient.setQueryData(
      ["profile", "profile-a", 1, "terminal-sessions"],
      sessionsA.map((s) => ({ ...s, profileId: "profile-a" })),
    );
    queryClient.setQueryData(
      ["profile", "profile-b", 1, "terminal-sessions"],
      sessionsB.map((s) => ({ ...s, profileId: "profile-b" })),
    );

    container = document.createElement("div");
    container.id = "browser-test-root";
    container.style.width = "1280px";
    container.style.height = "800px";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
      root = null;
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
      container = null;
    }
    saveProfiles([]);
    resetConnections();
    localStorage.clear();
    useCognitoModeStore.getState().reset();
    useHostResourceAlertPresentationStore.getState().reset();
    queryClient.clear();
  });

  it("renders MonitorTray with live metrics and opens System Monitor on click", async () => {
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <OsShell />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    // Verify MonitorTray is rendered in TopBar
    const tray = container?.querySelector('[data-testid="os-monitor-tray"]');
    expect(tray).not.toBeNull();

    // Click MonitorTray to dispatch system:monitor intent
    const trayButton = tray?.querySelector("button");
    expect(trayButton).not.toBeNull();

    await act(async () => {
      trayButton?.click();
    });

    // Verify SystemMonitor window is opened
    const monitorApp = container?.querySelector('[data-os-system-monitor="true"], [data-testid^="system-monitor-app-"]');
    expect(monitorApp).not.toBeNull();
  });

  it("isolates sessions across two profiles with identical terminal IDs during jump and kill", async () => {
    let focusedTerminal: { profileId: string; terminalId: string } | null = null;
    const unsubFocus = registerIntentHandler("terminal:focus", (intent) => {
      focusedTerminal = {
        profileId: intent.payload.profileId,
        terminalId: intent.payload.terminalId,
      };
      return { status: "handled" };
    });

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <OsShell />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    // Open System Monitor
    await act(async () => {
      await dispatchIntent(createIntent("system:monitor", { profileId: "profile-a" }));
    });

    const monitorApp = container?.querySelector('[data-testid^="system-monitor-app-"]');
    expect(monitorApp).not.toBeNull();

    // Verify both session rows are displayed across fleet
    const sessionRows = container?.querySelectorAll("li[role='button']");
    expect(sessionRows?.length).toBe(2);

    // Test Jump action: clicking the first row (profile-a) triggers terminal:focus for profile-a
    await act(async () => {
      (sessionRows?.[0] as HTMLElement).click();
    });
    expect(focusedTerminal).toEqual({ profileId: "profile-a", terminalId: identicalId });

    // Click kill button on the first session row (profile-a)
    const killBtnA = sessionRows?.[0]?.querySelector("button[title='Kill session']");
    expect(killBtnA).not.toBeNull();

    await act(async () => {
      (killBtnA as HTMLButtonElement).click();
    });

    // Verify confirmation Dialog primitive opened with focus trap
    const confirmDialog = document.querySelector('[role="dialog"]');
    expect(confirmDialog).not.toBeNull();
    expect(confirmDialog?.textContent).toContain("profile-a");
    expect(confirmDialog?.textContent).toContain("npm start");

    // Confirm kill
    const confirmBtn = confirmDialog?.querySelector("button.bg-\\[var\\(--color-danger\\)\\]");
    expect(confirmBtn).not.toBeNull();

    await act(async () => {
      (confirmBtn as HTMLButtonElement).click();
    });

    // Verify kill was dispatched to transport A, NOT transport B!
    expect(killCallsA).toEqual([identicalId]);
    expect(killCallsB).toHaveLength(0);

    unsubFocus();
  });

  it("rejects kill action if connection generation changed before confirmation", async () => {
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <OsShell />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    // Open System Monitor
    await act(async () => {
      await dispatchIntent(createIntent("system:monitor", { profileId: "profile-a" }));
    });

    // Click kill on row
    const row = container?.querySelector("li[role='button']");
    const killBtn = row?.querySelector("button[title='Kill session']");
    await act(async () => {
      (killBtn as HTMLButtonElement)?.click();
    });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    // Simulate profile disconnect & reconnect with new generation (stale generation change!)
    __setConnectionSnapshotForTests("profile-a", {
      status: "connected",
      intent: true,
      owner: { profileId: "profile-a", generation: 2 },
      transport: createMockTransport(sessionsA),
    });

    // Click confirm in modal
    const confirmBtn = document.querySelector('[role="dialog"] button.bg-\\[var\\(--color-danger\\)\\]');
    await act(async () => {
      (confirmBtn as HTMLButtonElement)?.click();
    });

    // Verify error was displayed and NO kill was sent
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Connection generation changed");
    expect(killCallsA).toHaveLength(0);
  });

  it("rejects kill action if process incarnation changed before confirmation", async () => {
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <OsShell />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    // Open System Monitor
    await act(async () => {
      await dispatchIntent(createIntent("system:monitor", { profileId: "profile-a" }));
    });

    // Click kill on row
    const row = container?.querySelector("li[role='button']");
    const killBtn = row?.querySelector("button[title='Kill session']");
    await act(async () => {
      (killBtn as HTMLButtonElement)?.click();
    });

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    // Simulate replacement process with new incarnation
    queryClient.setQueryData(
      ["profile", "profile-a", 1, "terminal-sessions"],
      [
        {
          id: identicalId,
          command: "npm start",
          project: "app-prod",
          cwd: "/prod",
          type: "terminal",
          alive: true,
          startedAt: Date.now(),
          incarnation: 99, // Changed incarnation!
        },
      ],
    );

    // Click confirm in modal
    const confirmBtn = document.querySelector('[role="dialog"] button.bg-\\[var\\(--color-danger\\)\\]');
    await act(async () => {
      (confirmBtn as HTMLButtonElement)?.click();
    });

    // Verify error was displayed and NO kill was sent
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Process incarnation changed");
    expect(killCallsA).toHaveLength(0);
  });

  it("reveals exact host and incident when alert dot is clicked in MonitorTray", async () => {
    // Record snapshot alert on profile-b
    useHostResourceAlertPresentationStore.getState().recordSnapshotAlerts(
      {
        incidentId: "inc-mem-exhaustion-42",
        state: "active",
        severity: "critical",
        scope: "memory",
        confidence: "high",
        durationSeconds: 12,
        nextAction: "Kill rogue process or expand cgroup memory limit",
        threshold: "90%",
        evidence: {
          availablePercent: 8,
          reclaimablePercent: 2,
        },
      },
      [],
      "profile-b",
    );

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <OsShell />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    // Verify alert button appears in MonitorTray
    const alertBtn = container?.querySelector('button[aria-label^="System Alert:"]');
    expect(alertBtn).not.toBeNull();

    // Click alert button
    await act(async () => {
      (alertBtn as HTMLButtonElement)?.click();
    });

    // Verify System Monitor opened with profile-b inspected
    const monitorApp = container?.querySelector('[data-testid^="system-monitor-app-"]');
    expect(monitorApp).not.toBeNull();
    expect(container?.textContent).toContain("Staging US");

    // Verify target incident banner is revealed
    const incidentBanner = container?.querySelector('[data-testid="highlighted-incident-banner"]');
    expect(incidentBanner).not.toBeNull();
    expect(incidentBanner?.textContent).toContain("inc-mem-exhaustion-42");
  });

  it("reveals singleton across virtual desktops by switching to the window's desktop", async () => {
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <OsShell />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    // Open System Monitor on desktop 1
    await act(async () => {
      await dispatchIntent(createIntent("system:monitor", { profileId: "profile-a" }));
    });

    // Add Desktop 2 and switch to it
    await act(async () => {
      useWindowStore.getState().addDesktop("Desktop 2");
      const d2Id = useWindowStore.getState().session.desktops[1].id;
      useWindowStore.getState().switchDesktop(d2Id);
    });

    const activeD2 = useWindowStore.getState().session.activeDesktopId;
    expect(activeD2).not.toBe("desktop-1");
    // Dispatch system:monitor while on Desktop 2
    await act(async () => {
      await dispatchIntent(createIntent("system:monitor", { profileId: "profile-a" }));
    });

    // Verify desktop switched back to desktop-1 where System Monitor resides
    const finalActiveD = useWindowStore.getState().session.activeDesktopId;
    expect(finalActiveD).toBe("desktop-1");
  });

  it("redacts server and session identities completely when Cognito Privacy Mode is active", async () => {
    // Activate Cognito Mode
    useCognitoModeStore.getState().toggle("Mod+Alt+KeyB");

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <OsShell />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    // Verify MonitorTray shows PROTECTED
    const tray = container?.querySelector('[data-testid="os-monitor-tray"]');
    expect(tray?.textContent).toContain("PROTECTED");

    // Open System Monitor
    await act(async () => {
      await dispatchIntent(createIntent("system:monitor", { profileId: "profile-a" }));
    });

    // Verify System Monitor header shows Protected
    expect(container?.textContent).toContain("Protected");

    // Negative assertions: raw command names and project identities are NOT rendered
    expect(container?.textContent).not.toContain("npm start");
    expect(container?.textContent).not.toContain("app-prod");
    expect(container?.textContent).not.toContain("cargo test");
    expect(container?.textContent).not.toContain("api-staging");
    expect(container?.textContent).not.toContain("Production EU");
    expect(container?.textContent).not.toContain("Staging US");
    expect(container?.textContent).not.toContain("127.0.0.1:4801");
    expect(container?.textContent).not.toContain("127.0.0.1:4802");
  });

  it("ingests typed SSE activity events into OS notification store", () => {
    const id = ingestIpcActivityEvent({
      type: "terminal:changed",
      profileId: "profile-a",
      generation: 1,
      data: { projectName: "dam-hopper" },
      timestamp: Date.now(),
    });

    expect(id).not.toBeNull();
    const entry = useOsNotificationStore.getState().entries.find((e) => e.id === id);
    expect(entry?.title).toBe("Terminal Sessions Changed");
    expect(entry?.source).toBe("terminal");
  });

  it("preserves other profiles' unread attention when one profile is acknowledged", () => {
    const store = useHostResourceAlertPresentationStore.getState();
    store.recordSnapshotAlerts(
      {
        incidentId: "inc-a",
        state: "active",
        severity: "warning",
        scope: "host",
        confidence: "high",
        durationSeconds: 10,
        threshold: "80%",
        nextAction: "check",
        evidence: {},
      },
      [],
      "profile-a",
    );
    store.recordSnapshotAlerts(
      {
        incidentId: "inc-b",
        state: "active",
        severity: "critical",
        scope: "host",
        confidence: "high",
        durationSeconds: 20,
        threshold: "90%",
        nextAction: "check",
        evidence: {},
      },
      [],
      "profile-b",
    );
    expect(useHostResourceAlertPresentationStore.getState().unreadIds).toContain("inc-a");
    expect(useHostResourceAlertPresentationStore.getState().unreadIds).toContain("inc-b");

    // Acknowledge profile-a
    useHostResourceAlertPresentationStore.getState().markRead("profile-a");
    expect(useHostResourceAlertPresentationStore.getState().unreadIds).not.toContain("inc-a");
    expect(useHostResourceAlertPresentationStore.getState().unreadIds).toContain("inc-b");
  });

  it("suppresses OS focus cycling while confirmation dialog is active", async () => {
    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <EncryptProvider>
            <MemoryRouter>
              <OsShell />
            </MemoryRouter>
          </EncryptProvider>
        </QueryClientProvider>,
      );
    });

    await act(async () => {
      await dispatchIntent(createIntent("system:monitor", { profileId: "profile-a" }));
    });

    // Click kill on row to open dialog
    const row = container?.querySelector("li[role='button']");
    const killBtn = row?.querySelector("button[title='Kill session']");
    await act(async () => {
      (killBtn as HTMLButtonElement)?.click();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("data-os-modal")).toBe("true");

    const activeWindowBefore = useWindowStore.getState().session.desktops[0].focusedWindowId;

    // Press Ctrl+Alt+Escape on window frame
    const frame = container?.querySelector('[data-os-window-frame]');
    await act(async () => {
      frame?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // Verify focused window did not change
    const activeWindowAfter = useWindowStore.getState().session.desktops[0].focusedWindowId;
    expect(activeWindowAfter).toBe(activeWindowBefore);
  });
});
