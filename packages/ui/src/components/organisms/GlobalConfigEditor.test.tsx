import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalConfigEditor } from "./GlobalConfigEditor.js";


vi.mock("@/api/queries.js", () => ({
  useGlobalConfig: () => ({
    data: { workspace: { name: "demo", root: "/workspaces/demo" } },
    isLoading: false,
  }),
  useSwitchWorkspace: () => ({
    isPending: false,
    error: null,
    mutateAsync: vi.fn(),
  }),
  useWorkspaceStatus: () => ({
    data: { ready: true, path: "/workspaces/demo", configPath: "/home/user/.config/dam-hopper/config.toml" },
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
  it("renders workspace configuration and known-workspace inputs enabled", () => {
    const markup = renderToStaticMarkup(<GlobalConfigEditor />);

    expect(markup).toContain("Workspace Configuration");
    expect(markup).toContain("Canonical Workspace Root");
    expect(markup).toContain('placeholder="/path/to/workspace"');
    expect(markup).not.toContain('placeholder="/path/to/workspace" disabled=""');
  });
});
