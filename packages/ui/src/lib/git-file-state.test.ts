import { describe, expect, it } from "vitest";
import type { DiffFileEntry } from "@/api/client.js";
import {
  buildGitFileStateIndex,
  gitStatusShortLabel,
  projectPathForGitEntry,
} from "./git-file-state.js";

function entry(partial: Partial<DiffFileEntry>): DiffFileEntry {
  return {
    path: "src/app.ts",
    status: "modified",
    staged: false,
    additions: 1,
    deletions: 0,
    ...partial,
  };
}

describe("git file state normalization", () => {
  it("normalizes unstaged-only files", () => {
    const index = buildGitFileStateIndex([entry({ staged: false })]);
    const state = index.files.get("src/app.ts");

    expect(state?.stagedState).toBe("unstaged");
    expect(state?.status).toBe("modified");
    expect(state?.additions).toBe(1);
  });

  it("normalizes staged-only files", () => {
    const index = buildGitFileStateIndex([entry({ staged: true })]);

    expect(index.files.get("src/app.ts")?.stagedState).toBe("staged");
  });

  it("merges duplicate staged and unstaged entries by project path", () => {
    const index = buildGitFileStateIndex([
      entry({ staged: true, additions: 2 }),
      entry({ staged: false, deletions: 3 }),
    ]);
    const state = index.files.get("src/app.ts");

    expect(state?.stagedState).toBe("mixed");
    expect(state?.additions).toBe(3);
    expect(state?.deletions).toBe(3);
    expect(gitStatusShortLabel(state!)).toBe("±");
  });

  it("tracks conflicts as the highest-priority state", () => {
    const index = buildGitFileStateIndex([
      entry({ status: "modified" }),
      entry({ status: "conflicted", staged: true }),
    ]);
    const state = index.files.get("src/app.ts");

    expect(state?.status).toBe("conflicted");
    expect(state?.hasConflict).toBe(true);
    expect(gitStatusShortLabel(state!)).toBe("!");
  });

  it("maps submodule root-relative paths to project-relative paths", () => {
    const source = entry({ path: "lib.rs", rootId: "modules/child" });
    const index = buildGitFileStateIndex([source]);
    const state = index.files.get("modules/child/lib.rs");

    expect(projectPathForGitEntry(source)).toBe("modules/child/lib.rs");
    expect(state?.path).toBe("modules/child/lib.rs");
    expect(state?.rootRelativePath).toBe("lib.rs");
  });

  it("records changed ancestor folders", () => {
    const index = buildGitFileStateIndex([
      entry({ path: "src/features/git/file.ts" }),
    ]);

    expect(index.changedDirs.has("src")).toBe(true);
    expect(index.changedDirs.has("src/features")).toBe(true);
    expect(index.changedDirs.has("src/features/git")).toBe(true);
  });
});
