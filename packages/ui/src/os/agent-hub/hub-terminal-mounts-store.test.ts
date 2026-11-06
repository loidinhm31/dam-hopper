// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalTarget } from "@/api/terminal-session-contract.js";
import {
  type HubTerminalMount,
  useHubTerminalMountsStore,
} from "./hub-terminal-mounts-store.js";

describe("useHubTerminalMountsStore", () => {
  const targetA: TerminalTarget = Object.freeze({
    profileId: "p1",
    generation: 1,
    serverEpoch: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    terminalId: "t1",
    incarnation: "1",
  });

  const targetB: TerminalTarget = Object.freeze({
    profileId: "p1",
    generation: 1,
    serverEpoch: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    terminalId: "t2",
    incarnation: "1",
  });

  const mount1: HubTerminalMount = {
    logicalKey: '["p1","t1"]',
    target: targetA,
    project: "proj-1",
    command: "bash",
    cwd: "/home/user/p1",
    worktreePath: "/home/user/p1",
  };

  const mount2: HubTerminalMount = {
    logicalKey: '["p1","t2"]',
    target: targetB,
    project: "proj-1",
    command: "npm test",
  };

  beforeEach(() => {
    // Reset store state
    for (const hubId of Object.keys(
      useHubTerminalMountsStore.getState().mountsByHub,
    )) {
      useHubTerminalMountsStore.getState().clear(hubId);
    }
  });

  it("publishes and isolates mounts per hub window", () => {
    const store = useHubTerminalMountsStore.getState();

    store.publish("hub-1", [mount1]);
    expect(
      useHubTerminalMountsStore.getState().mountsByHub["hub-1"],
    ).toEqual([mount1]);
    expect(
      useHubTerminalMountsStore.getState().mountsByHub["hub-2"],
    ).toBeUndefined();

    store.publish("hub-2", [mount2]);
    expect(
      useHubTerminalMountsStore.getState().mountsByHub["hub-1"],
    ).toEqual([mount1]);
    expect(
      useHubTerminalMountsStore.getState().mountsByHub["hub-2"],
    ).toEqual([mount2]);

    store.clear("hub-1");
    expect(
      useHubTerminalMountsStore.getState().mountsByHub["hub-1"],
    ).toBeUndefined();
    expect(
      useHubTerminalMountsStore.getState().mountsByHub["hub-2"],
    ).toEqual([mount2]);
  });

  it("structurally equal publish is a no-op that preserves state identity", () => {
    useHubTerminalMountsStore.getState().publish("hub-1", [mount1]);
    const stateBefore = useHubTerminalMountsStore.getState();

    const listener = vi.fn();
    const unsub = useHubTerminalMountsStore.subscribe(listener);

    // Incoming mount is a different object instance but structurally equal
    const clonedMount1: HubTerminalMount = {
      logicalKey: '["p1","t1"]',
      target: { ...targetA },
      project: "proj-1",
      command: "bash",
      cwd: "/home/user/p1",
      worktreePath: "/home/user/p1",
    };

    useHubTerminalMountsStore.getState().publish("hub-1", [clonedMount1]);
    const stateAfter = useHubTerminalMountsStore.getState();

    expect(stateAfter).toBe(stateBefore);
    expect(listener).not.toHaveBeenCalled();

    unsub();
  });

  it("clear on absent hub is a no-op that preserves state identity", () => {
    useHubTerminalMountsStore.getState().publish("hub-1", [mount1]);
    const stateBefore = useHubTerminalMountsStore.getState();

    const listener = vi.fn();
    const unsub = useHubTerminalMountsStore.subscribe(listener);

    useHubTerminalMountsStore.getState().clear("absent-hub");
    const stateAfter = useHubTerminalMountsStore.getState();

    expect(stateAfter).toBe(stateBefore);
    expect(listener).not.toHaveBeenCalled();

    unsub();
  });

  it("mount field changes trigger state updates", () => {
    useHubTerminalMountsStore.getState().publish("hub-1", [mount1]);
    const stateBefore = useHubTerminalMountsStore.getState();

    const changedCommandMount: HubTerminalMount = {
      ...mount1,
      command: "zsh",
    };

    useHubTerminalMountsStore
      .getState()
      .publish("hub-1", [changedCommandMount]);
    const stateAfter = useHubTerminalMountsStore.getState();

    expect(stateAfter).not.toBe(stateBefore);
    expect(stateAfter.mountsByHub["hub-1"][0].command).toBe("zsh");
  });

  it("never writes to localStorage or sessionStorage", () => {
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");

    useHubTerminalMountsStore.getState().publish("hub-1", [mount1]);
    useHubTerminalMountsStore.getState().clear("hub-1");

    expect(storageSpy).not.toHaveBeenCalled();

    // Sanity check: confirm the spy catches a deliberate storage write
    localStorage.setItem("test-probe", "1");
    expect(storageSpy).toHaveBeenCalledWith("test-probe", "1");

    storageSpy.mockRestore();
    localStorage.removeItem("test-probe");
  });
});
