import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStatusBadge } from "@/components/atoms/AgentStatusBadge.js";
import { TerminalNotificationCenter } from "@/components/organisms/TerminalNotificationCenter.js";
import { TerminalNotificationToastViewport } from "@/components/organisms/TerminalNotificationToastViewport.js";
import type { AgentStatusSnapshotV1 } from "@/api/agent-status-types.js";
import type { TerminalAgentNotifications } from "@/api/client.js";
import { subscribeToTerminalNotificationSelection } from "@/lib/terminal-notification-navigation.js";
import { watchAgentStatusConnection } from "@/hooks/use-agent-status-connections.js";
import { useAgentStatusStore } from "@/stores/agent-status.js";
import { useSettingsStore } from "@/stores/settings.js";
import { useTerminalNotificationsStore } from "@/stores/terminal-notifications.js";
import { __setConnectionSnapshotForTests } from "@/api/connections.js";
import "@/index.css";

function row(id: string, incarnation: number, attentionRevision = 0) {
  return {
    id,
    incarnation,
    agentKind: "omp" as const,
    agentSessionId: "session-a",
    reporterEpoch: 1,
    state: "idle" as const,
    attentionRevision,
  };
}

function snapshot(
  id: string,
  incarnation: number,
  revision = 1,
  attentionRevision = 0,
): AgentStatusSnapshotV1 {
  return {
    version: 1,
    serverEpoch: 42,
    revision,
    availability: "ready",
    terminals: [row(id, incarnation, attentionRevision)],
  };
}

function event(
  id: string,
  incarnation: number,
  revision: number,
  attentionRevision: number,
) {
  return {
    serverEpoch: 42,
    revision,
    row: {
      ...row(id, incarnation, attentionRevision),
      state: "blocked",
      reason: "approval",
    },
    attention: {
      id: `42:${id}:${incarnation}:${attentionRevision}`,
      kind: "needs-attention",
      terminalId: id,
      incarnation,
      agentKind: "omp",
      agentSessionId: "session-a",
      reason: "approval",
      attentionRevision,
      timestampMs: 123,
    },
  };
}

