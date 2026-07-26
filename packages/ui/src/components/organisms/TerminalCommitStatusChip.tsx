import { useProjectStatus } from "@/api/queries.js";

interface TerminalCommitStatusChipProps {
  project?: string | null;
  enabled: boolean;
}

function formatCommitDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * A passive, space-conscious latest-commit summary for a terminal header.
 * It intentionally has no refresh affordance or polling: Git mutations
 * invalidate the shared project-status query when a newer value is needed.
 */
export function TerminalCommitStatusChip({
  project,
  enabled,
}: TerminalCommitStatusChipProps) {
  const shouldQuery = enabled && Boolean(project);
  const {
    data: status,
    isLoading,
    isError,
  } = useProjectStatus(project ?? "", shouldQuery);

  if (
    !shouldQuery ||
    isLoading ||
    isError ||
    !status ||
    status.pathExists === false ||
    status.statusError ||
    !status.branch ||
    !status.lastCommit?.hash ||
    !status.lastCommit.message
  ) {
    return null;
  }

  const formattedDate = formatCommitDate(status.lastCommit.date);
  if (!formattedDate) return null;

  const shortHash = status.lastCommit.hash.slice(0, 7);
  const accessibleLabel = `Latest commit on ${status.branch}: ${status.lastCommit.message}. ${status.lastCommit.date}. ${status.lastCommit.hash}.`;

  return (
    <div
      aria-label={accessibleLabel}
      className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/55 px-2 py-1 text-[11px] leading-none text-[var(--color-text-muted)] shadow-sm"
      role="status"
      title={accessibleLabel}
    >
      <span
        className="shrink-0 font-mono text-[var(--color-text)]"
        title={status.branch}
      >
        {status.branch}
      </span>
      <span aria-hidden="true" className="text-[var(--color-border)]">
        ·
      </span>
      <span
        className="min-w-0 truncate text-[var(--color-text-muted)]"
        title={status.lastCommit.message}
      >
        {status.lastCommit.message}
      </span>
      <time
        className="hidden shrink-0 text-[var(--color-text-muted)] lg:inline"
        dateTime={new Date(status.lastCommit.date).toISOString()}
        title={status.lastCommit.date}
      >
        {formattedDate}
      </time>
      <span
        className="shrink-0 font-mono text-[var(--color-primary)]"
        title={status.lastCommit.hash}
      >
        {shortHash}
      </span>
    </div>
  );
}
