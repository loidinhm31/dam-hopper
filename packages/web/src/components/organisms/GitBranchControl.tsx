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
  SelectGroup,
  SelectItem,
  SelectLabel,
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

  const localBranches = useMemo(
    () => branches.filter((b) => !b.isRemote).sort((a, b) => a.name.localeCompare(b.name)),
    [branches],
  );

  const remoteBranches = useMemo(
    () => branches.filter((b) => b.isRemote).sort((a, b) => a.name.localeCompare(b.name)),
    [branches],
  );

  const allSortedBranches = useMemo(() => [...localBranches, ...remoteBranches], [localBranches, remoteBranches]);

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
          "flex items-center gap-2 px-1 min-w-0",
          compact && "max-w-full",
          className,
        )}
      >
        <GitBranch className="h-4 w-4 shrink-0 text-[var(--color-primary)] opacity-80" />
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
            "min-w-0 h-8 text-[11px] font-bold px-3 glass-input font-sans tracking-tight",
            compact ? "w-[200px]" : "w-[300px]",
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
                  <SelectItem key={branch.name} value={branch.name}>
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
                      <span className="text-[9px] opacity-40 px-1 border border-current rounded-[2px]">REMOTE</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
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
          disabled={checkoutBranch.isPending || createBranch.isPending}
          title="Create new branch"
        >
          <Plus className="h-4 w-4" />
          {!compact ? <span className="ml-1">New Branch</span> : null}
        </Button>
      </div>

      {(message || error) && (
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
      )}
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

      <GitDirtyCheckoutDialog
        targetBranch={dirtyTarget}
        isPending={checkoutBranch.isPending}
        onRetry={(strategy) => dirtyTarget && void runCheckout(dirtyTarget, strategy)}
        onClose={() => setDirtyTarget(null)}
      />
    </>
  );
}
