import { useState } from "react";
import { Download, GitBranch, RefreshCw, Upload } from "lucide-react";
import {
  isGitUnavailableError,
  normalizeProjectTarget,
  type ProjectTargetRef,
} from "@/api/client.js";
import {
  useBranches,
  useGitFetch,
  useGitPull,
  useGitPush,
  useGitRoots,
} from "@/api/queries.js";
import { Button, inputClass } from "@/components/atoms/Button.js";
import { GitForcePushDialog } from "@/components/organisms/GitForcePushDialog.js";
import { PassphraseDialog } from "@/components/organisms/PassphraseDialog.js";
import { SshRetryStatusMessage } from "@/components/atoms/SshRetryStatusMessage.js";
import { useGitWithSshRetry } from "@/hooks/use-git-with-ssh-retry.js";
import { cn } from "@/lib/utils.js";
import {
  buildProjectInfoPushTarget,
  buildProjectInfoPushTargetWithMode,
  describeProjectInfoRoot,
  formatProjectInfoRootLabel,
  projectInfoRootOptions,
  DEFAULT_GIT_ROOT_ID,
} from "./ProjectInfoHelpers.js";

export function ProjectInfoGitSection({
  projectName,
  target,
}: {
  projectName: string;
  target?: ProjectTargetRef;
}) {
  const targetRef = normalizeProjectTarget(target ?? projectName);
  const { data: roots = [], error: rootsError } = useGitRoots(targetRef);
  const rootOptions = projectInfoRootOptions(roots);
  const [selectedRootId, setSelectedRootId] = useState(DEFAULT_GIT_ROOT_ID);
  const resolvedRootId = rootOptions.some(
    (root) => root.rootId === selectedRootId,
  )
    ? selectedRootId
    : (rootOptions[0]?.rootId ?? DEFAULT_GIT_ROOT_ID);
  const { data: branches = [], error: branchesError } = useBranches(
    targetRef,
    resolvedRootId,
  );
  const gitFetch = useGitFetch();
  const gitPull = useGitPull();
  const gitPush = useGitPush();
  const [forcePushOpen, setForcePushOpen] = useState(false);
  const { passphraseDialogProps, statusMessage, executeWithRetry } =
    useGitWithSshRetry();
  const selectedRoot =
    rootOptions.find((root) => root.rootId === resolvedRootId) ??
    rootOptions[0];
  const selectedRootLabel = selectedRoot
    ? formatProjectInfoRootLabel(selectedRoot)
    : "Project root";

  if (
    isGitUnavailableError(rootsError) ||
    isGitUnavailableError(branchesError)
  ) {
    return (
      <div className="px-3 py-3 text-xs text-[var(--color-text-muted)]">
        Git is not initialized for this project. Run{" "}
        <code className="font-mono">git init</code> to enable Git actions.
      </div>
    );
  }

  return (
    <div className="px-3 py-2 space-y-2">
      <PassphraseDialog {...passphraseDialogProps} />
      <GitForcePushDialog
        open={forcePushOpen}
        project={projectName}
        rootLabel={selectedRootLabel}
        loading={gitPush.isPending}
        onClose={() => setForcePushOpen(false)}
        onConfirm={() => {
          setForcePushOpen(false);
          void executeWithRetry({ operation: "push" }, () =>
            gitPush.mutateAsync(
              buildProjectInfoPushTargetWithMode(
                projectName,
                resolvedRootId,
                true,
                targetRef,
              ),
            ),
          ).catch(() => {});
        }}
      />
      {rootOptions.length > 1 && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">
            VCS Root
          </label>
          <select
            value={resolvedRootId}
            onChange={(event) => setSelectedRootId(event.target.value)}
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
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant="secondary"
          loading={gitFetch.isPending}
          onClick={() =>
            void executeWithRetry({ operation: "fetch" }, () =>
              gitFetch.mutateAsync([targetRef]),
            ).catch(() => {})
          }
        >
          <RefreshCw className="h-3 w-3" />
          Fetch
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={gitPull.isPending}
          onClick={() =>
            void executeWithRetry({ operation: "pull" }, () =>
              gitPull.mutateAsync([targetRef]),
            ).catch(() => {})
          }
        >
          <Download className="h-3 w-3" />
          Pull
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={gitPush.isPending}
          onClick={() =>
            void executeWithRetry({ operation: "push" }, () =>
              gitPush.mutateAsync(
                buildProjectInfoPushTarget(
                  projectName,
                  resolvedRootId,
                  targetRef,
                ),
              ),
            ).catch(() => {})
          }
        >
          <Upload className="h-3 w-3" />
          Push
        </Button>
        <Button
          size="sm"
          variant="danger"
          loading={gitPush.isPending}
          onClick={() => setForcePushOpen(true)}
        >
          <Upload className="h-3 w-3" />
          Force Push
        </Button>
      </div>
      <SshRetryStatusMessage message={statusMessage} />
      {branches.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-xs text-[var(--color-text-muted)] font-medium">
            Branches
          </p>
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {branches.map((branch) => (
              <div
                key={branch.name}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-0.5 rounded text-xs",
                  branch.isCurrent
                    ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                    : "text-[var(--color-text-muted)]",
                )}
              >
                <GitBranch className="h-3 w-3 shrink-0" />
                <span className="truncate">{branch.name}</span>
                {branch.isCurrent && (
                  <span className="ml-auto text-[10px] opacity-60">
                    current
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
