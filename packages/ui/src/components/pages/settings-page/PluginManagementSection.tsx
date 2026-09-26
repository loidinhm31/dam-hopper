import { useEffect, useState, useCallback, useMemo } from "react";
import type { ApiClient } from "@/api/client.js";
import { getApiClientForProfile } from "@/api/connections.js";
import { buildAuthHeaders, getProfiles, getServerUrl } from "@/api/server-config.js";
import { useAggregatedProjects } from "@/hooks/use-aggregated-projects.js";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.js";
import type {
  AdminInstallationDto,
  AuthStatusResponse,
  InitialGrant,
  OwnerHistorySource,
  StageReviewDto,
} from "@/api/plugin-types.js";
import { PluginAccessModal } from "./PluginAccessModal.js";

interface PluginManagementSectionProps {
  profileId?: string | null;
  client?: ApiClient | null;
}

export function PluginManagementSection({ profileId, client: clientProp }: PluginManagementSectionProps) {
  const [installations, setInstallations] = useState<AdminInstallationDto[]>([]);
  const [securityRevision, setSecurityRevision] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<boolean>(false);

  // Authenticated account and role state
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);

  // Stage upload state
  const [stageFile, setStageFile] = useState<File | null>(null);
  const [expectedSha256, setExpectedSha256] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<{ uploaded: number; total: number } | null>(null);
  const [stagingLoading, setStagingLoading] = useState<boolean>(false);
  const [stageReview, setStageReview] = useState<StageReviewDto | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [approveLoading, setApproveLoading] = useState<boolean>(false);

  // Initial access configuration in stage review
  const [stageBoundProjects, setStageBoundProjects] = useState<string[]>([]);
  const [stageActor, setStageActor] = useState<string>("");
  const [stageOps, setStageOps] = useState<string>("");
  const [stageAllowPolicy, setStageAllowPolicy] = useState<boolean>(false);
  const [stageEnableHistory, setStageEnableHistory] = useState<boolean>(false);
  const [stageHistoryPath, setStageHistoryPath] = useState<string>("");
  const [stageHistoryId, setStageHistoryId] = useState<string>("");
  const [stageHistoryAllAuth, setStageHistoryAllAuth] = useState<boolean>(false);

  // Destructive confirmations & modals
  const [rollbackTarget, setRollbackTarget] = useState<AdminInstallationDto | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AdminInstallationDto | null>(null);
  const [accessTarget, setAccessTarget] = useState<AdminInstallationDto | null>(null);
  const [actionPending, setActionPending] = useState<boolean>(false);

  const resolvedClient = useMemo(() => {
    return clientProp ?? getApiClientForProfile(profileId);
  }, [clientProp, profileId]);

  const targetProfile = useMemo(() => {
    const list = getProfiles();
    return list.find((p) => p.id === profileId) ?? null;
  }, [profileId]);
  const serverUrl = profileId ? targetProfile?.url : getServerUrl();

  // Reset privilege and state immediately on profile switch
  useEffect(() => {
    setAuthStatus(null);
    setUnauthorized(false);
    setInstallations([]);
    setStageReview(null);
    setError(null);
    setStageBoundProjects([]);
    setStageActor("");
  }, [profileId]);

  // Load auth status for selected profile
  useEffect(() => {
    let cancelled = false;
    const fetchAuth = async () => {
      try {
        setAuthLoading(true);
        const res = await fetch(`${serverUrl}/api/auth/status`, {
          headers: buildAuthHeaders(profileId ?? undefined),
          credentials: "omit",
        });
        if (cancelled) return;
        if (res.ok) {
          const data: AuthStatusResponse = await res.json();
          setAuthStatus(data);
        } else {
          setAuthStatus({ authenticated: false, workbenchProtocol: 2 });
        }
      } catch {
        if (!cancelled) {
          setAuthStatus({ authenticated: false, workbenchProtocol: 2, error: "Network error" });
        }
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    };
    void fetchAuth();
    return () => {
      cancelled = true;
    };
  }, [serverUrl, profileId]);

  const isAdmin = authStatus?.role === "admin";

  const { allProjects } = useAggregatedProjects();
  const availableProjects = useMemo(() => {
    return allProjects
      .filter((p) => !profileId || p.profileId === profileId)
      .map((p) => ({ name: p.project.name, path: p.project.path }));
  }, [allProjects, profileId]);


  const loadInstallations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setUnauthorized(false);
      if (!resolvedClient) {
        setInstallations([]);
        return;
      }
      const res = await resolvedClient.plugins.adminList();
      setInstallations(res.installations);
      setSecurityRevision(res.securityRevision);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("401") || msg.includes("403") || msg.includes("authorized") || msg.includes("Bearer")) {
        setUnauthorized(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [resolvedClient]);

  useEffect(() => {
    if (isAdmin) {
      void loadInstallations();
    } else {
      setInstallations([]);
    }
  }, [isAdmin, loadInstallations]);

  // Subscribe to push lifecycle revision events
  useEffect(() => {
    if (!resolvedClient) return;
    const unsub = resolvedClient.plugins.onLifecycleRevision(() => {
      void loadInstallations();
    });
    return () => {
      unsub();
    };
  }, [resolvedClient, loadInstallations]);

  const handleStageUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stageFile) {
      setStageError("Please select a package archive (.tar.gz)");
      return;
    }
    const cleanSha = expectedSha256.trim().toLowerCase();
    if (cleanSha.length !== 64 || !/^[a-f0-9]{64}$/.test(cleanSha)) {
      setStageError("Expected SHA-256 must be a 64-character hexadecimal hash");
      return;
    }

    try {
      setStagingLoading(true);
      setStageError(null);
      setUploadProgress({ uploaded: 0, total: stageFile.size });

      if (!resolvedClient) return;
      const review = await resolvedClient.plugins.adminStage(
        stageFile,
        cleanSha,
        (uploaded, total) => {
          setUploadProgress({ uploaded, total });
        }
      );
      setStageReview(review);
      setUploadProgress(null);
    } catch (err: unknown) {
      setStageError(err instanceof Error ? err.message : String(err));
      setUploadProgress(null);
    } finally {
      setStagingLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!stageReview) return;
    try {
      setApproveLoading(true);
      setStageError(null);
      if (!resolvedClient) return;

      // Construct initial bindings
      const initialBindings: Record<string, string> = {};
      for (const pName of stageBoundProjects) {
        const match = availableProjects.find((p) => p.name === pName);
        if (match?.path) {
          initialBindings[pName] = match.path;
        } else {
          initialBindings[pName] = pName;
        }
      }

      // Construct initial grants
      const initialGrants: InitialGrant[] = [];
      const trimmedActor = stageActor.trim();
      if (trimmedActor) {
        if (stageBoundProjects.length === 0) {
          setStageError("Please select at least one bound project target for the grant recipient.");
          setApproveLoading(false);
          return;
        }
        const ops = stageOps
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (ops.length === 0) {
          setStageError("Please select or specify at least one capability for the grant recipient.");
          setApproveLoading(false);
          return;
        }
        for (const tgt of stageBoundProjects) {
          initialGrants.push({
            actorSubject: trimmedActor,
            configuredProjectTarget: tgt,
            allowedOperations: ops,
            allowCurrentAccountPolicy: stageAllowPolicy,
          });
        }
      }

      // Construct optional owner history source
      let ownerHistorySource: OwnerHistorySource | undefined = undefined;
      if (stageEnableHistory && stageHistoryPath.trim() && stageHistoryId.trim()) {
        ownerHistorySource = {
          rootPath: stageHistoryPath.trim(),
          rootIdentity: stageHistoryId.trim().toLowerCase(),
          sourceRevision: 1,
          allAuthenticatedHistoryRead: stageHistoryAllAuth,
        };
      }

      await resolvedClient.plugins.adminApprove(stageReview.stageId, {
        expectedSha256: stageReview.archiveSha256,
        expectedSecurityRevision: securityRevision,
        initialBindings: Object.keys(initialBindings).length > 0 ? initialBindings : undefined,
        initialGrants: initialGrants.length > 0 ? initialGrants : undefined,
        ownerHistorySource,
      });

      setStageReview(null);
      setStageFile(null);
      setExpectedSha256("");
      await loadInstallations();
    } catch (err: unknown) {
      setStageError(err instanceof Error ? err.message : String(err));
    } finally {
      setApproveLoading(false);
    }
  };

  const handleToggleEnable = async (inst: AdminInstallationDto) => {
    try {
      setActionPending(true);
      if (!resolvedClient) return;
      if (inst.enabled) {
        await resolvedClient.plugins.adminDisable(inst.installationId, {
          expectedSecurityRevision: securityRevision,
        });
      } else {
        await resolvedClient.plugins.adminEnable(inst.installationId, {
          expectedSecurityRevision: securityRevision,
        });
      }
      await loadInstallations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionPending(false);
    }
  };

  const handleConfirmRollback = async () => {
    if (!rollbackTarget) return;
    try {
      setActionPending(true);
      if (!resolvedClient) return;
      await resolvedClient.plugins.adminRollback(rollbackTarget.installationId, {
        expectedSecurityRevision: securityRevision,
      });
      setRollbackTarget(null);
      await loadInstallations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionPending(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!removeTarget) return;
    try {
      setActionPending(true);
      if (!resolvedClient) return;
      await resolvedClient.plugins.adminRemove(removeTarget.installationId, securityRevision);
      setRemoveTarget(null);
      await loadInstallations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionPending(false);
    }
  };

  if (unauthorized) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 p-6 text-sm text-muted-foreground" data-testid="plugin-admin-unauthorized">
        <div className="font-medium text-foreground mb-1">Administrator Access Required</div>
        <p>
          Plugin lifecycle and package management operations are restricted to administrator accounts.
          Authenticate with an administrator account to view and manage plugins.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="plugin-management-section">
      {/* Account and Role Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-border/60 bg-muted/10">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Account:</span>
          <span className="text-xs font-semibold text-foreground" data-testid="auth-user-name">
            {authStatus?.user ?? (authLoading ? "Checking..." : "Unauthenticated")}
          </span>
          <span
            className={`text-[10px] px-2 py-0.5 rounded font-mono uppercase font-semibold ${
              isAdmin
                ? "bg-primary/15 text-primary border border-primary/30"
                : "bg-muted text-muted-foreground border border-border"
            }`}
            data-testid="auth-role-badge"
          >
            Role: {authStatus?.role ?? (authLoading ? "..." : "user")}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          Security Revision: <span className="font-mono text-foreground">{securityRevision}</span>
        </div>
      </div>

      {/* Non-Admin Notice Banner */}
      {!authLoading && !isAdmin && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-300 space-y-1"
          data-testid="plugin-admin-role-warning"
        >
          <div className="font-semibold text-foreground">Non-Administrator Account</div>
          <p>
            You are logged in as a standard user. Plugin package staging, lifecycle controls, and permission
            granting are restricted to administrators. Contact your system operator to assign the admin role.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/15 border border-destructive/30 p-3 text-sm text-destructive" data-testid="plugin-admin-error">
          {error}
        </div>
      )}

      {/* Installed Plugins Table */}
      <div className="rounded-lg border border-border/50 bg-background/50 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-foreground">Installed Plugins</h3>
            <p className="text-xs text-muted-foreground">
              Active runner-supervised plugin instances and configured access grants
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadInstallations()}
            disabled={loading}
            className="text-xs px-2.5 py-1 rounded bg-secondary hover:bg-secondary/80 transition-colors"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {installations.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground" data-testid="no-plugins-message">
            No plugins installed. Upload and approve a package below to get started.
          </div>
        ) : (
          <div className="divide-y divide-border/40 border border-border/40 rounded-md overflow-hidden">
            {installations.map((inst) => {
              const hasGrantsOrHistory = inst.grants.length > 0 || Boolean(inst.ownerHistorySource);

              return (
                <div
                  key={inst.installationId}
                  className="p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-muted/5 hover:bg-muted/10 transition-colors"
                  data-testid={`plugin-item-${inst.installationId}`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">{inst.pluginId}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-muted font-mono">v{inst.activeVersion}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-medium ${
                          inst.enabled
                            ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30"
                            : "bg-zinc-500/15 text-zinc-400 border border-zinc-500/30"
                        }`}
                      >
                        {inst.enabled ? "Enabled" : "Disabled"}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        gen {inst.activationGeneration}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
                        worker: {inst.workerStatus}
                      </span>

                      {/* Diagnostic Chip */}
                      {!hasGrantsOrHistory ? (
                        <span
                          className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-500 border border-amber-500/30 font-medium"
                          data-testid={`diagnostic-chip-${inst.installationId}`}
                        >
                          0 Grants · Hidden from navigation
                        </span>
                      ) : (
                        <span
                          className="text-[10px] px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30 font-medium"
                          data-testid={`diagnostic-chip-${inst.installationId}`}
                        >
                          {inst.grants.length} Grant{inst.grants.length !== 1 ? "s" : ""}
                          {inst.ownerHistorySource ? " · History Root" : ""}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono truncate max-w-xl">
                      SHA: {inst.activePackageDigest}
                    </div>
                    {inst.previousPackage && (
                      <div className="text-xs text-muted-foreground">
                        Previous: v{inst.previousPackage.version} ({inst.previousPackage.packageDigest.slice(0, 12)}...)
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center">
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => setAccessTarget(inst)}
                          disabled={actionPending}
                          className="text-xs px-3 py-1.5 rounded border border-border hover:bg-secondary font-medium transition-colors"
                          data-testid={`manage-access-${inst.installationId}`}
                        >
                          Manage Access
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleToggleEnable(inst)}
                          disabled={actionPending}
                          className="text-xs px-3 py-1.5 rounded border border-border hover:bg-secondary transition-colors"
                          data-testid={`toggle-enable-${inst.installationId}`}
                        >
                          {inst.enabled ? "Disable" : "Enable"}
                        </button>

                        {inst.canRollback && (
                          <button
                            type="button"
                            onClick={() => setRollbackTarget(inst)}
                            disabled={actionPending}
                            className="text-xs px-3 py-1.5 rounded border border-amber-500/30 text-amber-500 hover:bg-amber-500/10 transition-colors"
                            data-testid={`rollback-${inst.installationId}`}
                          >
                            Rollback
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setRemoveTarget(inst)}
                          disabled={actionPending}
                          className="text-xs px-3 py-1.5 rounded border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                          data-testid={`remove-${inst.installationId}`}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Stage & Install New Package (Admin Only) */}
      {isAdmin && (
        <div className="rounded-lg border border-border/50 bg-background/50 p-4 space-y-4">
          <div>
            <h3 className="font-medium text-foreground">Stage Package</h3>
            <p className="text-xs text-muted-foreground">
              Upload and inspect an immutable package archive with independently verified SHA-256 digest before approval.
            </p>
          </div>

          {stageError && (
            <div className="rounded-md bg-destructive/15 border border-destructive/30 p-2.5 text-xs text-destructive" data-testid="stage-error">
              {stageError}
            </div>
          )}

          {!stageReview ? (
            <form onSubmit={handleStageUpload} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Package Archive (.tar.gz)
                  </label>
                  <input
                    type="file"
                    accept=".tar.gz,.tgz,application/gzip"
                    onChange={(e) => setStageFile(e.target.files?.[0] ?? null)}
                    className="text-xs w-full file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:bg-secondary file:text-foreground hover:file:bg-secondary/80 text-muted-foreground"
                    data-testid="stage-file-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Expected SHA-256 Digest
                  </label>
                  <input
                    type="text"
                    placeholder="64-character hex hash"
                    value={expectedSha256}
                    onChange={(e) => setExpectedSha256(e.target.value)}
                    className="w-full text-xs font-mono px-3 py-1.5 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    data-testid="expected-sha256-input"
                  />
                </div>
              </div>

              {uploadProgress && (
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Uploading stream...</span>
                    <span>
                      {Math.round((uploadProgress.uploaded / (uploadProgress.total || 1)) * 100)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-200"
                      style={{
                        width: `${Math.min(100, Math.round((uploadProgress.uploaded / (uploadProgress.total || 1)) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={stagingLoading || !stageFile || !expectedSha256}
                className="text-xs px-3.5 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                data-testid="stage-upload-btn"
              >
                {stagingLoading ? "Streaming to Runner..." : "Stage & Inspect Package"}
              </button>
            </form>
          ) : (
            /* Immutable Review & Access Setup Card */
            <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-4" data-testid="stage-review-card">
              <div className="flex items-center justify-between border-b border-border/40 pb-2">
                <div>
                  <div className="font-semibold text-sm text-foreground flex items-center gap-2">
                    <span>{stageReview.pluginId}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-muted font-mono">v{stageReview.version}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Publisher: {stageReview.publisher} · Compatible: {stageReview.hostVersionRange}
                  </div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 font-medium">
                  Verified Integrity
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground block">Entries:</span>
                  <span className="font-mono">{stageReview.totalEntries} files</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Uncompressed:</span>
                  <span className="font-mono">{(stageReview.uncompressedBytes / 1024).toFixed(1)} KiB</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Backend Entry:</span>
                  <span className="font-mono truncate block">{stageReview.entrypoints.backend.entry}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">UI Mode:</span>
                  <span className="font-mono">{stageReview.entrypoints.ui ? stageReview.entrypoints.ui.mode : "Headless"}</span>
                </div>
              </div>

              <div className="text-xs font-mono bg-muted/40 p-2 rounded truncate text-muted-foreground">
                SHA: {stageReview.archiveSha256}
              </div>

              {stageReview.capabilities.length > 0 && (
                <div className="text-xs">
                  <span className="text-muted-foreground mr-1">Capabilities:</span>
                  {stageReview.capabilities.map((c) => (
                    <span key={c} className="mr-1 px-1.5 py-0.5 rounded bg-muted text-foreground text-[10px]">
                      {c}
                    </span>
                  ))}
                </div>
              )}

              {/* Initial Access Configuration */}
              <div className="rounded border border-border/50 bg-background/50 p-3 space-y-3">
                <div className="text-xs font-semibold text-foreground">
                  Initial Access & Authorization Setup
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">
                      Target Project Binding:
                    </label>
                    <select
                      value={stageBoundProjects[0] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setStageBoundProjects(val ? [val] : []);
                      }}
                      className="w-full text-xs px-2.5 py-1.5 rounded border border-border bg-background"
                      data-testid="stage-project-select"
                    >
                      <option value="">-- No target project (Quarantine) --</option>
                      {availableProjects.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name} {p.path ? `(${p.path})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-muted-foreground mb-1">
                      Grant Recipient Username:
                    </label>
                    <input
                      type="text"
                      placeholder="Username (e.g. admin-user)"
                      value={stageActor}
                      onChange={(e) => setStageActor(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 rounded border border-border bg-background"
                      data-testid="stage-actor-input"
                    />
                  </div>
                </div>

                <div className="text-xs">
                  <label className="block text-[11px] text-muted-foreground mb-1">
                    Allowed Operations (* for all capabilities):
                  </label>
                  <input
                    type="text"
                    value={stageOps}
                    onChange={(e) => setStageOps(e.target.value)}
                    placeholder="* or comma-separated capabilities"
                    className="w-full text-xs font-mono px-2.5 py-1.5 rounded border border-border bg-background"
                    data-testid="stage-ops-input"
                  />
                </div>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    id="stage-allow-policy"
                    checked={stageAllowPolicy}
                    onChange={(e) => setStageAllowPolicy(e.target.checked)}
                    data-testid="stage-policy-checkbox"
                  />
                  <label htmlFor="stage-allow-policy">Allow current account policy access</label>
                </div>

                {/* Optional History Source */}
                <div className="pt-2 border-t border-border/40 space-y-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={stageEnableHistory}
                      onChange={(e) => setStageEnableHistory(e.target.checked)}
                      data-testid="stage-history-checkbox"
                    />
                    <span>Configure Global Owner History Source</span>
                  </label>

                  {stageEnableHistory && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs pt-1">
                      <div>
                        <input
                          type="text"
                          placeholder="Absolute host path (e.g. ~/.evcrate/advisor-history)"
                          value={stageHistoryPath}
                          onChange={(e) => setStageHistoryPath(e.target.value)}
                          className="w-full text-xs font-mono px-2 py-1 rounded border border-border bg-background"
                          data-testid="stage-history-path"
                        />
                      </div>
                      <div>
                        <input
                          type="text"
                          placeholder="64-char lowercase hex root identity"
                          value={stageHistoryId}
                          onChange={(e) => setStageHistoryId(e.target.value)}
                          className="w-full text-xs font-mono px-2 py-1 rounded border border-border bg-background"
                          data-testid="stage-history-id"
                        />
                      </div>
                      <div className="md:col-span-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          id="stage-history-all-auth"
                          checked={stageHistoryAllAuth}
                          onChange={(e) => setStageHistoryAllAuth(e.target.checked)}
                        />
                        <label htmlFor="stage-history-all-auth">
                          Allow all authenticated users to read history root
                        </label>
                      </div>
                    </div>
                  )}
                </div>

                {stageBoundProjects.length === 0 && !stageActor && (
                  <p className="text-[11px] text-amber-500/90 italic">
                    Note: Without project bindings or recipient grants, the plugin will install in quarantined state and will not appear in top navigation.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => void handleApprove()}
                  disabled={approveLoading}
                  className="text-xs px-4 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors font-medium"
                  data-testid="approve-stage-btn"
                >
                  {approveLoading ? "Activating Generation..." : "Approve & Activate"}
                </button>
                <button
                  type="button"
                  onClick={() => setStageReview(null)}
                  disabled={approveLoading}
                  className="text-xs px-3 py-1.5 rounded border border-border hover:bg-secondary transition-colors"
                  data-testid="discard-stage-btn"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        open={Boolean(rollbackTarget)}
        title="Confirm Rollback"
        description={
          rollbackTarget
            ? `Rollback "${rollbackTarget.pluginId}" to previous package version "${rollbackTarget.previousPackage?.version ?? "unknown"}"?\n\n` +
              `Current security intent (grants, enablement) is preserved and will NOT be rolled back.`
            : ""
        }
        confirmText="Rollback Plugin"
        variant="danger"
        loading={actionPending}
        onConfirm={() => void handleConfirmRollback()}
        onClose={() => setRollbackTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Confirm Removal"
        description={
          removeTarget
            ? `Permanently remove installation "${removeTarget.pluginId}"?\n\n` +
              `The worker will be stopped and unreferenced package files cleaned from the registry. Workspace sources are never modified.`
            : ""
        }
        confirmText="Remove Installation"
        variant="danger"
        loading={actionPending}
        onConfirm={() => void handleConfirmRemove()}
        onClose={() => setRemoveTarget(null)}
      />

      {/* Access Settings Modal */}
      {accessTarget && (
        <PluginAccessModal
          open={Boolean(accessTarget)}
          onClose={() => setAccessTarget(null)}
          installation={accessTarget}
          securityRevision={securityRevision}
          client={resolvedClient}
          onSaved={loadInstallations}
          availableProjects={availableProjects}
        />
      )}
    </div>
  );
}
