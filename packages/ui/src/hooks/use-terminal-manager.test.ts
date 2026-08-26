import { beforeEach, describe, expect, it } from "vitest";
import { ApiRequestError, type SessionInfo } from "@/api/client.js";
import { useProjectTargetStore } from "@/stores/project-target.js";
import {
  findSessionMeta,
  reconcileTerminalTargetError,
} from "./use-terminal-manager.js";

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
