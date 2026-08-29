import { beforeEach, describe, expect, it } from "vitest";
import { ApiRequestError, type SessionInfo } from "@/api/client.js";
import { useProjectTargetStore } from "@/stores/project-target.js";
import {
  buildTerminalDisplayTabs,
  findSessionMeta,
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
      id: "terminal:encoded-project:_:1",
      project: undefined,
      command: "bash",
      cwd: "/repo",
      type: "terminal",
      alive: true,
      startedAt: 1,
    };

    expect(
      findSessionMeta(session.id, [], new Map([[session.id, session]])),
    ).toMatchObject({
      project: "encoded-project",
      sessionType: "terminal",
    });
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
