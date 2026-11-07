// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  resolveRestoredWorkspaceSelection,
  resolveTerminalTabBaseLabel,
  useAgentHubWorkspaces,
  type UseAgentHubWorkspacesResult,
} from "./use-agent-hub-workspaces.js";
import { useWindowStore } from "../window-store.js";
import { useHubTerminalMountsStore } from "./hub-terminal-mounts-store.js";
import type { OsWindow } from "../types.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import type { AggregatedSessionInfo } from "@/hooks/use-aggregated-terminal-sessions.js";
import type { AggregatedProjectItem } from "@/hooks/use-aggregated-projects.js";
import { terminalKey } from "@/api/ownership.js";
import { terminalActionCoordinator } from "@/lib/terminal-session-action-coordinator.js";

// Mock hooks and API modules
const mockSessions: AggregatedSessionInfo[] = [];
const mockProjects: AggregatedProjectItem[] = [];
let mockInventoryLoading = false;

vi.mock("@/hooks/use-aggregated-terminal-sessions.js", () => ({
  useAggregatedTerminalSessions: () => ({
    sessions: mockSessions,
    mountedSessions: [],
    terminalTabs: [],
    activeSessionId: null,
  }),
}));

vi.mock("@/hooks/use-aggregated-projects.js", () => ({
  useAggregatedProjects: () => ({
    allProjects: mockProjects,
    isLoading: mockInventoryLoading,
  }),
}));

vi.mock("@/stores/agent-status.js", () => ({
  useAgentStatusStore: (selector: (state: { profiles: ReadonlyMap<string, unknown> }) => unknown) =>
    selector({ profiles: new Map() }),
}));

vi.mock("@/api/server-config.js", () => ({
  getProfiles: () => [{ id: "p1", name: "Host 1" }],
  getProfileChangeVersion: () => 1,
  subscribeToProfileChanges: () => () => {},
}));

vi.mock("@/api/connections.js", () => ({
  getConnectionSnapshot: (id: string) => ({
    status: "connected",
    owner: { profileId: id, generation: 1 },
    serverEpoch: "epoch-1",
  }),
  subscribeConnections: () => () => {},
}));

