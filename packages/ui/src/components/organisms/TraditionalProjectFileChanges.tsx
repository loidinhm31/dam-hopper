import { useMemo, useCallback, useState, type ReactElement } from "react";
import { Loader2, GitCommit, FileCode } from "lucide-react";
import { useGitDiff } from "@/api/queries.js";
import { normalizeProjectTarget } from "@/api/client.js";
import type { DiffFileEntry } from "@/api/client.js";
import { useConnectionSnapshot } from "@/api/connections.js";
import { useProjectTarget } from "@/hooks/use-project-target.js";
import type { FsTargetRef, ProjectRef, ProjectTargetRef } from "@/api/ownership.js";
import type { IntentPayloadMap } from "@/os/intents.js";
import { cn } from "@/lib/utils.js";
import { ContextMenu } from "@/components/ui/ContextMenu.js";
import { projectPathForEntry } from "@/components/organisms/ChangedFilesList.js";

export interface TraditionalProjectFileChangesProps {
  readonly projectName: string;
  readonly profileId?: string;
  readonly projectRef?: ProjectTargetRef | ProjectRef | string | null;
  readonly onOpenFile?: (payload: IntentPayloadMap["file:open"]) => void;
  readonly className?: string;
  readonly onLocateFile?: (filePath: string) => void;
}


