import { describe, expect, it, vi } from "vitest";
import {
  findNodeById,
  getAncestorDirectoryIds,
  revealFileTreePath,
  type FileTreeRevealRequest,
} from "./file-tree-reveal.js";
import type { FsArborNode } from "@/api/fs-types.js";

function file(id: string): FsArborNode {
  return {
    id,
    name: id.split("/").pop() ?? id,
    kind: "file",
    size: 1,
    mtime: 0,
    isSymlink: false,
    children: null,
  };
}

function dir(id: string, children: FsArborNode[] | null = null): FsArborNode {
  return {
    id,
    name: id.split("/").pop() ?? id,
    kind: "dir",
    size: 0,
    mtime: 0,
    isSymlink: false,
    children,
  };
}

describe("file-tree-reveal", () => {
  it("collects ancestor directories from root to leaf parent", () => {
    expect(getAncestorDirectoryIds("src/components/FileTree.tsx")).toEqual([
      "src",
      "src/components",
    ]);
  });

  it("loads unloaded ancestors in order and focuses the target node", async () => {
    const loadChildren = vi.fn(async (nodeId: string) => {
      if (nodeId === "src") return [dir("src/components", null)];
      if (nodeId === "src/components") {
        return [file("src/components/FileTree.tsx")];
      }
      return [];
    });
    const tree = {
      openParents: vi.fn(),
      select: vi.fn(),
      focus: vi.fn(),
      scrollTo: vi.fn(),
    };

    await expect(
      revealFileTreePath({
        path: "src/components/FileTree.tsx",
        nodes: [dir("src", null)],
        tree,
        loadChildren,
      }),
    ).resolves.toBe(true);

    expect(loadChildren).toHaveBeenNthCalledWith(1, "src");
    expect(loadChildren).toHaveBeenNthCalledWith(2, "src/components");
    expect(tree.openParents).toHaveBeenCalledWith("src/components/FileTree.tsx");
    expect(tree.select).toHaveBeenCalledWith("src/components/FileTree.tsx");
    expect(tree.focus).toHaveBeenCalledWith("src/components/FileTree.tsx", {
      scroll: false,
    });
    expect(tree.scrollTo).toHaveBeenCalledWith("src/components/FileTree.tsx");
  });

  it("re-runs safely for repeated same-path requests", async () => {
    const nodes = [dir("src", [file("src/app.ts")])];
    const tree = {
      openParents: vi.fn(),
      select: vi.fn(),
      focus: vi.fn(),
      scrollTo: vi.fn(),
    };

    await revealFileTreePath({
      path: "src/app.ts",
      nodes,
      tree,
      loadChildren: vi.fn(async () => []),
    });
    await revealFileTreePath({
      path: "src/app.ts",
      nodes,
      tree,
      loadChildren: vi.fn(async () => []),
    });

    expect(tree.scrollTo).toHaveBeenCalledTimes(2);
    expect(tree.focus).toHaveBeenCalledTimes(2);
  });

  it("waits for a committed lazy-child render before focusing", async () => {
    let releaseCommit: (() => void) | undefined;
    const tree = {
      openParents: vi.fn(),
      select: vi.fn(),
      focus: vi.fn(),
      scrollTo: vi.fn(),
    };
    const reveal = revealFileTreePath({
      path: "src/app.ts",
      nodes: [dir("src", null)],
      tree,
      loadChildren: vi.fn(async () => [file("src/app.ts")]),
      getTreeCommitVersion: () => 4,
      waitForTreeCommitAfter: vi.fn(
        () => new Promise<void>((resolve) => (releaseCommit = resolve)),
      ),
    });

    await Promise.resolve();
    expect(tree.focus).not.toHaveBeenCalled();
    releaseCommit?.();
    await expect(reveal).resolves.toBe(true);
    expect(tree.focus).toHaveBeenCalledWith("src/app.ts", { scroll: false });
  });

  it("no-ops safely when the target node cannot be found", async () => {
    const tree = {
      openParents: vi.fn(),
      select: vi.fn(),
      focus: vi.fn(),
      scrollTo: vi.fn(),
    };

    await expect(
      revealFileTreePath({
        path: "src/missing.ts",
        nodes: [dir("src", [])],
        tree,
        loadChildren: vi.fn(async () => []),
      }),
    ).resolves.toBe(false);

    expect(tree.openParents).not.toHaveBeenCalled();
    expect(tree.select).not.toHaveBeenCalled();
    expect(tree.focus).not.toHaveBeenCalled();
    expect(tree.scrollTo).not.toHaveBeenCalled();
  });

  it("finds nested nodes by id", () => {
    const nodes = [dir("src", [dir("src/lib", [file("src/lib/a.ts")])])];

    expect(findNodeById(nodes, "src/lib/a.ts")?.name).toBe("a.ts");
    expect(findNodeById(nodes, "src/lib/missing.ts")).toBeNull();
  });

  it("keeps reveal requests retriggerable by nonce", () => {
    const first: FileTreeRevealRequest = {
      project: "alpha",
      path: "src/app.ts",
      nonce: 1,
    };
    const second: FileTreeRevealRequest = {
      project: "alpha",
      path: "src/app.ts",
      nonce: 2,
    };

    expect(first).not.toEqual(second);
  });
});
