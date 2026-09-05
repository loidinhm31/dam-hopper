import { describe, expect, it } from "vitest";
import { buildTreeCopyPaths, joinRelativePath } from "./tree-copy-paths.js";

describe("joinRelativePath", () => {
  it("returns the node id when subPath is empty", () => {
    expect(joinRelativePath("", "src/index.ts")).toBe("src/index.ts");
  });

  it("prefixes subPath for subdirectory views", () => {
    expect(joinRelativePath("src", "index.ts")).toBe("src/index.ts");
  });

  it("ignores dot-only segments", () => {
    expect(joinRelativePath(".", ".")).toBe("");
  });

  it("trims leading and trailing slashes", () => {
    expect(joinRelativePath("/src/", "/index.ts")).toBe("src/index.ts");
  });
});

describe("buildTreeCopyPaths", () => {
  it("builds absolute and relative for a root-level file", () => {
    expect(
      buildTreeCopyPaths({
        projectRoot: "/home/u/proj",
        subPath: "",
        nodeId: "package.json",
      }),
    ).toEqual({
      absolutePath: "/home/u/proj/package.json",
      relativePath: "package.json",
    });
  });

  it("builds paths for a nested file", () => {
    expect(
      buildTreeCopyPaths({
        projectRoot: "/home/u/proj",
        subPath: "",
        nodeId: "src/index.ts",
      }),
    ).toEqual({
      absolutePath: "/home/u/proj/src/index.ts",
      relativePath: "src/index.ts",
    });
  });

  it("prefixes subPath in subdirectory views", () => {
    expect(
      buildTreeCopyPaths({
        projectRoot: "/home/u/proj",
        subPath: "src",
        nodeId: "index.ts",
      }),
    ).toEqual({
      absolutePath: "/home/u/proj/src/index.ts",
      relativePath: "src/index.ts",
    });
  });

  it("returns the project root when nodeId is the dot root", () => {
    expect(
      buildTreeCopyPaths({
        projectRoot: "/home/u/proj",
        subPath: "",
        nodeId: ".",
      }),
    ).toEqual({
      absolutePath: "/home/u/proj",
      relativePath: "",
    });
  });

  it("handles an empty project root by falling back to the relative path", () => {
    expect(
      buildTreeCopyPaths({
        projectRoot: "",
        subPath: "",
        nodeId: "package.json",
      }),
    ).toEqual({
      absolutePath: "package.json",
      relativePath: "package.json",
    });
  });

  it("trims trailing slashes from the project root", () => {
    expect(
      buildTreeCopyPaths({
        projectRoot: "/home/u/proj/",
        subPath: "",
        nodeId: "a.ts",
      }),
    ).toEqual({
      absolutePath: "/home/u/proj/a.ts",
      relativePath: "a.ts",
    });
  });

  it("uses native backslash separator for Windows project roots", () => {
    expect(
      buildTreeCopyPaths({
        projectRoot: "D:\\repos\\proj",
        subPath: "",
        nodeId: "src/index.ts",
      }),
    ).toEqual({
      absolutePath: "D:\\repos\\proj\\src\\index.ts",
      relativePath: "src/index.ts",
    });
  });

  it("prefixes subPath with native separator on Windows subdirectory views", () => {
    expect(
      buildTreeCopyPaths({
        projectRoot: "D:\\repos\\proj",
        subPath: "src",
        nodeId: "index.ts",
      }),
    ).toEqual({
      absolutePath: "D:\\repos\\proj\\src\\index.ts",
      relativePath: "src/index.ts",
    });
  });
});
