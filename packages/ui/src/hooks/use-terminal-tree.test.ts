import { describe, expect, it } from "vitest";
import type { SessionInfo } from "@/api/client.js";
import {
  countLiveTerminalSessionsForTarget,
  isPathWithinTarget,
  isRecoverableTerminalSession,
  markOrphanedSessions,
  sessionBelongsToProjectTarget,
  sessionMatchesProjectTarget,
} from "./use-terminal-tree.js";

function session(
  cwd: string,
  overrides: Partial<SessionInfo> = {},
): SessionInfo {
  return {
    id: `terminal:${cwd}`,
    project: "demo",
    command: "bash",
    cwd,
    type: "shell",
    alive: true,
    startedAt: 1,
    ...overrides,
  };
}

describe("terminal target ownership", () => {
  it("keeps unavailable target sessions in the recovery terminal group", () => {
    expect(
      isRecoverableTerminalSession(
        session("/tmp/demo-feature", {
          id: "terminal:demo:profile:wt-stale",
          alive: false,
          targetUnavailable: true,
        }),
      ),
    ).toBe(true);
  });

  it("matches a target and its descendants without prefix collisions", () => {
    expect(
      isPathWithinTarget("/tmp/demo-feature/src", "/tmp/demo-feature"),
    ).toBe(true);
    expect(isPathWithinTarget("/tmp/demo-feature-2", "/tmp/demo-feature")).toBe(
      false,
    );
  });

  it("does not treat a POSIX literal backslash as a directory separator", () => {
    expect(
      isPathWithinTarget("/repo/feature\\name/src", "/repo/feature"),
    ).toBe(false);
  });

  it("counts only live sessions owned by the exact project target", () => {
    const target = { project: "demo", worktreePath: "/tmp/demo-feature" };
    const sessions = [
      session("/tmp/demo-feature"),
      session("/tmp/demo-feature/src"),
      session("/tmp/demo"),
      session("/tmp/demo-feature-2"),
      session("/tmp/demo-feature", { alive: false }),
      session("/tmp/demo-feature", { project: "other" }),
    ];

    expect(
      countLiveTerminalSessionsForTarget(sessions, target, "/tmp/demo"),
    ).toBe(2);
    expect(
      sessionBelongsToProjectTarget(
        sessions[2]!,
        { project: "demo" },
        "/tmp/demo",
      ),
    ).toBe(true);
  });

  it("marks only live sessions under an unavailable target", () => {
    const sessions = [
      session("/tmp/demo-feature/src"),
      session("/tmp/demo-feature-2"),
      session("/tmp/demo-feature", { alive: false }),
      session("/tmp/demo"),
    ];

    const marked = markOrphanedSessions(sessions, {
      demo: ["/tmp/demo-feature"],
    });

    expect(marked.map((value) => value.orphaned)).toEqual([
      true,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("marks sessions for each unavailable target without losing older paths", () => {
    const marked = markOrphanedSessions(
      [
        session("/tmp/demo-first/src", {
          worktreePath: "/tmp/demo-first",
        }),
        session("/tmp/demo-second/src", {
          worktreePath: "/tmp/demo-second",
        }),
        session("/tmp/demo-root"),
      ],
      { demo: ["/tmp/demo-first", "/tmp/demo-second"] },
    );

    expect(marked.map((value) => value.orphaned)).toEqual([
      true,
      true,
      undefined,
    ]);
  });

  it("keeps persisted unavailable identities visible as orphaned", () => {
    const marked = markOrphanedSessions(
      [
        session("/tmp/demo-feature", {
          alive: false,
          worktreePath: "/tmp/demo-feature",
          targetUnavailable: true,
        }),
      ],
      {},
    );

    expect(marked[0]?.orphaned).toBe(true);
    expect(
      sessionMatchesProjectTarget(
        marked[0]!,
        { project: "demo", worktreePath: "/tmp/demo-feature" },
        "/tmp/demo",
      ),
    ).toBe(true);
  });

  it("matches unavailable target aliases with UNC spelling and case changes", () => {
    const marked = markOrphanedSessions(
      [
        session("//server/share/repo/src", {
          worktreePath: "\\\\SERVER\\Share\\Repo",
        }),
      ],
      { demo: ["//server/share/repo"] },
    );

    expect(marked[0]?.orphaned).toBe(true);
  });
});
