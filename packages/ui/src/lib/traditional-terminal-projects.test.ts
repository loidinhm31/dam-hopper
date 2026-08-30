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
  it("groups open terminals in first-tab order and exposes aggregate status", () => {
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
      hasRunningTerminal: true,
      terminalTabs: [terminalTabs[0], terminalTabs[2]],
      mountedSessions: [mountedSessions[0], mountedSessions[2]],
    });
    expect(groups[1]?.hasRunningTerminal).toBe(false);
    expect(groups[2]?.hasRunningTerminal).toBe(false);
    expect(groups.flatMap((group) => group.terminalTabs)).not.toContain(
      terminalTabs[4],
    );
  });

  it("keeps a project row when its final running tab stops", () => {
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
      hasRunningTerminal: false,
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
});

describe("traditionalTerminalLayoutStorageKey", () => {
  it("encodes the project group id in the v2 namespace", () => {
    expect(traditionalTerminalLayoutStorageKey("project:alpha/beta")).toBe(
      "dam-hopper:terminal-layout:v2:project%3Aalpha%2Fbeta",
    );
  });
});
