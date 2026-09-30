import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  getApi,
  getConnectionSnapshot,
  subscribeConnections,
} from "@/api/connections.js";
import {
  toServerProjectTarget,
  type PluginMetadataItem,
  type ProjectRef,
} from "@/api/client.js";
import { useProjectTarget } from "@/hooks/use-project-target.js";
import { useWorkbenchSelectionsStore } from "@/stores/workbench-selections.js";
import { useAggregatedProjects } from "@/hooks/use-aggregated-projects.js";
import {
  getActiveProfileId,
  subscribeToProfileChanges,
  getProfileChangeVersion,
} from "@/api/server-config.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type PluginNavigationAvailability =
  | "ready"
  | "disabled"
  | "no-ui"
  | "incompatible";

export interface PluginNavigationItem {
  installationId: string;
  label: string;
  to: string;
  availability: PluginNavigationAvailability;
  metadata: PluginMetadataItem;
}

export interface PluginNavigationState {
  loading: boolean;
  items: PluginNavigationItem[];
  error: string | null;
}

export function isAdvisorMetadata(metadata: PluginMetadataItem): boolean {
  return metadata.id === "evcrate.advisor";
}

export function parsePluginMetadata(value: unknown): PluginMetadataItem | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item)
    .filter((k) => k !== "ownerHistorySource")
    .sort();
  const expected = [
    "activeDigest",
    "activeGeneration",
    "capabilities",
    "enabled",
    "hasUi",
    "id",
    "publisher",
    "version",
  ];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    typeof item.id !== "string" ||
    item.id.length === 0 ||
    typeof item.version !== "string" ||
    typeof item.publisher !== "string" ||
    !Array.isArray(item.capabilities) ||
    item.capabilities.some(
      (capability) => typeof capability !== "string" || capability.length === 0,
    ) ||
    typeof item.hasUi !== "boolean" ||
    typeof item.activeDigest !== "string" ||
    !Number.isSafeInteger(item.activeGeneration) ||
    (item.activeGeneration as number) < 0 ||
    typeof item.enabled !== "boolean"
  ) {
    return null;
  }
  return item as unknown as PluginMetadataItem;
}

export function pluginNavigationItem(
  metadata: PluginMetadataItem,
): PluginNavigationItem {
  let availability: PluginNavigationAvailability = "ready";
  if (!metadata.enabled) {
    availability = "disabled";
  } else if (!metadata.hasUi) {
    availability = "no-ui";
  } else if (
    !SHA256_PATTERN.test(metadata.activeDigest) ||
    !Number.isSafeInteger(metadata.activeGeneration) ||
    metadata.activeGeneration < 0
  ) {
    availability = "incompatible";
  }

  const suffix =
    availability === "disabled"
      ? " (Disabled)"
      : availability === "no-ui"
        ? " (No UI)"
        : availability === "incompatible"
          ? " (Incompatible)"
          : "";

  const friendlyName = isAdvisorMetadata(metadata)
    ? "EVCrate Advisor"
    : metadata.id.toUpperCase();

  return {
    installationId: metadata.id,
    label: `${friendlyName}${suffix}`,
    to: `/plugins/${encodeURIComponent(metadata.id)}`,
    availability,
    metadata,
  };
}

