import { useState } from "react";
import { Switch } from "@/components/atoms/Switch.js";
import {
  useSemanticSettings,
  useUpdateSemanticSettings,
  type OwnerInput,
} from "@/api/queries.js";
import {
  SettingsActionRow,
  SettingsStatusMessage,
} from "@/components/pages/settings-page/SettingsActionRow.js";
import { ApiRequestError } from "@/api/client.js";

export function SettingsSemanticNavigationSection({
  owner,
}: {
  owner?: OwnerInput;
} = {}) {
  const { data: status, isLoading, isError } = useSemanticSettings(owner);
  const updateSettings = useUpdateSemanticSettings(owner);

  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="py-4 text-xs text-[var(--color-text-muted)]">
        Loading semantic navigation settings…
      </div>
    );
  }

  if (isError || !status) {
    return (
      <div className="py-4 text-xs text-[var(--color-danger)]">
        Failed to load semantic navigation status. Check server connection.
      </div>
    );
  }

  const isPending = updateSettings.isPending;
  const isChecked = status.configuredEnabled;
  const canMutate = status.canMutate && !isPending;

  async function handleToggle(nextEnabled: boolean) {
    if (!canMutate) return;
    setActionSuccess(null);
    setActionError(null);

    try {
      const resp = await updateSettings.mutateAsync({ enabled: nextEnabled });
      setActionSuccess(
        resp.configuredEnabled
          ? "Semantic navigation enabled (0 child processes until first active session)."
          : "Semantic navigation disabled (all active sessions and processes reaped).",
      );
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.status === 403) {
          setActionError(
            "Administrator credentials required. Non-admin users and --no-auth development sessions cannot modify global semantic settings.",
          );
          return;
        }
        setActionError(err.message || "Failed to update semantic settings.");
      } else {
        setActionError(
          err instanceof Error ? err.message : "Failed to update semantic settings.",
        );
      }
    }
  }

  const hasMismatch =
    status.configuredEnabled !== status.runtimeEnabled ||
    status.runtimeState === "safe-disabled";

  return (
    <div className="flex flex-col divide-y divide-[var(--color-border)]">
      {status.resourceWarning && (
        <div className="mb-4 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-warning)]">
          <p className="font-medium">Advisory Portable Resource Limits</p>
          <p className="mt-1">{status.resourceWarning}</p>
        </div>
      )}

      {hasMismatch && (
        <div className="mb-4 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 text-xs text-[var(--color-danger)]">
          <p className="font-medium">Configuration / Runtime Mismatch</p>
          <p className="mt-1">
            Configured intent is {status.configuredEnabled ? "enabled" : "disabled"},
            but effective runtime state is {status.runtimeState}.
            {status.transitionError ? ` Last error: ${status.transitionError}` : ""}
          </p>
        </div>
      )}

      <SettingsActionRow
        title="Enable Semantic Navigation"
        description={
          <div>
            <p>
              Enables TypeScript and JavaScript semantic definition and implementation
              across this DamHopper server.
            </p>
            <p className="mt-1 text-[var(--color-text-muted)]">
              Runtime starts zero child processes upon enablement; language servers are
              spawned lazily per authenticated connection and target workspace.
            </p>
            {!status.canMutate && (
              <p className="mt-1 text-xs text-[var(--color-text-muted)] italic">
                Administrator role required to change global semantic settings (read-only for current session).
              </p>
            )}
          </div>
        }
        status={
          actionError ? (
            <SettingsStatusMessage tone="danger">{actionError}</SettingsStatusMessage>
          ) : actionSuccess ? (
            <SettingsStatusMessage tone="success">{actionSuccess}</SettingsStatusMessage>
          ) : undefined
        }
        action={
          <div className="flex items-center gap-2">
            <Switch
              checked={isChecked}
              onCheckedChange={handleToggle}
              ariaLabel="Enable semantic navigation"
              disabled={!canMutate}
            />
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 py-4 sm:grid-cols-4">
        <div>
          <span className="block text-xs text-[var(--color-text-muted)]">Runtime State</span>
          <span className="mt-1 block text-sm font-medium capitalize">
            {status.runtimeState}
          </span>
        </div>
        <div>
          <span className="block text-xs text-[var(--color-text-muted)]">Bundled Toolchain</span>
          <span className="mt-1 block text-sm font-medium">
            {status.toolchainReady ? "Verified" : "Unverified"}
          </span>
        </div>
        <div>
          <span className="block text-xs text-[var(--color-text-muted)]">Active Trees</span>
          <span className="mt-1 block text-sm font-medium">
            {status.activeTrees}
          </span>
        </div>
        <div>
          <span className="block text-xs text-[var(--color-text-muted)]">Open Documents</span>
          <span className="mt-1 block text-sm font-medium">
            {status.openDocuments}
          </span>
        </div>
      </div>

      {status.tupleIdentifier && (
        <div className="py-3 text-xs text-[var(--color-text-muted)]">
          Engine tuple: <code className="font-mono">{status.tupleIdentifier}</code>
        </div>
      )}
    </div>
  );
}
