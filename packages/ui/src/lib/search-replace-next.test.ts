import { describe, expect, it, vi } from "vitest";
import type { SearchMatch } from "@/api/fs-types.js";
import {
  resolveSearchMatchTarget,
  runReplaceNext,
  replaceContentSearchMatch,
} from "./search-replace-next.js";
import { sortContentSearchMatches } from "./search-matches.js";

function textResponse(content: string, mtime = 10) {
  return {
    ok: true as const,
    binary: false,
    content: btoa(content),
    mime: "text/plain",
    mtime,
    size: content.length,
  };
}

function match(
  path: string,
  line: number,
  col: number,
  text: string,
): SearchMatch {
  return { path, line, col, text };
}

describe("replaceContentSearchMatch", () => {
  it("replaces exactly one occurrence at the reported line and column", () => {
    const result = replaceContentSearchMatch(
      "needle one\nneedle two\nneedle three\n",
      match("src/demo.ts", 2, 1, "needle two"),
      "needle",
      "token",
      true,
    );

    expect(result).toEqual({
      ok: true,
      content: "needle one\ntoken two\nneedle three\n",
    });
  });

  it("treats stale coordinates as a no-op signal", () => {
    expect(
      replaceContentSearchMatch(
        "hello world\n",
        match("src/demo.ts", 1, 7, "hello world"),
        "planet",
        "earth",
        true,
      ),
    ).toEqual({ ok: false });
  });

  it("verifies case sensitivity before replacing", () => {
    expect(
      replaceContentSearchMatch(
        "Alpha beta\n",
        match("src/demo.ts", 1, 1, "Alpha beta"),
        "alpha",
        "omega",
        true,
      ),
    ).toEqual({ ok: false });

    expect(
      replaceContentSearchMatch(
        "Alpha beta\n",
        match("src/demo.ts", 1, 1, "Alpha beta"),
        "alpha",
        "omega",
        false,
      ),
    ).toEqual({ ok: true, content: "omega beta\n" });
  });

  it("converts UTF-8 byte columns before replacing", () => {
    expect(
      replaceContentSearchMatch(
        "xin chào token\n",
        match("src/demo.ts", 1, 11, "xin chào token"),
        "token",
        "value",
        true,
      ),
    ).toEqual({ ok: true, content: "xin chào value\n" });
  });
});

describe("runReplaceNext", () => {
  it("routes workspace matches to each configured project root", () => {
    const selectedWorktree = {
      project: "alpha",
      worktreePath: "/tmp/alpha-worktree",
    } as const;

    expect(
      resolveSearchMatchTarget(selectedWorktree, "alpha", "workspace"),
    ).toBe("alpha");
    expect(
      resolveSearchMatchTarget(selectedWorktree, "beta", "workspace"),
    ).toBe("beta");
    expect(
      resolveSearchMatchTarget(selectedWorktree, "alpha", "project"),
    ).toEqual(selectedWorktree);
  });

  it("blocks replacement when the target file has an open dirty tab", async () => {
    const openMatch = vi.fn();
    const readFile = vi.fn();
    const writeFile = vi.fn();
    const result = await runReplaceNext({
      currentProject: "alpha",
      matches: [match("src/demo.ts", 1, 1, "needle demo")],
      selectedMatch: null,
      searchQuery: "needle",
      replaceQuery: "token",
      caseSensitive: true,
      hasDirtyOpenTab: () => true,
      openMatch,
      readFile,
      writeFile,
      refreshMatches: vi.fn(async () => []),
    });

    expect(result.kind).toBe("blocked-dirty");
    expect(openMatch).toHaveBeenCalledTimes(1);
    expect(readFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("refreshes and advances when the stored match is stale", async () => {
    const matches = sortContentSearchMatches([
      match("src/demo.ts", 1, 1, "needle one"),
      match("src/demo.ts", 2, 1, "needle two"),
    ]);

    const refreshedMatches = sortContentSearchMatches([
      match("src/demo.ts", 2, 1, "needle two"),
    ]);

    const result = await runReplaceNext({
      currentProject: "alpha",
      matches,
      selectedMatch: matches[0]!,
      searchQuery: "needle",
      replaceQuery: "token",
      caseSensitive: true,
      hasDirtyOpenTab: () => false,
      openMatch: vi.fn(),
      readFile: vi.fn(async () => textResponse("moved one\nneedle two\n")),
      writeFile: vi.fn(),
      refreshMatches: vi.fn(async () => refreshedMatches),
    });

    expect(result).toEqual({
      kind: "stale",
      nextMatch: refreshedMatches[0],
      message: "That match moved or changed. Search results were refreshed.",
    });
  });

  it("replaces, refetches, and advances to the next remaining match", async () => {
    const matches = sortContentSearchMatches([
      {
        project: "alpha",
        path: "src/demo.ts",
        line: 1,
        col: 1,
        text: "needle one",
      },
      {
        project: "beta",
        path: "src/demo.ts",
        line: 1,
        col: 1,
        text: "needle two",
      },
    ]);
    const refreshedMatches = sortContentSearchMatches([
      {
        project: "beta",
        path: "src/demo.ts",
        line: 1,
        col: 1,
        text: "needle two",
      },
    ]);
    const writeFile = vi.fn(async () => ({ ok: true as const, newMtime: 11 }));
    const reloadOpenTab = vi.fn(async () => undefined);

    const result = await runReplaceNext({
      currentProject: "alpha",
      matches,
      selectedMatch: matches[0]!,
      searchQuery: "needle",
      replaceQuery: "token",
      caseSensitive: true,
      hasDirtyOpenTab: () => false,
      openMatch: vi.fn(),
      readFile: vi.fn(async () => textResponse("needle one\n", 10)),
      writeFile,
      refreshMatches: vi.fn(async () => refreshedMatches),
      reloadOpenTab,
    });

    expect(writeFile).toHaveBeenCalledWith(
      "alpha",
      "src/demo.ts",
      "token one\n",
      10,
    );
    expect(reloadOpenTab).toHaveBeenCalledWith("alpha", "src/demo.ts");
    expect(result).toEqual({
      kind: "replaced",
      nextMatch: refreshedMatches[0],
    });
  });

  it("uses the current project when project-scope matches omit a project name", async () => {
    const writeFile = vi.fn(async () => ({ ok: true as const, newMtime: 11 }));

    await runReplaceNext({
      currentProject: "alpha",
      matches: [match("src/demo.ts", 1, 1, "needle one")],
      selectedMatch: null,
      searchQuery: "needle",
      replaceQuery: "token",
      caseSensitive: true,
      hasDirtyOpenTab: () => false,
      openMatch: vi.fn(),
      readFile: vi.fn(async () => textResponse("needle one\n", 10)),
      writeFile,
      refreshMatches: vi.fn(async () => []),
    });

    expect(writeFile).toHaveBeenCalledWith(
      "alpha",
      "src/demo.ts",
      "token one\n",
      10,
    );
  });
});
