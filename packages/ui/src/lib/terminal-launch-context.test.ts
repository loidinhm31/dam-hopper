import { describe, expect, it } from "vitest";
import {
  getProjectRelativeTerminalCwd,
  getSafeProjectProfileCwd,
  getTerminalLaunchContext,
  getTerminalLaunchRequest,
} from "./terminal-launch-context.js";

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

describe("getTerminalLaunchRequest", () => {
  it("projects a configured-root profile directory into the selected worktree", () => {
    expect(
      getTerminalLaunchRequest(
        "/workspace/api",
        "/tmp/api-feature",
        "/workspace/api/packages/server",
      ),
    ).toEqual({
      cwd: "packages/server",
      displayCwd: "/tmp/api-feature/packages/server",
      worktreePath: "/tmp/api-feature",
    });
  });

  it("uses the selected worktree root when the profile points at the project root", () => {
    expect(
      getTerminalLaunchRequest(
        "/workspace/api",
        "/tmp/api-feature",
        "/workspace/api",
      ),
    ).toEqual({
      cwd: undefined,
      displayCwd: "/tmp/api-feature",
      worktreePath: "/tmp/api-feature",
    });
  });

  it("preserves a relative cwd as target-relative input", () => {
    expect(
      getTerminalLaunchRequest("/workspace/api", "/tmp/api-feature", "src"),
    ).toEqual({
      cwd: "src",
      displayCwd: "/tmp/api-feature/src",
      worktreePath: "/tmp/api-feature",
    });
  });

  it("projects a nested UNC cwd into the selected worktree", () => {
    expect(
      getTerminalLaunchRequest(
        "\\\\server\\share\\api",
        "\\\\server\\share\\api-feature",
        "\\\\server\\share\\api\\packages\\server",
      ),
    ).toEqual({
      cwd: "packages/server",
      displayCwd: "\\\\server\\share\\api-feature/packages/server",
      worktreePath: "\\\\server\\share\\api-feature",
    });
  });

  it("does not treat a POSIX path as a UNC alias", () => {
    expect(
      getTerminalLaunchRequest(
        "/server/share/api",
        String.raw`\\server\share\api-feature`,
        String.raw`\\server\share\api\packages\server`,
      ),
    ).toEqual({
      cwd: String.raw`\\server\share\api\packages\server`,
      displayCwd: String.raw`\\server\share\api\packages\server`,
      worktreePath: String.raw`\\server\share\api-feature`,
    });
  });
});

describe("getProjectRelativeTerminalCwd", () => {
  it("does not persist the absolute selected-worktree path", () => {
    expect(
      getProjectRelativeTerminalCwd(
        "/workspace/api",
        "/tmp/api-feature",
        "/tmp/api-feature/packages/server",
      ),
    ).toBe("packages/server");
  });

  it("maps the selected worktree root to the profile root", () => {
    expect(
      getProjectRelativeTerminalCwd(
        "/workspace/api",
        "/tmp/api-feature",
        "/tmp/api-feature",
      ),
    ).toBeUndefined();
  });

  it("does not persist a source project root when saving into another project", () => {
    expect(
      getSafeProjectProfileCwd({
        destinationProjectName: "web",
        sourceProjectName: "api",
        projectPath: "/workspace/web",
        requestedCwd: "/workspace/api",
      }),
    ).toBe(".");
  });

  it("keeps relative cwd values when moving a root-scoped terminal", () => {
    expect(
      getSafeProjectProfileCwd({
        destinationProjectName: "web",
        sourceProjectName: "api",
        projectPath: "/workspace/web",
        requestedCwd: "scripts",
      }),
    ).toBe("scripts");
  });
});
