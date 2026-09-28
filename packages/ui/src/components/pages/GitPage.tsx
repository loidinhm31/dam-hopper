import { lazy, Suspense, useState, useMemo, useEffect, useRef } from "react";
import { GitCommit, GitBranch, History, Upload } from "lucide-react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { Button, inputClass } from "@/components/atoms/Button.js";
import { SshRetryStatusMessage } from "@/components/atoms/SshRetryStatusMessage.js";
import { ProgressList } from "@/components/organisms/ProgressList.js";
import { DiagnosticsExportButton } from "@/components/organisms/DiagnosticsExportButton.js";
import { PassphraseDialog } from "@/components/organisms/PassphraseDialog.js";
import { GitForcePushDialog } from "@/components/organisms/GitForcePushDialog.js";
import {
  useGitFetch,
  useGitPull,
  useGitPush,
  useGitLog,
  useGitRoots,
  useProjectStatus,
} from "@/api/queries.js";
import type {
  GitOpResult,
  GitLogEntry,
  DiffFileEntry,
  ProjectTargetInput,
} from "@/api/client.js";
import { normalizeProjectTarget } from "@/api/client.js";
import {
  projectKey,
  parseProjectKey,
  type ProjectRef,
} from "@/api/ownership.js";
import { Badge } from "@/components/atoms/Badge.js";
import { useGitWithSshRetry } from "@/hooks/use-git-with-ssh-retry.js";
import { useProjectTarget } from "@/hooks/use-project-target.js";
import { useAggregatedProjects } from "@/hooks/use-aggregated-projects.js";
import { useWorkspaceStore } from "@/stores/workspace.js";
import { useEditorStore } from "@/stores/editor.js";
import { cn } from "@/lib/utils.js";
import {
  buildProjectInfoPushTarget,
  buildProjectInfoPushTargetWithMode,
  describeProjectInfoRoot,
  formatProjectInfoRootLabel,
  projectInfoRootOptions,
} from "@/components/organisms/ProjectInfoPanel.js";
import {
  GitDropCommitDialog,
  GitEditCommitMessageDialog,
  GitHistoryStatusBanner,
  GitRevertCommitDialog,
  GitResetDialog,
  GitSelectedChangesDialog,
  GitUndoLastCommitDialog,
  useGitHistoryActions,
} from "@/components/organisms/GitHistoryActions.js";

const GitLogTree = lazy(() =>
  import("@/components/organisms/GitLogTree.js").then((m) => ({
    default: m.GitLogTree,
  })),
);
const GitLocalChanges = lazy(() =>
  import("@/components/organisms/GitLocalChanges.js").then((m) => ({
    default: m.GitLocalChanges,
  })),
);
const CommitDetailsPanel = lazy(() =>
  import("@/components/organisms/CommitDetailsPanel.js").then((m) => ({
    default: m.CommitDetailsPanel,
  })),
);

interface SectionResults {
  results: GitOpResult[];
}

const GIT_PANEL_FALLBACK = (
  <div className="flex h-full items-center justify-center text-xs text-[var(--color-text-muted)]">
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
    <span className="ml-2">Loading Git view…</span>
  </div>
);

function ResultsSummary({ results }: SectionResults) {
  const ok = results.filter((r) => r.success).length;
  const fail = results.filter((r) => !r.success);
  return (
    <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] p-3 text-sm">
      <div className="flex gap-3 mb-2">
        <span className="text-[var(--color-success)]">✓ {ok} succeeded</span>
        {fail.length > 0 && (
          <span className="text-[var(--color-danger)]">
            ✗ {fail.length} failed
          </span>
        )}
      </div>
      {fail.map((r) => (
        <div
          key={r.projectName}
          className="text-[var(--color-danger)] font-mono text-xs"
        >
          {r.projectName}:{" "}
          {typeof r.error === "string"
            ? r.error
            : ((r.error as unknown as { message?: string })?.message ??
              String(r.error))}
        </div>
      ))}
    </div>
  );
}

