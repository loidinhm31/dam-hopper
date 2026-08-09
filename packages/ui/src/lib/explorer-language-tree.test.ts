import { describe, expect, it } from "vitest";
import type { LanguageFile } from "@/api/fs-types.js";
import {
  buildExplorerLanguageTree,
  normalizeExplorerLanguagePath,
} from "./explorer-language-tree.js";

const files: LanguageFile[] = [
  { path: "src/z.ts", size: 12, mtime: 20, language: "javascript-typescript" },
  { path: "src/a.ts", size: 11, mtime: 19, language: "javascript-typescript" },
  { path: "src/lib/main.rs", size: 42, mtime: 30, language: "rust" },
  {
    path: ".github/workflows/check.ts",
    size: 2,
    mtime: 10,
    language: "javascript-typescript",
  },
  {
    path: "src/.generated/hidden.ts",
    size: 3,
    mtime: 11,
    language: "javascript-typescript",
  },
];

describe("explorer language tree", () => {
  it("rejects unsafe paths while preserving literal Unix backslashes", () => {
    expect(normalizeExplorerLanguagePath("src\\main.ts")).toEqual([
      "src\\main.ts",
    ]);
    expect(normalizeExplorerLanguagePath("/tmp/main.ts")).toBeNull();
    expect(normalizeExplorerLanguagePath("src//main.ts")).toBeNull();
    expect(normalizeExplorerLanguagePath("src/../main.ts")).toBeNull();
    expect(normalizeExplorerLanguagePath("./main.ts")).toBeNull();
    expect(normalizeExplorerLanguagePath("C:\\outside.ts")).toBeNull();
  });

  it("keeps a literal backslash in the file ID and open metadata", () => {
    const tree = buildExplorerLanguageTree(
      [
        {
          path: "source\\module.rs",
          size: 4,
          mtime: 2,
          language: "rust",
        },
      ],
      "rust",
      true,
    );
    expect(tree[0]).toMatchObject({
      id: "source\\module.rs",
      name: "source\\module.rs",
      size: 4,
      mtime: 2,
    });
  });

  it("filters by family, hides any hidden path segment, and sorts directories first", () => {
    const tree = buildExplorerLanguageTree(
      files,
      "javascript-typescript",
      false,
    );
    expect(tree.map((node) => node.id)).toEqual(["src"]);
    expect(tree[0]?.children?.map((node) => node.id)).toEqual([
      "src/a.ts",
      "src/z.ts",
    ]);
  });

  it("includes hidden paths and preserves exact file metadata", () => {
    const source = files.map((file) => ({ ...file }));
    const tree = buildExplorerLanguageTree(
      source,
      "javascript-typescript",
      true,
    );
    expect(tree.map((node) => node.id)).toEqual([".github", "src"]);
    const githubFile = tree[0]?.children?.[0]?.children?.[0];
    expect(githubFile).toEqual({
      id: ".github/workflows/check.ts",
      name: "check.ts",
      kind: "file",
      size: 2,
      mtime: 10,
      isSymlink: false,
      children: null,
    });
    expect(source).toEqual(files);
  });

  it("keeps duplicate results deterministic without changing metadata", () => {
    const tree = buildExplorerLanguageTree(
      [
        { path: "main.rs", size: 8, mtime: 1, language: "rust" },
        { path: "main.rs", size: 99, mtime: 2, language: "rust" },
      ],
      "rust",
      true,
    );
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ id: "main.rs", size: 8, mtime: 1 });
  });

  it("uses locale-independent ordering for sibling names", () => {
    const tree = buildExplorerLanguageTree(
      [
        { path: "z.ts", size: 1, mtime: 1, language: "javascript-typescript" },
        { path: "A.ts", size: 1, mtime: 1, language: "javascript-typescript" },
        { path: "a.ts", size: 1, mtime: 1, language: "javascript-typescript" },
      ],
      "javascript-typescript",
      true,
    );
    expect(tree.map((node) => node.name)).toEqual(["A.ts", "a.ts", "z.ts"]);
  });
});
