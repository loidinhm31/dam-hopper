// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffResult } from "@/api/client.js";

const queryState: { data?: GitDiffResult; isLoading: boolean } = {
  isLoading: false,
};

const mutation = {
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
};

vi.mock("@/api/queries.js", () => ({
  useGitDiff: () => ({ ...queryState, refetch: vi.fn() }),
  useGitStage: () => mutation,
  useGitUnstage: () => mutation,
  useGitDiscard: () => mutation,
  useGitCommit: () => mutation,
}));

import { GitLocalChanges } from "./GitLocalChanges.js";

beforeEach(() => {
  queryState.data = undefined;
  queryState.isLoading = false;
});

describe("GitLocalChanges", () => {
  it("renders unavailable Git without mutation controls", () => {
    queryState.data = {
      gitAvailable: false,
      code: "GIT_NOT_INITIALIZED",
      entries: [],
      untrackedTruncated: false,
      untrackedTotal: 0,
    };

    const markup = renderToStaticMarkup(<GitLocalChanges project="demo" />);

    expect(markup).toContain("Git is not initialized for this project");
    expect(markup).not.toContain("No local changes");
    expect(markup).not.toContain("Commit message");
  });

  it("preserves the empty initialized repository state", () => {
    queryState.data = {
      gitAvailable: true,
      entries: [],
      untrackedTruncated: false,
      untrackedTotal: 0,
    };

    const markup = renderToStaticMarkup(<GitLocalChanges project="demo" />);

    expect(markup).toContain("No local changes");
    expect(markup).toContain("Commit message");
  });
});
