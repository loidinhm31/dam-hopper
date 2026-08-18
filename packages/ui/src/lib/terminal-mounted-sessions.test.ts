import { describe, expect, it } from "vitest";
import {
  createMountedSession,
  upsertMountedSession,
} from "./terminal-mounted-sessions.js";

describe("createMountedSession", () => {
  it("preserves cwd and target metadata for recovery", () => {
    expect(
      createMountedSession("terminal:demo:dev", {
        project: "demo",
        command: "pnpm dev",
        cwd: "/worktrees/demo-feature/src",
        worktreePath: "/worktrees/demo-feature",
      }),
    ).toEqual({
      sessionId: "terminal:demo:dev",
      project: "demo",
      command: "pnpm dev",
      cwd: "/worktrees/demo-feature/src",
      worktreePath: "/worktrees/demo-feature",
    });
  });
});

describe("upsertMountedSession", () => {
  it("appends new sessions in insertion order", () => {
    const next = upsertMountedSession(
      [{ sessionId: "one", project: "web", command: "pnpm dev" }],
      { sessionId: "two", project: "api", command: "cargo run" },
    );

    expect(next.map((session) => session.sessionId)).toEqual(["one", "two"]);
  });

  it("updates an existing session without reordering it", () => {
    const next = upsertMountedSession(
      [
        { sessionId: "one", project: "web", command: "pnpm dev" },
        { sessionId: "two", project: "api", command: "cargo run" },
      ],
      {
        sessionId: "one",
        project: "web",
        command: "pnpm dev --host",
        cwd: "/repo/web",
      },
    );

    expect(next.map((session) => session.sessionId)).toEqual(["one", "two"]);
    expect(next[0]?.command).toBe("pnpm dev --host");
    expect(next[0]?.cwd).toBe("/repo/web");
  });
});
