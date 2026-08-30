import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@/api/client.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import {
  FREE_TRADITIONAL_TERMINAL_GROUP_ID,
  buildTraditionalTerminalProjectGroups,
  traditionalTerminalLayoutStorageKey,
} from "./traditional-terminal-projects.js";

function mounted(sessionId: string, project: string): MountedSession {
  return { sessionId, project, command: "bash", cwd: "/repo" };
}

function session(
  id: string,
  project: string | undefined,
  alive: boolean,
): SessionInfo {
  return {
    id,
    project,
    command: "bash",
    cwd: "/repo",
    type: "custom",
    alive,
    startedAt: 1,
  };
}

function tab(
  id: string,
  project: string | undefined,
  alive: boolean,
): TabEntry {
  return { sessionId: id, label: id, session: session(id, project, alive) };
}

describe("buildTraditionalTerminalProjectGroups", () => {
  it("groups open terminals in first-tab order", () => {
    const mountedSessions = [
      mounted("alpha:stopped", "alpha"),
      mounted("beta:stopped", "beta"),
      mounted("alpha:live", "alpha"),
      mounted("free:one", ""),
    ];
    const terminalTabs = [
      tab("alpha:stopped", "alpha", false),
      tab("beta:stopped", "beta", false),
      tab("alpha:live", "alpha", true),
      tab("free:one", undefined, false),
      tab("orphan", "gamma", true),
    ];

    const groups = buildTraditionalTerminalProjectGroups(
      mountedSessions,
      terminalTabs,
    );

    expect(groups.map((group) => group.id)).toEqual([
      "project:alpha",
      "project:beta",
      FREE_TRADITIONAL_TERMINAL_GROUP_ID,
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "alpha",
      "beta",
      "Free terminals",
    ]);
    expect(groups[0]).toMatchObject({
      projectName: "alpha",
      terminalTabs: [terminalTabs[0], terminalTabs[2]],
      mountedSessions: [mountedSessions[0], mountedSessions[2]],
    });
    expect(groups.flatMap((group) => group.terminalTabs)).not.toContain(
      terminalTabs[4],
    );
  });

  it("keeps a project row when its final tab stops", () => {
    const mountedSessions = [mounted("alpha:live", "alpha")];
    const stoppedTabs = [tab("alpha:live", "alpha", false)];

    const groups = buildTraditionalTerminalProjectGroups(
      mountedSessions,
      stoppedTabs,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      id: "project:alpha",
      label: "alpha",
    });
  });

  it("keeps a free session with a project under that named project", () => {
    const groups = buildTraditionalTerminalProjectGroups(
      [mounted("free:alpha", "alpha")],
      [tab("free:alpha", "alpha", true)],
    );

    expect(groups[0]).toMatchObject({
      id: "project:alpha",
      projectName: "alpha",
      label: "alpha",
    });
  });

  it("preserves global projectless title ordinals across mounted project groups", () => {
    const alphaTitle = {
      baseLabel: "Terminal 1",
      ordinal: 1,
      fullText: "Terminal 1 #1",
    };
    const betaTitle = {
      baseLabel: "Terminal 2",
      ordinal: 2,
      fullText: "Terminal 2 #2",
    };
    const terminalTabs = [
      { ...tab("free:alpha", undefined, true), title: alphaTitle },
      { ...tab("free:beta", undefined, true), title: betaTitle },
    ];

    const groups = buildTraditionalTerminalProjectGroups(
      [mounted("free:alpha", "alpha"), mounted("free:beta", "beta")],
      terminalTabs,
    );

    expect(groups.map((group) => group.terminalTabs[0].title)).toEqual([
      alphaTitle,
      betaTitle,
    ]);
  });
});

describe("traditionalTerminalLayoutStorageKey", () => {
  it("encodes the project group id in the v2 namespace", () => {
    expect(traditionalTerminalLayoutStorageKey("project:alpha/beta")).toBe(
      "dam-hopper:terminal-layout:v2:project%3Aalpha%2Fbeta",
    );
  });
});
