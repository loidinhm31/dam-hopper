import { describe, expect, it } from "vitest";
import type { DiffFileEntry } from "@/api/client.js";
import {
  createChangedFileSelection,
  groupedByRoot,
  projectPathForEntry,
  stagedRootIdsForEntries,
} from "./ChangedFilesList.js";

function entry(partial: Partial<DiffFileEntry>): DiffFileEntry {
  return {
    path: "README.md",
    status: "modified",
    staged: false,
    additions: 1,
    deletions: 0,
    ...partial,
  };
}

describe("ChangedFilesList VCS root helpers", () => {
  it("converts root-relative child paths to project-relative paths", () => {
    expect(
      projectPathForEntry(
        entry({ path: "README.md", rootId: "modules/child" }),
      ),
    ).toBe("modules/child/README.md");

    expect(
      projectPathForEntry(
        entry({ path: "modules/child/README.md", rootId: "modules/child" }),
      ),
    ).toBe("modules/child/README.md");

    expect(projectPathForEntry(entry({ path: "package.json" }))).toBe(
      "package.json",
    );
  });

  it("groups aggregate diff entries by VCS root with primary first", () => {
    const groups = groupedByRoot([
      entry({ path: "child.ts", rootId: "modules/child" }),
      entry({ path: "app.ts", rootId: "." }),
    ]);

    expect(groups.map(([rootId]) => rootId)).toEqual([".", "modules/child"]);
  });

  it("detects mixed-root staged commits", () => {
    expect(
      stagedRootIdsForEntries([
        entry({ path: "app.ts", rootId: ".", staged: true }),
        entry({ path: "child.ts", rootId: "modules/child", staged: true }),
        entry({ path: "notes.md", rootId: "modules/child", staged: false }),
      ]),
    ).toEqual([".", "modules/child"]);
  });

  it("retains diff metadata for deleted, conflicted, and child-root files", () => {
    expect(
      createChangedFileSelection(
        entry({
          path: "removed.ts",
          status: "deleted",
          additions: 0,
          deletions: 12,
        }),
      ),
    ).toMatchObject({
      projectPath: "removed.ts",
      status: "deleted",
      additions: 0,
      deletions: 12,
      gitRootId: ".",
      diffPath: "removed.ts",
    });

    expect(
      createChangedFileSelection(
        entry({
          path: "src/conflict.ts",
          status: "conflicted",
          additions: 4,
          deletions: 3,
          rootId: "packages/app",
        }),
      ),
    ).toMatchObject({
      projectPath: "packages/app/src/conflict.ts",
      status: "conflicted",
      additions: 4,
      deletions: 3,
      gitRootId: "packages/app",
      diffPath: "src/conflict.ts",
    });
  });
});
