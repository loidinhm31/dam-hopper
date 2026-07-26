import { GitBranch, GitCommitHorizontal, RefreshCw } from "lucide-react";
import { Button } from "@/components/atoms/Button.js";
import type { GitStatus } from "@/api/client.js";
import type { ReactNode } from "react";

interface SettingsProjectStatusSectionProps {
  activeProject: string | null;
  status?: GitStatus | null;
  isLoading: boolean;
  error?: Error | null;
  onRefresh: () => void;
}

function parseCommitDate(value: string | undefined) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function formatCommitDate(date: Date | null) {
  if (!date) return null;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function SettingsProjectStatusSection({
  activeProject,
  status,
  isLoading,
  error,
  onRefresh,
}: SettingsProjectStatusSectionProps) {
  const canRefresh = Boolean(activeProject) && !isLoading;

  if (!activeProject) {
    return <StatusMessage>No active project selected.</StatusMessage>;
  }

  if (isLoading) {
    return <StatusMessage loading>Checking latest commit…</StatusMessage>;
  }

  if (error) {
    return (
      <StatusMessage tone="danger" role="alert">
        Could not read project status. Try refreshing again.
      </StatusMessage>
    );
  }

  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--color-text)]">
            Latest commit
          </p>
          <p
            className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]"
            title={activeProject}
          >
            {activeProject}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]"
          disabled={!canRefresh}
          aria-label="Refresh latest commit"
          onClick={onRefresh}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {status === undefined ? (
        <StatusMessage>
          Refresh to check this project&apos;s latest commit.
        </StatusMessage>
      ) : status === null ? (
        <StatusMessage>This project is not a Git repository.</StatusMessage>
      ) : status.pathExists === false ? (
        <StatusMessage tone="danger" role="alert">
          This project path is no longer available.
        </StatusMessage>
      ) : status.statusError ? (
        <StatusMessage tone="danger" role="alert">
          Git status is unavailable for this project. Try refreshing again.
        </StatusMessage>
      ) : !status.lastCommit?.hash || !status.lastCommit.message ? (
        <StatusMessage>This Git repository has no commits yet.</StatusMessage>
      ) : (
        <CommitSummary status={status} />
      )}
    </div>
  );
}

function CommitSummary({ status }: { status: GitStatus }) {
  const commit = status.lastCommit;
  const commitDate = parseCommitDate(commit.date);
  const formattedDate = formatCommitDate(commitDate);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/45 px-3 py-3">
      <p
        className="truncate text-sm font-medium text-[var(--color-text)]"
        title={commit.message}
      >
        {commit.message}
      </p>
      <div className="mt-2 grid gap-2 text-xs text-[var(--color-text-muted)] sm:grid-cols-2">
        <StatusDetail
          icon={<GitBranch />}
          label="Branch"
          value={status.branch}
        />
        <StatusDetail
          icon={<GitCommitHorizontal />}
          label="Commit"
          value={commit.hash.slice(0, 7)}
          mono
          title={commit.hash}
        />
      </div>
      <time
        className="mt-2 block text-xs text-[var(--color-text-muted)]"
        dateTime={commitDate?.toISOString()}
        title={commit.date}
      >
        {formattedDate ?? "Commit date unavailable"}
      </time>
    </div>
  );
}

function StatusDetail({
  icon,
  label,
  value,
  mono = false,
  title,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden="true">
        {icon}
      </span>
      <span className="shrink-0">{label}</span>
      <span
        className={`truncate text-[var(--color-text)] ${mono ? "font-mono" : ""}`}
        title={title ?? value}
      >
        {value}
      </span>
    </div>
  );
}

function StatusMessage({
  children,
  loading = false,
  tone = "neutral",
  role,
}: {
  children: ReactNode;
  loading?: boolean;
  tone?: "neutral" | "danger";
  role?: "alert" | "status";
}) {
  return (
    <p
      className={`text-xs leading-5 ${tone === "danger" ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"}`}
      aria-busy={loading || undefined}
      role={role ?? (loading ? "status" : undefined)}
    >
      {children}
    </p>
  );
}
