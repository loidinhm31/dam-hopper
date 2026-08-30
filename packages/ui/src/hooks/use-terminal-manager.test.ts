import { beforeEach, describe, expect, it } from "vitest";
import { ApiRequestError, type SessionInfo } from "@/api/client.js";
import {
  rememberTerminalSessionIncarnation,
  resetTerminalSessionIncarnations,
} from "@/lib/terminal-incarnation-state.js";
import { useProjectTargetStore } from "@/stores/project-target.js";
import {
  applyLocalStoppedSession,
  buildTerminalDisplayTabs,
  findSessionMeta,
  getLocallyStoppedSessionIds,
  getLocallyStoppedSessionMarker,
  isSameSessionIdentity,
  reconcileTerminalTargetError,
} from "./use-terminal-manager.js";

describe("buildTerminalDisplayTabs", () => {
  const profileSessionIds = new Set<string>();

  it("keeps base tabs unsuffixed while deriving per-project ordinals", () => {
    const openTabs = [
      {
        sessionId: "terminal:demo:_:1",
        label: "demo:bash",
        project: "project-a",
      },
      {
        sessionId: "terminal:other:_:1",
        label: "other:bash",
        project: "project-b",
      },
      {
        sessionId: "terminal:demo:_:2",
        label: "demo:bash",
        project: "project-a",
      },
    ];
    const tabs = buildTerminalDisplayTabs(
      openTabs,
      new Map(),
      profileSessionIds,
      new Map(),
    );

    expect(openTabs.map((tab) => tab.label)).toEqual([
      "demo:bash",
      "other:bash",
      "demo:bash",
    ]);
    expect(tabs.map((tab) => tab.title)).toEqual([
      { baseLabel: "demo:bash", ordinal: 1, fullText: "demo:bash #1" },
      { baseLabel: "other:bash", ordinal: 1, fullText: "other:bash #1" },
      { baseLabel: "demo:bash", ordinal: 2, fullText: "demo:bash #2" },
    ]);
  });

  it("uses live project metadata when an existing tab is hydrated", () => {
    const id = "terminal:from-id:_:1";
    const session = {
      id,
      project: "authoritative",
      command: "bash",
      cwd: "/repo",
      type: "terminal" as const,
      alive: true,
      startedAt: 1,
    };
    const [tab] = buildTerminalDisplayTabs(
      [{ sessionId: id, label: "old" }],
      new Map([[id, session]]),
      profileSessionIds,
      new Map(),
    );

    expect(tab?.project).toBe("authoritative");
  });

  it("prefers explicit tab project metadata over hydrated session metadata", () => {
    const id = "terminal:pending-project:_:1";
    const session: SessionInfo = {
      id,
      project: "stale-session-project",
      command: "bash",
      cwd: "/repo",
      type: "terminal",
      alive: true,
      startedAt: 1,
    };
    const [tab] = buildTerminalDisplayTabs(
      [{ sessionId: id, label: "pending:bash", project: "explicit-project" }],
      new Map([[id, session]]),
      profileSessionIds,
      new Map(),
    );

    expect(tab?.project).toBe("explicit-project");
    expect(tab?.title.fullText).toBe("pending:bash #1");
  });

  it("keeps free tabs in the shared projectless group", () => {
    const tabs = buildTerminalDisplayTabs(
      [
        { sessionId: "free:one", label: "free one", project: "project-a" },
        { sessionId: "free:two", label: "free two" },
      ],
      new Map(),
      profileSessionIds,
      new Map(),
    );

    expect(tabs.map((tab) => tab.title.ordinal)).toEqual([1, 2]);
    expect(tabs.every((tab) => tab.project === undefined)).toBe(true);
  });
  it("transitions a free tab from pending to its indexed base label", () => {
    const openTabs = [{ sessionId: "free:pending", label: "stale" }];
    const pending = buildTerminalDisplayTabs(
      openTabs,
      new Map(),
      profileSessionIds,
      new Map(),
    );
    const indexed = buildTerminalDisplayTabs(
      openTabs,
      new Map(),
      profileSessionIds,
      new Map([["free:pending", 3]]),
    );

    expect(pending[0]?.label).toBe("Terminal (starting…)");
    expect(pending[0]?.title.fullText).toBe("Terminal (starting…) #1");
    expect(indexed[0]?.label).toBe("Terminal 3");
    expect(indexed[0]?.title.fullText).toBe("Terminal 3 #1");
  });
});





