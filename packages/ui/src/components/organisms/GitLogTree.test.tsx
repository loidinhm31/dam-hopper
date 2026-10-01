import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GitLogEntry } from "@/api/client.js";
import {
  GitLogTree,
  getDropCommitMenuState,
  getEditCommitMessageMenuState,
  getUndoLastCommitMenuState,
  isHeadCommit,
} from "./GitLogTree.js";

const sampleLogs: GitLogEntry[] = [
  {
    hash: "a1b2c3d4e5f67890123456789012345678901234",
    parents: ["b2c3d4e5f678901234567890123456789012345a"],
    authorName: "Alice Dev",
    authorEmail: "alice@example.com",
    timestamp: 1727800000,
    message: "feat: add history search",
    refs: ["HEAD -> main", "origin/main"],
    isPushed: true,
  },
  {
    hash: "b2c3d4e5f678901234567890123456789012345a",
    parents: [],
    authorName: "Bob Dev",
    authorEmail: "bob@example.com",
    timestamp: 1727700000,
    message: "chore: initial commit",
    refs: [],
    isPushed: true,
  },
];

describe("GitLogTree helpers", () => {
  it("disables drop commit for pushed commits", () => {
    expect(getDropCommitMenuState({ isPushed: true })).toEqual({
      disabled: true,
      title: "Drop commit is only available for commits not pushed upstream",
    });
    expect(getDropCommitMenuState({ isPushed: false })).toEqual({
      disabled: false,
      title: undefined,
    });
  });

  it("enables Edit Commit Message for both pushed and unpushed commits", () => {
    expect(getEditCommitMessageMenuState({ isPushed: true })).toEqual({
      disabled: false,
      title: undefined,
    });
    expect(getEditCommitMessageMenuState({ isPushed: false })).toEqual({
      disabled: false,
      title: undefined,
    });
  });

  it("enables undo last commit only for HEAD", () => {
    expect(
      getUndoLastCommitMenuState({ isHead: true, isPushed: false }),
    ).toEqual({
      disabled: false,
      title: undefined,
    });
    expect(
      getUndoLastCommitMenuState({ isHead: false, isPushed: false }),
    ).toEqual({
      disabled: true,
      title: "Undo Last Commit is only available on HEAD",
    });
    expect(
      getUndoLastCommitMenuState({ isHead: true, isPushed: true }),
    ).toEqual({
      disabled: true,
      title:
        "Undo Last Commit is only available for commits not pushed upstream",
    });
  });

  it("detects HEAD from commit refs", () => {
    expect(isHeadCommit({ refs: ["HEAD -> main", "origin/main"] })).toBe(true);
    expect(isHeadCommit({ refs: ["HEAD"] })).toBe(true);
    expect(isHeadCommit({ refs: ["origin/main", "tag: v1"] })).toBe(false);
  });
});

describe("GitLogTree presentation modes", () => {
  it("renders graph SVG elements in graph presentation mode", () => {
    const html = renderToStaticMarkup(
      <GitLogTree logs={sampleLogs} presentation="graph" />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain("<circle");
    expect(html).toContain("feat: add history search");
    expect(html).toContain("a1b2c3d");
  });

  it("omits graph SVG and circle elements in list presentation mode", () => {
    const html = renderToStaticMarkup(
      <GitLogTree logs={sampleLogs} presentation="list" />,
    );
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("<circle");
    expect(html).toContain("feat: add history search");
    expect(html).toContain("chore: initial commit");
    expect(html).toContain("a1b2c3d");
    expect(html).toContain("b2c3d4e");
    expect(html).toContain("Alice Dev");
  });

  it("renders custom emptyMessage when logs are empty", () => {
    const html = renderToStaticMarkup(
      <GitLogTree logs={[]} emptyMessage="No matching commits found." />,
    );
    expect(html).toContain("No matching commits found.");
  });

  it("renders default empty message when logs are empty and no emptyMessage passed", () => {
    const html = renderToStaticMarkup(<GitLogTree logs={[]} />);
    expect(html).toContain("No commits found.");
  });
});
