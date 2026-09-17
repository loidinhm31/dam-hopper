// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  assertOwnerMatch,
  connectionKey,
  ConnectionOwnerError,
  isOwnerMatch,
  normalizeProjectTargetRef,
  projectKey,
  projectTargetKey,
  terminalInstanceKey,
  terminalKey,
  toServerProjectTarget,
  type ConnectionRef,
  type ProjectRef,
  type ProjectTargetRef,
  type TerminalInstanceRef,
  type TerminalRef,
} from "./ownership.js";

describe("ownership key builders", () => {
  it("serializes projectKey as a JSON tuple", () => {
    const ref: ProjectRef = { profileId: "prof-1", project: "dam-hopper" };
    expect(projectKey(ref)).toBe(JSON.stringify(["prof-1", "dam-hopper"]));
  });

  it("serializes projectTargetKey with root worktree", () => {
    const ref: ProjectTargetRef = { profileId: "prof-1", project: "dam-hopper" };
    expect(projectTargetKey(ref)).toBe(JSON.stringify(["prof-1", "dam-hopper", null]));
  });

  it("serializes projectTargetKey with normalized worktree path", () => {
    const ref: ProjectTargetRef = {
      profileId: "prof-1",
      project: "dam-hopper",
      worktreePath: "/repo/worktrees/feature-a/",
    };
    expect(projectTargetKey(ref)).toBe(
      JSON.stringify(["prof-1", "dam-hopper", "/repo/worktrees/feature-a"]),
    );
  });

  it("serializes terminalKey and terminalInstanceKey as JSON tuples", () => {
    const term: TerminalRef = { profileId: "prof-1", id: "term-123" };
    expect(terminalKey(term)).toBe(JSON.stringify(["prof-1", "term-123"]));

    const instance: TerminalInstanceRef = {
      profileId: "prof-1",
      id: "term-123",
      incarnation: 4,
    };
    expect(terminalInstanceKey(instance)).toBe(
      JSON.stringify(["prof-1", "term-123", 4]),
    );
  });

  it("serializes connectionKey as JSON tuple", () => {
    const conn: ConnectionRef = { profileId: "prof-1", generation: 3 };
    expect(connectionKey(conn)).toBe(JSON.stringify(["prof-1", 3]));
  });
});

describe("project target normalization and wire projection", () => {
  it("preserves profileId during normalization", () => {
    const input: ProjectTargetRef = {
      profileId: "profile-alpha",
      project: "my-project",
      worktreePath: "subdir/../trees/feat/",
    };
    const normalized = normalizeProjectTargetRef(input);
    expect(normalized.profileId).toBe("profile-alpha");
    expect(normalized.project).toBe("my-project");
    expect(normalized.worktreePath).toBe("trees/feat");
  });

  it("normalizes empty or whitespace worktreePath to null", () => {
    const input: ProjectTargetRef = {
      profileId: "profile-alpha",
      project: "my-project",
      worktreePath: "   ",
    };
    const normalized = normalizeProjectTargetRef(input);
    expect(normalized.worktreePath).toBeNull();
  });

  it("projects target to server wire DTO without profileId", () => {
    const targetWithWorktree: ProjectTargetRef = {
      profileId: "profile-alpha",
      project: "my-project",
      worktreePath: "trees/feat",
    };
    const wire = toServerProjectTarget(targetWithWorktree);
    expect(wire).toEqual({
      project: "my-project",
      worktreePath: "trees/feat",
    });
    expect((wire as Record<string, unknown>).profileId).toBeUndefined();

    const targetRoot: ProjectTargetRef = {
      profileId: "profile-alpha",
      project: "my-project",
    };
    expect(toServerProjectTarget(targetRoot)).toEqual({
      project: "my-project",
    });
  });
});

describe("owner matching and rejection", () => {
  it("matches identical profile IDs", () => {
    const expected: ConnectionRef = { profileId: "p1", generation: 1 };
    const actualProject: ProjectRef = { profileId: "p1", project: "proj" };
    expect(isOwnerMatch(expected, actualProject)).toBe(true);
    expect(() => assertOwnerMatch(expected, actualProject)).not.toThrow();
  });

  it("matches identical ConnectionRefs", () => {
    const expected: ConnectionRef = { profileId: "p1", generation: 2 };
    const actual: ConnectionRef = { profileId: "p1", generation: 2 };
    expect(isOwnerMatch(expected, actual)).toBe(true);
    expect(() => assertOwnerMatch(expected, actual)).not.toThrow();
  });

  it("rejects mismatched profileId", () => {
    const expected: ConnectionRef = { profileId: "p1", generation: 1 };
    const actual: ProjectRef = { profileId: "p2", project: "proj" };
    expect(isOwnerMatch(expected, actual)).toBe(false);
    expect(() => assertOwnerMatch(expected, actual, "test-op")).toThrowError(
      ConnectionOwnerError,
    );
    try {
      assertOwnerMatch(expected, actual, "test-op");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectionOwnerError);
      expect((err as ConnectionOwnerError).reason).toBe("owner-mismatch");
    }
  });

  it("rejects mismatched connection generation", () => {
    const expected: ConnectionRef = { profileId: "p1", generation: 1 };
    const actual: ConnectionRef = { profileId: "p1", generation: 2 };
    expect(isOwnerMatch(expected, actual)).toBe(false);
    expect(() => assertOwnerMatch(expected, actual)).toThrowError(
      ConnectionOwnerError,
    );
  });
});
