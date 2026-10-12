import { describe, expect, it } from "vitest";
import {
  isGitCommitRevealRequestMatchingTarget,
  formatGitCommitAuthorTimestamp,
  type GitCommitRevealRequest,
  type GitCommitRevealOwner,
} from "./git-commit-reveal.js";

describe("isGitCommitRevealRequestMatchingTarget", () => {
  const owner: GitCommitRevealOwner = { profileId: "prof-1", generation: 1 };
  const baseRequest: GitCommitRevealRequest = {
    nonce: 1,
    owner,
    target: { project: "proj-a", profileId: "prof-1" },
    rootId: ".",
    hash: "abc1234",
  };

  it("returns false if owner or currentTarget is missing", () => {
    expect(isGitCommitRevealRequestMatchingTarget(baseRequest, null, { project: "proj-a" })).toBe(false);
    expect(isGitCommitRevealRequestMatchingTarget(baseRequest, owner, null)).toBe(false);
  });

  it("returns false if profileId or generation differs", () => {
    expect(
      isGitCommitRevealRequestMatchingTarget(
        baseRequest,
        { profileId: "prof-other", generation: 1 },
        { project: "proj-a" },
      ),
    ).toBe(false);
    expect(
      isGitCommitRevealRequestMatchingTarget(
        baseRequest,
        { profileId: "prof-1", generation: 2 },
        { project: "proj-a" },
      ),
    ).toBe(false);
  });

  it("returns false if project name differs", () => {
    expect(
      isGitCommitRevealRequestMatchingTarget(
        baseRequest,
        owner,
        { project: "proj-b" },
      ),
    ).toBe(false);
  });

  it("accepts reveal request from worktree when currentTarget is root", () => {
    const worktreeRequest: GitCommitRevealRequest = {
      ...baseRequest,
      target: { project: "proj-a", profileId: "prof-1", worktreePath: "/trees/feat" },
    };
    expect(
      isGitCommitRevealRequestMatchingTarget(
        worktreeRequest,
        owner,
        { project: "proj-a", profileId: "prof-1" },
      ),
    ).toBe(true);
  });

  it("enforces exact worktree matching when currentTarget is worktree-scoped", () => {
    const worktreeRequest: GitCommitRevealRequest = {
      ...baseRequest,
      target: { project: "proj-a", profileId: "prof-1", worktreePath: "/trees/feat" },
    };
    expect(
      isGitCommitRevealRequestMatchingTarget(
        worktreeRequest,
        owner,
        { project: "proj-a", profileId: "prof-1", worktreePath: "/trees/feat" },
      ),
    ).toBe(true);
    expect(
      isGitCommitRevealRequestMatchingTarget(
        worktreeRequest,
        owner,
        { project: "proj-a", profileId: "prof-1", worktreePath: "/trees/other" },
      ),
    ).toBe(false);
  });
});

describe("formatGitCommitAuthorTimestamp", () => {
  it("formats epoch and timezone correctly", () => {
    const formatted = formatGitCommitAuthorTimestamp(1728100000, 420);
    expect(formatted).toContain("UTC+7");
  });

  it("returns empty string for invalid timestamp", () => {
    expect(formatGitCommitAuthorTimestamp(0)).toBe("");
    expect(formatGitCommitAuthorTimestamp(NaN)).toBe("");
  });
});