interface BulkGitOperationsProps {
  selectedRefs: ProjectRef[] | undefined;
  allProjectRefs: ProjectRef[];
  selectedRef: ProjectRef | null;
  setFetchResults: (results: GitOpResult[] | null) => void;
  setPullResults: (results: GitOpResult[] | null) => void;
  setPushResults: (results: GitOpResult[] | null) => void;
}

function BulkGitOperations({
  selectedRefs,
  allProjectRefs,
  selectedRef,
  setFetchResults,
  setPullResults,
  setPushResults,
}: BulkGitOperationsProps) {
  const selectedTarget = useProjectTarget(selectedRef);
  const targetRef = selectedTarget?.target ?? selectedRef ?? "";
  const gitFetch = useGitFetch();
  const gitPull = useGitPull();
  const gitPush = useGitPush();
  const [isFetching, setIsFetching] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const { data: roots = [] } = useGitRoots(targetRef);
  const rootOptions = projectInfoRootOptions(roots);
  const [selectedRootId, setSelectedRootId] = useState(".");
  const [forcePushOpen, setForcePushOpen] = useState(false);
  const resolvedRootId = rootOptions.some(
    (root) => root.rootId === selectedRootId,
  )
    ? selectedRootId
    : (rootOptions[0]?.rootId ?? ".");
  const selectedRoot =
    rootOptions.find((root) => root.rootId === resolvedRootId) ??
    rootOptions[0];
  const selectedRootLabel = selectedRoot
    ? formatProjectInfoRootLabel(selectedRoot)
    : "Project root";
  const { passphraseDialogProps, statusMessage, executeWithRetry } =
    useGitWithSshRetry();

  const targetProjects = selectedRefs ?? allProjectRefs;
  const operationTargets: ProjectTargetInput[] = targetProjects.map((ref) =>
    selectedRef &&
    ref.profileId === selectedRef.profileId &&
    ref.project === selectedRef.project
      ? targetRef
      : ref,
  );
  const pushDisabledReason = selectedRef
    ? null
    : "Select exactly one project to push. Bulk push is deferred in this phase.";

  async function handleBulkFetch() {
    setFetchResults(null);
    setIsFetching(true);
    const byProfile = new Map<string, ProjectTargetInput[]>();
    for (const target of operationTargets) {
      const norm = normalizeProjectTarget(target);
      const pId = norm.profileId || "";
      const group = byProfile.get(pId) ?? [];
      group.push(target);
      byProfile.set(pId, group);
    }

    const allResults: GitOpResult[] = [];
    try {
      for (const [, profileTargets] of byProfile) {
        try {
          const res = await executeWithRetry({ operation: "fetch" }, () =>
            gitFetch.mutateAsync(profileTargets),
          );
          if (Array.isArray(res)) {
            allResults.push(...res);
          } else if (res) {
            allResults.push(res);
          }
        } catch {
          // preserve already collected results for other profiles
        }
      }
    } finally {
      setFetchResults(allResults.length > 0 ? allResults : null);
      setIsFetching(false);
    }
  }

  async function handleBulkPull() {
    setPullResults(null);
    setIsPulling(true);
    const byProfile = new Map<string, ProjectTargetInput[]>();
    for (const target of operationTargets) {
      const norm = normalizeProjectTarget(target);
      const pId = norm.profileId || "";
      const group = byProfile.get(pId) ?? [];
      group.push(target);
      byProfile.set(pId, group);
    }

    const allResults: GitOpResult[] = [];
    try {
      for (const [, profileTargets] of byProfile) {
        try {
          const res = await executeWithRetry({ operation: "pull" }, () =>
            gitPull.mutateAsync(profileTargets),
          );
          if (Array.isArray(res)) {
            allResults.push(...res);
          } else if (res) {
            allResults.push(res);
          }
        } catch {
          // preserve already collected results for other profiles
        }
      }
    } finally {
      setPullResults(allResults.length > 0 ? allResults : null);
      setIsPulling(false);
    }
  }

  return (
    <>
      <PassphraseDialog {...passphraseDialogProps} />
      <GitForcePushDialog
        open={forcePushOpen}
        project={selectedRef?.project ?? ""}
        rootLabel={selectedRootLabel}
        loading={gitPush.isPending}
        onClose={() => setForcePushOpen(false)}
        onConfirm={() => {
          if (!selectedRef) return;
          setForcePushOpen(false);
          setPushResults(null);
          void executeWithRetry({ operation: "push" }, () =>
            gitPush.mutateAsync(
              buildProjectInfoPushTargetWithMode(
                selectedRef.project,
                resolvedRootId,
                true,
                selectedTarget?.target,
              ),
            ),
          )
            .then((result) => setPushResults(result))
            .catch(() => {});
        }}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              Bulk Fetch
            </h2>
            <Button
              variant="primary"
              size="sm"
              loading={isFetching || gitFetch.isPending}
              disabled={isFetching || isPulling || targetProjects.length === 0}
              onClick={() => void handleBulkFetch()}
            >
              Start Fetch
            </Button>
          </div>
          <ProgressList
            initialProjects={
              isFetching ? targetProjects.map((p) => p.project) : []
            }
          />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[var(--color-text)]">
              Bulk Pull
            </h2>
            <Button
              variant="primary"
              size="sm"
              loading={isPulling || gitPull.isPending}
              disabled={isFetching || isPulling || targetProjects.length === 0}
              onClick={() => void handleBulkPull()}
            >
              Start Pull
            </Button>
          </div>
          <ProgressList
            initialProjects={
              isPulling ? targetProjects.map((p) => p.project) : []
            }
          />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--color-text)]">
                Push
              </h2>
              <p className="text-xs text-[var(--color-text-muted)]">
                {pushDisabledReason ??
                  "Push the selected repository root after SSH authentication succeeds."}
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              loading={gitPush.isPending}
              disabled={!!pushDisabledReason}
              onClick={() => {
                if (!selectedRef) return;
                setPushResults(null);
                void executeWithRetry({ operation: "push" }, () =>
                  gitPush.mutateAsync(
                    buildProjectInfoPushTarget(
                      selectedRef.project,
                      resolvedRootId,
                      selectedTarget?.target,
                    ),
                  ),
                )
                  .then((result) => setPushResults(result))
                  .catch(() => {});
              }}
            >
              <Upload className="h-3 w-3" />
              Push
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={gitPush.isPending}
              disabled={!!pushDisabledReason}
              onClick={() => {
                if (!selectedRef) return;
                setForcePushOpen(true);
              }}
            >
              <Upload className="h-3 w-3" />
              Force Push
            </Button>
          </div>

          {selectedRef && rootOptions.length > 1 && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--color-text-muted)]">
                VCS Root
              </label>
              <select
                value={resolvedRootId}
                onChange={(e) => setSelectedRootId(e.target.value)}
                className={cn(inputClass, "pr-8")}
              >
                {rootOptions.map((root) => (
                  <option key={root.rootId} value={root.rootId}>
                    {formatProjectInfoRootLabel(root)} -{" "}
                    {describeProjectInfoRoot(root)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedRef && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm text-[var(--color-text-muted)]">
              <div className="font-medium text-[var(--color-text)]">
                {selectedRef.project}
              </div>
              <div className="mt-1 text-xs">
                Target root:{" "}
                <span className="font-mono text-[var(--color-text)]">
                  {formatProjectInfoRootLabel(
                    rootOptions.find(
                      (root) => root.rootId === resolvedRootId,
                    ) ?? rootOptions[0],
                  )}
                </span>
              </div>
            </div>
          )}

          <SshRetryStatusMessage message={statusMessage} />
        </section>
      </div>
    </>
  );
}

