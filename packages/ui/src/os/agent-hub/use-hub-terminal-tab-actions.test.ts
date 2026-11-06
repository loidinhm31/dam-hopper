// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useHubTerminalTabActions,
  type UseHubTerminalTabActionsOptions,
  type UseHubTerminalTabActionsResult,
} from "./use-hub-terminal-tab-actions.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import type { TerminalTarget } from "@/api/terminal-session-contract.js";
import type { TerminalCloseContextValue } from "../terminal-close-context.js";
import { savePinnedTerminalIds, type TerminalPinStorage } from "@/lib/terminal-pin-persistence.js";
import { __setConnectionSnapshotForTests } from "@/api/connections.js";
import { terminalKey } from "@/api/ownership.js";

function createMemoryStorage(): TerminalPinStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, val) => {
      map.set(key, val);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function makeGroupWithTabs(
  id: string,
  profileId: string,
  tabIds: string[],
): TraditionalTerminalProjectGroup {
  return {
    id,
    label: id,
    projectName: id,
    profileId,
    terminalTabs: tabIds.map((tid) => {
      const qKey = terminalKey({ profileId, id: tid });
      return {
        sessionId: qKey,
        terminalRef: { profileId, id: tid },
        profileId,
        label: tid,
        session: { id: qKey, command: "bash", alive: true },
      };
    }),
    mountedSessions: [],
  };
}

function renderTabActionsHook(initialOptions: UseHubTerminalTabActionsOptions) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let latestResult: UseHubTerminalTabActionsResult | undefined;

  function TestComponent(props: { opts: UseHubTerminalTabActionsOptions }) {
    latestResult = useHubTerminalTabActions(props.opts);
    return null;
  }

  act(() => {
    root.render(createElement(TestComponent, { opts: initialOptions }));
  });

  return {
    get current(): UseHubTerminalTabActionsResult {
      if (!latestResult) throw new Error("Hook did not render");
      return latestResult;
    },
    rerender(nextOpts: UseHubTerminalTabActionsOptions) {
      act(() => {
        root.render(createElement(TestComponent, { opts: nextOpts }));
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

describe("useHubTerminalTabActions", () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("toggles and persists tab pin per profile", () => {
    const group = makeGroupWithTabs("group-1", "p1", ["term-1", "term-2"]);
    const pinStorage = createMemoryStorage();
    const runtimeIndex = new Map<string, TerminalTarget>();

    const harness = renderTabActionsHook({
      hubWindowId: "hub-1",
      groups: [group],
      runtimeIndex,
      onSelectTab: vi.fn(),
      pinStorage,
    });

    const qKey1 = terminalKey({ profileId: "p1", id: "term-1" });
    expect(harness.current.isTabPinned(qKey1)).toBe(false);

    act(() => {
      harness.current.onToggleTabPin(qKey1);
    });

    expect(harness.current.isTabPinned(qKey1)).toBe(true);

    // Toggle off
    act(() => {
      harness.current.onToggleTabPin(qKey1);
    });

    expect(harness.current.isTabPinned(qKey1)).toBe(false);

    harness.cleanup();
  });

  it("calls requestTerminalClose with exact target and Hub-local onCloseView", () => {
    const group = makeGroupWithTabs("group-1", "p1", ["term-1", "term-2"]);
    const target1: TerminalTarget = {
      profileId: "p1",
      generation: 1,
      terminalId: "term-1",
      incarnation: "inc-1",
    };

    const qKey1 = terminalKey({ profileId: "p1", id: "term-1" });
    const qKey2 = terminalKey({ profileId: "p1", id: "term-2" });

    const runtimeIndex = new Map<string, TerminalTarget>();
    runtimeIndex.set(qKey1, target1);

    const requestTerminalClose = vi.fn();
    const mockCloseContext: TerminalCloseContextValue = {
      requestTerminalClose,
      isPromptOpen: false,
      currentRequest: null,
      activeTerminationState: null,
    };

    const onSelectTab = vi.fn();
    const onClearSelection = vi.fn();

    const harness = renderTabActionsHook({
      hubWindowId: "hub-1",
      groups: [group],
      runtimeIndex,
      onSelectTab,
      onClearSelection,
      terminalCloseSource: () => mockCloseContext,
    });

    act(() => {
      harness.current.onCloseTab(qKey1, qKey2);
    });

    expect(requestTerminalClose).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: "hub-1",
        entry: "pane-tab",
        target: target1,
      }),
      expect.any(Function),
    );

    // Call onCloseView passed to requestTerminalClose
    const passedOnCloseView = requestTerminalClose.mock.calls[0][1] as (wId: string) => void;

    act(() => {
      passedOnCloseView("hub-1");
    });

    // Must select preferredFallbackSessionId, not close Hub window
    expect(onSelectTab).toHaveBeenCalledWith(qKey2);

    // Idempotent: calling again does not re-select
    act(() => {
      passedOnCloseView("hub-1");
    });
    expect(onSelectTab).toHaveBeenCalledTimes(1);

    harness.cleanup();
  });

  it("fails closed with notice when live target is not in runtimeIndex", () => {
    const group = makeGroupWithTabs("group-1", "p1", ["term-1"]);
    const qKey1 = terminalKey({ profileId: "p1", id: "term-1" });

    const runtimeIndex = new Map<string, TerminalTarget>();
    const onSelectTab = vi.fn();
    const onClearSelection = vi.fn();

    const harness = renderTabActionsHook({
      hubWindowId: "hub-1",
      groups: [group],
      runtimeIndex,
      onSelectTab,
      onClearSelection,
    });

    act(() => {
      harness.current.onCloseTab(qKey1);
    });

    expect(onClearSelection).not.toHaveBeenCalled();
    expect(harness.current.actionNotice).toBe(
      "Cannot close terminal: Session target is unavailable or disconnected.",
    );
    harness.cleanup();
  });

  it("closes dead or exited terminal locally when target is not in runtimeIndex", () => {
    const group: TraditionalTerminalProjectGroup = {
      id: "group-1",
      profileId: "p1",
      profileName: "p1",
      label: "Group 1",
      mountedSessions: [],
      terminalTabs: [
        {
          sessionId: terminalKey({ profileId: "p1", id: "term-1" }),
          title: "term-1",
          terminationState: { kind: "exited", exitCode: 0 },
        },
      ],
    };
    const qKey1 = terminalKey({ profileId: "p1", id: "term-1" });

    const runtimeIndex = new Map<string, TerminalTarget>();
    const onSelectTab = vi.fn();
    const onClearSelection = vi.fn();

    const harness = renderTabActionsHook({
      hubWindowId: "hub-1",
      groups: [group],
      runtimeIndex,
      onSelectTab,
      onClearSelection,
    });

    act(() => {
      harness.current.onCloseTab(qKey1);
    });

    expect(onClearSelection).toHaveBeenCalled();
    expect(harness.current.actionNotice).toBeNull();
    harness.cleanup();
  });
  it("preserves saved pins while terminal inventory is loading or pending and prunes only once loaded", () => {
    const pinStorage = createMemoryStorage();
    __setConnectionSnapshotForTests("p1", {
      status: "connected",
      owner: { profileId: "p1", generation: 1 },
    });
    // Pre-seed pins for p1 using official serializer
    savePinnedTerminalIds(["term-1", "term-old"], pinStorage, "p1");
    const groupNoTabs = makeGroupWithTabs("group-1", "p1", []);
    const runtimeIndex = new Map<string, TerminalTarget>();

    // Render with terminalInventoryLoaded = false
    const harness = renderTabActionsHook({
      hubWindowId: "hub-1",
      groups: [groupNoTabs],
      runtimeIndex,
      pinStorage,
      terminalInventoryLoaded: false,
      onSelectTab: vi.fn(),
    });

    // Stored pins must NOT be pruned while inventory is pending!
    expect(harness.current.isTabPinned(terminalKey({ profileId: "p1", id: "term-1" }))).toBe(true);
    expect(pinStorage.getItem("dam-hopper:terminal-pins:v2:p1")).toContain("term-old");

    // Now update with terminalInventoryLoaded = true and live tabs containing only term-1
    const groupWithTabs = makeGroupWithTabs("group-1", "p1", ["term-1"]);
    harness.rerender({
      hubWindowId: "hub-1",
      groups: [groupWithTabs],
      runtimeIndex,
      pinStorage,
      terminalInventoryLoaded: true,
      onSelectTab: vi.fn(),
    });

    // term-1 remains pinned, dead term-old is pruned
    expect(harness.current.isTabPinned(terminalKey({ profileId: "p1", id: "term-1" }))).toBe(true);
    expect(pinStorage.getItem("dam-hopper:terminal-pins:v2:p1")).not.toContain("term-old");

    harness.cleanup();
  });

  it("denies closing pinned tab with notice and allows closing after unpinning", () => {
    const group = makeGroupWithTabs("group-1", "p1", ["term-1"]);
    const qKey1 = terminalKey({ profileId: "p1", id: "term-1" });
    const target1: TerminalTarget = {
      profileId: "p1",
      generation: 1,
      serverEpoch: "00000000-0000-0000-0000-000000000001",
      terminalId: "term-1",
      incarnation: "1",
    };
    const runtimeIndex = new Map<string, TerminalTarget>([[qKey1, target1]]);

    const requestTerminalClose = vi.fn();
    const mockCloseContext: TerminalCloseContextValue = {
      requestTerminalClose,
      isPromptOpen: false,
      currentRequest: null,
      activeTerminationState: null,
    };

    const pinStorage = createMemoryStorage();

    const harness = renderTabActionsHook({
      hubWindowId: "hub-1",
      groups: [group],
      runtimeIndex,
      pinStorage,
      terminalCloseSource: () => mockCloseContext,
      onSelectTab: vi.fn(),
    });

    // Pin the tab
    act(() => {
      harness.current.onToggleTabPin(qKey1);
    });
    expect(harness.current.isTabPinned(qKey1)).toBe(true);

    // Attempt close while pinned
    act(() => {
      harness.current.onCloseTab(qKey1);
    });
    expect(requestTerminalClose).not.toHaveBeenCalled();
    expect(harness.current.actionNotice).toContain("Cannot close pinned terminal tab; unpin it first.");

    // Unpin tab
    act(() => {
      harness.current.onToggleTabPin(qKey1);
    });
    expect(harness.current.isTabPinned(qKey1)).toBe(false);

    // Close now succeeds
    act(() => {
      harness.current.onCloseTab(qKey1);
    });
    expect(requestTerminalClose).toHaveBeenCalledTimes(1);

    harness.cleanup();
  });
});
