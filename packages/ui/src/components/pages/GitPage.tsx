import { lazy, Suspense, useState, useMemo, useEffect, useRef } from "react";
import {
  GitCommit,
  GitBranch,
  History,
  Upload,
  AlertCircle,
} from "lucide-react";
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
  useGitRoots,
  useProjectStatus,
} from "@/api/queries.js";
import type {
  GitOpResult,
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
import {
  useGitHistoryStore,
  useGitHistoryHydrated,
} from "@/stores/git-history.js";
import { useGitHistoryView } from "@/hooks/use-git-history-view.js";
import { GitSquashFlow } from "@/components/organisms/GitSquashFlow.js";
import { GitHistoryToolbar } from "@/components/molecules/GitHistoryToolbar.js";
import { GitBranchControl } from "@/components/organisms/GitBranchControl.js";
import { cn } from "@/lib/utils.js";
import {
  buildProjectInfoPushTarget,
  describeProjectInfoRoot,
  formatProjectInfoRootLabel,
  projectInfoRootOptions,
  projectRelativePathForRoot,
} from "@/components/organisms/ProjectInfoPanel.js";
import { useLeasedGitPush } from "@/hooks/use-leased-git-push.js";
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
  bulkDisabledReason?: string | null;
  setFetchResults: (results: GitOpResult[] | null) => void;
  setPullResults: (results: GitOpResult[] | null) => void;
  setPushResults: (results: GitOpResult[] | null) => void;
}

