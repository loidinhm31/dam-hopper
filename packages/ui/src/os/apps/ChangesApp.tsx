import { useState, useCallback, useMemo, useEffect } from "react";
import type { OsWindow } from "../types.js";
import { useWindowOwner } from "../window-context.js";
import {
  ChangedFilesList,
  createChangedFileSelection,
  projectPathForEntry,
  type ChangedFileSelection,
} from "@/components/organisms/ChangedFilesList.js";
import { useGitDiff } from "@/api/queries.js";
import { GitLocalChanges } from "@/components/organisms/GitLocalChanges.js";
import { DiffViewer } from "@/components/organisms/DiffViewer.js";
import { dispatchIntent, createIntent } from "../intents.js";
import { normalizeProjectTarget } from "@/api/client.js";

export interface ChangesAppProps {
  window: OsWindow;
}

export function ChangesApp({ window }: ChangesAppProps) {
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

  const { data: diffData, isLoading: isDiffLoading } = useGitDiff(target, "*");
  const diffEntries = useMemo(() => {
    if (!diffData) return [];
    return Array.isArray(diffData) ? diffData : (diffData.entries ?? []);
  }, [diffData]);

  const [selectedSelection, setSelectedSelection] =
    useState<ChangedFileSelection | null>(null);
  const [activeTab, setActiveTab] = useState<"changes" | "commit" | "diff">(
    "changes",
  );
  const requestedFilePath = window.appState?.filePath as string | undefined;
  const requestedTab = window.appState?.activeTab as
    | "changes"
    | "commit"
    | "diff"
    | undefined;
  const deliveryId = window.appState?.deliveryId;

  useEffect(() => {
    if (requestedFilePath) {
      if (window.appState?.status !== undefined) {
        setSelectedSelection({
          projectPath: requestedFilePath,
          status: (window.appState.status as string) ?? "M",
          additions: (window.appState.additions as number) ?? 0,
          deletions: (window.appState.deletions as number) ?? 0,
          gitRootId:
            (window.appState.gitRootId as string) ??
            (window.ctx.gitRootId ?? "."),
          diffPath:
            (window.appState.diffPath as string) ?? requestedFilePath,
        });
        setActiveTab("diff");
      } else if (diffEntries.length > 0 || !isDiffLoading) {
        const matchingEntry = diffEntries.find(
          (e) =>
            projectPathForEntry(e) === requestedFilePath ||
            e.path === requestedFilePath,
        );
        if (matchingEntry) {
          setSelectedSelection(createChangedFileSelection(matchingEntry));
          setActiveTab("diff");
        } else if (!isDiffLoading) {
          setSelectedSelection(null);
          setActiveTab("changes");
        }
      }
    } else if (requestedTab) {
      setActiveTab(requestedTab);
    }
  }, [
    requestedFilePath,
    requestedTab,
    deliveryId,
    window.appState,
    window.ctx.gitRootId,
    diffEntries,
    isDiffLoading,
  ]);

  const selectedFile = selectedSelection?.projectPath ?? null;

  const handleSelectFile = useCallback(
    (selection: ChangedFileSelection) => {
      setSelectedSelection(selection);
      void dispatchIntent(
        createIntent(
          "changes:diff",
          {
            profileId,
            projectId: project,
            worktreeId,
            filePath: selection.projectPath,
            status: selection.status,
            additions: selection.additions,
            deletions: selection.deletions,
            gitRootId: selection.gitRootId,
            diffPath: selection.diffPath,
          },
          window.id,
        ),
      );
    },
    [profileId, project, worktreeId, window.id],
  );

  const handleSelectConflict = useCallback(
    (selection: ChangedFileSelection) => {
      void dispatchIntent(
        createIntent(
          "conflict:resolve",
          {
            profileId,
            projectId: project,
            worktreeId,
            root: selection.gitRootId,
            filePath: selection.projectPath,
          },
          window.id,
        ),
      );
    },
    [profileId, project, worktreeId, window.id],
  );

  const handleOpenResolver = useCallback(() => {
    void dispatchIntent(
      createIntent(
        "conflict:resolve",
        {
          profileId,
          projectId: project,
          worktreeId,
        },
        window.id,
      ),
    );
  }, [profileId, project, worktreeId, window.id]);

  return (
    <div
      data-os-changes-app={window.id}
      data-testid={`changes-app-${window.id}`}
      className="w-full h-full overflow-hidden flex flex-col bg-[var(--color-surface)] text-[var(--color-text)] select-none"
    >
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] shrink-0 text-xs font-medium">
        <button
          type="button"
          onClick={() => setActiveTab("changes")}
          className={`px-2.5 py-1 rounded transition-colors ${
            activeTab === "changes"
              ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-xs"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          Files
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("commit")}
          className={`px-2.5 py-1 rounded transition-colors ${
            activeTab === "commit"
              ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-xs"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          Commit
        </button>
        {selectedFile && (
          <button
            type="button"
            onClick={() => setActiveTab("diff")}
            className={`px-2.5 py-1 rounded transition-colors truncate max-w-[140px] ${
              activeTab === "diff"
                ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-xs"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            Diff: {selectedFile.split("/").pop()}
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 relative">
        {activeTab === "changes" && (
          <ChangedFilesList
            project={project}
            target={target}
            selectedFile={selectedFile}
            onSelectFile={handleSelectFile}
            onSelectConflict={handleSelectConflict}
            onOpenOperationResolver={handleOpenResolver}
          />
        )}
        {activeTab === "commit" && (
          <div className="h-full overflow-y-auto p-3">
            <GitLocalChanges project={project} target={target} />
          </div>
        )}
        {activeTab === "diff" && selectedFile && (
          <DiffViewer
            project={project}
            target={target}
            filePath={selectedFile}
            fileStatus={selectedSelection?.status ?? "M"}
            additions={selectedSelection?.additions ?? 0}
            deletions={selectedSelection?.deletions ?? 0}
            gitRootId={selectedSelection?.gitRootId ?? window.ctx.gitRootId}
            diffPath={selectedSelection?.diffPath}
            onClose={() => setActiveTab("changes")}
          />
        )}
      </div>
    </div>
  );
}
