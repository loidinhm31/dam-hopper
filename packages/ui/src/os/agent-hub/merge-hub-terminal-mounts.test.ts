import { describe, expect, it } from "vitest";
import type { TerminalTarget } from "@/api/terminal-session-contract.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import {
  mergeTerminalMountDescriptors,
  type HubMountDescriptor,
} from "./merge-hub-terminal-mounts.js";

function makeTarget(
  profileId: string,
  terminalId: string,
  incarnation = "1",
  serverEpoch = "epoch-1",
  generation = 1,
): TerminalTarget {
  return {
    profileId,
    generation,
    terminalId,
    incarnation,
    serverEpoch,
  };
}

describe("mergeTerminalMountDescriptors", () => {
  it("handles hub-only sessions", () => {
    const target = makeTarget("p1", "term-1");
    const hubMounts: HubMountDescriptor[] = [
      {
        hubWindowId: "hub-1",
        logicalKey: '["p1","term-1"]',
        target,
        project: "test-proj",
        command: "bash",
      },
    ];

    const result = mergeTerminalMountDescriptors({
      hubMounts,
      derived: [],
    });

    expect(result.sessions).toHaveLength(1);
    const session = result.sessions[0];
    expect(session.mountKey).toBe("hub:hub-1:p1:term-1:1");
    expect(session.sessionId).toBe("term-1");
    expect(session.terminalRef).toEqual({ profileId: "p1", id: "term-1" });
    expect(session.terminalTarget).toEqual(target);
    expect(session.attachPolicy).toBe("existing-only");
    expect(session.project).toBe("test-proj");
    expect(session.command).toBe("bash");
  });

  it("handles standalone-only sessions", () => {
    const target = makeTarget("p1", "term-1");
    const derived: MountedSession[] = [
      {
        mountKey: "win-1:p1:term-1",
        sessionId: "term-1",
        project: "test-proj",
        command: "",
        profileId: "p1",
        terminalRef: { profileId: "p1", id: "term-1" },
        terminalTarget: target,
        attachPolicy: "existing-only",
      },
    ];

    const result = mergeTerminalMountDescriptors({
      hubMounts: [],
      derived,
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].mountKey).toBe("win-1:p1:term-1");
    expect(result.sessions[0].sessionId).toBe("term-1");
  });

  it("produces one descriptor when same target exists in both and preserves first-rendered key across order flips", () => {
    const target = makeTarget("p1", "term-1");
    const hubMount: HubMountDescriptor = {
      hubWindowId: "hub-1",
      logicalKey: '["p1","term-1"]',
      target,
      project: "hub-proj",
      command: "bash",
    };
    const standalone: MountedSession = {
      mountKey: "win-1:p1:term-1",
      sessionId: "term-1",
      project: "win-proj",
      command: "",
      profileId: "p1",
      terminalRef: { profileId: "p1", id: "term-1" },
      terminalTarget: target,
      attachPolicy: "existing-only",
    };

    // 1. Hub rendered first with its key
    const hubFirst = mergeTerminalMountDescriptors({
      hubMounts: [hubMount],
      derived: [standalone],
      renderedKeys: new Set(["hub:hub-1:p1:term-1:1"]),
    });
    expect(hubFirst.sessions).toHaveLength(1);
    expect(hubFirst.sessions[0].mountKey).toBe("hub:hub-1:p1:term-1:1");

    // 2. Standalone rendered first with its key
    const standaloneFirst = mergeTerminalMountDescriptors({
      hubMounts: [hubMount],
      derived: [standalone],
      renderedKeys: new Set(["win-1:p1:term-1"]),
    });
    expect(standaloneFirst.sessions).toHaveLength(1);
    expect(standaloneFirst.sessions[0].mountKey).toBe("win-1:p1:term-1");
  });

  it("keeps mount key unchanged when hub is closed while standalone lists target", () => {
    const target = makeTarget("p1", "term-1");
    const hubMount: HubMountDescriptor = {
      hubWindowId: "hub-1",
      logicalKey: '["p1","term-1"]',
      target,
      project: "hub-proj",
      command: "bash",
    };
    const standalone: MountedSession = {
      mountKey: "win-1:p1:term-1",
      sessionId: "term-1",
      project: "win-proj",
      command: "",
      profileId: "p1",
      terminalRef: { profileId: "p1", id: "term-1" },
      terminalTarget: target,
      attachPolicy: "existing-only",
    };

    // Initial state: both open, hub was rendered first
    const initial = mergeTerminalMountDescriptors({
      hubMounts: [hubMount],
      derived: [standalone],
      renderedKeys: new Set(["hub:hub-1:p1:term-1:1"]),
    });
    expect(initial.sessions[0].mountKey).toBe("hub:hub-1:p1:term-1:1");

    // Hub is closed, only standalone remains
    const afterHubClosed = mergeTerminalMountDescriptors({
      hubMounts: [],
      derived: [standalone],
      renderedKeys: new Set(["hub:hub-1:p1:term-1:1"]),
      retainedKeys: initial.retainedKeys,
    });
    expect(afterHubClosed.sessions).toHaveLength(1);
    // Key stays unchanged from initial rendered key!
    expect(afterHubClosed.sessions[0].mountKey).toBe("hub:hub-1:p1:term-1:1");
  });

  it("keeps mount key unchanged and folds hub during standalone untargeted -> targeted transition", () => {
    const target = makeTarget("p1", "term-1");
    // Initial: standalone untargeted
    const untargetedStandalone: MountedSession = {
      mountKey: "win-1:p1:term-1",
      sessionId: "term-1",
      project: "win-proj",
      command: "",
      profileId: "p1",
      terminalRef: { profileId: "p1", id: "term-1" },
    };
    const hubMount: HubMountDescriptor = {
      hubWindowId: "hub-1",
      logicalKey: '["p1","term-1"]',
      target,
      project: "hub-proj",
      command: "bash",
    };

    // 1. Initial untargeted standalone + hub
    const step1 = mergeTerminalMountDescriptors({
      hubMounts: [hubMount],
      derived: [untargetedStandalone],
      renderedKeys: new Set(["win-1:p1:term-1"]),
    });
    expect(step1.sessions).toHaveLength(1);
    expect(step1.sessions[0].mountKey).toBe("win-1:p1:term-1");

    // 2. Standalone adopts target
    const targetedStandalone: MountedSession = {
      ...untargetedStandalone,
      terminalTarget: target,
      attachPolicy: "existing-only",
    };
    const step2 = mergeTerminalMountDescriptors({
      hubMounts: [hubMount],
      derived: [targetedStandalone],
      renderedKeys: new Set(["win-1:p1:term-1"]),
      retainedKeys: step1.retainedKeys,
    });
    expect(step2.sessions).toHaveLength(1);
    expect(step2.sessions[0].mountKey).toBe("win-1:p1:term-1");
  });

  it("folds legacy untargeted standalone and hub with same PTY into one descriptor", () => {
    const target = makeTarget("p1", "term-1");
    const untargetedStandalone: MountedSession = {
      mountKey: "win-1:p1:term-1",
      sessionId: "term-1",
      project: "win-proj",
      command: "",
      profileId: "p1",
    };
    const hubMount: HubMountDescriptor = {
      hubWindowId: "hub-1",
      logicalKey: '["p1","term-1"]',
      target,
      project: "hub-proj",
      command: "bash",
    };

    const result = mergeTerminalMountDescriptors({
      hubMounts: [hubMount],
      derived: [untargetedStandalone],
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].sessionId).toBe("term-1");
  });

  it("drops hub target when isValidHubTarget returns false", () => {
    const target1 = makeTarget("p1", "term-1");
    const target2 = makeTarget("p1", "term-2");

    const hubMounts: HubMountDescriptor[] = [
      {
        hubWindowId: "hub-1",
        logicalKey: '["p1","term-1"]',
        target: target1,
        project: "test",
        command: "",
      },
      {
        hubWindowId: "hub-1",
        logicalKey: '["p1","term-2"]',
        target: target2,
        project: "test",
        command: "",
      },
    ];

    const result = mergeTerminalMountDescriptors({
      hubMounts,
      derived: [],
      isValidHubTarget: (t) => t.terminalId === "term-2",
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].sessionId).toBe("term-2");
  });

  it("does not reuse mount keys across replacement incarnations", () => {
    const targetV1 = makeTarget("p1", "term-1", "1", "epoch-1");
    const targetV2 = makeTarget("p1", "term-1", "2", "epoch-1");

    const hubV1: HubMountDescriptor = {
      hubWindowId: "hub-1",
      logicalKey: '["p1","term-1"]',
      target: targetV1,
      project: "test",
      command: "",
    };

    const run1 = mergeTerminalMountDescriptors({
      hubMounts: [hubV1],
      derived: [],
    });
    expect(run1.sessions).toHaveLength(1);
    const keyV1 = run1.sessions[0].mountKey;

    // Now session is replaced with incarnation 2
    const hubV2: HubMountDescriptor = {
      hubWindowId: "hub-1",
      logicalKey: '["p1","term-1"]',
      target: targetV2,
      project: "test",
      command: "",
    };

    const run2 = mergeTerminalMountDescriptors({
      hubMounts: [hubV2],
      derived: [],
      renderedKeys: new Set([keyV1!]),
      retainedKeys: run1.retainedKeys,
    });
    expect(run2.sessions).toHaveLength(1);
    // Incarnation 2 must NOT inherit keyV1 because target identity changed!
    expect(run2.sessions[0].mountKey).not.toBe(keyV1);
  });
});
