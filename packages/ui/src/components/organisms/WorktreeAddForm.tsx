import { useState } from "react";
import { useAddWorktree } from "@/api/queries.js";
import { Button, inputClass } from "@/components/atoms/Button.js";

interface WorktreeAddFormProps {
  projectName: string;
  onCancel: () => void;
  onAdded: () => void;
}

export function WorktreeAddForm({
  projectName,
  onCancel,
  onAdded,
}: WorktreeAddFormProps) {
  const addWorktree = useAddWorktree(projectName);
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    if (!path || !branch) return;
    setError(null);
    addWorktree.mutate(
      { path, branch, createBranch },
      {
        onSuccess: () => {
          setPath("");
          setBranch("");
          setCreateBranch(false);
          onAdded();
        },
        onError: (mutationError) => {
          setError(
            mutationError instanceof Error
              ? mutationError.message
              : "Failed to add worktree",
          );
        },
      },
    );
  }

  return (
    <div className="space-y-1.5">
      <label
        htmlFor="worktree-path"
        className="text-xs text-[var(--color-text-muted)]"
      >
        Path
      </label>
      <input
        id="worktree-path"
        type="text"
        placeholder="/path/to/worktree"
        value={path}
        onChange={(event) => setPath(event.target.value)}
        className={inputClass}
      />
      <label
        htmlFor="worktree-branch"
        className="text-xs text-[var(--color-text-muted)]"
      >
        Branch name
      </label>
      <input
        id="worktree-branch"
        type="text"
        placeholder="feature/my-branch"
        value={branch}
        onChange={(event) => setBranch(event.target.value)}
        className={inputClass}
      />
      <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] cursor-pointer">
        <input
          type="checkbox"
          checked={createBranch}
          onChange={(event) => setCreateBranch(event.target.checked)}
          className="rounded"
        />
        Create new branch
      </label>
      {error && (
        <p className="text-xs text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="primary"
          loading={addWorktree.isPending}
          onClick={handleAdd}
        >
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
