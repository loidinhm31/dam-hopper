import { useMemo, useState } from "react";
import { GitBranch, Plus } from "lucide-react";
import {
  useBranches,
  useGitCheckoutBranch,
  useGitCreateBranch,
  useProjectStatus,
} from "@/api/queries.js";
import { Button } from "@/components/atoms/Button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import { cn } from "@/lib/utils.js";
import {
  GitBranchCreateDialog,
  GitDirtyCheckoutDialog,
} from "@/components/organisms/GitBranchControlDialogs.js";

interface GitBranchControlProps {
  project: string;
  compact?: boolean;
  className?: string;
}

type CheckoutRetryStrategy = "normal" | "stash" | "force";

export function GitBranchControl({
  project,
  compact = false,
  className,
}: GitBranchControlProps) {
  const { data: branches = [] } = useBranches(project);
  const { data: projectStatus } = useProjectStatus(project);
  const checkoutBranch = useGitCheckoutBranch(project);
  const createBranch = useGitCreateBranch(project);

  const [createOpen, setCreateOpen] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [startPoint, setStartPoint] = useState("");
  const [checkoutAfterCreate, setCheckoutAfterCreate] = useState(true);
  const [dirtyTarget, setDirtyTarget] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentBranch = projectStatus?.branch ?? "";
  const defaultStartPoint = useMemo(() => {
    const localBranches = branches.filter((branch) => !branch.isRemote);
    return (
      currentBranch ||
      localBranches[0]?.name ||
      branches[0]?.name ||
      ""
    );
  }, [branches, currentBranch]);
  const branchOptions = useMemo(
    () =>
      [...branches].sort((a, b) => {
        if (a.isCurrent) return -1;
        if (b.isCurrent) return 1;
        if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
        return a.name.localeCompare(b.name);
      }),
    [branches],
  );

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
      setError(err instanceof Error ? err.message : `Failed to check out ${branch}`);
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

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-1.5 min-w-0",
          compact && "max-w-full",
          className,
        )}
      >
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]" />
        <Select
          value={currentBranch || undefined}
          disabled={checkoutBranch.isPending || createBranch.isPending}
          onValueChange={(value) => {
            if (!value || value === currentBranch) return;
            void runCheckout(value);
          }}
        >
          <SelectTrigger
            className={cn(
              "min-w-0 h-7 text-xs",
              compact ? "w-[140px] px-2" : "w-[220px]",
            )}
          >
            <SelectValue placeholder="Select branch" />
          </SelectTrigger>
          <SelectContent>
            {branchOptions.map((branch) => (
              <SelectItem key={branch.name} value={branch.name}>
                <span className="inline-flex items-center gap-2">
                  <span>{branch.name}</span>
                  {branch.isRemote ? (
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      remote
                    </span>
                  ) : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="shrink-0 px-2"
          onClick={() => {
            setBranchName("");
            setStartPoint(defaultStartPoint);
            setCheckoutAfterCreate(true);
            setError(null);
            setMessage(null);
            setCreateOpen(true);
          }}
          disabled={checkoutBranch.isPending || createBranch.isPending}
        >
          <Plus className="h-3.5 w-3.5" />
          {!compact ? "New" : null}
        </Button>
      </div>

      {(message || error) && (
        <div
          className={cn(
            "rounded border px-2 py-1 text-[10px]",
            error
              ? "border-[var(--color-danger)]/20 bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
              : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
          )}
        >
          {error ?? message}
        </div>
      )}
      <GitBranchCreateDialog
        open={createOpen}
        branchName={branchName}
        startPoint={startPoint}
        checkoutAfterCreate={checkoutAfterCreate}
        branches={branchOptions}
        isPending={createBranch.isPending}
        onOpenChange={setCreateOpen}
        onBranchNameChange={setBranchName}
        onStartPointChange={setStartPoint}
        onCheckoutAfterCreateChange={setCheckoutAfterCreate}
        onSubmit={() => void handleCreateBranch()}
      />

      <GitDirtyCheckoutDialog
        targetBranch={dirtyTarget}
        isPending={checkoutBranch.isPending}
        onRetry={(strategy) => dirtyTarget && void runCheckout(dirtyTarget, strategy)}
        onClose={() => setDirtyTarget(null)}
      />
    </>
  );
}
