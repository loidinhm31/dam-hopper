import { describe, it, expect } from "vitest";
import { parseWorktreePorcelain } from "../worktree.js";

describe("parseWorktreePorcelain", () => {
  it("parses main + linked worktree", () => {
    const output = `worktree /home/user/project
HEAD abc123def456
branch refs/heads/main

worktree /home/user/project-feature
HEAD 789xyz
branch refs/heads/feature/my-feature

`;
    const result = parseWorktreePorcelain(output);
    expect(result).toHaveLength(2);

    expect(result[0]).toMatchObject({
      path: "/home/user/project",
      branch: "main",
      commitHash: "abc123def456",
      isMain: true,
      isLocked: false,
    });

    expect(result[1]).toMatchObject({
      path: "/home/user/project-feature",
      branch: "feature/my-feature",
      commitHash: "789xyz",
      isMain: false,
      isLocked: false,
    });
  });

  it("parses locked worktree", () => {
    const output = `worktree /home/user/project
HEAD abc123
branch refs/heads/main

worktree /home/user/project-locked
HEAD def456
branch refs/heads/other
locked reason text

`;
    const result = parseWorktreePorcelain(output);
    expect(result[1].isLocked).toBe(true);
  });

  it("handles empty output", () => {
    expect(parseWorktreePorcelain("")).toHaveLength(0);
  });

  it("handles single worktree", () => {
    const output = `worktree /home/user/myrepo
HEAD aaabbb
branch refs/heads/develop

`;
    const result = parseWorktreePorcelain(output);
    expect(result).toHaveLength(1);
    expect(result[0].isMain).toBe(true);
    expect(result[0].branch).toBe("develop");
  });

  it("handles detached HEAD worktree", () => {
    const output = `worktree /home/user/project
HEAD abc123
branch refs/heads/main

worktree /home/user/project-detached
HEAD deadbeef
detached

`;
    const result = parseWorktreePorcelain(output);
    expect(result).toHaveLength(2);
    expect(result[1].branch).toBe("(detached)");
    expect(result[1].commitHash).toBe("deadbeef");
  });
});
