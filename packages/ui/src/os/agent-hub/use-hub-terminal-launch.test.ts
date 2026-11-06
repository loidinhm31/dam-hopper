// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useHubTerminalLaunch,
  type UseHubTerminalLaunchOptions,
  type UseHubTerminalLaunchResult,
} from "./use-hub-terminal-launch.js";
import type { TraditionalTerminalProjectGroup } from "@/lib/traditional-terminal-projects.js";
import type { ConnectionSnapshot } from "@/api/connections.js";
import type { TerminalTarget } from "@/api/terminal-session-contract.js";
import { terminalKey } from "@/api/ownership.js";

function makeGroup(id: string, projectName: string, profileId: string): TraditionalTerminalProjectGroup {
  return {
    id,
    label: projectName,
    projectName,
    profileId,
    projectRef: { profileId, project: projectName },
    terminalTabs: [],
    mountedSessions: [],
  };
}

function renderLaunchHook(initialOptions: UseHubTerminalLaunchOptions) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  let latestResult: UseHubTerminalLaunchResult | undefined;

  function TestComponent(props: { opts: UseHubTerminalLaunchOptions }) {
    latestResult = useHubTerminalLaunch(props.opts);
    return null;
  }

  act(() => {
    root.render(createElement(TestComponent, { opts: initialOptions }));
  });

  return {
    get current(): UseHubTerminalLaunchResult {
      if (!latestResult) throw new Error("Hook did not render");
      return latestResult;
    },
    rerender(nextOpts: UseHubTerminalLaunchOptions) {
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

describe("useHubTerminalLaunch", () => {
  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("handles blocked launch and sets stuckAttempt info", async () => {
    const group = makeGroup("group-1", "dam-hopper", "p1");
    const getSnapshot = vi.fn().mockReturnValue({
      status: "connected",
      owner: { profileId: "p1", generation: 2 },
    } as ConnectionSnapshot);

    const reserveAndExecute = vi.fn().mockResolvedValue({
      kind: "blocked",
      reason: "Launch blocked by attempt-xyz",
      existingAttemptId: "attempt-xyz",
    });

    const onSelectTab = vi.fn();
    const runtimeIndex = new Map<string, TerminalTarget>();

    const harness = renderLaunchHook({
      hubWindowId: "win-hub",
      desktopId: "d1",
      groups: [group],
      runtimeIndex,
      onSelectTab,
      getConnectionSnapshot: getSnapshot,
      reserveAndExecuteTerminalLaunch: reserveAndExecute,
    });

    await act(async () => {
      await harness.current.launchTerminal("group-1");
    });

    expect(harness.current.launchNotice).toBe("Launch blocked by attempt-xyz");
    expect(harness.current.stuckAttempt).toEqual({
      attemptId: "attempt-xyz",
      reason: "Launch blocked by attempt-xyz",
      profileId: "p1",
    });

    harness.cleanup();
  });

  it("selects terminal only after exact target matches in runtimeIndex under unchanged generation", async () => {
    const group = makeGroup("group-1", "dam-hopper", "p1");
    const createdTarget: TerminalTarget = {
      profileId: "p1",
      generation: 2,
      terminalId: "term-99",
      incarnation: "inc-1",
      authority: "epoch-1",
    };

    const getSnapshot = vi.fn().mockReturnValue({
      status: "connected",
      owner: { profileId: "p1", generation: 2 },
    } as ConnectionSnapshot);

    const reserveAndExecute = vi.fn().mockResolvedValue({
      kind: "created",
      terminalId: "term-99",
      target: createdTarget,
    });

    const onSelectTab = vi.fn();
    const runtimeIndex = new Map<string, TerminalTarget>();

    const harness = renderLaunchHook({
      hubWindowId: "win-hub",
      desktopId: "d1",
      groups: [group],
      runtimeIndex,
      onSelectTab,
      getConnectionSnapshot: getSnapshot,
      reserveAndExecuteTerminalLaunch: reserveAndExecute,
    });

    await act(async () => {
      await harness.current.launchTerminal("group-1");
    });

    // Created, but target has not appeared in runtimeIndex yet -> not selected yet
    expect(onSelectTab).not.toHaveBeenCalled();

    // Now update runtimeIndex to include the exact target
    const updatedRuntimeIndex = new Map<string, TerminalTarget>();
    const qKey = terminalKey({ profileId: "p1", id: "term-99" });
    updatedRuntimeIndex.set(qKey, createdTarget);

    harness.rerender({
      hubWindowId: "win-hub",
      desktopId: "d1",
      groups: [group],
      runtimeIndex: updatedRuntimeIndex,
      onSelectTab,
      getConnectionSnapshot: getSnapshot,
      reserveAndExecuteTerminalLaunch: reserveAndExecute,
    });

    // Exact match found! Must be selected
    expect(onSelectTab).toHaveBeenCalledWith(qKey);

    harness.cleanup();
  });

  it("cancels pending selection if generation changes before target observation", async () => {
    const group = makeGroup("group-1", "dam-hopper", "p1");
    const createdTarget: TerminalTarget = {
      profileId: "p1",
      generation: 2,
      terminalId: "term-99",
      incarnation: "inc-1",
    };

    let generation = 2;
    const getSnapshot = vi.fn().mockImplementation(() => ({
      status: "connected",
      owner: { profileId: "p1", generation },
    }));

    const reserveAndExecute = vi.fn().mockResolvedValue({
      kind: "created",
      terminalId: "term-99",
      target: createdTarget,
    });

    const onSelectTab = vi.fn();
    const runtimeIndex = new Map<string, TerminalTarget>();

    const harness = renderLaunchHook({
      hubWindowId: "win-hub",
      desktopId: "d1",
      groups: [group],
      runtimeIndex,
      onSelectTab,
      getConnectionSnapshot: getSnapshot,
      reserveAndExecuteTerminalLaunch: reserveAndExecute,
    });

    await act(async () => {
      await harness.current.launchTerminal("group-1");
    });

    // Generation changed on profile!
    generation = 3;

    // Rerender
    harness.rerender({
      hubWindowId: "win-hub",
      desktopId: "d1",
      groups: [group],
      runtimeIndex,
      onSelectTab,
      getConnectionSnapshot: getSnapshot,
      reserveAndExecuteTerminalLaunch: reserveAndExecute,
    });

    // Now if target appears, it must NOT be selected because generation changed
    const updatedRuntimeIndex = new Map<string, TerminalTarget>();
    const qKey = terminalKey({ profileId: "p1", id: "term-99" });
    updatedRuntimeIndex.set(qKey, createdTarget);

    harness.rerender({
      hubWindowId: "win-hub",
      desktopId: "d1",
      groups: [group],
      runtimeIndex: updatedRuntimeIndex,
      onSelectTab,
      getConnectionSnapshot: getSnapshot,
      reserveAndExecuteTerminalLaunch: reserveAndExecute,
    });

    expect(onSelectTab).not.toHaveBeenCalled();
    harness.cleanup();
  });

  it("fails closed on non-canonical created outcome and shows notice", async () => {
    const group = makeGroup("group-1", "dam-hopper", "p1");
    const getSnapshot = vi.fn().mockReturnValue({
      status: "connected",
      owner: { profileId: "p1", generation: 1 },
    } as ConnectionSnapshot);

    const reserveAndExecute = vi.fn().mockResolvedValue({
      kind: "created",
      terminalId: "term-raw",
      // No target! Non-canonical
    });

    const onSelectTab = vi.fn();
    const runtimeIndex = new Map<string, TerminalTarget>();

    const harness = renderLaunchHook({
      hubWindowId: "win-hub",
      desktopId: "d1",
      groups: [group],
      runtimeIndex,
      onSelectTab,
      getConnectionSnapshot: getSnapshot,
      reserveAndExecuteTerminalLaunch: reserveAndExecute,
    });

    await act(async () => {
      await harness.current.launchTerminal("group-1");
    });

    expect(onSelectTab).not.toHaveBeenCalled();
    expect(harness.current.launchNotice).toBe(
      "Terminal started; select it from the project tabs",
    );

    harness.cleanup();
  });

  it("handles unmount mid-flight cleanly without errors", async () => {
    const group = makeGroup("group-1", "dam-hopper", "p1");
    const { promise: executePromise, resolve: resolveExecute } =
      Promise.withResolvers<unknown>();

    const reserveAndExecute = vi.fn().mockReturnValue(executePromise);
    const getSnapshot = vi.fn().mockReturnValue({
      status: "connected",
      owner: { profileId: "p1", generation: 1 },
    } as ConnectionSnapshot);

    const harness = renderLaunchHook({
      hubWindowId: "win-hub",
      desktopId: "d1",
      groups: [group],
      runtimeIndex: new Map(),
      onSelectTab: vi.fn(),
      getConnectionSnapshot: getSnapshot,
      reserveAndExecuteTerminalLaunch: reserveAndExecute,
    });

    act(() => {
      harness.current.launchTerminal("group-1");
    });

    // Unmount while still pending
    harness.cleanup();

    // Now resolve execution
    await act(async () => {
      resolveExecute({
        kind: "created",
        terminalId: "term-bg",
        target: {
          profileId: "p1",
          generation: 1,
          terminalId: "term-bg",
          incarnation: "inc-1",
        },
      });
    });

    // No errors thrown!
  });
});