export function GitPage() {
  const { allProjects } = useAggregatedProjects();
  const workspaceProject = useWorkspaceStore((state) => state.selectedProject);
  const setSelectedProject = useWorkspaceStore(
    (state) => state.setSelectedProject,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedCommit, setSelectedCommit] = useState<GitLogEntry | null>(
    null,
  );

  const [fetchResults, setFetchResults] = useState<GitOpResult[] | null>(null);
  const [pullResults, setPullResults] = useState<GitOpResult[] | null>(null);
  const [pushResults, setPushResults] = useState<GitOpResult[] | null>(null);

  const availableProjectMap = useMemo(() => {
    const map = new Map<string, ProjectRef>();
    for (const item of allProjects) {
      map.set(projectKey(item.ref), item.ref);
    }
    return map;
  }, [allProjects]);

  // Seed initial selection from workspaceStore on mount or hydration
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (hasInitializedRef.current || allProjects.length === 0) return;
    hasInitializedRef.current = true;
    if (workspaceProject) {
      const key = projectKey(workspaceProject);
      if (availableProjectMap.has(key)) {
        setSelected(new Set([key]));
      }
    }
  }, [allProjects.length, availableProjectMap, workspaceProject]);

  const allProjectRefs = useMemo(
    () => allProjects.map((item) => item.ref),
    [allProjects],
  );

  const selectedRefs = useMemo(() => {
    if (selected.size === 0) return undefined;
    const list: ProjectRef[] = [];
    for (const key of selected) {
      const ref = availableProjectMap.get(key) ?? parseProjectKey(key);
      if (ref) list.push(ref);
    }
    return list;
  }, [availableProjectMap, selected]);

  const selectedRef = useMemo<ProjectRef | null>(() => {
    if (selected.size !== 1) return null;
    const singleKey = [...selected][0];
    return availableProjectMap.get(singleKey) ?? parseProjectKey(singleKey);
  }, [availableProjectMap, selected]);

  const selectedProjectName = selectedRef?.project ?? null;
  const selectedProfileName = useMemo(() => {
    if (!selectedRef) return null;
    const item = allProjects.find(
      (p) =>
        p.ref.profileId === selectedRef.profileId &&
        p.ref.project === selectedRef.project,
    );
    return item?.profileName ?? null;
  }, [allProjects, selectedRef]);

  const selectedTarget = useProjectTarget(selectedRef);
  const targetRef = selectedTarget?.target ?? selectedRef ?? "";

  const { data: logs = [], isLoading: isGitLogLoading } = useGitLog(
    targetRef,
    200,
    0,
  );
  const openDiff = useEditorStore((s) => s.openDiff);
  const historyActions = useGitHistoryActions(targetRef);
  const { data: projectStatus } = useProjectStatus(targetRef);

  function resetHistoryView() {
    setSelectedCommit(null);
    historyActions.resetScope();
  }

  function toggleProject(ref: ProjectRef) {
    resetHistoryView();
    setFetchResults(null);
    setPullResults(null);
    setPushResults(null);
    const key = projectKey(ref);
    const next = new Set(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setSelected(next);
    if (next.size === 1) {
      const singleKey = [...next][0];
      const nextRef =
        availableProjectMap.get(singleKey) ?? parseProjectKey(singleKey);
      if (nextRef) setSelectedProject(nextRef);
    } else {
      setSelectedProject(null);
    }
  }

  function handleFileDoubleClick(file: DiffFileEntry) {
    if (selectedRef && selectedCommit) {
      openDiff(
        selectedTarget?.target ?? selectedRef,
        file.path,
        file.status,
        file.additions,
        file.deletions,
        selectedCommit.hash,
      );
    }
  }

  async function handleDropCommitConfirm() {
    const droppedHash = await historyActions.handleDropCommit();
    if (!droppedHash) return;
    setSelectedCommit((current) =>
      current?.hash === droppedHash ? null : current,
    );
  }

  async function handleEditCommitMessageConfirm(message: string) {
    const editedHash = await historyActions.handleEditCommitMessage(message);
    if (!editedHash) return;
    setSelectedCommit((current) =>
      current?.hash === editedHash ? null : current,
    );
  }

  async function handleUndoLastCommitConfirm() {
    const undoneHash = await historyActions.handleUndoLastCommit();
    if (!undoneHash) return;
    setSelectedCommit((current) =>
      current?.hash === undoneHash ? null : current,
    );
  }

  const hasMultipleProfiles = useMemo(() => {
    if (allProjects.length <= 1) return false;
    const first = allProjects[0].profileId;
    return allProjects.some((p) => p.profileId !== first);
  }, [allProjects]);

  return (
    <AppLayout
      title="Git Operations"
      actions={
        <DiagnosticsExportButton
          compact
          terminalIds={[]}
          includeTerminalOutput={false}
          scope={{
            page: "git",
            route: "/git",
            project: selectedProjectName,
            frontendScopes: ["GitPage", "git"],
          }}
        />
      }
    >
      {/* Project selector */}
      <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] p-4 mb-6">
        <p className="text-sm font-medium text-[var(--color-text)] mb-3">
          Select projects (empty = all)
        </p>
        <div className="flex flex-wrap gap-2">
          {allProjects.map((item) => {
            const key = projectKey(item.ref);
            return (
              <label
                key={key}
                className="flex items-center gap-1.5 text-sm cursor-pointer px-2 py-1 rounded bg-[var(--color-surface-2)]/60 hover:bg-[var(--color-surface-2)]"
              >
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => toggleProject(item.ref)}
                />
                <span className="font-medium text-[var(--color-text)]">
                  {item.project.name}
                </span>
                {hasMultipleProfiles && item.profileName && (
                  <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-[var(--color-surface)] text-[var(--color-text-muted)]">
                    {item.profileName}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {selected.size > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="primary">{selected.size} selected</Badge>
            <button
              className="text-xs text-[var(--color-text-muted)] hover:underline"
              onClick={() => {
                resetHistoryView();
                setSelected(new Set());
                setSelectedProject(null);
              }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <BulkGitOperations
        key={selectedRef ? projectKey(selectedRef) : "__all__"}
        selectedRefs={selectedRefs}
        allProjectRefs={allProjectRefs}
        selectedRef={selectedRef}
        setFetchResults={setFetchResults}
        setPullResults={setPullResults}
        setPushResults={setPushResults}
      />
      {fetchResults && <ResultsSummary results={fetchResults} />}
      {pullResults && <ResultsSummary results={pullResults} />}
      {pushResults && <ResultsSummary results={pushResults} />}

      {/* Git Graph View */}
      {selectedProjectName ? (
        <div className="mt-8 space-y-4">
          <h2 className="text-base font-semibold text-[var(--color-text)] flex items-center gap-2">
            Git Repository: {selectedProjectName}
            {selectedProfileName && (
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
                {selectedProfileName}
              </span>
            )}
            {projectStatus?.branch && (
              <Badge
                variant="primary"
                className="ml-1 text-[var(--color-primary)] bg-[var(--color-primary)]/5 border-[var(--color-primary)]/20"
              >
                <GitBranch className="w-3 h-3 mr-1" />
                {projectStatus.branch}
              </Badge>
            )}
          </h2>
          <GitHistoryStatusBanner
            className="rounded-lg px-3 py-2 text-sm"
            status={historyActions.status}
          />
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[700px]">
            {/* Sidebar: Commit / Local Changes */}
            <div className="lg:col-span-1 flex flex-col h-full overflow-hidden">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-2">
                <GitCommit className="w-3.5 h-3.5" />
                Local Changes
              </div>
              <Suspense fallback={GIT_PANEL_FALLBACK}>
                <GitLocalChanges
                  project={selectedProjectName}
                  target={selectedTarget?.target}
                />
              </Suspense>
            </div>

            {/* Main: Git Log Graph + Details */}
            <div className="lg:col-span-3 flex h-full overflow-hidden border border-[var(--color-border)] rounded-md bg-[var(--color-surface)]">
              <div
                className={cn(
                  "flex flex-col min-w-0 flex-1",
                  selectedCommit ? "w-[65%]" : "w-full",
                )}
              >
                <div className="shrink-0 mb-0 px-4 py-2 border-b border-[var(--color-border)] text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-2 bg-[var(--color-background)]">
                  <History className="w-3.5 h-3.5" />
                  Commits
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <Suspense fallback={GIT_PANEL_FALLBACK}>
                    <GitLogTree
                      logs={logs}
                      isLoading={isGitLogLoading}
                      selectedHash={selectedCommit?.hash}
                      onSelectCommit={setSelectedCommit}
                      onCherryPick={(entry) =>
                        void historyActions.handleCherryPick(entry)
                      }
                      onRevertCommit={historyActions.setRevertCommit}
                      onUndoLastCommit={historyActions.setUndoLastCommit}
                      onDropCommit={historyActions.setDropCommit}
                      onEditCommitMessage={historyActions.setEditCommit}
                      onReset={historyActions.setResetCommit}
                    />
                  </Suspense>
                </div>
              </div>

              {selectedCommit && (
                <div className="w-[35%] h-full shrink-0">
                  <Suspense fallback={GIT_PANEL_FALLBACK}>
                    <CommitDetailsPanel
                      project={selectedProjectName}
                      target={selectedTarget?.target}
                      commit={selectedCommit}
                      onClose={() => setSelectedCommit(null)}
                      onFileDoubleClick={handleFileDoubleClick}
                      onCherryPickSelectedChanges={(commit, files) =>
                        void historyActions.handleCherryPickFiles(commit, files)
                      }
                      onRevertSelectedChanges={
                        historyActions.requestRevertFiles
                      }
                      onDropSelectedChanges={(commit, files) =>
                        historyActions.requestDropFiles(commit, files)
                      }
                    />
                  </Suspense>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-8 p-8 flex flex-col items-center justify-center text-center border-2 border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-surface)]/50">
          <GitBranch className="w-12 h-12 text-[var(--color-text-muted)] mb-3" />
          <h3 className="font-medium text-[var(--color-text)]">
            No Project Selected
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Select exactly one project above to view its Git history graph,
            structured similarly to IDE tools.
          </p>
        </div>
      )}
      <GitResetDialog
        commit={historyActions.resetCommit}
        onClose={() => historyActions.setResetCommit(null)}
        onConfirm={(mode) => void historyActions.handleReset(mode)}
      />
      <GitDropCommitDialog
        commit={historyActions.dropCommit}
        loading={historyActions.isDropCommitPending}
        onClose={() => historyActions.setDropCommit(null)}
        onConfirm={() => void handleDropCommitConfirm()}
      />
      <GitEditCommitMessageDialog
        commit={historyActions.editCommit}
        originalMessage={historyActions.editCommitMessage}
        loading={historyActions.editCommitMessageLoading}
        saving={historyActions.isEditCommitMessagePending}
        error={historyActions.editCommitMessageError}
        onClose={() => historyActions.setEditCommit(null)}
        onConfirm={(message) => void handleEditCommitMessageConfirm(message)}
      />
      <GitRevertCommitDialog
        commit={historyActions.revertCommit}
        loading={historyActions.isRevertCommitPending}
        onClose={() => historyActions.setRevertCommit(null)}
        onConfirm={() => void historyActions.handleRevertCommit()}
      />
      <GitUndoLastCommitDialog
        commit={historyActions.undoLastCommit}
        loading={historyActions.isUndoLastCommitPending}
        onClose={() => historyActions.setUndoLastCommit(null)}
        onConfirm={() => void handleUndoLastCommitConfirm()}
      />
      <GitSelectedChangesDialog
        operation={historyActions.selectedChangesOperation}
        loading={historyActions.isSelectedChangesPending}
        onClose={historyActions.clearSelectedChangesOperation}
        onConfirm={() => void historyActions.handleSelectedChangesOperation()}
      />
    </AppLayout>
  );
}
