import { Edit2, Play, RotateCw, Square, Trash2 } from "lucide-react";
import { Badge } from "@/components/atoms/Badge.js";
import { Button } from "@/components/atoms/Button.js";
import { SshForwardProfileSummary } from "@/components/molecules/SshForwardProfileSummary.js";
import {
  getFixedSshForwardError,
  type FixedSshForwardErrorCode,
} from "@/lib/ssh-forward-error-copy.js";
import type {
  HostKeyChallenge,
  SshForwardProfile,
  SshForwardRuntime,
  WireCounter,
} from "@/lib/ssh-forward-host.js";

interface Props {
  profile: SshForwardProfile;
  runtime?: SshForwardRuntime;
  challenge?: HostKeyChallenge;
  pending: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTrust: () => void;
  onBlockedAction: () => void;
}

const ACTIVE_STATES = new Set<SshForwardRuntime["state"]>([
  "starting",
  "running",
  "reconnecting",
  "stopping",
]);

function statusVariant(
  state: SshForwardRuntime["state"],
): "success" | "danger" | "warning" | "neutral" {
  if (state === "running") return "success";
  if (state === "failed") return "danger";
  if (state === "starting" || state === "reconnecting" || state === "stopping")
    return "warning";
  return "neutral";
}

export function SshForwardProfileCard({
  profile,
  runtime,
  challenge,
  pending,
  onStart,
  onStop,
  onRestart,
  onEdit,
  onDelete,
  onTrust,
  onBlockedAction,
}: Props) {
  const state = runtime?.state ?? "stopped";
  const active = ACTIVE_STATES.has(state);
  const generation: WireCounter = runtime?.generation ?? ("0" as WireCounter);
  const error = runtime?.errorCode
    ? getFixedSshForwardError(runtime.errorCode as FixedSshForwardErrorCode)
    : null;
  const actionBlocked = () => onBlockedAction();

  return (
    <article className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-[var(--color-text)]">
              {profile.name}
            </h2>
            <Badge variant={statusVariant(state)}>{state}</Badge>
          </div>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            127.0.0.1:{profile.localPort} ← {profile.sshUser}@{profile.sshHost}:
            {profile.sshPort}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Remote target:{" "}
            <code className="font-mono text-[var(--color-text)]">
              127.0.0.1:{profile.targetPort}
            </code>
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={active ? actionBlocked : onEdit}
            disabled={pending}
            aria-label={`Edit ${profile.name}`}
          >
            <Edit2 className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={active ? actionBlocked : onDelete}
            disabled={pending}
            aria-label={`Delete ${profile.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>

      <SshForwardProfileSummary
        profile={profile}
        runtime={runtime}
        generation={generation}
      />

      {error ? (
        <div
          role="alert"
          className="space-y-2 rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-xs text-[var(--color-danger)]"
        >
          <p>{error.message}</p>
          {error.code === "AUTO_START_SKIPPED_LIMIT" ? (
            <p>Stop another forward, then use Start here to try again.</p>
          ) : null}
          {challenge ||
          error.code === "HOST_KEY_CHANGED" ||
          error.code === "HOST_KEY_ALGORITHM_CHANGED" ? (
            <Button size="sm" variant="secondary" onClick={onTrust}>
              Review host fingerprint
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2" aria-live="polite">
        <Button
          size="sm"
          variant="primary"
          onClick={onStart}
          disabled={
            pending || active || (state === "failed" && Boolean(challenge))
          }
        >
          <Play className="h-3.5 w-3.5" /> Start
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={onStop}
          disabled={pending || !active}
        >
          <Square className="h-3.5 w-3.5" /> Stop
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={onRestart}
          disabled={pending || state === "starting" || state === "stopping"}
        >
          <RotateCw className="h-3.5 w-3.5" /> Restart
        </Button>
      </div>
    </article>
  );
}
