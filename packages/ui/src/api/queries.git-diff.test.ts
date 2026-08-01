import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  diff: vi.fn(),
  roots: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => options,
  useMutation: vi.fn(),
  useQueryClient: vi.fn(),
}));

vi.mock("./client.js", () => ({
  api: { git: { diff: mocks.diff, roots: mocks.roots } },
  isGitUnavailableError: (error: unknown) =>
    (error as { code?: string })?.code === "GIT_NOT_INITIALIZED",
}));

vi.mock("@/stores/editor.js", () => ({
  useEditorStore: { getState: vi.fn() },
}));

import { useGitDiff } from "./queries.js";

interface CapturedQuery {
  queryFn: () => Promise<unknown>;
}

describe("useGitDiff", () => {
  it("maps the direct diff unavailable code without a roots preflight", async () => {
    mocks.diff.mockRejectedValueOnce({ code: "GIT_NOT_INITIALIZED" });

    const query = useGitDiff("demo", "*") as unknown as CapturedQuery;

    await expect(query.queryFn()).resolves.toMatchObject({
      gitAvailable: false,
      code: "GIT_NOT_INITIALIZED",
      entries: [],
    });
    expect(mocks.diff).toHaveBeenCalledWith("demo", "*");
    expect(mocks.roots).not.toHaveBeenCalled();
  });

  it("preserves generic diff failures", async () => {
    const error = new Error("network failed");
    mocks.diff.mockRejectedValueOnce(error);

    const query = useGitDiff("demo", "*") as unknown as CapturedQuery;

    await expect(query.queryFn()).rejects.toBe(error);
  });
});
