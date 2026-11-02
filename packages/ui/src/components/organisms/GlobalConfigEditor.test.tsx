import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalConfigEditor } from "./GlobalConfigEditor.js";


vi.mock("@/api/queries.js", () => ({
  useGlobalConfig: () => ({
    data: { defaults: { workspace: "/workspaces/demo" } },
    isLoading: false,
  }),
  useUpdateGlobalDefaults: () => ({
    isPending: false,
    error: null,
    mutateAsync: vi.fn(),
  }),
  useKnownWorkspaces: () => ({
    data: { workspaces: [] },
    isLoading: false,
  }),
  useAddKnownWorkspace: () => ({
    isPending: false,
    error: null,
    mutate: vi.fn(),
  }),
  useRemoveKnownWorkspace: () => ({
    isPending: false,
    error: null,
    mutate: vi.fn(),
  }),
  useWorkspace: () => ({ data: { root: "/workspaces/demo" } }),
}));

describe("GlobalConfigEditor", () => {
  it("renders default and known-workspace inputs enabled", () => {
    const markup = renderToStaticMarkup(<GlobalConfigEditor />);

    expect(markup).toContain('placeholder="/path/to/workspace"');
    expect(markup).not.toContain('placeholder="/path/to/workspace" disabled=""');
  });
});
