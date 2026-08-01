import { useMemo, useRef, useState } from "react";
import { GitBranch, Plus } from "lucide-react";
import {
  useBranches,
  useGitCheckoutBranch,
  useGitCreateBranch,
  useGitDeleteBranch,
  useProjectStatus,
} from "@/api/queries.js";
import { Button } from "@/components/atoms/Button.js";
import { isGitUnavailableError } from "@/api/client.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import { cn } from "@/lib/utils.js";
import { GitBranchContextMenu } from "@/components/organisms/GitBranchContextMenu.js";
import {
  GitBranchCreateDialog,
  GitBranchDeleteDialog,
  GitDirtyCheckoutDialog,
} from "@/components/organisms/GitBranchControlDialogs.js";

interface GitBranchControlProps {
  project: string;
  root?: string;
  compact?: boolean;
  className?: string;
  showFeedback?: boolean;
  mode?: "checkout" | "view";
  selectedBranch?: string;
  onSelectedBranchChange?: (branch: string) => void;
}

interface BranchContextMenuState {
  x: number;
  y: number;
  branchName: string;
  isCurrent: boolean;
}

type CheckoutRetryStrategy = "normal" | "stash" | "force";

interface GitBranchFeedbackProps {
  message: string | null;
  error: string | null;
  showFeedback?: boolean;
}

export function GitBranchFeedback({
  message,
  error,
  showFeedback = true,
}: GitBranchFeedbackProps) {
  if (!showFeedback || (!message && !error)) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded border px-2 py-1 text-[10px] mt-1 mx-1",
        error
          ? "border-[var(--color-danger)]/20 bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
          : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
      )}
    >
      {error ?? message}
    </div>
  );
}

