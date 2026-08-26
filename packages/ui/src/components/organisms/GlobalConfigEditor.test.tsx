import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalConfigEditor } from "./GlobalConfigEditor.js";

const mockPolicy = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/contexts/AndroidChromeInputPolicyContext.js", () => ({
  useAndroidChromeInputPolicy: () => ({
    isAndroidChromeNativeInputSuppressed: mockPolicy.enabled,
  }),
}));

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

describe("GlobalConfigEditor Android Chrome policy", () => {
  beforeEach(() => {
    mockPolicy.enabled = false;
  });

  it("blocks default and known-workspace text entry actions", () => {
    mockPolicy.enabled = true;
    const markup = renderToStaticMarkup(<GlobalConfigEditor />);

    expect(markup).toContain('placeholder="/path/to/workspace" disabled=""');
    expect(markup).toContain(
      "Unavailable on Android Chrome: text entry is disabled",
    );
  });
});
