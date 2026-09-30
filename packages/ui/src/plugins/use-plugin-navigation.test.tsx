// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { usePluginNavigation, type PluginNavigationState } from "./use-plugin-navigation.js";
import { useWorkbenchSelectionsStore } from "@/stores/workbench-selections.js";
import type { PluginMetadataItem, ProjectRef } from "@/api/client.js";

const mockSettingsPluginsList = vi.fn();
const mockWorkspacePluginsList = vi.fn();

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
  id: "custom.plugin",
  version: "0.2.0",
  publisher: "community",
  capabilities: ["fs.read"],
  hasUi: true,
  activeDigest: "b".repeat(64),
  activeGeneration: 1,
  enabled: true,
};

const snapshots: Record<string, { status: "connected"; owner: { profileId: string; generation: number } }> = {};
function getSnap(profileId: string) {
  if (!profileId) return null;
  if (!snapshots[profileId]) {
    snapshots[profileId] = {
      status: "connected",
      owner: { profileId, generation: 1 },
    };
  }
  return snapshots[profileId];
}

vi.mock("@/api/connections.js", () => ({
  subscribeConnections: () => () => {},
  getConnectionSnapshot: (profileId: string) => getSnap(profileId),
  getApi: (owner: { profileId: string }) => ({
    plugins: {
      list: owner.profileId === "settings-profile"
        ? mockSettingsPluginsList
        : mockWorkspacePluginsList,
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

function Harness({
  project,
  onState,
}: {
  project: ProjectRef | null;
  onState: (state: PluginNavigationState) => void;
}) {
  const state = usePluginNavigation(project);
  React.useEffect(() => {
    onState(state);
  }, [state, onState]);
  return null;
}

describe("usePluginNavigation Settings Target Server routing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    useWorkbenchSelectionsStore.setState({
      settingsProfileId: "settings-profile",
    });
    mockSettingsPluginsList.mockResolvedValue({
      plugins: [advisorMetadata],
    });
    mockWorkspacePluginsList.mockResolvedValue({
      plugins: [otherMetadata],
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("excludes evcrate.advisor from standalone navigation when workspace project is null", async () => {
    let latestState: PluginNavigationState | null = null;

    await act(async () => {
      root.render(
        <Harness
          project={null}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState).not.toBeNull();
      expect(latestState?.loading).toBe(false);
      expect(latestState?.items.length).toBe(0);
    });

    expect(mockSettingsPluginsList).toHaveBeenCalledWith({
      project: "settings-repo",
    });
  });

  it("excludes evcrate.advisor and includes ordinary plugins across servers", async () => {
    const workspaceRef: ProjectRef = {
      profileId: "workspace-profile",
      project: "workspace-repo",
    };
    let latestState: PluginNavigationState | null = null;

    await act(async () => {
      root.render(
        <Harness
          project={workspaceRef}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState).not.toBeNull();
      expect(latestState?.loading).toBe(false);
      expect(latestState?.items.length).toBe(1);
    });
    expect(mockSettingsPluginsList).toHaveBeenCalledWith({
      project: "settings-repo",
    });
    expect(mockWorkspacePluginsList).toHaveBeenCalledWith({
      project: "workspace-repo",
    });

    const ids = latestState?.items.map((i) => i.installationId);
    expect(ids).not.toContain("evcrate.advisor");
    expect(ids).toContain("custom.plugin");
  });

  it("excludes evcrate.advisor while including ordinary plugins when workspace and settings profile are identical", async () => {
    mockSettingsPluginsList.mockResolvedValue({
      plugins: [advisorMetadata, otherMetadata],
    });

    const sameProfileRef: ProjectRef = {
      profileId: "settings-profile",
      project: "settings-repo",
    };
    let latestState: PluginNavigationState | null = null;

    await act(async () => {
      root.render(
        <Harness
          project={sameProfileRef}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState).not.toBeNull();
      expect(latestState?.loading).toBe(false);
      expect(latestState?.items.length).toBe(1);
    });

    const ids = latestState?.items.map((i) => i.installationId);
    expect(ids).not.toContain("evcrate.advisor");
    expect(ids).toContain("custom.plugin");
  });

  it("preserves other plugins with publisher evcrate in standalone navigation", async () => {
    const evcrateOtherMetadata: PluginMetadataItem = {
      id: "evcrate.custom-tool",
      version: "0.3.0",
      publisher: "evcrate",
      capabilities: ["custom.op"],
      hasUi: true,
      activeDigest: "c".repeat(64),
      activeGeneration: 1,
      enabled: true,
    };

    mockSettingsPluginsList.mockResolvedValue({
      plugins: [advisorMetadata, evcrateOtherMetadata],
    });

    const sameProfileRef: ProjectRef = {
      profileId: "settings-profile",
      project: "settings-repo",
    };
    let latestState: PluginNavigationState | null = null;

    await act(async () => {
      root.render(
        <Harness
          project={sameProfileRef}
          onState={(state) => {
            latestState = state;
          }}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState).not.toBeNull();
      expect(latestState?.loading).toBe(false);
      expect(latestState?.items.length).toBe(1);
    });

    const ids = latestState?.items.map((i) => i.installationId);
    expect(ids).not.toContain("evcrate.advisor");
    expect(ids).toContain("evcrate.custom-tool");
  });
});
