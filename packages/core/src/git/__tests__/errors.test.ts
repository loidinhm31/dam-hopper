import { describe, it, expect } from "vitest";
import { classifyGitError, GitError, wrapGitError } from "../errors.js";

describe("classifyGitError", () => {
  it("classifies network errors", () => {
    expect(
      classifyGitError(new Error("Could not resolve host: github.com")),
    ).toBe("network");
    expect(classifyGitError(new Error("Connection refused"))).toBe("network");
  });

  it("classifies auth errors", () => {
    expect(classifyGitError(new Error("Permission denied (publickey)"))).toBe(
      "auth",
    );
    expect(
      classifyGitError(
        new Error("Authentication failed for 'https://github.com'"),
      ),
    ).toBe("auth");
  });

  it("classifies conflict errors", () => {
    expect(
      classifyGitError(
        new Error("CONFLICT (content): Merge conflict in file.txt"),
      ),
    ).toBe("conflict");
    expect(
      classifyGitError(
        new Error("not possible because you have unmerged files"),
      ),
    ).toBe("conflict");
  });

  it("classifies lock errors", () => {
    expect(
      classifyGitError(new Error("Unable to create '.git/index.lock'")),
    ).toBe("lock");
    expect(
      classifyGitError(new Error("fatal: Unable to create lock file")),
    ).toBe("lock");
  });

  it("classifies not_repo errors", () => {
    expect(
      classifyGitError(
        new Error(
          "fatal: not a git repository (or any of the parent directories)",
        ),
      ),
    ).toBe("not_repo");
  });

  it("falls back to unknown", () => {
    expect(classifyGitError(new Error("some unexpected error"))).toBe(
      "unknown",
    );
  });
});

describe("GitError", () => {
  it("has correct properties", () => {
    const err = new GitError("fetch failed", "network", "my-project");
    expect(err.name).toBe("GitError");
    expect(err.category).toBe("network");
    expect(err.projectName).toBe("my-project");
    expect(err.message).toBe("fetch failed");
    expect(err instanceof Error).toBe(true);
  });
});

describe("wrapGitError", () => {
  it("wraps plain Error", () => {
    const wrapped = wrapGitError(new Error("not a git repository"), "proj");
    expect(wrapped).toBeInstanceOf(GitError);
    expect(wrapped.category).toBe("not_repo");
  });

  it("passes through existing GitError", () => {
    const original = new GitError("auth", "auth", "proj");
    expect(wrapGitError(original, "proj")).toBe(original);
  });

  it("wraps non-Error values", () => {
    const wrapped = wrapGitError("something went wrong", "proj");
    expect(wrapped).toBeInstanceOf(GitError);
    expect(wrapped.message).toBe("something went wrong");
  });
});