export function usePluginNavigation(
  project: ProjectRef | null,
): PluginNavigationState {
  const settingsProfileId = useWorkbenchSelectionsStore(
    (s) => s.settingsProfileId,
  );
  useSyncExternalStore(
    subscribeToProfileChanges,
    getProfileChangeVersion,
    () => 0,
  );
  const activeProfileId = getActiveProfileId();
  const settingsTargetProfileId = settingsProfileId || activeProfileId || "";

  const { allProjects } = useAggregatedProjects();

  const settingsProjectRef = useMemo<ProjectRef | null>(() => {
    if (project?.profileId === settingsTargetProfileId) {
      return project;
    }
    const matching = allProjects.find((p) => p.profileId === settingsTargetProfileId);
    return matching ? matching.ref : null;
  }, [allProjects, project, settingsTargetProfileId]);

  const settingsConnection = useSyncExternalStore(
    subscribeConnections,
    () => (settingsTargetProfileId ? getConnectionSnapshot(settingsTargetProfileId) : null),
    () => null,
  );
  const settingsProjectTarget = useProjectTarget(settingsProjectRef);

  const workspaceProfileId = project?.profileId ?? "";
  const workspaceConnection = useSyncExternalStore(
    subscribeConnections,
    () => (workspaceProfileId ? getConnectionSnapshot(workspaceProfileId) : null),
    () => null,
  );
  const workspaceProjectTarget = useProjectTarget(project);

  const [state, setState] = useState<PluginNavigationState>({
    loading: false,
    items: [],
    error: null,
  });

  const settingsTargetKey = JSON.stringify([
    settingsProjectTarget?.target.project ?? "",
    settingsProjectTarget?.target.worktreePath ?? null,
  ]);
  const workspaceTargetKey = JSON.stringify([
    workspaceProjectTarget?.target.project ?? "",
    workspaceProjectTarget?.target.worktreePath ?? null,
  ]);

  const canQuerySettings = Boolean(
    settingsTargetProfileId &&
      settingsProjectRef &&
      settingsProjectTarget &&
      settingsConnection?.status === "connected" &&
      settingsConnection.owner,
  );

  const canQueryWorkspace = Boolean(
    project &&
      project.profileId &&
      workspaceProjectTarget &&
      workspaceConnection?.status === "connected" &&
      workspaceConnection.owner,
  );

  useEffect(() => {
    let active = true;
    let requestRevision = 0;
    const unsubscribes: Array<() => void> = [];

    if (!canQuerySettings && !canQueryWorkspace) {
      setState({ loading: false, items: [], error: null });
      return;
    }
    const load = async () => {
      const revision = ++requestRevision;
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const itemMap = new Map<string, PluginNavigationItem>();

        // Query settings target server for Advisor
        if (canQuerySettings && settingsConnection?.owner && settingsProjectTarget) {
          const api = getApi(settingsConnection.owner);
          const target = toServerProjectTarget(settingsProjectTarget.target);
          const response = await api.plugins.list(target);
          if (!active || revision !== requestRevision) return;
          if (response && Array.isArray(response.plugins)) {
            const parsed = response.plugins.map(parsePluginMetadata);
            const isWorkspaceSameServer =
              canQueryWorkspace && project?.profileId === settingsTargetProfileId;
            for (const meta of parsed) {
              if (
                meta &&
                meta.id !== "evcrate.advisor" &&
                (!canQueryWorkspace || isWorkspaceSameServer)
              ) {
                itemMap.set(meta.id, pluginNavigationItem(meta));
              }
            }
          }
        }

        // Query workspace project server for non-advisor plugins
        if (canQueryWorkspace && workspaceConnection?.owner && workspaceProjectTarget) {
          const isSameTarget =
            canQuerySettings &&
            project?.profileId === settingsTargetProfileId &&
            project?.project === settingsProjectRef?.project;

          if (!isSameTarget) {
            const api = getApi(workspaceConnection.owner);
            const target = toServerProjectTarget(workspaceProjectTarget.target);
            const response = await api.plugins.list(target);
            if (!active || revision !== requestRevision) return;
            if (response && Array.isArray(response.plugins)) {
              const workspaceParsed =
                response.plugins.map(parsePluginMetadata);
              for (const meta of workspaceParsed) {
                if (meta && meta.id !== "evcrate.advisor") {
                  itemMap.set(meta.id, pluginNavigationItem(meta));
                }
              }
            }
          }
        }

        const items = [...itemMap.values()].sort((a, b) =>
          a.label.localeCompare(b.label),
        );
        setState({ loading: false, items, error: null });
      } catch {
        if (!active || revision !== requestRevision) return;
        setState({
          loading: false,
          items: [],
          error: "Plugin navigation is unavailable for this target.",
        });
      }
    };

    if (canQuerySettings && settingsConnection?.owner) {
      const api = getApi(settingsConnection.owner);
      unsubscribes.push(
        api.transport.onEvent("plugin:availability.changed", () => void load()),
      );
    }
    if (
      canQueryWorkspace &&
      workspaceConnection?.owner &&
      project?.profileId !== settingsTargetProfileId
    ) {
      const api = getApi(workspaceConnection.owner);
      unsubscribes.push(
        api.transport.onEvent("plugin:availability.changed", () => void load()),
      );
    }

    void load();

    return () => {
      active = false;
      requestRevision += 1;
      for (const unsub of unsubscribes) {
        unsub();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canQuerySettings,
    canQueryWorkspace,
    settingsConnection?.owner?.generation,
    settingsConnection?.status,
    settingsTargetKey,
    settingsTargetProfileId,
    workspaceConnection?.owner?.generation,
    workspaceConnection?.status,
    workspaceProfileId,
    workspaceTargetKey,
  ]);

  return state;
}
