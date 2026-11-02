import { useState, useCallback, useMemo } from "react";
import type { OsWindow } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { ProjectInfoPanel } from "@/components/organisms/ProjectInfoPanel.js";
import { ConfigEditor } from "@/components/organisms/ConfigEditor.js";
import { useConfig, useUpdateConfig } from "@/api/queries.js";
import { dispatchIntent, createIntent } from "../intents.js";
import type { TreeCommand } from "@/hooks/use-terminal-tree.js";
import type { DamHopperConfig } from "@/api/client.js";
import type { ConnectionRef } from "@/api/ownership.js";
import {
  createProjectTargetSnapshot,
  type ProjectTargetSnapshot,
} from "@/stores/project-target.js";

export interface ProjectInfoAppProps {
  window: OsWindow;
}

export function ProjectInfoApp({ window }: ProjectInfoAppProps) {
  const owner = useWindowOwner();
  const profileId = owner.profileId;
  const project = window.ctx.projectId ?? "";
  const worktreeId = window.ctx.worktreeId;
  const [activeTab, setActiveTab] = useState<"overview" | "config">("overview");

  const ownerRef = useMemo<ConnectionRef>(
    () => ({
      profileId: owner.profileId,
      generation: owner.generation,
    }),
    [owner.profileId, owner.generation],
  );

  const { data: config, isLoading: isConfigLoading } = useConfig({
    owner: ownerRef,
  });
  const updateConfigMutation = useUpdateConfig({
    owner: ownerRef,
  });

  const targetSnapshot: ProjectTargetSnapshot = useMemo(
    () =>
      createProjectTargetSnapshot(
        { profileId: owner.profileId, project },
        worktreeId,
      ),
    [owner.profileId, project, worktreeId],
  );
  const handleLaunchCommand = useCallback(
    (command: TreeCommand) => {
      void dispatchIntent(
        createIntent(
          "terminal:open",
          {
            profileId,
            projectId: project,
            worktreeId,
            cwd: command.cwd,
          },
          window.id,
        ),
      );
    },
    [profileId, project, worktreeId, window.id],
  );

  const handleSaveConfig = useCallback(
    async (updated: DamHopperConfig) => {
      await updateConfigMutation.mutateAsync(updated);
    },
    [updateConfigMutation],
  );

  return (
    <div
      data-os-project-info-app={window.id}
      data-testid={`project-info-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] shrink-0 text-xs font-medium">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`px-2.5 py-1 rounded transition-colors ${
            activeTab === "overview"
              ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-xs"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("config")}
          className={`px-2.5 py-1 rounded transition-colors ${
            activeTab === "config"
              ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-xs"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          Configuration
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {activeTab === "overview" && (
          <ProjectInfoPanel
            projectName={project}
            target={targetSnapshot}
            onLaunchCommand={handleLaunchCommand}
          />
        )}
        {activeTab === "config" && (
          <div>
            {isConfigLoading || !config ? (
              <div className="flex items-center justify-center py-8 text-xs text-[var(--color-text-muted)]">
                Loading configuration...
              </div>
            ) : (
              <ConfigEditor
                config={config}
                onSave={handleSaveConfig}
                isSaving={updateConfigMutation.isPending}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