describe("findSessionMeta", () => {

  it("keeps cwd and target metadata for deep-link terminal selection", () => {
    const session: SessionInfo = {
      id: "terminal:demo:dev:1",
      project: "demo",
      command: "pnpm dev",
      cwd: "/worktrees/demo-feature/src",
      worktreePath: "/worktrees/demo-feature",
      type: "terminal",
      alive: true,
      startedAt: 1,
    };

    expect(
      findSessionMeta(session.id, [], new Map([[session.id, session]])),
    ).toEqual({
      project: "demo",
      command: "pnpm dev",
      sessionType: "terminal",
      cwd: "/worktrees/demo-feature/src",
      worktreePath: "/worktrees/demo-feature",
    });
  });
  it("falls back to the encoded project for deep-link session metadata", () => {
    const session: SessionInfo = {
      id: "terminal:encoded-project:_:1", project: undefined, command: "bash",
      cwd: "/repo", type: "terminal", alive: true, startedAt: 1,
    };
    expect(findSessionMeta(session.id, [], new Map([[session.id, session]]))).toMatchObject({
      project: "encoded-project", sessionType: "terminal",
    });
  });
});

describe("local stopped session reconciliation", () => {
  beforeEach(() => resetTerminalSessionIncarnations());
  it("releases a stop marker when an omitted session ID is recreated", () => {
    const sessionId = "terminal:demo:reused";
    const previousSession: SessionInfo = {
      id: sessionId,
      incarnation: 11,
      project: "demo",
      command: "bash",
      cwd: "/workspaces/demo",
      type: "shell",
      alive: true,
      startedAt: 1,
    };
    const marker = getLocallyStoppedSessionMarker(sessionId, new Map(), [
      { sessionId, label: "Terminal 1", session: previousSession },
    ]);
    expect(marker).toEqual({ incarnation: 11, startedAt: 1 });

    const markers = new Map([[sessionId, marker!]]);
    const recreatedSession: SessionInfo = {
      ...previousSession,
      incarnation: 12,
      startedAt: 2,
    };

    expect(
      getLocallyStoppedSessionIds(
        markers,
        new Map([[sessionId, recreatedSession]]),
      ),
    ).toEqual(new Set());
    expect(applyLocalStoppedSession(recreatedSession, marker)).toBe(
      recreatedSession,
    );
  });
  it("uses the latest incarnation when retained tab metadata is missing", () => {
    const sessionId = "terminal:demo:known-incarnation";
    rememberTerminalSessionIncarnation(sessionId, 21);

    const marker = getLocallyStoppedSessionMarker(sessionId, new Map(), [
      { sessionId, label: "Terminal 1" },
    ]);
    expect(marker).toEqual({ incarnation: 21, startedAt: undefined });

    const recreatedSession: SessionInfo = {
      id: sessionId,
      incarnation: 22,
      project: "demo",
      command: "bash",
      cwd: "/workspaces/demo",
      type: "shell",
      alive: true,
      startedAt: 2,
    };
    const markers = new Map([[sessionId, marker!]]);

    expect(
      getLocallyStoppedSessionIds(
        markers,
        new Map([[sessionId, recreatedSession]]),
      ),
    ).toEqual(new Set());
  });

  it("matches a legacy snapshot by startedAt when incarnation is omitted", () => {
    const session: SessionInfo = {
      id: "terminal:demo:legacy",
      project: "demo",
      command: "bash",
      cwd: "/workspaces/demo",
      type: "shell",
      alive: true,
      startedAt: 1,
    };
    const marker = { incarnation: 21, startedAt: 1 };

    expect(isSameSessionIdentity(session, marker)).toBe(true);
    expect(applyLocalStoppedSession(session, marker)).toEqual({
      ...session,
      alive: false,
    });
  });

  it("does not create a wildcard marker without a session identity", () => {
    expect(
      getLocallyStoppedSessionMarker("terminal:demo:pending", new Map(), [
        { sessionId: "terminal:demo:pending", label: "Terminal 1" },
      ]),
    ).toBeUndefined();
  });
});

describe("reconcileTerminalTargetError", () => {
  beforeEach(() => useProjectTargetStore.getState().resetTarget("demo"));

  it("marks the exact worktree unavailable for target API failures", () => {
    useProjectTargetStore.getState().selectTarget("demo", "/tmp/demo-feature");

    reconcileTerminalTargetError(
      "demo",
      "/tmp/demo-feature",
      new ApiRequestError(
        "WORKSPACE_TARGET_UNAVAILABLE: worktree disappeared",
        404,
        "WORKSPACE_TARGET_UNAVAILABLE",
      ),
    );

    expect(useProjectTargetStore.getState().activeTargetByProject).toEqual({});
    expect(
      useProjectTargetStore.getState().unavailableTargetsByProject,
    ).toEqual({ demo: ["/tmp/demo-feature"] });
  });

  it("does not downgrade the selected target for unrelated failures", () => {
    useProjectTargetStore.getState().selectTarget("demo", "/tmp/demo-feature");

    reconcileTerminalTargetError(
      "demo",
      "/tmp/demo-feature",
      new Error("shell could not be started"),
    );

    expect(useProjectTargetStore.getState().activeTargetByProject).toEqual({
      demo: "/tmp/demo-feature",
    });
    expect(
      useProjectTargetStore.getState().unavailableTargetsByProject,
    ).toEqual({});
  });
});