function bus() {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    onEvent: (kind: string, handler: (payload: unknown) => void) => {
      handlers.set(kind, handler);
      return () => {
        handlers.delete(kind);
      };
    },
    send: (kind: string, payload: unknown) => handlers.get(kind)?.(payload),
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("agent status on Chromium surfaces", () => {
  let container: HTMLDivElement;
  let root: Root;
  const stops: Array<() => void> = [];
  let savedNotifications: TerminalAgentNotifications;

  beforeEach(() => {
    useAgentStatusStore.setState({ profiles: new Map() });
    useTerminalNotificationsStore.setState({ notifications: [], toasts: [] });
    savedNotifications = useSettingsStore.getState().terminalAgentNotifications;
    const current = savedNotifications;
    useSettingsStore.setState({
      terminalAgentNotifications: {
        ...current,
        agents: {
          ...current.agents,
          omp: {
            ...current.agents.omp,
            enabled: true,
            toast: true,
            sound: false,
            browser: false,
          },
        },
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    stops.splice(0).forEach((stop) => stop());
    await act(async () => root.unmount());
    container.remove();
    useAgentStatusStore.setState({ profiles: new Map() });
    useTerminalNotificationsStore.setState({ notifications: [], toasts: [] });
    useSettingsStore.setState({
      terminalAgentNotifications: savedNotifications,
    });
    vi.unstubAllGlobals();
    __setConnectionSnapshotForTests("first", null);
    __setConnectionSnapshotForTests("second", null);
  });

  it("keeps inactive-route badges and per-profile attention isolated; reconnect is silent", async () => {
    const firstOwner = { profileId: "first", generation: 1 };
    const secondOwner = { profileId: "second", generation: 1 };
    __setConnectionSnapshotForTests("first", {
      status: "connected",
      owner: { profileId: "first", generation: 1 },
    });
    __setConnectionSnapshotForTests("second", {
      status: "connected",
      owner: { profileId: "second", generation: 1 },
    });
    const firstBus = bus();
    const secondBus = bus();
    stops.push(
      watchAgentStatusConnection(
        firstOwner,
        { agentStatusSnapshot: async () => snapshot("shared", 2) },
        firstBus,
      ),
    );
    stops.push(
      watchAgentStatusConnection(
        secondOwner,
        { agentStatusSnapshot: async () => snapshot("shared", 2) },
        secondBus,
      ),
    );
    await settle();
    await act(async () =>
      root.render(
        <>
          <AgentStatusBadge
            terminalRef={{ profileId: "first", id: "shared" }}
            incarnation={2}
          />
          <AgentStatusBadge
            terminalRef={{ profileId: "second", id: "shared" }}
            incarnation={2}
          />
          <TerminalNotificationCenter />
          <TerminalNotificationToastViewport />
        </>,
      ),
    );
    expect(
      container.querySelectorAll('[role="img"][aria-label="OMP agent: Idle"]'),
    ).toHaveLength(2);
    await act(async () =>
      firstBus.send("terminal:agentStatusChanged", event("shared", 2, 2, 1)),
    );
    expect(
      container.querySelectorAll(
        '[role="img"][aria-label="OMP agent: Needs attention"]',
      ),
    ).toHaveLength(1);
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(
      1,
    );
    await act(async () =>
      firstBus.send("terminal:agentStatusChanged", event("shared", 2, 2, 1)),
    );
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(
      1,
    );
    await act(async () =>
      root.render(
        <>
          <p>Settings route</p>
          <TerminalNotificationCenter />
        </>,
      ),
    );
    await act(async () =>
      secondBus.send("terminal:agentStatusChanged", event("shared", 2, 2, 1)),
    );
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(
      2,
    );
    expect(container.textContent).toContain("Settings route");
    const oldStop = stops.shift()!;
    __setConnectionSnapshotForTests("first", {
      status: "connected",
      owner: { profileId: "first", generation: 2 },
    });
    const replacement = bus();
    stops.push(
      watchAgentStatusConnection(
        { profileId: "first", generation: 2 },
        { agentStatusSnapshot: async () => snapshot("shared", 3, 4, 1) },
        replacement,
      ),
    );
    await settle();
    await act(async () =>
      firstBus.send("terminal:agentStatusChanged", event("shared", 2, 3, 2)),
    );
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(
      2,
    );
    await act(async () =>
      root.render(
        <AgentStatusBadge
          terminalRef={{ profileId: "first", id: "shared" }}
          incarnation={3}
        />,
      ),
    );
    expect(container.textContent).toContain("OMP");
  });

  it("denied browser permission leaves history and owner-qualified notification selection", async () => {
    vi.stubGlobal(
      "Notification",
      class {
        static permission: NotificationPermission = "denied";
      },
    );
    const current = useSettingsStore.getState().terminalAgentNotifications;
    useSettingsStore.setState({
      terminalAgentNotifications: {
        ...current,
        agents: {
          ...current.agents,
          omp: { ...current.agents.omp, browser: true },
        },
      },
    });
    const owner = { profileId: "first", generation: 1 };
    __setConnectionSnapshotForTests("first", {
      status: "connected",
      owner: { profileId: "first", generation: 1 },
    });
    const stream = bus();
    stops.push(
      watchAgentStatusConnection(
        owner,
        { agentStatusSnapshot: async () => snapshot("shared", 2) },
        stream,
      ),
    );
    await settle();
    await act(async () =>
      root.render(
        <>
          <TerminalNotificationCenter />
          <TerminalNotificationToastViewport />
        </>,
      ),
    );
    const selected: unknown[][] = [];
    const unsubscribe = subscribeToTerminalNotificationSelection((...args) =>
      selected.push(args),
    );
    await act(async () =>
      stream.send("terminal:agentStatusChanged", event("shared", 2, 2, 1)),
    );
    expect(useTerminalNotificationsStore.getState().notifications).toHaveLength(
      1,
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')
        ?.click(),
    );
    await act(async () =>
      container.querySelector<HTMLButtonElement>("li button")?.click(),
    );
    expect(selected[0]).toEqual([
      JSON.stringify(["first", "shared"]),
      "first",
      { profileId: "first", id: "shared" },
      { profileId: "first", id: "shared", incarnation: 2 },
    ]);
    unsubscribe();
  });
});