export function GitBranchControl({
  project,
  root,
  compact = false,
  className,
  showFeedback = true,
  mode = "checkout",
  selectedBranch,
  onSelectedBranchChange,
}: GitBranchControlProps) {
  const compactTextClass = "text-[length:calc(var(--app-font-size)*0.75)]";
  const { data: branches = [], error: branchesError } = useBranches(
    project,
    root,
  );
  const { data: projectStatus } = useProjectStatus(project);
  const checkoutBranch = useGitCheckoutBranch(project, root);
  const createBranch = useGitCreateBranch(project, root);
  const deleteBranch = useGitDeleteBranch(project, root);

  const [createOpen, setCreateOpen] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [startPoint, setStartPoint] = useState("");
  const [checkoutAfterCreate, setCheckoutAfterCreate] = useState(true);
  const [dirtyTarget, setDirtyTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<BranchContextMenuState | null>(
    null,
  );
  const selectTriggerRef = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentBranch =
    branches.find((branch) => branch.isCurrent)?.name ??
    (root && root !== "." ? "" : (projectStatus?.branch ?? ""));
  const branchValue =
    mode === "view" ? selectedBranch || currentBranch : currentBranch;
  const defaultStartPoint = useMemo(() => {
    const localBranches = branches.filter((branch) => !branch.isRemote);
    return currentBranch || localBranches[0]?.name || branches[0]?.name || "";
  }, [branches, currentBranch]);

  const localBranches = useMemo(
    () =>
      branches
        .filter((b) => !b.isRemote)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [branches],
  );

  const remoteBranches = useMemo(
    () =>
      branches
        .filter((b) => b.isRemote)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [branches],
  );

  const allSortedBranches = useMemo(
    () => [...localBranches, ...remoteBranches],
    [localBranches, remoteBranches],
  );
  const isMutating =
    checkoutBranch.isPending ||
    createBranch.isPending ||
    deleteBranch.isPending;

  if (isGitUnavailableError(branchesError)) {
    return (
      <div
        role="status"
        className={cn(
          "rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-300",
          className,
        )}
      >
        Git is not initialized for this project
      </div>
    );
  }

  async function runCheckout(
    branch: string,
    strategy: CheckoutRetryStrategy = "normal",
  ) {
    setError(null);
    setMessage(null);
    try {
      const result = await checkoutBranch.mutateAsync({ branch, strategy });
      if (result.ok) {
        setDirtyTarget(null);
        setMessage(result.message ?? `Checked out ${branch}`);
        return;
      }
      if (result.dirty) {
        setDirtyTarget(branch);
        setError(result.message ?? "Working tree has local changes");
        return;
      }
      setError(result.message ?? `Failed to check out ${branch}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Failed to check out ${branch}`,
      );
    }
  }

  async function handleCreateBranch() {
    if (!branchName.trim()) return;
    setError(null);
    setMessage(null);
    try {
      const result = await createBranch.mutateAsync({
        name: branchName.trim(),
        startPoint: startPoint || undefined,
        checkout: checkoutAfterCreate,
      });
      setCreateOpen(false);
      if (result.ok) {
        setMessage(result.message ?? `Created branch ${branchName.trim()}`);
        return;
      }
      if (result.dirty) {
        setDirtyTarget(branchName.trim());
        setError(result.message ?? "Working tree has local changes");
        return;
      }
      setError(result.message ?? `Failed to create ${branchName.trim()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create branch");
    }
  }

  async function handleDeleteBranch() {
    if (!deleteTarget) return;
    setError(null);
    setMessage(null);
    try {
      const result = await deleteBranch.mutateAsync({ name: deleteTarget });
      setDeleteTarget(null);
      if (result.ok) {
        if (
          mode === "view" &&
          selectedBranch === deleteTarget &&
          currentBranch
        ) {
          onSelectedBranchChange?.(currentBranch);
        }
        setMessage(result.message ?? `Deleted branch ${deleteTarget}`);
        return;
      }
      setError(result.message ?? `Failed to delete ${deleteTarget}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Failed to delete ${deleteTarget}`,
      );
    }
  }

  function openBranchContextMenu(
    branch: { name: string; isCurrent: boolean },
    x: number,
    y: number,
  ) {
    setSelectOpen(false);
    setContextMenu({
      x,
      y,
      branchName: branch.name,
      isCurrent: branch.isCurrent,
    });
  }

  function closeBranchContextMenu() {
    setContextMenu(null);
    window.setTimeout(() => {
      if (!selectTriggerRef.current?.disabled) {
        selectTriggerRef.current?.focus();
      }
    }, 0);
  }

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 px-1 min-w-0",
          compact && "max-w-full",
          className,
        )}
      >
        <GitBranch className="h-4 w-4 shrink-0 text-[var(--color-primary)] opacity-80" />
        <Select
          open={selectOpen}
          value={branchValue}
          disabled={isMutating}
          onOpenChange={setSelectOpen}
          onValueChange={(value) => {
            if (!value || value === branchValue) return;
            if (mode === "view") {
              onSelectedBranchChange?.(value);
              return;
            }
            void runCheckout(value);
          }}
        >
          <SelectTrigger
            ref={selectTriggerRef}
            className={cn(
              "min-w-0 h-8 font-bold px-3 glass-input font-sans tracking-tight",
              compact && compactTextClass,
              compact
                ? "w-[132px] sm:w-[168px] lg:w-[200px]"
                : "w-[300px] text-[11px]",
            )}
          >
            <SelectValue placeholder="Select branch" />
          </SelectTrigger>
          <SelectContent className="min-w-[200px]">
            {localBranches.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-[10px] uppercase tracking-wider opacity-50 px-2 py-1">
                  Local Branches
                </SelectLabel>
                {localBranches.map((branch) => (
                  <SelectItem
                    key={branch.name}
                    value={branch.name}
                    onPointerDown={(event) => {
                      if (event.button === 2) event.preventDefault();
                    }}
                    onPointerUp={(event) => {
                      if (event.button !== 2) return;
                      event.preventDefault();
                      event.stopPropagation();
                      openBranchContextMenu(
                        branch,
                        event.clientX,
                        event.clientY,
                      );
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openBranchContextMenu(
                        branch,
                        event.clientX,
                        event.clientY,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "ContextMenu" ||
                        (event.shiftKey && event.key === "F10")
                      ) {
                        event.preventDefault();
                        const rect =
                          event.currentTarget.getBoundingClientRect();
                        openBranchContextMenu(
                          branch,
                          rect.left + 24,
                          rect.top + 20,
                        );
                      }
                    }}
                    title="Right-click for branch actions"
                  >
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {remoteBranches.length > 0 && (
              <SelectGroup>
                <SelectLabel className="text-[10px] uppercase tracking-wider opacity-50 px-2 py-1">
                  Remote Branches
                </SelectLabel>
                {remoteBranches.map((branch) => (
                  <SelectItem key={branch.name} value={branch.name}>
                    <span className="flex items-center gap-2">
                      <span className="truncate">{branch.name}</span>
                      <span className="text-[9px] opacity-40 px-1 border border-current rounded-[2px]">
                        REMOTE
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        {mode === "checkout" ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0 px-2.5 h-8 hover:bg-[var(--color-primary)]/10 hover:text-[var(--color-primary)] transition-all"
            onClick={() => {
              setBranchName("");
              setStartPoint(defaultStartPoint);
              setCheckoutAfterCreate(true);
              setError(null);
              setMessage(null);
              setCreateOpen(true);
            }}
            disabled={isMutating}
            title="Create new branch"
          >
            <Plus className="h-4 w-4" />
            {!compact ? (
              <span className="ml-1">New Branch</span>
            ) : (
              <span className={cn("sr-only", compactTextClass)}>
                New Branch
              </span>
            )}
          </Button>
        ) : null}
      </div>

      {contextMenu ? (
        <GitBranchContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          branchName={contextMenu.branchName}
          isCurrent={contextMenu.isCurrent}
          onDelete={() => {
            setContextMenu(null);
            setDeleteTarget(contextMenu.branchName);
          }}
          onClose={closeBranchContextMenu}
        />
      ) : null}

      <GitBranchFeedback
        message={message}
        error={error}
        showFeedback={showFeedback}
      />
      {mode === "checkout" ? (
        <GitBranchCreateDialog
          open={createOpen}
          branchName={branchName}
          startPoint={startPoint}
          checkoutAfterCreate={checkoutAfterCreate}
          branches={allSortedBranches}
          isPending={createBranch.isPending}
          onOpenChange={setCreateOpen}
          onBranchNameChange={setBranchName}
          onStartPointChange={setStartPoint}
          onCheckoutAfterCreateChange={setCheckoutAfterCreate}
          onSubmit={() => void handleCreateBranch()}
        />
      ) : null}

      <GitBranchDeleteDialog
        branchName={deleteTarget}
        isPending={deleteBranch.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteBranch()}
      />

      {mode === "checkout" ? (
        <GitDirtyCheckoutDialog
          targetBranch={dirtyTarget}
          isPending={checkoutBranch.isPending}
          onRetry={(strategy) =>
            dirtyTarget && void runCheckout(dirtyTarget, strategy)
          }
          onClose={() => setDirtyTarget(null)}
        />
      ) : null}
    </>
  );
}
