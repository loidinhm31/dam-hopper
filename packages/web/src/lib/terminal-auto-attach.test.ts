import { describe, expect, it } from "vitest";
import { deriveTerminalAutoAttachState } from "./terminal-auto-attach.js";
import type { SessionInfo } from "@/api/client.js";
import type { TabEntry } from "@/components/organisms/TerminalTabBar.js";
import type { MountedSession } from "@/components/organisms/MultiTerminalDisplay.js";

function session(
  id: string,
  overrides: Partial<SessionInfo> = {},
): SessionInfo {
  return {
    id,
    project: overrides.project,
    command: overrides.command ?? "npm run dev",
    cwd: overrides.cwd ?? "/repo",
    type: overrides.type ?? "unknown",
    alive: overrides.alive ?? true,
    startedAt: overrides.startedAt ?? 1,
    ...overrides,
  };
}

function derive({
  sessions,
  openTabs = [],
  mountedSessions = [],
  activeTab = null,
  profileSessionIds = new Set<string>(),
  freeTerminalIndexMap = new Map<string, number>(),
  ignoredSessionIds,
  pendingSessionIds,
}: {
  sessions: SessionInfo[];
  openTabs?: TabEntry[];
  mountedSessions?: MountedSession[];
  activeTab?: string | null;
  profileSessionIds?: Set<string>;
  freeTerminalIndexMap?: Map<string, number>;
  ignoredSessionIds?: Set<string>;
  pendingSessionIds?: Set<string>;
}) {
  return deriveTerminalAutoAttachState({
    sessions,
    openTabs,
    mountedSessions,
    activeTab,
    profileSessionIds,
    freeTerminalIndexMap,
    ignoredSessionIds,
    pendingSessionIds,
  });
}

