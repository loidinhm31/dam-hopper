// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffResult } from "@/api/client.js";

const queryState: { data?: GitDiffResult; isLoading: boolean } = {
  isLoading: false,
};
const mockPolicy = vi.hoisted(() => ({ enabled: false }));

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

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

import { GitLocalChanges } from "./GitLocalChanges.js";

beforeEach(() => {
  queryState.data = undefined;
  queryState.isLoading = false;
  mockPolicy.enabled = false;
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

  it("blocks commit text entry on Android Chrome", () => {
    mockPolicy.enabled = true;
    queryState.data = {
      gitAvailable: true,
      entries: [
        {
          path: "README.md",
          status: "modified",
          staged: true,
          additions: 1,
          deletions: 0,
        },
      ],
      untrackedTruncated: false,
      untrackedTotal: 0,
    };

    const markup = renderToStaticMarkup(<GitLocalChanges project="demo" />);

    expect(markup).toContain('placeholder="Commit message..." disabled=""');
    expect(markup).toContain(
      'title="Unavailable on Android Chrome: text entry is disabled"',
    );
    expect(markup).toContain("Unstage All");
  });
});
