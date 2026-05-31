import { describe, expect, it } from "vitest";
import type { GitLineChange } from "@/api/client.js";
import {
  findGitLineChangeAtLine,
  gitLineChangesToDecorationDescriptors,
} from "./git-line-decorations.js";

const changes: GitLineChange[] = [
  {
    kind: "added",
    line: 4,
    length: 2,
    oldStart: 3,
    oldLines: 0,
    newStart: 4,
    newLines: 2,
  },
  {
    kind: "deleted",
    line: 8,
    length: 1,
    oldStart: 9,
    oldLines: 1,
    newStart: 8,
    newLines: 0,
  },
];

describe("git line decoration descriptors", () => {
  it("converts line changes into Monaco-friendly descriptor data", () => {
    const descriptors = gitLineChangesToDecorationDescriptors(changes);

    expect(descriptors[0]).toMatchObject({
      kind: "added",
      startLineNumber: 4,
      endLineNumber: 5,
      className: "git-line-change git-line-change-added",
      glyphMarginClassName: "git-glyph-change git-glyph-change-added",
    });
    expect(descriptors[1].hoverMessage).toContain("+0 -1");
  });

  it("finds changes by visible editor line", () => {
    expect(findGitLineChangeAtLine(changes, 5)?.kind).toBe("added");
    expect(findGitLineChangeAtLine(changes, 8)?.kind).toBe("deleted");
    expect(findGitLineChangeAtLine(changes, 6)).toBeNull();
  });
});
