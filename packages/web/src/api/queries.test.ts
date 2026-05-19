import { beforeEach, describe, expect, it, vi } from "vitest";

const reconcileGitMutationFiles = vi.fn();
const reconcileGitProjectFiles = vi.fn();

vi.mock("@/stores/editor.js", () => ({
  useEditorStore: {
    getState: () => ({ reconcileGitMutationFiles, reconcileGitProjectFiles }),
  },
}));

import {
  invalidateGitBranchOperation,
  invalidateGitFileOperation,
  invalidateGitHistoryOperation,
} from "./queries.js";

function makeQueryClient() {
  return {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Git query invalidation scopes", () => {
  beforeEach(() => {
    reconcileGitMutationFiles.mockReset();
    reconcileGitProjectFiles.mockReset();
    reconcileGitMutationFiles.mockResolvedValue(undefined);
    reconcileGitProjectFiles.mockResolvedValue(undefined);
  });

  it("invalidates only file-local Git queries and reconciles the affected editor tab", async () => {
    const qc = makeQueryClient();

    await invalidateGitFileOperation(qc, "demo", "src/app.ts");

    expect(qc.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["git-diff", "demo"] }],
      [{ queryKey: ["git-file-diff", "demo", "src/app.ts"] }],
      [{ queryKey: ["project-status", "demo"] }],
    ]);
    expect(reconcileGitMutationFiles).toHaveBeenCalledWith("demo", [
      "src/app.ts",
    ]);
  });

  it("invalidates history-local Git queries without branch or file tree refresh", async () => {
    const qc = makeQueryClient();

    await invalidateGitHistoryOperation(qc, "demo", [
      "src/app.ts",
      "README.md",
    ]);

    expect(qc.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["git-diff", "demo"] }],
      [{ queryKey: ["git-conflicts", "demo"] }],
      [{ queryKey: ["project-status", "demo"] }],
      [{ queryKey: ["git-file-diff", "demo", "src/app.ts"] }],
      [{ queryKey: ["git-file-diff", "demo", "README.md"] }],
    ]);
    expect(reconcileGitMutationFiles).toHaveBeenCalledWith("demo", [
      "src/app.ts",
      "README.md",
    ]);
  });

  it("invalidates branch-history queries for operations that can rewrite the tree", async () => {
    const qc = makeQueryClient();

    await invalidateGitBranchOperation(qc, "demo");

    expect(qc.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["branches", "demo"] }],
      [{ queryKey: ["project-status", "demo"] }],
      [{ queryKey: ["projects"] }],
      [{ queryKey: ["git-log", "demo"] }],
      [{ queryKey: ["git-diff", "demo"] }],
      [{ queryKey: ["git-conflicts", "demo"] }],
      [{ queryKey: ["fs-tree", "demo"] }],
    ]);
    expect(reconcileGitProjectFiles).toHaveBeenCalledWith("demo");
  });
});