function getStatusBadge(status: string, staged?: boolean): { label: string; colorClass: string } {
  if (status === "conflicted") {
    return { label: "C", colorClass: "text-red-400 border-red-500/30 bg-red-500/10" };
  }
  if (staged) {
    if (status === "added") return { label: "A", colorClass: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" };
    if (status === "deleted") return { label: "D", colorClass: "text-rose-400 border-rose-500/30 bg-rose-500/10" };
    if (status === "renamed") return { label: "R", colorClass: "text-amber-400 border-amber-500/30 bg-amber-500/10" };
    return { label: "M", colorClass: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" };
  }
  if (status === "deleted") return { label: "D", colorClass: "text-rose-400 border-rose-500/30 bg-rose-500/10" };
  if (status === "renamed") return { label: "R", colorClass: "text-amber-400 border-amber-500/30 bg-amber-500/10" };
  if (status === "added" || status === "untracked") return { label: "?", colorClass: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" };
  return { label: "M", colorClass: "text-sky-400 border-sky-500/30 bg-sky-500/10" };
}

export function TraditionalProjectFileChanges({
  projectName,
  profileId,
  projectRef,
  onOpenFile,
  onLocateFile,
  className,
}: TraditionalProjectFileChangesProps): ReactElement {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const effectiveProfileId = profileId ?? (typeof projectRef === "object" ? projectRef?.profileId : undefined);
  const connectionSnapshot = useConnectionSnapshot(effectiveProfileId ?? "");
  const generation = connectionSnapshot?.owner.generation;

  const projectScope = useMemo<ProjectRef | null>(() => {
    if (!effectiveProfileId) return null;
    return (
      (typeof projectRef === "object" && projectRef) || {
        profileId: effectiveProfileId,
        project: projectName,
      }
    );
  }, [effectiveProfileId, projectName, projectRef]);

  const targetSnapshot = useProjectTarget(projectScope);
  const projectTarget = targetSnapshot?.target;

  const targetRef = useMemo<ProjectTargetRef>(() => {
    if (projectRef && typeof projectRef === "object") {
      return normalizeProjectTarget({
        project: projectRef.project,
        profileId: projectRef.profileId ?? profileId,
        worktreePath: "worktreePath" in projectRef ? projectRef.worktreePath : undefined,
      });
    }
    return normalizeProjectTarget({
      project: projectName,
      profileId,
    });
  }, [projectName, profileId, projectRef]);

  const { data: diff, isLoading, isError, error } = useGitDiff(targetRef, "*");

  const handleOpenFileDiff = useCallback(
    (entry: DiffFileEntry) => {
      const worktreePath =
        projectTarget?.worktreePath ??
        (projectRef && typeof projectRef === "object" && "worktreePath" in projectRef
          ? projectRef.worktreePath
          : undefined) ??
        null;
      const target: FsTargetRef = {
        kind: "project",
        profileId: effectiveProfileId ?? "default",
        project: projectName,
        worktreePath: worktreePath || undefined,
      };
      const payload: IntentPayloadMap["file:open"] = {
        profileId: effectiveProfileId ?? "default",
        projectId: projectName,
        worktreeId: worktreePath || undefined,
        target,
        filePath: projectPathForEntry(entry),
        diffPath: entry.path,
        gitRootId: entry.rootId,
        isDiff: true,
        fileStatus: entry.status,
        ...((generation !== undefined || (effectiveProfileId ?? "default") === "default")
          ? { mode: "float" as const }
          : {}),
        ...(generation !== undefined ? { generation } : {}),
      };
      onOpenFile?.(payload);
    },
    [effectiveProfileId, generation, onOpenFile, projectName, projectRef, projectTarget],
  );
  const handleOpenFileRegular = useCallback(
    (entry: DiffFileEntry) => {
      const worktreePath =
        projectTarget?.worktreePath ??
        (projectRef && typeof projectRef === "object" && "worktreePath" in projectRef
          ? projectRef.worktreePath
          : undefined) ??
        null;
      const target: FsTargetRef = {
        kind: "project",
        profileId: effectiveProfileId ?? "default",
        project: projectName,
        worktreePath: worktreePath || undefined,
      };
      const resolvedPath = projectPathForEntry(entry);
      const payload: IntentPayloadMap["file:open"] = {
        profileId: effectiveProfileId ?? "default",
        projectId: projectName,
        worktreeId: worktreePath || undefined,
        target,
        filePath: resolvedPath,
        isDiff: false,
        fileStatus: entry.status,
        ...((generation !== undefined || (effectiveProfileId ?? "default") === "default")
          ? { mode: "float" as const }
          : {}),
        ...(generation !== undefined ? { generation } : {}),
      };
      onOpenFile?.(payload);
    },
    [effectiveProfileId, generation, onOpenFile, projectName, projectRef, projectTarget],
  );


  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center py-6 text-xs text-[var(--color-text-muted)] gap-2", className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-primary)]" aria-hidden="true" />
        <span>Loading changes…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={cn("px-3 py-4 text-center text-xs text-[var(--color-danger,#f87171)]", className)}>
        {error instanceof Error ? error.message : "Failed to load project changes"}
      </div>
    );
  }

  if (diff?.gitAvailable === false) {
    return (
      <div className={cn("px-3 py-6 text-center text-xs text-[var(--color-text-muted)]", className)}>
        <GitCommit className="mx-auto h-5 w-5 opacity-40 mb-1" aria-hidden="true" />
        <span>Git not available for this project</span>
      </div>
    );
  }

  const entries: DiffFileEntry[] = diff?.entries ?? [];

  if (entries.length === 0) {
    return (
      <div className={cn("px-3 py-6 text-center text-xs text-[var(--color-text-muted)]", className)}>
        <FileCode className="mx-auto h-5 w-5 opacity-40 mb-1" aria-hidden="true" />
        <span>No changed files</span>
      </div>
    );
  }

  return (
    <div
      role="list"
      aria-label={`${projectName} changed files`}
      className={cn("flex flex-col gap-0.5 py-1 text-xs select-none", className)}
    >
      {entries.map((entry) => {
        const badge = getStatusBadge(entry.status, entry.staged);
        const fileName = entry.path.split("/").pop() ?? entry.path;
        const dirPath = entry.path.includes("/")
          ? entry.path.slice(0, entry.path.lastIndexOf("/"))
          : "";

        const resolvedPath = projectPathForEntry(entry);
        const isDeleted = entry.status === "deleted";

        return (
          <ContextMenu.Root key={entry.path}>
            <ContextMenu.Trigger>
              <div
                role="listitem"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPath(entry.path);
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedPath(entry.path);
                  handleOpenFileDiff(entry);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedPath(entry.path);
                    handleOpenFileDiff(entry);
                  }
                }}
                title={`${entry.path} (${entry.status})`}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2 py-1 text-left transition-colors cursor-pointer",
                  selectedPath === entry.path
                    ? "bg-[var(--color-primary)]/15 text-[var(--color-primary)] font-medium"
                    : "hover:bg-[var(--color-surface-2)]",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)]",
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border font-mono text-[9px] font-bold",
                    badge.colorClass,
                  )}
                  title={entry.status}
                  aria-label={entry.status}
                >
                  {badge.label}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--color-text)]">
                  {fileName}
                  {dirPath && (
                    <span className="ml-1 text-[var(--color-text-muted)] text-[10px]">
                      {dirPath}
                    </span>
                  )}
                </span>
              </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="w-44">
                <ContextMenu.Item
                  disabled={isDeleted}
                  title={isDeleted ? "Cannot locate deleted file in file tree" : undefined}
                  onSelect={() => {
                    setSelectedPath(entry.path);
                    onLocateFile?.(resolvedPath);
                  }}
                >
                  Locate in files
                </ContextMenu.Item>
                <ContextMenu.Item
                  onSelect={() => {
                    setSelectedPath(entry.path);
                    handleOpenFileDiff(entry);
                  }}
                >
                  Open diff
                </ContextMenu.Item>
                <ContextMenu.Item
                  disabled={isDeleted}
                  title={isDeleted ? "Cannot open deleted file" : undefined}
                  onSelect={() => {
                    setSelectedPath(entry.path);
                    handleOpenFileRegular(entry);
                  }}
                >
                  Open file
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        );
      })}
    </div>
  );
}
