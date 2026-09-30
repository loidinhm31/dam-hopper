import { useMemo, useSyncExternalStore } from "react";
import { useParams } from "react-router-dom";
import type { ProjectRef } from "@/api/client.js";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { useWorkbenchSelectionsStore } from "@/stores/workbench-selections.js";
import { useAggregatedProjects } from "@/hooks/use-aggregated-projects.js";
import {
  getActiveProfileId,
  subscribeToProfileChanges,
  getProfileChangeVersion,
} from "@/api/server-config.js";
import { PluginHost } from "./PluginHost.js";

export function PluginHostPage() {
  const { installationId = "" } = useParams<{ installationId: string }>();
  const isAdvisor =
    installationId === "evcrate.advisor" ||
    installationId.startsWith("evcrate.") ||
    installationId === "evcrate-advisor";

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

  const workspaceProject = useWorkspaceStore((state) => state.selectedProject);
  const { allProjects } = useAggregatedProjects();

  const effectiveProfileId = isAdvisor
    ? settingsTargetProfileId
    : workspaceProject?.profileId || settingsTargetProfileId;

  const effectiveProjectRef = useMemo<ProjectRef | null>(() => {
    if (!isAdvisor && workspaceProject) {
      return workspaceProject;
    }
    if (workspaceProject?.profileId === effectiveProfileId) {
      return workspaceProject;
    }
    const matching = allProjects.find(
      (p) => p.profileId === effectiveProfileId,
    );
    return matching ? matching.ref : null;
  }, [allProjects, effectiveProfileId, isAdvisor, workspaceProject]);

  const title =
    installationId === "evcrate.advisor"
      ? "EVCrate Advisor"
      : installationId || "Plugin";

  return (
    <AppLayout title={`Plugin · ${title}`}>
      <PluginHost
        installationId={installationId}
        project={effectiveProjectRef}
      />
    </AppLayout>
  );
}
