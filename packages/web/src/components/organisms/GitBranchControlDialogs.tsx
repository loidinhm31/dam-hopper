import { Button } from "@/components/atoms/Button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog.js";
import { Input } from "@/components/ui/Input.js";
import { Label } from "@/components/ui/Label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select.js";
import type { Branch } from "@/api/client.js";

interface GitBranchCreateDialogProps {
  open: boolean;
  branchName: string;
  startPoint: string;
  checkoutAfterCreate: boolean;
  branches: Branch[];
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onBranchNameChange: (value: string) => void;
  onStartPointChange: (value: string) => void;
  onCheckoutAfterCreateChange: (value: boolean) => void;
  onSubmit: () => void;
}

export function GitBranchCreateDialog({
  open,
  branchName,
  startPoint,
  checkoutAfterCreate,
  branches,
  isPending,
  onOpenChange,
  onBranchNameChange,
  onStartPointChange,
  onCheckoutAfterCreateChange,
  onSubmit,
}: GitBranchCreateDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isPending) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Create Branch</DialogTitle>
          <DialogDescription>
            Create a branch from the current or selected base ref.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="branch-name">Branch name</Label>
            <Input
              id="branch-name"
              autoFocus
              value={branchName}
              onChange={(event) => onBranchNameChange(event.target.value)}
              placeholder="feature/my-branch"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="branch-start-point">Base ref</Label>
            <Select
              value={startPoint}
              disabled={isPending}
              onValueChange={onStartPointChange}
            >
              <SelectTrigger id="branch-start-point" className="h-9">
                <SelectValue placeholder="Select base ref" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((branch) => (
                  <SelectItem key={branch.name} value={branch.name}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text)]">
            <input
              type="checkbox"
              checked={checkoutAfterCreate}
              disabled={isPending}
              onChange={(event) =>
                onCheckoutAfterCreateChange(event.target.checked)
              }
              className="h-3.5 w-3.5 accent-[var(--color-primary)]"
            />
            Check out branch after creation
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isPending}
              disabled={isPending || !branchName.trim()}
            >
              Create branch
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface GitDirtyCheckoutDialogProps {
  targetBranch: string | null;
  isPending: boolean;
  onRetry: (strategy: "normal" | "stash" | "force") => void;
  onClose: () => void;
}

export function GitDirtyCheckoutDialog({
  targetBranch,
  isPending,
  onRetry,
  onClose,
}: GitDirtyCheckoutDialogProps) {
  return (
    <Dialog open={targetBranch !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Local changes detected</DialogTitle>
          <DialogDescription>
            Choose how to switch to <strong>{targetBranch}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => targetBranch && onRetry("normal")}
            loading={isPending}
          >
            Normal
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => targetBranch && onRetry("stash")}
            disabled={isPending}
          >
            Stash then checkout
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => targetBranch && onRetry("force")}
            disabled={isPending}
          >
            Force checkout
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
