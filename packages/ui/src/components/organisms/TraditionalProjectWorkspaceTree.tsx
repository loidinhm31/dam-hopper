import { useCallback, useMemo } from "react";
import { useConnectionSnapshot } from "@/api/connections.js";
import { useProjectTarget } from "@/hooks/use-project-target.js";
import { FileTree } from "@/components/organisms/FileTree.js";
import { EncryptProvider } from "@/contexts/EncryptContext.js";
import type { FsArborNode } from "@/api/fs-types.js";
import type { IntentPayloadMap } from "@/os/intents.js";
import type { FsTargetRef, ProjectRef } from "@/api/ownership.js";
import type { FileTreeRevealRequest } from "@/lib/file-tree-reveal.js";
import { cn } from "@/lib/utils.js";

export interface TraditionalProjectWorkspaceTreeProps {
  projectName: string;
  profileId?: string;
  projectRef?: ProjectRef;
  regionId: string;
  onOpenFile?: (payload: IntentPayloadMap["file:open"]) => void;
  className?: string;
  revealRequest?: FileTreeRevealRequest | null;
}

export function TraditionalProjectWorkspaceTree({
  projectName,
  profileId,
  projectRef,
  regionId,
  onOpenFile,
  className,
  revealRequest,
}: TraditionalProjectWorkspaceTreeProps) {
  const effectiveProfileId = profileId ?? projectRef?.profileId;
  const connectionSnapshot = useConnectionSnapshot(effectiveProfileId ?? "");
  const isConnected = effectiveProfileId
    ? effectiveProfileId === "default" ||
      connectionSnapshot?.status === "connected"
    : false;
  const generation = connectionSnapshot?.owner.generation;
  const projectScope = useMemo<ProjectRef | null>(() => {
    if (!effectiveProfileId) return null;
    return (
      projectRef ?? {
        profileId: effectiveProfileId,
        project: projectName,
      }
    );
  }, [effectiveProfileId, projectName, projectRef]);

  const targetSnapshot = useProjectTarget(projectScope);
  const projectTarget = targetSnapshot?.target;

  const handleFileOpen = useCallback(
    (node: FsArborNode) => {
      if (!isConnected) {
        return;
      }
      const worktreePath = projectTarget?.worktreePath ?? null;
      const target: FsTargetRef = {
        kind: "project",
        profileId: effectiveProfileId ?? "default",
        project: projectName,
        worktreePath,
      };
      const payload: IntentPayloadMap["file:open"] = {
        profileId: effectiveProfileId ?? "default",
        projectId: projectName,
        worktreeId: worktreePath || undefined,
        target,
        filePath: node.id,
        ...(generation !== undefined
          ? { mode: "float" as const, generation }
          : {}),
      };
      onOpenFile?.(payload);
    },
    [
      effectiveProfileId,
      generation,
      isConnected,
      onOpenFile,
      projectName,
      projectTarget,
    ],
  );

  return (
    <div
      role="region"
      id={regionId}
      aria-label={`${projectName} files`}
      className={cn("min-h-0 pl-4 pr-1 py-1", className)}
    >
      {!effectiveProfileId || !isConnected ? (
        <p
          role="status"
          className="px-2 py-1 text-xs text-[var(--color-text-muted)] italic"
        >
          {!effectiveProfileId
            ? `Profile not specified for ${projectName}`
            : `${projectName} owner is disconnected`}
        </p>
      ) : (
        <EncryptProvider>
          <FileTree
            project={projectName}
            target={
              projectTarget ?? {
                kind: "project",
                profileId: effectiveProfileId ?? "default",
                project: projectName,
                worktreePath: null,
              }
            }
            mode="projects"
            onFileOpen={handleFileOpen}
            revealRequest={revealRequest}
            className="min-h-24 h-full flex-1 overflow-y-auto"
          />
        </EncryptProvider>
      )}
    </div>
  );
}
