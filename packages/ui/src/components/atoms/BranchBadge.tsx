import { GitBranch } from "lucide-react";

interface Props {
  branch: string | undefined;
}

export function BranchBadge({ branch }: Props) {
  if (!branch) return <span className="text-[var(--color-text-muted)]">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[var(--color-text-muted)] font-mono text-xs">
      <GitBranch className="h-3 w-3" />
      {branch}
    </span>
  );
}
