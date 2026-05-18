import { describe, expect, it } from "vitest";
import { getTerminalLaunchContext } from "./terminal-launch-context.js";

describe("getTerminalLaunchContext", () => {
  const projects = [
    { name: "api", path: "/workspace/api" },
    { name: "web", path: "/workspace/web" },
  ];

  it("returns the selected project cwd", () => {
    expect(getTerminalLaunchContext(projects, "web")).toEqual({
      projectName: "web",
      projectPath: "/workspace/web",
    });
  });

  it("does not reuse a stale project cwd when the project is unknown", () => {
    expect(getTerminalLaunchContext(projects, "old-project")).toEqual({
      projectName: undefined,
      projectPath: undefined,
    });
  });

  it("allows workspace-level terminals when no project is selected", () => {
    expect(getTerminalLaunchContext(projects)).toEqual({
      projectName: undefined,
      projectPath: undefined,
    });
  });
});