function BulkGitOperations({
  selectedRefs,
  allProjectRefs,
  selectedRef,
  bulkDisabledReason,
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

  const leasedPushTarget = useMemo(
    () => ({
      ...(selectedTarget?.target ?? targetRef),
      project: selectedRef?.project ?? "",
    }),
    [selectedRef?.project, selectedTarget?.target, targetRef],
  );
  const leasedPush = useLeasedGitPush(
    leasedPushTarget,
    resolvedRootId === "." ? undefined : resolvedRootId,
  );

  const targetProjects = selectedRefs ?? allProjectRefs;
  const isBulkDisabled =
    isFetching ||
    isPulling ||
    targetProjects.length === 0 ||
    Boolean(bulkDisabledReason);

  const operationTargets: ProjectTargetInput[] = targetProjects.map((ref) =>
    selectedRef &&
    ref.profileId === selectedRef.profileId &&
    ref.project === selectedRef.project
      ? targetRef
      : ref,
  );
  const pushDisabledReason =
    bulkDisabledReason ??
    (selectedRef
      ? null
      : "Select exactly one project to push. Bulk push is deferred in this phase.");
  async function handleBulkFetch() {
    setFetchResults(null);
    setIsFetching(true);
    const byProfile: Record<string, ProjectTargetInput[]> = {};
    for (const target of operationTargets) {
      const norm = normalizeProjectTarget(target);
      const pId = norm.profileId || "";
      const group = byProfile[pId] ?? [];
      group.push(target);
      byProfile[pId] = group;
    }

    const allResults: GitOpResult[] = [];
    try {
      for (const profileTargets of Object.values(byProfile)) {
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
    const byProfile: Record<string, ProjectTargetInput[]> = {};
    for (const target of operationTargets) {
      const norm = normalizeProjectTarget(target);
      const pId = norm.profileId || "";
      const group = byProfile[pId] ?? [];
      group.push(target);
      byProfile[pId] = group;
    }

    const allResults: GitOpResult[] = [];
    try {
      for (const profileTargets of Object.values(byProfile)) {
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
      <PassphraseDialog {...leasedPush.passphraseDialogProps} />
      <GitForcePushDialog
        open={leasedPush.state !== "closed"}
        project={selectedRef?.project ?? ""}
        rootLabel={selectedRootLabel}
        state={leasedPush.state}
        preview={leasedPush.preview}
        result={leasedPush.result}
        error={leasedPush.error}
        onPrepare={() => void leasedPush.prepare()}
        onPublish={() => void leasedPush.publish()}
        onClose={leasedPush.close}
      />
      {bulkDisabledReason ? (
        <div className="mb-4 rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300">
          {bulkDisabledReason}
        </div>
      ) : null}
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
              disabled={isBulkDisabled}
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
              disabled={isBulkDisabled}
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
              loading={
                leasedPush.state === "preparing" ||
                leasedPush.state === "publishing"
              }
              disabled={!!pushDisabledReason || !selectedRef}
              onClick={() => {
                if (!selectedRef) return;
                void leasedPush.prepare();
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

          <SshRetryStatusMessage
            message={statusMessage || leasedPush.sshStatus}
          />
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

  const gitPageSelection = useGitHistoryStore((s) => s.gitPageSelection);
  const selectionRecoveryRequired = useGitHistoryStore(
    (s) => s.selectionRecoveryRequired,
  );
  const setGitPageSelection = useGitHistoryStore((s) => s.setGitPageSelection);
  const clearGitPageSelection = useGitHistoryStore(
    (s) => s.clearGitPageSelection,
  );
  const resetSelectionRecoveryRequired = useGitHistoryStore(
    (s) => s.resetSelectionRecoveryRequired,
  );
  const isGitHistoryHydrated = useGitHistoryHydrated();

  const [fetchResults, setFetchResults] = useState<GitOpResult[] | null>(null);
  const [pullResults, setPullResults] = useState<GitOpResult[] | null>(null);
  const [pushResults, setPushResults] = useState<GitOpResult[] | null>(null);

  const availableProjectByKey = useMemo(() => {
    const byKey: Record<string, ProjectRef> = {};
    for (const item of allProjects) {
      byKey[projectKey(item.ref)] = item.ref;
    }
    return byKey;
  }, [allProjects]);

  // Seed initial selection once both git-history and workspace stores are hydrated
  const hasSeededRef = useRef(false);
  useEffect(() => {
    if (hasSeededRef.current) return;
    if (!isGitHistoryHydrated) return;
    const isWorkspaceHydrated =
      typeof useWorkspaceStore.persist?.hasHydrated === "function"
        ? useWorkspaceStore.persist.hasHydrated()
        : true;
    if (!isWorkspaceHydrated) return;

    if (gitPageSelection !== null || selectionRecoveryRequired) {
      hasSeededRef.current = true;
      return;
    }

    hasSeededRef.current = true;
    if (workspaceProject) {
      setGitPageSelection([projectKey(workspaceProject)]);
    } else {
      setGitPageSelection([]);
    }
  }, [
    isGitHistoryHydrated,
    gitPageSelection,
    selectionRecoveryRequired,
    workspaceProject,
    setGitPageSelection,
  ]);

  const allProjectRefs = useMemo(
    () => allProjects.map((item) => item.ref),
    [allProjects],
  );

  const selectedKeys = useMemo(
    () => gitPageSelection ?? [],
    [gitPageSelection],
  );
  const checkedKeyMap = useMemo(() => {
    const map: Record<string, true> = {};
    for (const key of selectedKeys) {
      map[key] = true;
    }
    return map;
  }, [selectedKeys]);

  const { availableSelectedKeys, unavailableSelectedKeys } = useMemo(() => {
    const available: string[] = [];
    const unavailable: string[] = [];
    for (const key of selectedKeys) {
      if (availableProjectByKey[key]) {
        available.push(key);
      } else {
        unavailable.push(key);
      }
    }
    return {
      availableSelectedKeys: available,
      unavailableSelectedKeys: unavailable,
    };
  }, [selectedKeys, availableProjectByKey]);

  // Determine bulk target projects and disable state
  const { bulkTargetRefs, bulkDisabledReason } = useMemo(() => {
    if (selectionRecoveryRequired) {
      return {
        bulkTargetRefs: allProjectRefs,
        bulkDisabledReason:
          "Saved project selection requires recovery. Please select a valid project or click Clear.",
      };
    }
    if (unavailableSelectedKeys.length > 0) {
      const names = unavailableSelectedKeys
        .map((k) => parseProjectKey(k)?.project ?? k)
        .join(", ");
      return {
        bulkTargetRefs: allProjectRefs,
        bulkDisabledReason: `${unavailableSelectedKeys.length} selected project(s) (${names}) are offline or unavailable. Bulk operations are disabled to prevent unintended targets.`,
      };
    }
    if (selectedKeys.length === 0) {
      // Empty selection means all projects
      return {
        bulkTargetRefs: undefined,
        bulkDisabledReason: null,
      };
    }
    // Specific available projects selected
    const list: ProjectRef[] = [];
    for (const key of availableSelectedKeys) {
      const ref = availableProjectByKey[key];
      if (ref) list.push(ref);
    }
    return {
      bulkTargetRefs: list,
      bulkDisabledReason: null,
    };
  }, [
    selectionRecoveryRequired,
    unavailableSelectedKeys,
    selectedKeys.length,
    availableSelectedKeys,
    availableProjectByKey,
    allProjectRefs,
  ]);

  const isSingleAvailableSelected =
    selectedKeys.length === 1 &&
    unavailableSelectedKeys.length === 0 &&
    availableSelectedKeys.length === 1;

  const selectedRef = useMemo<ProjectRef | null>(() => {
    if (!isSingleAvailableSelected) return null;
    return availableProjectByKey[availableSelectedKeys[0]] ?? null;
  }, [isSingleAvailableSelected, availableProjectByKey, availableSelectedKeys]);

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

  const historyView = useGitHistoryView(
    normalizeProjectTarget(targetRef || { project: "" }),
    { available: isSingleAvailableSelected },
  );
  const historyActions = useGitHistoryActions(
    targetRef || "",
    historyView.rootId,
    historyView,
  );
  const openDiff = useEditorStore((s) => s.openDiff);
  const { data: projectStatus } = useProjectStatus(
    targetRef || "",
    Boolean(selectedRef),
  );

  // Reset history mutation dialogs whenever effective scope changes
  useEffect(() => {
    historyActions.resetScope();
  }, [historyView.effectiveScopeKey, historyActions.resetScope]);

  function handleToggleProject(ref: ProjectRef) {
    const key = projectKey(ref);
    const isCurrentlyChecked = Boolean(checkedKeyMap[key]);
    const nextKeys = isCurrentlyChecked
      ? selectedKeys.filter((k) => k !== key)
      : [...selectedKeys, key];

    if (selectionRecoveryRequired) {
      resetSelectionRecoveryRequired();
    }
    setGitPageSelection(nextKeys);
    setFetchResults(null);
    setPullResults(null);
    setPushResults(null);

    if (nextKeys.length === 1) {
      const singleKey = nextKeys[0];
      const nextRef = availableProjectByKey[singleKey];
      if (nextRef) {
        setSelectedProject(nextRef);
      }
    }
  }

  function handleClearSelection() {
    clearGitPageSelection();
    setFetchResults(null);
    setPullResults(null);
    setPushResults(null);
  }

  function handleDeselectUnavailableKey(key: string) {
    const nextKeys = selectedKeys.filter((k) => k !== key);
    if (selectionRecoveryRequired) {
      resetSelectionRecoveryRequired();
    }
    setGitPageSelection(nextKeys);
    setFetchResults(null);
    setPullResults(null);
    setPushResults(null);
    if (nextKeys.length === 1) {
      const singleKey = nextKeys[0];
      const nextRef = availableProjectByKey[singleKey];
      if (nextRef) {
        setSelectedProject(nextRef);
      }
    }
  }

  function handleFileDoubleClick(file: DiffFileEntry) {
    if (selectedRef && historyView.selectedCommit) {
      openDiff(
        selectedTarget?.target ?? selectedRef,
        projectRelativePathForRoot(historyView.rootId, file.path),
        file.status,
        file.additions,
        file.deletions,
        historyView.selectedCommit.hash,
      );
    }
  }

  async function handleDropCommitConfirm() {
    const droppedHash = await historyActions.handleDropCommit();
    if (!droppedHash) return;
    if (historyView.selectedCommit?.hash === droppedHash) {
      historyView.clearSelectedCommit();
    }
  }

  async function handleEditCommitMessageConfirm(
    message: string,
    allowSignatureRemoval?: boolean,
  ) {
    const editedHash = await historyActions.handleEditCommitMessage(
      message,
      allowSignatureRemoval,
    );
    if (!editedHash) return;
    if (historyView.selectedCommit?.hash === editedHash) {
      historyView.clearSelectedCommit();
    }
  }

  async function handleUndoLastCommitConfirm() {
    const undoneHash = await historyActions.handleUndoLastCommit();
    if (!undoneHash) return;
    if (historyView.selectedCommit?.hash === undoneHash) {
      historyView.clearSelectedCommit();
    }
  }

  const selectedRoot =
    historyView.rootOptions.find(
      (root) => root.rootId === historyView.rootId,
    ) ?? historyView.rootOptions[0];

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

        {selectionRecoveryRequired && (
          <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300 flex items-center justify-between">
            <span>
              Saved project selection was corrupted or invalid. Please select a
              valid project or click Clear to reset.
            </span>
            <button
              onClick={handleClearSelection}
              className="underline font-semibold ml-2 hover:text-amber-200"
            >
              Clear
            </button>
          </div>
        )}

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
                  checked={Boolean(checkedKeyMap[key])}
                  onChange={() => handleToggleProject(item.ref)}
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

          {unavailableSelectedKeys.map((key) => {
            const parsed = parseProjectKey(key);
            const name = parsed?.project ?? key;
            const profile = parsed?.profileId;
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1.5 text-sm px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300"
              >
                <input
                  type="checkbox"
                  checked={true}
                  onChange={() => handleDeselectUnavailableKey(key)}
                />
                <span className="font-medium">{name}</span>
                {profile && (
                  <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-amber-500/20 text-amber-200">
                    {profile}
                  </span>
                )}
                <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400">
                  (offline)
                </span>
                <button
                  type="button"
                  onClick={() => handleDeselectUnavailableKey(key)}
                  title="Deselect unavailable project"
                  className="ml-1 text-amber-400 hover:text-amber-200"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>

        {selectedKeys.length > 0 && (
          <div className="mt-2 flex items-center gap-2">
            <Badge variant="primary">{selectedKeys.length} selected</Badge>
            <button
              className="text-xs text-[var(--color-text-muted)] hover:underline"
              onClick={handleClearSelection}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <BulkGitOperations
        key={selectedRef ? projectKey(selectedRef) : "__all__"}
        selectedRefs={bulkTargetRefs}
        allProjectRefs={allProjectRefs}
        selectedRef={selectedRef}
        bulkDisabledReason={bulkDisabledReason}
        setFetchResults={setFetchResults}
        setPullResults={setPullResults}
        setPushResults={setPushResults}
      />
      {fetchResults && <ResultsSummary results={fetchResults} />}
      {pullResults && <ResultsSummary results={pullResults} />}
      {pushResults && <ResultsSummary results={pushResults} />}

      {/* Git Graph / History View */}
      {isSingleAvailableSelected && selectedProjectName ? (
        <div className="mt-8 space-y-4">
          <div className="flex flex-col gap-2">
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

            {/* VCS Root and History Branch controls */}
            <div className="grid gap-3 sm:grid-cols-2 mt-2 pt-3 border-t border-[var(--color-border)]">
              <label className="min-w-0">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                  VCS Root
                </span>
                <select
                  value={historyView.rootId}
                  onChange={(event) => {
                    historyView.setRootId(event.target.value);
                    historyActions.resetScope();
                  }}
                  className={cn(inputClass, "pr-8")}
                >
                  {historyView.rootOptions.map((root) => (
                    <option key={root.rootId} value={root.rootId}>
                      {formatProjectInfoRootLabel(root)} -{" "}
                      {describeProjectInfoRoot(root)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="min-w-0">
                <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                  History Branch
                </span>
                <GitBranchControl
                  project={selectedProjectName}
                  target={selectedTarget?.target ?? (selectedRef || undefined)}
                  root={historyView.rootId}
                  mode="view"
                  selectedBranchRef={historyView.branchRef}
                  onSelectedBranchRefChange={historyView.selectBranchRef}
                  selectedBranch={historyView.branchLabel}
                  onSelectedBranchChange={historyView.selectBranchRef}
                  className="w-full px-0"
                />
              </div>
            </div>
          </div>

          {selectedRoot?.warnings?.length ? (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
              {selectedRoot.warnings.join(" ")}
            </div>
          ) : null}

          {!historyView.isViewingActiveBranch && historyView.activeBranch ? (
            <div className="rounded border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-300">
              Viewing <strong>{historyView.branchLabel}</strong>. Cherry-pick
              and revert apply to checked-out branch{" "}
              <strong>{historyView.activeBranch}</strong>.
            </div>
          ) : null}

          <GitHistoryStatusBanner
            className="rounded-lg px-3 py-2 text-sm"
            status={historyActions.status}
          />

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[700px]">
            {/* Sidebar: Commit / Local Changes */}
            <div className="lg:col-span-1 flex flex-col h-full overflow-hidden">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-2">
                <GitCommit className="w-3.5 h-3.5" />
                Local Changes (Project root)
              </div>
              <Suspense fallback={GIT_PANEL_FALLBACK}>
                <GitLocalChanges
                  project={selectedProjectName}
                  target={selectedTarget?.target}
                />
              </Suspense>
            </div>

            {/* Main: Git Log Graph + Details */}
            <div className="lg:col-span-3 flex flex-col md:flex-row h-full overflow-hidden border border-[var(--color-border)] rounded-md bg-[var(--color-surface)]">
              <div
                className={cn(
                  "flex flex-col min-h-0 min-w-0 flex-1",
                  historyView.selectedCommit ? "w-full md:w-[65%]" : "w-full",
                )}
              >
                <div className="shrink-0 mb-0 px-4 py-2 border-b border-[var(--color-border)] text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-2 bg-[var(--color-background)]">
                  <History className="w-3.5 h-3.5" />
                  Commits
                </div>

                <GitHistoryToolbar
                  searchText={historyView.searchText}
                  squashCount={historyView.squashSelection.count}
                  squashDisabledReason={
                    historyView.squashUnavailableReason ||
                    historyView.squashSelection.disabledReason
                  }
                  squashBusy={
                    historyActions.squash.open ||
                    historyActions.squash.publication.state !== "closed"
                  }
                  onSquash={historyActions.squash.begin}
                  onClearSquashSelection={historyView.clearSquashSelection}
                  focusRef={historyActions.squash.toolbarRef}
                  onSearchChange={historyView.setSearchText}
                  onClearSearch={historyView.clearSearch}
                  onCompositionStart={historyView.onCompositionStart}
                  onCompositionEnd={historyView.onCompositionEnd}
                  isFiltered={historyView.isFiltered}
                  page={historyView.page}
                  offset={historyView.offset}
                  logsCount={historyView.logs.length}
                  hasPreviousPage={historyView.hasPreviousPage}
                  hasNextPage={historyView.hasNextPage}
                  onPreviousPage={historyView.previousPage}
                  onNextPage={historyView.nextPage}
                  onRefresh={() => void historyView.refresh()}
                  isRefreshing={historyView.isRefreshing}
                  isLoading={historyView.isLoading}
                  disabled={!historyView.availability.isAvailable}
                  followActive={historyView.followActive}
                  isViewingActiveBranch={historyView.isViewingActiveBranch}
                  branchLabel={historyView.branchLabel}
                  onFollowCheckedOutBranch={historyView.followCheckedOutBranch}
                  notice={historyView.notice}
                  onDismissNotice={historyView.dismissNotice}
                  className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]"
                />
                <GitSquashFlow squash={historyActions.squash} />

                {historyView.error ? (
                  <div className="m-3 flex items-center justify-between gap-2 rounded border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-300">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
                      <span className="truncate">
                        Failed to load git history: {historyView.error.message}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void historyView.refresh()}
                      disabled={historyView.isRefreshing}
                    >
                      Retry
                    </Button>
                  </div>
                ) : null}

                <div className="flex-1 min-h-0 overflow-hidden">
                  <Suspense fallback={GIT_PANEL_FALLBACK}>
                    <GitLogTree
                      squashSelectedHashes={historyView.squashSelectedHashes}
                      onToggleSquashCommit={historyView.toggleSquashCommit}
                      squashSelectionDisabled={
                        !historyView.squashAvailable ||
                        historyActions.squash.open ||
                        historyActions.squash.publication.state !== "closed"
                      }
                      logs={historyView.logs}
                      isLoading={historyView.isLoading}
                      presentation={historyView.isFiltered ? "list" : "graph"}
                      emptyMessage={
                        historyView.isFiltered
                          ? "No matching commits found."
                          : "No commits found in this branch history."
                      }
                      selectedHash={historyView.selectedCommit?.hash}
                      onSelectCommit={historyView.selectCommit}
                      onCherryPick={(entry) =>
                        void historyActions.handleCherryPick(entry)
                      }
                      onRevertCommit={historyActions.setRevertCommit}
                      onUndoLastCommit={
                        historyView.isViewingActiveBranch
                          ? historyActions.setUndoLastCommit
                          : undefined
                      }
                      onDropCommit={
                        historyView.isViewingActiveBranch
                          ? historyActions.setDropCommit
                          : undefined
                      }
                      onEditCommitMessage={
                        historyView.isViewingLocalBranch
                          ? historyActions.setEditCommit
                          : undefined
                      }
                      onReset={
                        historyView.isViewingActiveBranch
                          ? historyActions.setResetCommit
                          : undefined
                      }
                    />
                  </Suspense>
                </div>
              </div>

              {historyView.selectedCommit && (
                <div className="w-full md:w-[35%] h-[45%] md:h-full min-h-0 shrink-0">
                  <Suspense fallback={GIT_PANEL_FALLBACK}>
                    <CommitDetailsPanel
                      mode="history"
                      project={selectedProjectName}
                      target={selectedTarget?.target}
                      root={historyView.rootId}
                      commit={historyView.selectedCommit}
                      onClose={historyView.clearSelectedCommit}
                      onFileDoubleClick={handleFileDoubleClick}
                      onCherryPickSelectedChanges={(commit, files) =>
                        void historyActions.handleCherryPickFiles(commit, files)
                      }
                      onRevertSelectedChanges={(commit, files) =>
                        void historyActions.handleRevertFiles(commit, files)
                      }
                      onDropSelectedChanges={
                        historyView.isViewingActiveBranch
                          ? (commit, files) =>
                              void historyActions.handleDropFiles(commit, files)
                          : undefined
                      }
                    />
                  </Suspense>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : selectedKeys.length === 1 && unavailableSelectedKeys.length === 1 ? (
        <div className="mt-8 p-8 flex flex-col items-center justify-center text-center border-2 border-dashed border-amber-500/30 rounded-lg bg-amber-500/5">
          <AlertCircle className="w-12 h-12 text-amber-400 mb-3" />
          <h3 className="font-medium text-[var(--color-text)]">
            Selected Project Offline or Unavailable
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            The selected project &ldquo;
            {parseProjectKey(unavailableSelectedKeys[0])?.project ??
              unavailableSelectedKeys[0]}
            &rdquo; is not currently reachable. Its history will be available
            once reconnected.
          </p>
        </div>
      ) : selectedKeys.length > 1 ? (
        <div className="mt-8 p-8 flex flex-col items-center justify-center text-center border-2 border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-surface)]/50">
          <GitBranch className="w-12 h-12 text-[var(--color-text-muted)] mb-3" />
          <h3 className="font-medium text-[var(--color-text)]">
            Multiple Projects Selected ({selectedKeys.length})
          </h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Select exactly one project above to view its Git history graph.
          </p>
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
        signatureConsentRequired={historyActions.signatureConsentRequired}
        onClose={() => historyActions.setEditCommit(null)}
        onConfirm={(message, allowSignatureRemoval) =>
          void handleEditCommitMessageConfirm(message, allowSignatureRemoval)
        }
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
