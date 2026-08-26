import { describe, expect, it } from "vitest";
import { normalizeProjectTargetPath } from "./project-target-path.js";

describe("normalizeProjectTargetPath", () => {
  it("preserves literal backslashes in POSIX filenames", () => {
    const literalBackslash = "/tmp/worktree/feature\\name";

    expect(normalizeProjectTargetPath(literalBackslash)).toBe(literalBackslash);
    expect(normalizeProjectTargetPath(literalBackslash)).not.toBe(
      normalizeProjectTargetPath("/tmp/worktree/feature/name"),
    );
  });

  it("still aliases explicit Windows drive and UNC spellings", () => {
    expect(
      normalizeProjectTargetPath(String.raw`C:\\Users\\Demo\\Project`),
    ).toBe(normalizeProjectTargetPath("c:/users/demo/project"));
    expect(
      normalizeProjectTargetPath(String.raw`\\\\Server\\Share\\Project`),
    ).toBe(normalizeProjectTargetPath("//server/share/project"));
  });
});