function renderWorkspacesHook(initialWindow: OsWindow) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let latestResult: UseAgentHubWorkspacesResult | undefined;

  function TestComponent(props: { win: OsWindow }) {
    latestResult = useAgentHubWorkspaces(props.win);
    return null;
  }

  act(() => {
    root.render(createElement(TestComponent, { win: initialWindow }));
  });

  return {
    get current(): UseAgentHubWorkspacesResult {
      if (!latestResult) throw new Error("Hook did not render");
      return latestResult;
    },
    rerender(nextWin: OsWindow) {
      act(() => {
        root.render(createElement(TestComponent, { win: nextWin }));
      });
    },
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("resolveRestoredWorkspaceSelection", () => {
  const dummyGroups: TraditionalTerminalProjectGroup[] = [
    {
      id: '["p1","dam-hopper"]',
      label: "dam-hopper",
      projectName: "dam-hopper",
      profileId: "p1",
      terminalTabs: [],
      mountedSessions: [],
    },
  ];

  it("returns drop when persistedKey is undefined or empty", () => {
    expect(resolveRestoredWorkspaceSelection(undefined, dummyGroups, true)).toEqual({
      action: "drop",
    });
    expect(resolveRestoredWorkspaceSelection("", dummyGroups, true)).toEqual({
      action: "drop",
    });
  });

  it("returns wait when inventory has not finished loading", () => {
    expect(
      resolveRestoredWorkspaceSelection('["p1","dam-hopper"]', dummyGroups, false),
    ).toEqual({ action: "wait" });
  });

  it("returns select when loaded and group is found in union", () => {
    expect(
      resolveRestoredWorkspaceSelection('["p1","dam-hopper"]', dummyGroups, true),
    ).toEqual({ action: "select", groupId: '["p1","dam-hopper"]' });
  });

  it("returns drop when loaded and group is not in union", () => {
    expect(
      resolveRestoredWorkspaceSelection('["p1","other"]', dummyGroups, true),
    ).toEqual({ action: "drop" });
  });
});

describe("useAgentHubWorkspaces", () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockSessions.length = 0;
    mockProjects.length = 0;
    mockInventoryLoading = false;
    useHubTerminalMountsStore.setState({ mountsByHub: {} });
    terminalActionCoordinator.resetForTests();
    useWindowStore.setState((state) => ({
      session: {
        ...state.session,
        windows: {},
      },
    }));
  });

  it("qualifies tab shape with matching tab.sessionId and session.id (AC5)", () => {
    const termRef = { profileId: "p1", id: "term-10" };
    const qKey = terminalKey(termRef);

    mockSessions.push({
      id: "term-10",
      profileId: "p1",
      project: "proj-a",
      command: "bash",
      alive: true,
      terminationState: "running",
      terminationTarget: {
        profileId: "p1",
        generation: 1,
        terminalId: "term-10",
        incarnation: "inc-1",
      },
    } as unknown as AggregatedSessionInfo);

    const win: OsWindow = {
      id: "hub-win",
      appId: "agent-hub",
      title: "Agent Hub",
      ctx: { profileId: "" },
      mode: "tile",
      desktopId: "d1",
    };

    useWindowStore.getState().session.windows["hub-win"] = win;

    const harness = renderWorkspacesHook(win);

    expect(harness.current.groups).toHaveLength(1);
    const group = harness.current.groups[0];
    expect(group.terminalTabs).toHaveLength(1);
    const tab = group.terminalTabs[0];

    // Must be qualified: tab.sessionId === qKey and tab.session.id === tab.sessionId
    expect(tab.sessionId).toBe(qKey);
    expect(tab.session.id).toBe(tab.sessionId);
    expect(tab.terminalRef).toEqual(termRef);
    expect(tab.title.baseLabel).toBe("bash");
    expect(tab.title.ordinal).toBe(1);
    expect(tab.label).toBe("bash #1");
    harness.cleanup();
  });
  it("resolves short friendly terminal base labels and skips UUIDs", () => {
    expect(resolveTerminalTabBaseLabel("custom-name", "bash")).toBe("custom-name");
    expect(resolveTerminalTabBaseLabel("9b5e3962-e932-4886-9a57-19adff48c0db", "bash")).toBe("bash");
    expect(resolveTerminalTabBaseLabel(null, "/usr/bin/zsh")).toBe("zsh");
    expect(resolveTerminalTabBaseLabel(null, null)).toBe("terminal");
  });

  it("publishes mounts for canonical live sessions and does NOT clear on unmount", () => {
    mockSessions.push({
      id: "term-1",
      profileId: "p1",
      project: "proj-1",
      command: "zsh",
      alive: true,
      terminationState: "running",
      terminationTarget: {
        profileId: "p1",
        generation: 1,
        terminalId: "term-1",
        incarnation: "inc-1",
      },
    } as unknown as AggregatedSessionInfo);

    const win: OsWindow = {
      id: "hub-win-mounts",
      appId: "agent-hub",
      title: "Agent Hub",
      ctx: { profileId: "" },
      mode: "tile",
      desktopId: "d1",
    };
    useWindowStore.getState().session.windows["hub-win-mounts"] = win;

    const harness = renderWorkspacesHook(win);

    const mounts = useHubTerminalMountsStore.getState().mountsByHub["hub-win-mounts"];
    expect(mounts).toHaveLength(1);
    expect(mounts[0].target.terminalId).toBe("term-1");

    // Unmount hook: mounts MUST NOT be cleared
    harness.cleanup();
    expect(useHubTerminalMountsStore.getState().mountsByHub["hub-win-mounts"]).toBeDefined();
  });

  it("handles openWorkspace, closeWorkspace (dismiss), and disclosure toggles", () => {
    mockProjects.push({
      profileId: "p1",
      profileName: "Host 1",
      serverUrl: "http://localhost",
      project: { name: "dam-hopper" } as unknown as AggregatedProjectItem["project"],
      ref: { profileId: "p1", project: "dam-hopper" },
    });

    const win: OsWindow = {
      id: "hub-win-actions",
      appId: "agent-hub",
      title: "Agent Hub",
      ctx: { profileId: "" },
      mode: "tile",
      desktopId: "d1",
      appState: {
        openWorkspaces: [],
      },
    };
    useWindowStore.getState().session.windows["hub-win-actions"] = win;

    const harness = renderWorkspacesHook(win);

    // Open zero-terminal workspace
    act(() => {
      harness.current.openWorkspace({ profileId: "p1", project: "dam-hopper" });
    });

    const updatedWin = useWindowStore.getState().session.windows["hub-win-actions"];
    expect(updatedWin.appState?.openWorkspaces).toEqual([
      { profileId: "p1", project: "dam-hopper" },
    ]);
    expect(harness.current.selectGroupRequest?.groupId).toBe('["p1","dam-hopper"]');

    // Toggle disclosure
    act(() => {
      harness.current.toggleDisclosure('["p1","dam-hopper"]');
    });
    const disclosedWin = useWindowStore.getState().session.windows["hub-win-actions"];
    expect(disclosedWin.appState?.disclosedWorkspaces).toEqual(['["p1","dam-hopper"]']);

    // Dismiss zero-terminal workspace
    act(() => {
      harness.current.closeWorkspace('["p1","dam-hopper"]');
    });
    const closedWin = useWindowStore.getState().session.windows["hub-win-actions"];
    expect(closedWin.appState?.openWorkspaces).toEqual([]);

    harness.cleanup();
  });

  it("immediately filters out sessions when termination is reserved or requested", () => {
    const target = {
      profileId: "p1",
      generation: 1,
      serverEpoch: "00000000-0000-0000-0000-000000000001",
      terminalId: "term-close-1",
      incarnation: "1",
    };
    mockSessions.push({
      id: "term-close-1",
      profileId: "p1",
      project: "proj-1",
      command: "bash",
      alive: true,
      terminationState: "live",
      terminationTarget: target,
    } as unknown as AggregatedSessionInfo);

    const win: OsWindow = {
      id: "hub-win-close",
      appId: "agent-hub",
      title: "Agent Hub",
      ctx: { profileId: "" },
      mode: "tile",
      desktopId: "d1",
    };
    useWindowStore.getState().session.windows["hub-win-close"] = win;

    const harness = renderWorkspacesHook(win);
    expect(harness.current.groups).toHaveLength(1);
    expect(harness.current.groups[0].terminalTabs).toHaveLength(1);

    act(() => {
      terminalActionCoordinator.reserveDispatch(target, "live");
    });

    expect(harness.current.groups).toHaveLength(0);
    expect(
      useHubTerminalMountsStore.getState().mountsByHub["hub-win-close"],
    ).toHaveLength(0);

    harness.cleanup();
  });
});
