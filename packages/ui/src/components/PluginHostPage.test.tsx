// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { PluginHostPage } from "./PluginHostPage.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { useWorkbenchSelectionsStore } from "@/stores/workbench-selections.js";
import type { PluginMetadataItem } from "@/api/client.js";

const mockParams = { installationId: "evcrate.advisor" };
vi.mock("react-router-dom", () => ({
  useParams: () => mockParams,
}));

const mockSettingsList = vi.fn();
const mockWorkspaceList = vi.fn();
const mockSettingsReadUiAsset = vi.fn();
const mockWorkspaceReadUiAsset = vi.fn();

const advisorMetadata: PluginMetadataItem = {
  id: "evcrate.advisor",
  version: "1.0.0",
  publisher: "evcrate",
  capabilities: ["policy.readCurrent"],
  hasUi: true,
  activeDigest: "a".repeat(64),
  activeGeneration: 1,
  enabled: true,
};

const otherMetadata: PluginMetadataItem = {
  id: "other.plugin",
  version: "1.0.0",
  publisher: "other",
  capabilities: [],
  hasUi: true,
  activeDigest: "b".repeat(64),
  activeGeneration: 1,
  enabled: true,
};

vi.mock("@/api/connections.js", () => ({
  isCurrentConnection: () => true,
  useConnectionSnapshot: (profileId: string) => ({
    status: "connected",
    owner: { profileId, generation: 1 },
  }),
  getApi: (owner: { profileId: string }) => ({
    plugins: {
      list: owner.profileId === "settings-profile" ? mockSettingsList : mockWorkspaceList,
      readUiAsset: owner.profileId === "settings-profile" ? mockSettingsReadUiAsset : mockWorkspaceReadUiAsset,
    },
    transport: {
      onEvent: () => () => {},
    },
  }),
}));

vi.mock("@/hooks/use-aggregated-projects.js", () => ({
  useAggregatedProjects: () => ({
    allProjects: [
      {
        profileId: "settings-profile",
        profileName: "Settings Server",
        serverUrl: "http://settings.local:4800",
        project: { name: "settings-repo", type: "git", isAvailable: true },
        ref: { profileId: "settings-profile", project: "settings-repo" },
      },
      {
        profileId: "workspace-profile",
        profileName: "Workspace Server",
        serverUrl: "http://workspace.local:4800",
        project: { name: "workspace-repo", type: "git", isAvailable: true },
        ref: { profileId: "workspace-profile", project: "workspace-repo" },
      },
    ],
    isLoading: false,
  }),
}));

const targetCache = new Map<string, { target: { profileId: string; project: string } }>();
vi.mock("@/hooks/use-project-target.js", () => ({
  useProjectTarget: (ref: { profileId: string; project: string } | null) => {
    if (!ref) return null;
    const key = `${ref.profileId}:${ref.project}`;
    if (!targetCache.has(key)) {
      targetCache.set(key, { target: { profileId: ref.profileId, project: ref.project } });
    }
    return targetCache.get(key) ?? null;
  },
}));

vi.mock("@/plugins/bridge-host.js", () => ({
  createApiFrameSessionBackend: () => ({}),
  FrameSession: class {
    state = "Ready";
    frameSession = "session-1";
    revoke = vi.fn();
  },
}));

vi.mock("@/plugins/plugin-document.js", () => ({
  buildVerifiedPluginDocument: vi.fn().mockResolvedValue({
    srcdoc: "<html></html>",
    digest: "a".repeat(64),
  }),
}));

vi.mock("@/components/templates/AppLayout.js", () => ({
  AppLayout: ({ title, children }: { title?: string; children?: React.ReactNode }) => (
    <div data-testid="app-layout" data-title={title}>
      {children}
    </div>
  ),
}));

vi.mock("./PluginFrame.js", () => ({
  PluginFrame: () => <div data-testid="plugin-frame" />,
}));

describe("PluginHostPage Settings Target Server routing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    mockParams.installationId = "evcrate.advisor";
    useWorkbenchSelectionsStore.setState({
      settingsProfileId: "settings-profile",
    });
    useWorkspaceStore.setState({
      selectedProject: { profileId: "workspace-profile", project: "workspace-repo" },
      activeProject: "workspace-repo",
      activeProjectRevision: 1,
      navigationRevision: 1,
    });

    mockSettingsList.mockResolvedValue({ plugins: [advisorMetadata] });
    mockWorkspaceList.mockResolvedValue({ plugins: [otherMetadata] });
    mockSettingsReadUiAsset.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      sha256: "a".repeat(64),
    });
    mockWorkspaceReadUiAsset.mockResolvedValue({
      bytes: new Uint8Array([4, 5, 6]),
      sha256: "b".repeat(64),
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("routes EVCrate Advisor to Settings Target Server regardless of workspace selectedProject", async () => {
    await act(async () => {
      root.render(<PluginHostPage />);
    });

    // Should query settings server, NOT workspace server
    expect(mockSettingsList).toHaveBeenCalledWith({
      project: "settings-repo",
    });
    expect(mockWorkspaceList).not.toHaveBeenCalled();

    expect(mockSettingsReadUiAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "evcrate.advisor",
        target: { project: "settings-repo" },
      }),
      expect.anything(),
    );

    const layout = container.querySelector('[data-testid="app-layout"]');
    expect(layout?.getAttribute("data-title")).toBe("Plugin · EVCrate Advisor");
  });

  it("routes non-Advisor plugins to the workspace project's server", async () => {
    mockParams.installationId = "other.plugin";

    await act(async () => {
      root.render(<PluginHostPage />);
    });

    // Should query workspace server for ordinary plugin
    expect(mockWorkspaceList).toHaveBeenCalledWith({
      project: "workspace-repo",
    });
    expect(mockWorkspaceReadUiAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: "other.plugin",
        target: { project: "workspace-repo" },
      }),
      expect.anything(),
    );
  });
});