describe("deriveTerminalAutoAttachState", () => {
  it("attaches a live free terminal", () => {
    const result = derive({
      sessions: [session("free:abc", { command: "", type: "free" })],
      freeTerminalIndexMap: new Map([["free:abc", 1]]),
    });

    expect(result.openTabs).toMatchObject([
      { sessionId: "free:abc", label: "Terminal 1" },
    ]);
    expect(result.mountedSessions).toMatchObject([
      { sessionId: "free:abc", project: "", command: "" },
    ]);
    expect(result.activeTab).toBe("free:abc");
  });

  it("attaches live custom, build, and run terminals", () => {
    const result = derive({
      sessions: [
        session("build:web", {
          project: "web",
          command: "pnpm build",
          type: "build",
          startedAt: 1,
        }),
        session("run:web", {
          project: "web",
          command: "pnpm dev",
          type: "run",
          startedAt: 2,
        }),
        session("custom:web:test", {
          project: "web",
          command: "pnpm test",
          type: "custom",
          startedAt: 3,
        }),
      ],
    });

    expect(result.openTabs.map((tab) => tab.label)).toEqual([
      "web:build",
      "web:run",
      "web:custom",
    ]);
    expect(result.mountedSessions.map((mounted) => mounted.sessionId)).toEqual([
      "build:web",
      "run:web",
      "custom:web:test",
    ]);
  });

  it("attaches a saved profile instance", () => {
    const id = "terminal:web:Smoke_Tests:100";
    const result = derive({
      sessions: [
        session(id, {
          project: "web",
          command: "pnpm test",
          type: "terminal",
        }),
      ],
      profileSessionIds: new Set([id]),
    });

    expect(result.openTabs[0]).toMatchObject({
      sessionId: id,
      label: "web:Smoke Tests",
      isSaveable: false,
    });
  });

  it("attaches an ad-hoc project terminal as saveable", () => {
    const id = "terminal:web:_:100";
    const result = derive({
      sessions: [
        session(id, {
          project: "web",
          command: "bash",
          type: "terminal",
        }),
      ],
    });

    expect(result.openTabs[0]).toMatchObject({
      sessionId: id,
      label: "web:bash",
      isSaveable: true,
    });
  });

  it("ignores dead sessions", () => {
    const result = derive({
      sessions: [
        session("free:dead", { alive: false, startedAt: 1 }),
        session("free:live", { type: "free", startedAt: 2 }),
      ],
      freeTerminalIndexMap: new Map([["free:live", 1]]),
    });

    expect(result.openTabs.map((tab) => tab.sessionId)).toEqual(["free:live"]);
    expect(result.mountedSessions.map((mounted) => mounted.sessionId)).toEqual([
      "free:live",
    ]);
  });

  it("does not resurrect explicitly ignored live sessions", () => {
    const result = derive({
      sessions: [
        session("free:closing", { type: "free", alive: true, startedAt: 1 }),
        session("free:visible", { type: "free", alive: true, startedAt: 2 }),
      ],
      ignoredSessionIds: new Set(["free:closing"]),
      freeTerminalIndexMap: new Map([
        ["free:closing", 1],
        ["free:visible", 2],
      ]),
    });

    expect(result.openTabs.map((tab) => tab.sessionId)).toEqual([
      "free:visible",
    ]);
  });

  it("preserves active tab when it is still live", () => {
    const existingSession = session("free:existing", {
      type: "free",
      startedAt: 1,
    });
    const activeSession = session("run:web", {
      project: "web",
      type: "run",
      startedAt: 2,
    });
    const discoveredSession = session("custom:web:test", {
      project: "web",
      type: "custom",
      startedAt: 3,
    });

    const result = derive({
      sessions: [discoveredSession, activeSession, existingSession],
      openTabs: [
        { sessionId: "run:web", label: "old run" },
        { sessionId: "free:existing", label: "old free" },
      ],
      mountedSessions: [
        { sessionId: "run:web", project: "web", command: "npm run dev" },
      ],
      activeTab: "run:web",
      freeTerminalIndexMap: new Map([["free:existing", 1]]),
    });

    expect(result.activeTab).toBe("run:web");
    expect(result.openTabs.map((tab) => tab.sessionId)).toEqual([
      "run:web",
      "free:existing",
      "custom:web:test",
    ]);
  });

  it("activates the newest live terminal when the current active tab is gone", () => {
    const result = derive({
      sessions: [
        session("free:old", { type: "free", startedAt: 1 }),
        session("terminal:web:_:200", {
          project: "web",
          command: "bash",
          type: "terminal",
          startedAt: 2,
        }),
      ],
      activeTab: "free:dead",
      freeTerminalIndexMap: new Map([["free:old", 1]]),
    });

    expect(result.activeTab).toBe("terminal:web:_:200");
  });

  it("keeps a pending terminal mounted while session data is stale", () => {
    const result = derive({
      sessions: [session("free:old", { type: "free", startedAt: 1 })],
      openTabs: [
        { sessionId: "free:old", label: "Terminal 1" },
        { sessionId: "free:new", label: "Terminal 2" },
      ],
      mountedSessions: [
        { sessionId: "free:new", project: "web", command: "", cwd: "/web" },
      ],
      activeTab: "free:new",
      pendingSessionIds: new Set(["free:new"]),
      freeTerminalIndexMap: new Map([["free:old", 1]]),
    });

    expect(result.openTabs.map((tab) => tab.sessionId)).toEqual([
      "free:old",
      "free:new",
    ]);
    expect(result.mountedSessions[0]).toMatchObject({
      sessionId: "free:new",
      project: "web",
      command: "",
      cwd: "/web",
    });
    expect(result.mountedSessions.map((mounted) => mounted.sessionId)).toEqual([
      "free:new",
      "free:old",
    ]);
  });

  it("preserves pending active terminal over older live terminals", () => {
    const result = derive({
      sessions: [session("free:old", { type: "free", startedAt: 1 })],
      openTabs: [{ sessionId: "free:new", label: "Terminal 2" }],
      mountedSessions: [{ sessionId: "free:new", project: "web", command: "" }],
      activeTab: "free:new",
      pendingSessionIds: new Set(["free:new"]),
      freeTerminalIndexMap: new Map([["free:old", 1]]),
    });

    expect(result.activeTab).toBe("free:new");
  });
});
