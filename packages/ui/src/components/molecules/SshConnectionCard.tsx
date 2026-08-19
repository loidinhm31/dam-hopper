import {
  Edit2,
  KeyRound,
  Link2,
  Plus,
  ShieldAlert,
  Trash2,
  Unplug,
} from "lucide-react";
import { Badge } from "@/components/atoms/Badge.js";
import { Button } from "@/components/atoms/Button.js";
import { SshForwardRuleCard } from "@/components/molecules/SshForwardRuleCard.js";
import { isSshForwardRuleRuntimeActive } from "@/lib/ssh-forward-host.js";
import {
  getFixedSshForwardError,
  type FixedSshForwardErrorCode,
} from "@/lib/ssh-forward-error-copy.js";
import type {
  HostKeyChallenge,
  SshConnectionProfile,
  SshConnectionRuntime,
  SshForwardCredentialState,
  SshForwardRule,
  SshForwardRuleRuntime,
} from "@/lib/ssh-forward-host.js";

interface Props {
  connection: SshConnectionProfile;
  runtime?: SshConnectionRuntime;
  credential?: SshForwardCredentialState;
  challenge?: HostKeyChallenge;
  rules: SshForwardRule[];
  ruleRuntimes: ReadonlyMap<string, SshForwardRuleRuntime>;
  pending: boolean;
  enabledRuleLimitReached?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onForget: () => void;
  onTrust: () => void;
  onAddRule: () => void;
  onEditRule: (rule: SshForwardRule) => void;
  onDeleteRule: (rule: SshForwardRule) => void;
  onSetRuleEnabled: (rule: SshForwardRule, enabled: boolean) => void;
  onBlockedAction: (message: string) => void;
}

const STATUS_LABELS: Record<
  NonNullable<SshConnectionRuntime>["state"],
  string
> = {
  disconnected: "Disconnected",
  authenticating: "Authenticating",
  established: "Established",
  reconnecting: "Reconnecting",
  disconnecting: "Disconnecting",
};

function statusVariant(
  state: NonNullable<SshConnectionRuntime>["state"],
): "success" | "danger" | "warning" | "neutral" {
  if (state === "established") return "success";
  if (
    state === "authenticating" ||
    state === "reconnecting" ||
    state === "disconnecting"
  )
    return "warning";
  return "neutral";
}

function credentialLabel(credential?: SshForwardCredentialState) {
  if (!credential || credential.status === "none") return null;
  if (credential.status === "saved")
    return `Saved · expires ${credential.expiresAt ?? "unknown"}`;
  if (credential.status === "expired") return "Saved credential expired";
  if (credential.status === "rejected") return "Saved credential rejected";
  return "Saved credential unavailable";
}

