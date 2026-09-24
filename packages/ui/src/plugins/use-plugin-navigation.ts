import { useEffect, useState, useSyncExternalStore } from "react";
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
export function parsePluginMetadata(value: unknown): PluginMetadataItem | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item).sort();
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
  const availability: PluginNavigationAvailability = !metadata.enabled
    ? "disabled"
    : !metadata.hasUi
      ? "no-ui"
      : !SHA256_PATTERN.test(metadata.activeDigest)
        ? "incompatible"
        : "ready";
  const suffix =
    availability === "disabled"
      ? " · DISABLED"
      : availability === "no-ui"
        ? " · NO UI"
        : availability === "incompatible"
          ? " · INCOMPATIBLE"
          : "";
  const friendlyName =
    metadata.id === "evcrate.advisor" || metadata.publisher === "evcrate"
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
  const profileId = project?.profileId ?? "";
  const connection = useSyncExternalStore(
    subscribeConnections,
    () => (profileId ? getConnectionSnapshot(profileId) : null),
    () => null,
  );
  const projectTarget = useProjectTarget(project);
  const [state, setState] = useState<PluginNavigationState>({
    loading: false,
    items: [],
    error: null,
  });
  const targetKey = JSON.stringify([
    projectTarget?.target.project ?? "",
    projectTarget?.target.worktreePath ?? null,
  ]);

  useEffect(() => {
    if (
      !project ||
      !project.profileId ||
      !projectTarget ||
      connection?.status !== "connected" ||
      !connection.owner
    ) {
      setState({ loading: false, items: [], error: null });
      return;
    }
    const api = getApi(connection.owner);
    const target = toServerProjectTarget(projectTarget.target);
    let active = true;
    let requestRevision = 0;

    const load = async () => {
      const revision = ++requestRevision;
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await api.plugins.list(target);
        if (!active || revision !== requestRevision) return;
        if (
          typeof response !== "object" ||
          response === null ||
          !Array.isArray(response.plugins)
        ) {
          throw new Error("Invalid plugin metadata response");
        }
        const parsed = response.plugins.map(parsePluginMetadata);
        if (parsed.some((item) => item === null)) {
          throw new Error("Invalid plugin metadata response");
        }
        const items = (parsed as PluginMetadataItem[])
          .map(pluginNavigationItem)
          .sort((left, right) => left.label.localeCompare(right.label));
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

    const unsubscribeChanged = api.transport.onEvent(
      "plugin:availability.changed",
      () => void load(),
    );
    void load();
    return () => {
      active = false;
      requestRevision += 1;
      unsubscribeChanged();
    };
  }, [connection?.owner?.generation, connection?.status, profileId, targetKey]);

  return state;
}
