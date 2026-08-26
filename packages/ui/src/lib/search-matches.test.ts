import { describe, expect, it } from "vitest";
import type { PathSearchMatch, SearchMatch } from "@/api/fs-types.js";
import {
  findNextContentSearchMatch,
  groupContentSearchMatches,
  sortContentSearchMatches,
  sortPathSearchMatches,
} from "./search-matches.js";

describe("search match utilities", () => {
  it("sorts content matches by project, path, line, and column", () => {
    const matches: SearchMatch[] = [
      { project: "beta", path: "src/b.ts", line: 3, col: 8, text: "bbb" },
      { project: "alpha", path: "src/a.ts", line: 8, col: 2, text: "aaa" },
      { project: "alpha", path: "src/a.ts", line: 3, col: 9, text: "aaa" },
      { project: "alpha", path: "src/a.ts", line: 3, col: 1, text: "aaa" },
    ];

    expect(sortContentSearchMatches(matches)).toEqual([
      { project: "alpha", path: "src/a.ts", line: 3, col: 1, text: "aaa" },
      { project: "alpha", path: "src/a.ts", line: 3, col: 9, text: "aaa" },
      { project: "alpha", path: "src/a.ts", line: 8, col: 2, text: "aaa" },
      { project: "beta", path: "src/b.ts", line: 3, col: 8, text: "bbb" },
    ]);
  });

  it("sorts filename matches by project then path", () => {
    const matches: PathSearchMatch[] = [
      { project: "beta", path: "src/b.ts" },
      { project: "alpha", path: "src/z.ts" },
      { project: "alpha", path: "src/a.ts" },
    ];

    expect(sortPathSearchMatches(matches)).toEqual([
      { project: "alpha", path: "src/a.ts" },
      { project: "alpha", path: "src/z.ts" },
      { project: "beta", path: "src/b.ts" },
    ]);
  });

  it("groups sorted content matches by project and path", () => {
    const matches = sortContentSearchMatches([
      { project: "alpha", path: "src/a.ts", line: 1, col: 1, text: "aaa" },
      { project: "alpha", path: "src/a.ts", line: 2, col: 1, text: "bbb" },
      { project: "beta", path: "src/a.ts", line: 1, col: 1, text: "ccc" },
    ]);

    expect(groupContentSearchMatches(matches)).toEqual([
      {
        key: "alpha:src/a.ts",
        path: "src/a.ts",
        project: "alpha",
        matches: [
          { project: "alpha", path: "src/a.ts", line: 1, col: 1, text: "aaa" },
          { project: "alpha", path: "src/a.ts", line: 2, col: 1, text: "bbb" },
        ],
      },
      {
        key: "beta:src/a.ts",
        path: "src/a.ts",
        project: "beta",
        matches: [
          { project: "beta", path: "src/a.ts", line: 1, col: 1, text: "ccc" },
        ],
      },
    ]);
  });

  it("finds the next remaining match after a replaced target", () => {
    const matches = sortContentSearchMatches([
      { project: "alpha", path: "src/a.ts", line: 1, col: 1, text: "aaa" },
      { project: "alpha", path: "src/a.ts", line: 3, col: 4, text: "bbb" },
      { project: "beta", path: "src/a.ts", line: 1, col: 1, text: "ccc" },
    ]);

    expect(findNextContentSearchMatch(matches, matches[0])).toEqual(matches[1]);
    expect(findNextContentSearchMatch(matches, matches[2])).toBeNull();
    expect(findNextContentSearchMatch(matches, null)).toEqual(matches[0]);
  });
});
