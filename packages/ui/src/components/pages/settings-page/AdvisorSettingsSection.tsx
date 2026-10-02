import { useMemo, useState } from "react";
import {
  useAdvisorAuth,
  useAdvisorStatus,
  useAdvisorToggle,
} from "@/hooks/use-advisor.js";
import {
  getConnectionSnapshot,
  isCurrentConnection,
  useConnectionSnapshot,
} from "@/api/connections.js";
import { getProfiles } from "@/api/server-config.js";
import { Sparkles, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";

export interface AdvisorSettingsSectionProps {
  readonly profileId?: string | null;
}

export function AdvisorSettingsSection({
  profileId,
}: AdvisorSettingsSectionProps) {
  const effectiveProfileId = profileId ?? "";
  const connectionSnapshot = useConnectionSnapshot(effectiveProfileId);
  const profiles = getProfiles();
  const profile = useMemo(
    () => profiles.find((p) => p.id === effectiveProfileId) ?? null,
    [profiles, effectiveProfileId],
  );

  const isConnected = connectionSnapshot?.status === "connected";
  const owner = connectionSnapshot?.owner ?? null;
  const isOwnerCurrent = Boolean(owner && isCurrentConnection(owner));

  const auth = useAdvisorAuth(profileId);
  const isAdmin = auth.isAdmin;

  const {
    data: status,
    isLoading: statusLoading,
    error: statusError,
    refetch,
    isFetching,
  } = useAdvisorStatus(isOwnerCurrent ? owner : null, {
    enabled: isConnected && isAdmin,
  });

  const toggleMutation = useAdvisorToggle(isOwnerCurrent ? owner : null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const isEnabled = status?.enabled ?? false;

  const handleToggle = async () => {
    setToggleError(null);
    try {
      await toggleMutation.mutateAsync(!isEnabled);
    } catch (err) {
      setToggleError(
        err instanceof Error ? err.message : "Failed to update Advisor settings",
      );
    }
  };

  return (
    <div className="space-y-6" data-testid="advisor-settings-section">
      {/* Header and description */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h3 className="text-base font-medium text-foreground">
              Native Advisor
            </h3>
            {profile && (
              <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground font-mono">
                {profile.name}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure server-side Evcrate Advisor integration. Native Advisor
            operates directly within the Workspace without external plugins or
            runners.
          </p>
        </div>

        {isConnected && isAdmin && (
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-muted disabled:opacity-50"
            title="Refresh Advisor status"
            aria-label="Refresh Advisor status"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
            <span>Refresh</span>
          </button>
        )}
      </div>

      {/* Disconnected Notice */}
      {!isConnected && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300 flex items-center gap-2"
          data-testid="advisor-disconnected-warning"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Target server is disconnected ({connectionSnapshot?.status ?? "disconnected"}). Connect to
            the server to view or configure Advisor.
          </span>
        </div>
      )}

      {/* Non-Admin Notice Banner */}
      {isConnected && !auth.isLoading && !isAdmin && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300 flex items-start gap-2"
          data-testid="advisor-admin-role-warning"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Administrator access required</p>
            <p className="mt-0.5 text-amber-300/80">
              Advisor configuration is restricted to administrators. Contact your
              server administrator to enable or inspect Advisor.
            </p>
          </div>
        </div>
      )}

      {/* Status query error — does NOT masquerade as disabled */}
      {isConnected && isAdmin && statusError && (
        <div
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-xs text-destructive flex items-start gap-2"
          data-testid="advisor-status-error"
        >
          <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Failed to inspect Advisor status</p>
            <p className="mt-0.5">
              {statusError instanceof Error
                ? statusError.message
                : String(statusError)}
            </p>
          </div>
        </div>
      )}

      {/* Toggle mutation error */}
      {toggleError && (
        <div
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-xs text-destructive flex items-center gap-2"
          data-testid="advisor-toggle-error"
        >
          <XCircle className="h-4 w-4 shrink-0" />
          <span>{toggleError}</span>
        </div>
      )}

      {/* Main Configuration Card */}
      {isConnected && isAdmin && (
        <div className="rounded-lg border border-border bg-card p-5 space-y-6">
          {/* Enable / Disable Toggle Row */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <label
                htmlFor="advisor-toggle"
                className="text-sm font-medium text-foreground cursor-pointer"
              >
                Enable Advisor
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                When enabled, Advisor surfaces and history become accessible in the
                Workspace.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  statusError
                    ? "bg-destructive/15 text-destructive border border-destructive/30"
                    : isEnabled
                      ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                      : "bg-muted text-muted-foreground border border-border"
                }`}
                data-testid="advisor-state-badge"
              >
                {statusLoading
                  ? "Checking…"
                  : statusError
                    ? "Error"
                    : isEnabled
                      ? "Enabled"
                      : "Disabled"}
              </span>

              <button
                id="advisor-toggle"
                type="button"
                role="switch"
                aria-checked={isEnabled}
                aria-label="Toggle native advisor"
                disabled={
                  statusLoading ||
                  Boolean(statusError) ||
                  toggleMutation.isPending ||
                  !isOwnerCurrent
                }
                onClick={() => void handleToggle()}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  isEnabled ? "bg-primary" : "bg-muted"
                }`}
                data-testid="advisor-toggle-switch"
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out ${
                    isEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Directory & Availability Details */}
          {status && (
            <div
              className="border-t border-border pt-4 space-y-3"
              data-testid="advisor-directory-details"
            >
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                History Directory Status
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* Detected Path */}
                <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1">
                  <div className="text-muted-foreground">Detected Location</div>
                  <div
                    className="font-mono text-foreground break-all"
                    data-testid="advisor-detected-path"
                  >
                    {status.path ?? "None ($HOME/.evcrate/advisor-history)"}
                  </div>
                </div>

                {/* Real-Directory Availability */}
                <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1">
                  <div className="text-muted-foreground">Availability</div>
                  <div className="flex items-center gap-1.5 font-medium">
                    {status.available ? (
                      <span
                        className="inline-flex items-center gap-1 text-emerald-400"
                        data-testid="advisor-available-badge"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Available (real directory)
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-amber-400"
                        data-testid="advisor-unavailable-badge"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Unavailable
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Source Error / Notice if unavailable */}
              {!status.available && (
                <div
                  className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 space-y-1"
                  data-testid="advisor-source-error-notice"
                >
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>Directory Unavailable Notice</span>
                  </div>
                  <p className="text-amber-300/90">
                    {status.sourceError ??
                      "Advisor history directory does not exist or is not a real directory."}
                  </p>
                  <p className="text-amber-300/75 mt-1">
                    Note: Advisor requires a real directory at server{" "}
                    <code className="rounded bg-black/30 px-1 py-0.5 font-mono">
                      $HOME/.evcrate/advisor-history
                    </code>
                    . Symbolic links to directories are rejected for security.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
