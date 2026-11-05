import { useCallback, useMemo } from "react";
import type { OsWindow } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import { WorkspaceGitPanel } from "@/components/organisms/WorkspaceGitPanel.js";
import { dispatchIntent, createIntent } from "../intents.js";
import { normalizeProjectTarget } from "@/api/client.js";

export interface GitAppProps {
  window: OsWindow;
}

export function GitApp({ window }: GitAppProps) {
  const owner = useWindowOwner();
  const profileId = owner.profileId;
  const project = window.ctx.projectId ?? "";
  const worktreeId = window.ctx.worktreeId;

  const target = useMemo(
    () =>
      normalizeProjectTarget({
        profileId,
        project,
        worktreePath: worktreeId,
      }),
    [profileId, project, worktreeId],
  );

  const handleOpenTerminal = useCallback(() => {
    void dispatchIntent(
      createIntent(
        "terminal:open",
        {
          profileId,
          projectId: project,
          worktreeId,
          target: {
            kind: "project",
            profileId,
            project,
            worktreePath: worktreeId,
          },
          directoryKind: "target-root",
        },
        window.id,
      ),
    );
  }, [profileId, project, worktreeId, window.id]);

  const handleResolveConflict = useCallback(
    (rootId?: string) => {
      void dispatchIntent(
        createIntent(
          "conflict:resolve",
          {
            profileId,
            projectId: project,
            worktreeId,
            root: rootId,
          },
          window.id,
        ),
      );
    },
    [profileId, project, worktreeId, window.id],
  );

  return (
    <div
      data-os-git-app={window.id}
      data-testid={`git-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      <div className="flex-1 min-h-0 relative">
        <WorkspaceGitPanel
          project={project}
          target={target}
          available={true}
        />
      </div>
    </div>
  );
}
