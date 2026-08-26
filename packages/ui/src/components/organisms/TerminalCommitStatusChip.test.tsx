import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GitStatus } from "@/api/client.js";

const queryState = vi.hoisted(() => ({
  data: undefined as GitStatus | null | undefined,
  isLoading: false,
  isError: false,
}));
const useProjectStatus = vi.hoisted(() => vi.fn(() => queryState));

vi.mock("@/api/queries.js", () => ({ useProjectStatus }));

import { TerminalCommitStatusChip } from "./TerminalCommitStatusChip.js";

const status: GitStatus = {
  projectName: "demo",
  branch: "feature/terminal-status",
  isClean: true,
  ahead: 0,
  behind: 0,
  staged: 0,
  modified: 0,
  untracked: 0,
  hasStash: false,
  lastCommit: {
    hash: "1234567890abcdef",
    message: "Move commit context into the terminal header",
    date: "Mon, 26 Jul 2026 12:30:00 +0000",
  },
};

function render(enabled = true, project = "demo") {
  return renderToStaticMarkup(
    <TerminalCommitStatusChip enabled={enabled} project={project} />,
  );
}

describe("TerminalCommitStatusChip", () => {
  it("uses a project-scoped query only when enabled", () => {
    queryState.data = undefined;
    queryState.isLoading = false;
    queryState.isError = false;

    render(false);

    expect(useProjectStatus).toHaveBeenLastCalledWith("demo", false);
  });

  it("renders the complete latest commit summary in a compact chip", () => {
    queryState.data = status;
    queryState.isLoading = false;
    queryState.isError = false;

    const markup = render();

    expect(markup).toContain("feature/terminal-status");
    expect(markup).toContain("Move commit context into the terminal header");
    expect(markup).toContain("1234567");
    expect(markup).toContain('title="1234567890abcdef"');
    expect(markup).toContain('title="Mon, 26 Jul 2026 12:30:00 +0000"');
  });

  it("hides invalid, empty, and unavailable Git status", () => {
    queryState.data = { ...status, statusError: "unavailable" };
    expect(render()).toBe("");

    queryState.data = { ...status, pathExists: false };
    expect(render()).toBe("");

    queryState.data = {
      ...status,
      lastCommit: { hash: "", message: "", date: "" },
    };
    expect(render()).toBe("");

    queryState.data = {
      ...status,
      lastCommit: { ...status.lastCommit, date: "not a date" },
    };
    expect(render()).toBe("");
  });
});