export function SshConnectionCard({
  connection,
  runtime,
  credential,
  challenge,
  rules,
  ruleRuntimes,
  pending,
  enabledRuleLimitReached = false,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
  onForget,
  onTrust,
  onAddRule,
  onEditRule,
  onDeleteRule,
  onSetRuleEnabled,
  onBlockedAction,
}: Props) {
  const state = runtime?.state ?? "disconnected";
  const connected = state === "established";
  const active = state !== "disconnected";
  const activeRuleCount = rules.filter((rule) => {
    const ruleState = ruleRuntimes.get(rule.id)?.state;
    return rule.desiredEnabled || isSshForwardRuleRuntimeActive(ruleState);
  }).length;
  const error = runtime?.errorCode
    ? getFixedSshForwardError(runtime.errorCode as FixedSshForwardErrorCode)
    : null;
  const credentialCopy = credentialLabel(credential);

  return (
    <article className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-[var(--color-text)]">
                {connection.name}
              </h2>
              <span role="status" aria-live="polite" aria-atomic="true">
                <Badge variant={statusVariant(state)}>
                  {STATUS_LABELS[state]}
                </Badge>
              </span>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-xs text-[var(--color-text-muted)]">
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
              {connection.sshUser}@{connection.sshHost}:{connection.sshPort}
              <span className="font-sans">
                · {connection.auth.mode === "key" ? "local key" : "OS agent"}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={
                active
                  ? () =>
                      onBlockedAction(
                        "Disconnect the connection before editing it.",
                      )
                  : onEdit
              }
              disabled={pending}
              aria-label={`Edit ${connection.name}`}
              title={active ? "Disconnect before editing" : undefined}
            >
              <Edit2 className="h-3.5 w-3.5" />{" "}
              <span className="hidden sm:inline">Edit</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={
                active || rules.length > 0
                  ? () =>
                      onBlockedAction(
                        active
                          ? "Disconnect the connection before deleting it."
                          : "Delete all child rules before deleting the connection.",
                      )
                  : onDelete
              }
              disabled={pending}
              aria-label={`Delete ${connection.name}`}
              title={
                active
                  ? "Disconnect before deleting"
                  : rules.length > 0
                    ? "Delete child rules before deleting"
                    : undefined
              }
            >
              <Trash2 className="h-3.5 w-3.5" />{" "}
              <span className="hidden sm:inline">Delete</span>
            </Button>
          </div>
        </div>

        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-2">
            <span className="block text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Endpoint
            </span>
            <span className="mt-1 block text-[var(--color-text)]">
              {connection.sshHost}:{connection.sshPort}
            </span>
          </div>
          <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-2">
            <span className="block text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Authentication
            </span>
            <span className="mt-1 block text-[var(--color-text)]">
              {connection.auth.mode === "key"
                ? `Key ${connection.auth.keyId}`
                : "OS SSH agent"}
            </span>
          </div>
          <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-2">
            <span className="block text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
              Channels
            </span>
            <span className="mt-1 block text-[var(--color-text)]">
              {runtime?.activeChannels ?? 0} active
            </span>
          </div>
        </div>

        {credentialCopy ? (
          <div className="flex flex-wrap items-start justify-between gap-2 rounded border border-[var(--color-primary)]/30 bg-[var(--color-primary)]/10 p-3 text-xs">
            <p className="flex min-w-0 items-start gap-2 text-[var(--color-text-muted)]">
              <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]" />
              <span>
                {credentialCopy}
                <span className="mt-0.5 block text-[11px]">
                  Fixed 30-day expiry in the Windows user vault; disconnecting
                  closes live resources but keeps this saved credential until
                  its fixed expiry. Scope switches and app restarts do not
                  extend or silently reuse that expiry.
                </span>
              </span>
            </p>
            <Button
              size="sm"
              variant="ghost"
              onClick={onForget}
              disabled={pending}
            >
              Forget
            </Button>
          </div>
        ) : null}

        {error || challenge ? (
          <div
            role="alert"
            className="space-y-2 rounded border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 p-3 text-xs text-[var(--color-danger)]"
          >
            <p>
              {error?.message ??
                "Review the host fingerprint before connecting."}
            </p>
            {challenge ||
            error?.code === "HOST_KEY_CHANGED" ||
            error?.code === "HOST_KEY_ALGORITHM_CHANGED" ? (
              <Button size="sm" variant="secondary" onClick={onTrust}>
                <ShieldAlert className="h-3.5 w-3.5" /> Review host fingerprint
              </Button>
            ) : null}
          </div>
        ) : null}
        {credential &&
        credential.status !== "none" &&
        credential.status !== "saved" ? (
          <p className="text-xs text-[var(--color-warning)]">
            {credentialCopy}. Connect will ask for a replacement; saved secrets
            are not sent until you explicitly connect.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          <Button
            size="sm"
            variant="primary"
            onClick={onConnect}
            disabled={
              pending ||
              connected ||
              state === "authenticating" ||
              state === "disconnecting" ||
              state === "reconnecting"
            }
            loading={state === "authenticating"}
            title={
              state === "reconnecting"
                ? "Wait for the connection to finish reconnecting"
                : undefined
            }
          >
            <Link2 className="h-3.5 w-3.5" /> Connect
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onDisconnect}
            disabled={
              pending || state === "disconnected" || state === "disconnecting"
            }
            loading={state === "disconnecting"}
          >
            <Unplug className="h-3.5 w-3.5" /> Disconnect
          </Button>
          <span className="ml-auto text-[11px] text-[var(--color-text-muted)]">
            {activeRuleCount} active rule{activeRuleCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <section
        className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)]/30 p-4"
        aria-labelledby={`ssh-rules-${connection.id}`}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3
              id={`ssh-rules-${connection.id}`}
              className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text)]"
            >
              Forwarding rules
            </h3>
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              Listeners stay vault-free. Establish the connection before
              enabling a port.
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={onAddRule}
            disabled={pending}
          >
            <Plus className="h-3.5 w-3.5" /> Add rule
          </Button>
        </div>
        {rules.length ? (
          <div className="space-y-2">
            {rules.map((rule) => (
              <SshForwardRuleCard
                key={rule.id}
                rule={rule}
                runtime={ruleRuntimes.get(rule.id)}
                connectionState={state}
                pending={pending}
                enabledRuleLimitReached={enabledRuleLimitReached}
                onSetEnabled={(enabled) => onSetRuleEnabled(rule, enabled)}
                onEdit={() => onEditRule(rule)}
                onDelete={() => onDeleteRule(rule)}
                onBlockedAction={() =>
                  onBlockedAction(
                    "Disable the rule before editing or deleting it.",
                  )
                }
              />
            ))}
          </div>
        ) : (
          <p className="rounded border border-dashed border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
            No forwarding rules yet. Add one for a remote loopback service.
          </p>
        )}
      </section>
    </article>
  );
}
