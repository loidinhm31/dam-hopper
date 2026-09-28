import { useState } from "react";
import { Button } from "@/components/atoms/Button.js";
import {
  useOmpExtensionStatus,
  useInstallOmpExtension,
  useUninstallOmpExtension,
} from "@/api/queries.js";
import type { ConnectionRef } from "@/api/ownership.js";

interface OmpExtensionManagerProps {
  owner?: ConnectionRef;
}

export function OmpExtensionManager({ owner }: OmpExtensionManagerProps) {
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const {
    data: report,
    isLoading,
    isError,
    refetch,
  } = useOmpExtensionStatus(undefined, { owner });

  const installMutation = useInstallOmpExtension({ owner });
  const uninstallMutation = useUninstallOmpExtension({ owner });

  const handleInstall = async () => {
    setFeedback(null);
    try {
      await installMutation.mutateAsync(undefined);
      setFeedback({
        type: "success",
        message:
          "Extension installed successfully! Please restart any active OMP sessions in your terminals to load it.",
      });
      void refetch();
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to install OMP extension.",
      });
    }
  };

  const handleUninstall = async () => {
    setFeedback(null);
    try {
      await uninstallMutation.mutateAsync(undefined);
      setFeedback({
        type: "success",
        message:
          "Extension uninstalled successfully. Restart any active OMP sessions.",
      });
      void refetch();
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to uninstall OMP extension.",
      });
    }
  };

  const isPending = installMutation.isPending || uninstallMutation.isPending;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 flex flex-col gap-4">
      {/* Title & Badge */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center font-bold text-sm">
            π
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              Oh My Pi (OMP) Lifecycle Extension
            </h3>
            <p className="text-xs text-[var(--color-text-muted)]">
              Report real-time agent status (working, idle, blocked) and turn notifications to DamHopper
            </p>
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          {isLoading ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              Checking…
            </span>
          ) : isError ? (
            <span className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-[var(--color-danger)]/15 text-[var(--color-danger)]">
              Status Unavailable
            </span>
          ) : report?.status === "current" ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Installed (v{report.version || report.bundledVersion})
            </span>
          ) : report?.status === "outdated" ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Update Available (v{report.bundledVersion})
            </span>
          ) : report?.status === "modified" ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-rose-500/15 text-rose-400 border border-rose-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
              Locally Modified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-text-muted)]" />
              Not Installed
            </span>
          )}
        </div>
      </div>

      {/* Target path */}
      {report?.targetPath && (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs font-mono text-[var(--color-text-muted)] flex items-center justify-between gap-2 overflow-x-auto">
          <span className="text-[var(--color-text)] select-all truncate">
            {report.targetPath}
          </span>
          <span className="shrink-0 text-[10px] uppercase font-semibold text-[var(--color-text-muted)] bg-[var(--color-surface)] px-1.5 py-0.5 rounded border border-[var(--color-border)]">
            Target File
          </span>
        </div>
      )}

      {/* Security Callout */}
      <div className="rounded border border-sky-500/20 bg-sky-500/5 p-3 text-xs text-sky-300 flex items-start gap-2">
        <svg
          className="h-4 w-4 shrink-0 text-sky-400 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
        <div className="flex-1">
          <p className="font-semibold text-sky-200">
            Hardened Single-Extension Boundary
          </p>
          <p className="text-[11px] text-sky-300/90 mt-0.5 leading-relaxed">
            Only the official bundled DamHopper OMP adapter (<code>dam-hopper-agent-status.ts</code>) can be installed or removed. Arbitrary script uploads, third-party extensions, and symlink targets are strictly rejected.
          </p>
        </div>
      </div>

      {/* Warning for modified files */}
      {report?.status === "modified" && (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
          The file at the target path contains local edits or unmanaged content. DamHopper refuses to overwrite modified files. To reinstall, remove the file manually first.
        </div>
      )}

      {/* Feedback banner */}
      {feedback && (
        <div
          className={`rounded border px-3 py-2 text-xs ${
            feedback.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-1">
        {report?.status === "current" ? (
          <Button
            variant="danger"
            size="sm"
            onClick={handleUninstall}
            disabled={isPending}
          >
            {uninstallMutation.isPending ? "Removing…" : "Remove Extension"}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={handleInstall}
            disabled={isPending || report?.status === "modified"}
          >
            {installMutation.isPending
              ? "Installing…"
              : report?.status === "outdated"
                ? "Update Extension"
                : "Install Extension"}
          </Button>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setFeedback(null);
            void refetch();
          }}
          disabled={isPending || isLoading}
        >
          Refresh Status
        </Button>
      </div>
    </div>
  );
}
