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
  pinnedSessionIds,
  stoppedSessionIds,
}: {
  sessions: SessionInfo[];
  openTabs?: TabEntry[];
  mountedSessions?: MountedSession[];
  activeTab?: string | null;
  profileSessionIds?: Set<string>;
  freeTerminalIndexMap?: Map<string, number>;
  ignoredSessionIds?: Set<string>;
  pendingSessionIds?: Set<string>;
  pinnedSessionIds?: Set<string>;
  stoppedSessionIds?: ReadonlySet<string>;
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
    pinnedSessionIds,
    stoppedSessionIds,
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

  it("keeps and hydrates an already open terminal after it exits", () => {
    const deadSession = session("custom:web:test", {
      project: "web",
      command: "pnpm test",
      type: "custom",
      alive: false,
      exitCode: 17,
    });
    const result = derive({
      sessions: [deadSession],
      openTabs: [
        {
          sessionId: deadSession.id,
          label: "web:test",
          session: session(deadSession.id, {
            project: "web",
            command: "pnpm test",
            type: "custom",
          }),
        },
      ],
      mountedSessions: [
        {
          sessionId: deadSession.id,
          project: "web",
          command: "pnpm test",
          cwd: "/repo/web",
        },
      ],
      activeTab: deadSession.id,
    });

    expect(result.openTabs).toMatchObject([
      {
        sessionId: deadSession.id,
        session: { alive: false, exitCode: 17 },
      },
    ]);
    expect(result.mountedSessions).toEqual([
      {
        sessionId: deadSession.id,
        project: "web",
        command: "pnpm test",
        cwd: "/repo",
        worktreePath: undefined,
      },
    ]);
    expect(result.activeTab).toBe(deadSession.id);

    const closed = derive({
      sessions: [deadSession],
      openTabs: result.openTabs,
      mountedSessions: result.mountedSessions,
      activeTab: result.activeTab,
      ignoredSessionIds: new Set([deadSession.id]),
    });

    expect(closed.openTabs).toEqual([]);
    expect(closed.mountedSessions).toEqual([]);
    expect(closed.activeTab).toBeNull();
  });
  it("keeps an exited tab stopped while its session snapshot is stale", () => {
    const staleSession = session("custom:web:test", {
      project: "web",
      type: "custom",
      alive: true,
    });
    const result = derive({
      sessions: [staleSession],
      openTabs: [
        {
          sessionId: staleSession.id,
          label: "web:test",
          session: staleSession,
        },
      ],
      mountedSessions: [
        {
          sessionId: staleSession.id,
          project: "web",
          command: staleSession.command,
          cwd: staleSession.cwd,
        },
      ],
      activeTab: staleSession.id,
      stoppedSessionIds: new Set([staleSession.id]),
    });

    expect(result.openTabs[0]?.session).toMatchObject({ alive: false });
    expect(result.activeTab).toBe(staleSession.id);
    const stable = derive({
      sessions: [staleSession],
      openTabs: result.openTabs,
      mountedSessions: result.mountedSessions,
      activeTab: result.activeTab,
      stoppedSessionIds: new Set([staleSession.id]),
    });
    expect(stable.openTabs[0]?.session).toBe(result.openTabs[0]?.session);
  });
  it("marks a retained tab stopped when its session disappears", () => {
    const staleSession = session("custom:web:test", {
      project: "web",
      type: "custom",
      alive: true,
    });
    const result = derive({
      sessions: [],
      openTabs: [
        {
          sessionId: staleSession.id,
          label: "web:test",
          session: staleSession,
        },
      ],
      mountedSessions: [
        {
          sessionId: staleSession.id,
          project: "web",
          command: staleSession.command,
          cwd: staleSession.cwd,
        },
      ],
      activeTab: staleSession.id,
    });

    expect(result.openTabs[0]?.session).toMatchObject({ alive: false });
    expect(result.activeTab).toBe(staleSession.id);
    expect(result.mountedSessions).toEqual([
      {
        sessionId: staleSession.id,
        project: "web",
        command: staleSession.command,
        cwd: staleSession.cwd,
      },
    ]);

    const closed = derive({
      sessions: [],
      openTabs: result.openTabs,
      mountedSessions: result.mountedSessions,
      activeTab: result.activeTab,
      ignoredSessionIds: new Set([staleSession.id]),
    });

    expect(closed.openTabs).toEqual([]);
    expect(closed.mountedSessions).toEqual([]);
    expect(closed.activeTab).toBeNull();
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

  it("preserves a pinned existing tab during SessionInfo refresh", () => {
    const id = "free:existing";
    const result = derive({
      sessions: [session(id, { type: "free", command: "bash" })],
      openTabs: [{ sessionId: id, label: "old label", isPinned: true }],
      activeTab: id,
      freeTerminalIndexMap: new Map([[id, 1]]),
    });

    expect(result.openTabs[0]).toMatchObject({
      sessionId: id,
      label: "Terminal 1",
      isPinned: true,
    });
  });

  it("restores a persisted pin only when attaching a matching live session", () => {
    const result = derive({
      sessions: [
        session("free:pinned", { type: "free", startedAt: 1 }),
        session("free:open", { type: "free", startedAt: 2 }),
      ],
      pinnedSessionIds: new Set(["free:pinned", "free:stale"]),
      freeTerminalIndexMap: new Map([
        ["free:pinned", 1],
        ["free:open", 2],
      ]),
    });

    expect(result.openTabs).toMatchObject([
      { sessionId: "free:pinned", isPinned: true },
      { sessionId: "free:open", isPinned: false },
    ]);
  });

  it("does not re-pin an existing tab after it was unpinned", () => {
    const result = derive({
      sessions: [session("free:existing", { type: "free" })],
      openTabs: [
        { sessionId: "free:existing", label: "Terminal 1", isPinned: false },
      ],
      pinnedSessionIds: new Set(["free:existing"]),
      activeTab: "free:existing",
      freeTerminalIndexMap: new Map([["free:existing", 1]]),
    });

    expect(result.openTabs[0]?.isPinned).toBe(false);
  });

  it("hydrates a persisted pin for a tab opened before a live snapshot", () => {
    const result = derive({
      sessions: [session("free:pending", { type: "free" })],
      openTabs: [{ sessionId: "free:pending", label: "Terminal 1" }],
      pinnedSessionIds: new Set(["free:pending"]),
      activeTab: "free:pending",
      freeTerminalIndexMap: new Map([["free:pending", 1]]),
    });

    expect(result.openTabs[0]?.isPinned).toBe(true);
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
