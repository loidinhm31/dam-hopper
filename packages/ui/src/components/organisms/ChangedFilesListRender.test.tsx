// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitDiffResult } from "@/api/client.js";

const queryState: {
  data?: GitDiffResult;
  isLoading: boolean;
  isError: boolean;
} = { isLoading: false, isError: false };
const mockPolicy = vi.hoisted(() => ({ enabled: false }));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/api/queries.js", () => ({
  useGitDiff: () => ({ ...queryState, refetch: vi.fn() }),
  useGitUntracked: () => ({ data: undefined, isFetching: false }),
}));

vi.mock("@/api/client.js", () => ({
  api: { git: {} },
  normalizeProjectTarget: (target: string | { project: string }) =>
    typeof target === "string" ? { project: target } : target,
  projectTargetCacheKey: (target: { project: string }) => target.project,
}));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

import { ChangedFilesList } from "./ChangedFilesList.js";

function renderList() {
  return renderToStaticMarkup(
    <ChangedFilesList
      project="demo"
      selectedFile={null}
      onSelectFile={vi.fn()}
    />,
  );
}

beforeEach(() => {
  queryState.data = undefined;
  queryState.isLoading = false;
  queryState.isError = false;
  mockPolicy.enabled = false;
});

describe("ChangedFilesList query states", () => {
  it("explains unavailable Git and suppresses mutation controls", () => {
    queryState.data = {
      gitAvailable: false,
      code: "GIT_NOT_INITIALIZED",
      entries: [],
      untrackedTruncated: false,
      untrackedTotal: 0,
    };

    const markup = renderList();

    expect(markup).toContain("Git is not initialized for this project");
    expect(markup).toContain("git init");
    expect(markup).not.toContain("No local changes");
    expect(markup).not.toContain("Commit message");
    expect(markup).not.toContain(">Commit<");
  });

  it("keeps the normal empty repository state", () => {
    queryState.data = {
      gitAvailable: true,
      entries: [],
      untrackedTruncated: false,
      untrackedTotal: 0,
    };

    const markup = renderList();

    expect(markup).toContain("No local changes");
    expect(markup).toContain("Commit message");
  });

  it("keeps generic failures retryable", () => {
    queryState.isError = true;

    const markup = renderList();

    expect(markup).toContain("Failed to load changes");
    expect(markup).toContain("Retry");
    expect(markup).not.toContain("Git is not initialized");
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

    const markup = renderList();

    expect(markup).toContain('placeholder="Commit message…" disabled=""');
    expect(markup).toContain(
      'title="Unavailable on Android Chrome: text entry is disabled"',
    );
  });
});
