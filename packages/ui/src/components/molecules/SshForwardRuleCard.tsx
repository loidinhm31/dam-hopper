import { Edit2, Trash2 } from "lucide-react";
import { Badge } from "@/components/atoms/Badge.js";
import { Button } from "@/components/atoms/Button.js";
import { Switch } from "@/components/atoms/Switch.js";
import { isSshForwardRuleRuntimeActive } from "@/lib/ssh-forward-host.js";
import type {
  SshForwardRule,
  SshForwardRuleRuntime,
} from "@/lib/ssh-forward-host.js";

interface Props {
  rule: SshForwardRule;
  runtime?: SshForwardRuleRuntime;
  pending: boolean;
  enabledRuleLimitReached?: boolean;
  onSetEnabled: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onBlockedAction: () => void;
}

function statusVariant(
  state: SshForwardRuleRuntime["state"],
): "success" | "danger" | "warning" | "neutral" {
  if (state === "on") return "success";
  if (state === "failed") return "danger";
  if (state === "opening" || state === "closing") return "warning";
  return "neutral";
}

export function SshForwardRuleCard({
  rule,
  runtime,
  pending,
  enabledRuleLimitReached = false,
  onSetEnabled,
  onEdit,
  onDelete,
  onBlockedAction,
}: Props) {
  const state = runtime?.state ?? "off";
  const runtimeActive = isSshForwardRuleRuntimeActive(state);
  const checked = rule.desiredEnabled || runtimeActive;
  const active = runtimeActive;
  const pendingActivation =
    rule.desiredEnabled && !runtimeActive && state !== "failed";
  const enabling = !checked;
  const toggleDisabled =
    pending || state === "closing" || (enabling && enabledRuleLimitReached);

  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)]/70 p-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-xs font-semibold text-[var(--color-text)]">
              {rule.name}
            </h4>
            <span role="status" aria-live="polite" aria-atomic="true">
              <Badge variant={statusVariant(state)}>{state}</Badge>
            </span>
            {rule.reconnect.enabled ? (
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
                reconnects
              </span>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-xs text-[var(--color-text-muted)]">
            127.0.0.1:{rule.localPort} <span aria-hidden="true">←</span> remote
            127.0.0.1:{rule.targetPort}
          </p>
          {runtime?.activeChannels ? (
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
              {runtime.activeChannels} active channel
              {runtime.activeChannels === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Switch
            checked={checked}
            onCheckedChange={onSetEnabled}
            disabled={toggleDisabled}
            ariaLabel={`${checked ? "Disable" : "Enable"} ${rule.name}`}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={active ? onBlockedAction : onEdit}
            disabled={pending}
            aria-label={`Edit ${rule.name}`}
            title={active ? "Disable the rule before editing" : undefined}
          >
            <Edit2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Edit</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={active ? onBlockedAction : onDelete}
            disabled={pending}
            aria-label={`Delete ${rule.name}`}
            title={active ? "Disable the rule before deleting" : undefined}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Delete</span>
          </Button>
        </div>
      </div>
      {runtime?.errorCode ? (
        <p role="alert" className="mt-2 text-[11px] text-[var(--color-danger)]">
          The listener could not establish. Review the connection state, then
          retry the rule.
        </p>
      ) : null}
      {pendingActivation ? (
        <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
          Desired state saved; the listener will start after the SSH connection
          is established.
        </p>
      ) : null}
    </div>
  );
}
