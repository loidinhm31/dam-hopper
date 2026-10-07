import { describe, expect, it } from "vitest";
import type { GitBlameResponse, VcsRoot } from "@/api/client.js";
import { projectTargetCacheKey } from "@/api/client.js";
import {
  computeMonacoLineCount,
  findBlameRangeForLine,
  findCommitForRange,
  findOwningVcsRoot,
  formatBlameDate,
  formatBlameFullTimestamp,
  GIT_BLAME_MAX_BUFFER_BYTES,
  isBufferOverLimit,
  isMatchingGitQueryKey,
  validateBlameResponse,
} from "./editor-git-blame.js";

describe("editor-git-blame helpers", () => {
  describe("computeMonacoLineCount", () => {
    it("returns 1 for empty string", () => {
      expect(computeMonacoLineCount("")).toBe(1);
    });

    it("returns 1 for a single line with no newline", () => {
      expect(computeMonacoLineCount("hello world")).toBe(1);
    });

    it("returns 2 for a single line with a trailing newline", () => {
      expect(computeMonacoLineCount("hello world\n")).toBe(2);
    });

    it("returns 3 for two lines with a trailing newline", () => {
      expect(computeMonacoLineCount("line 1\nline 2\n")).toBe(3);
    });

    it("returns 2 for two lines without a trailing newline", () => {
      expect(computeMonacoLineCount("line 1\nline 2")).toBe(2);
    });
  });

  describe("isBufferOverLimit", () => {
    it("returns false for small buffers", () => {
      expect(isBufferOverLimit("hello world")).toBe(false);
    });

    it("returns true when string length strictly exceeds 5 MiB", () => {
      const huge = "a".repeat(GIT_BLAME_MAX_BUFFER_BYTES + 1);
      expect(isBufferOverLimit(huge)).toBe(true);
    });
  });

  describe("validateBlameResponse", () => {
    const validCommit = {
      hash: "0123456789abcdef0123456789abcdef01234567",
      authorName: "Alice",
      authorEmail: "alice@example.com",
      authorTimestamp: 1760000000,
      authorTimezoneOffsetMinutes: 420,
      subject: "feat: initial commit",
    };

    const validResponse: GitBlameResponse = {
      snapshotId: "snap-1",
      modelVersion: 1,
      rootId: ".",
      rootRelativePath: "src/file.ts",
      baseCommitOid: "0123456789abcdef0123456789abcdef01234567",
      bufferLineCount: 5,
      status: "ready",
      commits: [validCommit],
      ranges: [
        { startLine: 1, lineCount: 3, commitIndex: 0 },
        { startLine: 4, lineCount: 2, commitIndex: null },
      ],
    };

    it("accepts a structurally valid blame response covering 1..bufferLineCount", () => {
      const res = validateBlameResponse(validResponse, {
        expectedSnapshotId: "snap-1",
        expectedModelVersion: 1,
        expectedBufferLineCount: 5,
      });
      expect(res.valid).toBe(true);
    });

    it("rejects commit record missing authorEmail", () => {
      const { authorEmail: _, ...commitWithoutEmail } = validCommit;
      const badResp = {
        ...validResponse,
        commits: [commitWithoutEmail],
      };
      const res = validateBlameResponse(badResp);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toContain("Invalid commit record at index 0");
      }
    });

    it("rejects commit record with non-string authorEmail", () => {
      const badCommit = { ...validCommit, authorEmail: 12345 };
      const badResp = {
        ...validResponse,
        commits: [badCommit],
      };
      const res = validateBlameResponse(badResp);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toContain("Invalid commit record at index 0");
      }
    });

    it("rejects non-object responses", () => {
      expect(validateBlameResponse(null).valid).toBe(false);
      expect(validateBlameResponse("invalid").valid).toBe(false);
    });

    it("rejects mismatched snapshotId", () => {
      const res = validateBlameResponse(validResponse, {
        expectedSnapshotId: "snap-2",
      });
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toContain("Snapshot ID mismatch");
      }
    });

    it("rejects mismatched modelVersion", () => {
      const res = validateBlameResponse(validResponse, {
        expectedModelVersion: 2,
      });
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toContain("Model version mismatch");
      }
    });

    it("rejects mismatched bufferLineCount", () => {
      const res = validateBlameResponse(validResponse, {
        expectedBufferLineCount: 6,
      });
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toContain("Buffer line count mismatch");
      }
    });

    it("accepts empty status with empty ranges", () => {
      const emptyResp: GitBlameResponse = {
        snapshotId: "snap-1",
        modelVersion: 1,
        rootId: ".",
        rootRelativePath: "empty.txt",
        baseCommitOid: null,
        bufferLineCount: 1,
        status: "empty",
        commits: [],
        ranges: [],
      };
      const res = validateBlameResponse(emptyResp);
      expect(res.valid).toBe(true);
    });

    it("accepts uncommitted status when all ranges have commitIndex: null", () => {
      const uncommittedResp: GitBlameResponse = {
        snapshotId: "snap-1",
        modelVersion: 1,
        rootId: ".",
        rootRelativePath: "new.txt",
        baseCommitOid: null,
        bufferLineCount: 3,
        status: "uncommitted",
        commits: [],
        ranges: [{ startLine: 1, lineCount: 3, commitIndex: null }],
      };
      const res = validateBlameResponse(uncommittedResp);
      expect(res.valid).toBe(true);
    });

    it("rejects uncommitted status if a range contains a commitIndex", () => {
      const badUncommitted: GitBlameResponse = {
        snapshotId: "snap-1",
        modelVersion: 1,
        rootId: ".",
        rootRelativePath: "new.txt",
        baseCommitOid: null,
        bufferLineCount: 2,
        status: "uncommitted",
        commits: [validCommit],
        ranges: [
          { startLine: 1, lineCount: 1, commitIndex: 0 },
          { startLine: 2, lineCount: 1, commitIndex: null },
        ],
      };
      const res = validateBlameResponse(badUncommitted);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toContain("Status is uncommitted but range");
      }
    });

    it("rejects range partition gaps", () => {
      const gapResp: GitBlameResponse = {
        ...validResponse,
        ranges: [
          { startLine: 1, lineCount: 2, commitIndex: 0 },
          { startLine: 4, lineCount: 2, commitIndex: null }, // skips line 3!
        ],
      };
      const res = validateBlameResponse(gapResp);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toContain("Range partition gap or overlap");
      }
    });

    it("rejects range partition overlaps", () => {
      const overlapResp: GitBlameResponse = {
        ...validResponse,
        ranges: [
          { startLine: 1, lineCount: 3, commitIndex: 0 },
          { startLine: 3, lineCount: 3, commitIndex: null }, // overlaps line 3!
        ],
      };
      const res = validateBlameResponse(overlapResp);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toContain("Range partition gap or overlap");
      }
    });

    it("rejects out-of-bounds commitIndex", () => {
      const badCommitIdxResp: GitBlameResponse = {
        ...validResponse,
        ranges: [
          { startLine: 1, lineCount: 5, commitIndex: 5 }, // commits has length 1
        ],
      };
      const res = validateBlameResponse(badCommitIdxResp);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toContain("out-of-bounds commitIndex");
      }
    });

    it("rejects incomplete range partition not covering bufferLineCount", () => {
      const incompleteResp: GitBlameResponse = {
        ...validResponse,
        bufferLineCount: 10,
        ranges: [{ startLine: 1, lineCount: 5, commitIndex: 0 }],
      };
      const res = validateBlameResponse(incompleteResp);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.reason).toContain(
          "Range partition covers 5 lines, but bufferLineCount is 10",
        );
      }
    });
  });

  describe("findBlameRangeForLine", () => {
    const ranges = [
      { startLine: 1, lineCount: 3, commitIndex: 0 }, // lines 1, 2, 3
      { startLine: 4, lineCount: 1, commitIndex: null }, // line 4
      { startLine: 5, lineCount: 5, commitIndex: 1 }, // lines 5, 6, 7, 8, 9
    ];

    it("finds ranges for boundaries and middle lines", () => {
      expect(findBlameRangeForLine(ranges, 1)).toEqual(ranges[0]);
      expect(findBlameRangeForLine(ranges, 2)).toEqual(ranges[0]);
      expect(findBlameRangeForLine(ranges, 3)).toEqual(ranges[0]);
      expect(findBlameRangeForLine(ranges, 4)).toEqual(ranges[1]);
      expect(findBlameRangeForLine(ranges, 5)).toEqual(ranges[2]);
      expect(findBlameRangeForLine(ranges, 9)).toEqual(ranges[2]);
    });

    it("returns null for out of bounds lines", () => {
      expect(findBlameRangeForLine(ranges, 0)).toBeNull();
      expect(findBlameRangeForLine(ranges, -1)).toBeNull();
      expect(findBlameRangeForLine(ranges, 10)).toBeNull();
      expect(findBlameRangeForLine([], 1)).toBeNull();
    });
  });

  describe("findCommitForRange", () => {
    const commits = [
      {
        hash: "1111",
        authorName: "Alice",
        authorEmail: "alice@example.com",
        authorTimestamp: 100,
        authorTimezoneOffsetMinutes: 0,
        subject: "commit 1",
      },
      {
        hash: "2222",
        authorName: "Bob",
        authorEmail: "bob@example.com",
        authorTimestamp: 200,
        authorTimezoneOffsetMinutes: 0,
        subject: "commit 2",
      },
    ];
    it("returns commit when commitIndex is valid", () => {
      expect(
        findCommitForRange(commits, {
          startLine: 1,
          lineCount: 1,
          commitIndex: 0,
        }),
      ).toEqual(commits[0]);
      expect(
        findCommitForRange(commits, {
          startLine: 2,
          lineCount: 1,
          commitIndex: 1,
        }),
      ).toEqual(commits[1]);
    });

    it("returns null when range is uncommitted (commitIndex null)", () => {
      expect(
        findCommitForRange(commits, {
          startLine: 1,
          lineCount: 1,
          commitIndex: null,
        }),
      ).toBeNull();
    });

    it("returns null when commitIndex is out of bounds or range is null", () => {
      expect(
        findCommitForRange(commits, {
          startLine: 1,
          lineCount: 1,
          commitIndex: 99,
        }),
      ).toBeNull();
      expect(findCommitForRange(commits, null)).toBeNull();
    });
  });

  describe("findOwningVcsRoot", () => {
    const roots: VcsRoot[] = [
      {
        rootId: ".",
        path: ".",
        absolutePath: "/project",
        kind: "primary",
        warnings: [],
      },
      {
        rootId: "packages/ui",
        path: "packages/ui",
        absolutePath: "/project/packages/ui",
        kind: "nestedRepo",
        warnings: [],
      },
      {
        rootId: "packages/broken",
        path: "packages/broken",
        absolutePath: "/project/packages/broken",
        kind: "submodule",
        mappingState: "missing",
        warnings: [],
      },
    ];

    it("resolves primary root for root files", () => {
      const root = findOwningVcsRoot(roots, "README.md");
      expect(root?.rootId).toBe(".");
    });

    it("resolves deepest matching root for nested subdirectories", () => {
      const root = findOwningVcsRoot(roots, "packages/ui/src/index.ts");
      expect(root?.rootId).toBe("packages/ui");
    });

    it("fails closed (returns null) for missing mapping roots", () => {
      const root = findOwningVcsRoot(roots, "packages/broken/file.txt");
      expect(root).toBeNull();
    });

    it("returns null if roots array is empty", () => {
      expect(findOwningVcsRoot([], "src/file.ts")).toBeNull();
    });
  });

  describe("date formatting helpers", () => {
    it("formats epoch seconds to UTC YYYY-MM-DD", () => {
      // 1760000000 = 2025-10-09T08:53:20Z
      const dateStr = formatBlameDate(1760000000);
      expect(dateStr).toBe("2025-10-09");
    });

    it("formats full timestamp with positive timezone offset", () => {
      // 1760000000 with offset +420 (+0700) -> 2025-10-09 15:53:20 +0700
      const formatted = formatBlameFullTimestamp(1760000000, 420);
      expect(formatted).toBe("2025-10-09 15:53:20 +0700");
    });

    it("formats full timestamp with negative timezone offset", () => {
      // 1760000000 with offset -300 (-0500) -> 2025-10-09 03:53:20 -0500
      const formatted = formatBlameFullTimestamp(1760000000, -300);
      expect(formatted).toBe("2025-10-09 03:53:20 -0500");
    });
  });

  describe("isMatchingGitQueryKey", () => {
    const target = {
      project: "my-project",
      profileId: "server-1",
      worktreePath: null,
    };
    const owner = {
      profileId: "server-1",
      generation: 1,
    };

    it("matches owner-scoped git-diff query key exactly", () => {
      const key = [
        "profile",
        "server-1",
        1,
        "git",
        "git-diff",
        "my-project",
        "root",
      ];
      const res = isMatchingGitQueryKey(key, target, owner);
      expect(res.matches).toBe(true);
      expect(res.prefix).toBe("git-diff");
      expect(res.isDiffMutation).toBe(true);
    });

    it("identifies non-diff git mutations (git-log, branches, git-roots)", () => {
      const logKey = [
        "profile",
        "server-1",
        1,
        "git",
        "git-log",
        "my-project",
        "root",
      ];
      const logRes = isMatchingGitQueryKey(logKey, target, owner);
      expect(logRes.matches).toBe(true);
      expect(logRes.isDiffMutation).toBe(false);

      const branchesKey = [
        "profile",
        "server-1",
        1,
        "git",
        "branches",
        "my-project",
        "root",
      ];
      const branchesRes = isMatchingGitQueryKey(branchesKey, target, owner);
      expect(branchesRes.matches).toBe(true);
      expect(branchesRes.isDiffMutation).toBe(false);
    });

    it("rejects cross-profile queries with the same project name", () => {
      const key = [
        "profile",
        "server-2",
        1,
        "git",
        "git-diff",
        "my-project",
        "root",
      ];
      const res = isMatchingGitQueryKey(key, target, owner);
      expect(res.matches).toBe(false);
    });

    it("rejects stale generation queries for the same profile", () => {
      const key = [
        "profile",
        "server-1",
        0,
        "git",
        "git-diff",
        "my-project",
        "root",
      ];
      const res = isMatchingGitQueryKey(key, target, owner);
      expect(res.matches).toBe(false);
    });

    it("rejects queries for a different project on the same profile", () => {
      const key = [
        "profile",
        "server-1",
        1,
        "git",
        "git-diff",
        "other-project",
        "root",
      ];
      const res = isMatchingGitQueryKey(key, target, owner);
      expect(res.matches).toBe(false);
    });

    it("rejects queries for a different worktree of the same project", () => {
      const key = [
        "profile",
        "server-1",
        1,
        "git",
        "git-diff",
        "my-project",
        "worktree-b",
      ];
      const res = isMatchingGitQueryKey(key, target, owner);
      expect(res.matches).toBe(false);
    });

    it("matches its canonical worktree and root without crossing sibling roots", () => {
      const worktreeTarget = { ...target, worktreePath: "/tmp/feature/" };
      const key = [
        "profile",
        owner.profileId,
        owner.generation,
        "git",
        "git-diff",
        target.project,
        projectTargetCacheKey(worktreeTarget),
        "nested",
      ];
      expect(
        isMatchingGitQueryKey(key, worktreeTarget, owner, "nested").matches,
      ).toBe(true);
      expect(
        isMatchingGitQueryKey(key, worktreeTarget, owner, "other").matches,
      ).toBe(false);
      expect(
        isMatchingGitQueryKey(
          [...key.slice(0, 7), "*"],
          worktreeTarget,
          owner,
          "nested",
        ).matches,
      ).toBe(true);
      expect(
        isMatchingGitQueryKey(
          ["git-diff", target.project, "root"],
          target,
          owner,
        ).matches,
      ).toBe(false);
    });

    it("rejects non-git namespaces (e.g. system, fs)", () => {
      const sysKey = ["profile", "server-1", 1, "system", "metrics"];
      expect(isMatchingGitQueryKey(sysKey, target, owner).matches).toBe(false);

      const fsKey = [
        "profile",
        "server-1",
        1,
        "fs",
        "my-project",
        "root",
        "src/file.ts",
      ];
      expect(isMatchingGitQueryKey(fsKey, target, owner).matches).toBe(false);
    });

    it("matches unowned git query key format", () => {
      const key = ["git-diff", "my-project", "root"];
      const res = isMatchingGitQueryKey(key, target, null);
      expect(res.matches).toBe(true);
      expect(res.isDiffMutation).toBe(true);
    });

    it("rejects invalid or empty keys", () => {
      expect(isMatchingGitQueryKey(null, target, owner).matches).toBe(false);
      expect(isMatchingGitQueryKey([], target, owner).matches).toBe(false);
      expect(isMatchingGitQueryKey("invalid", target, owner).matches).toBe(
        false,
      );
    });
  });
});
