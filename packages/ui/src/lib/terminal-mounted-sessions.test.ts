import { describe, expect, it } from "vitest";
import { upsertMountedSession } from "./terminal-mounted-sessions.js";

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
