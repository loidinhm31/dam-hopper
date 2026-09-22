import { useEffect, useState, useCallback, useMemo } from "react";
import type { ApiClient } from "@/api/client.js";
import { getApiClientForProfile } from "@/api/connections.js";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog.js";
import type {
  AdminInstallationDto,
  StageReviewDto,
} from "@/api/plugin-types.js";

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

  // Stage upload state
  const [stageFile, setStageFile] = useState<File | null>(null);
  const [expectedSha256, setExpectedSha256] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<{ uploaded: number; total: number } | null>(null);
  const [stagingLoading, setStagingLoading] = useState<boolean>(false);
  const [stageReview, setStageReview] = useState<StageReviewDto | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [approveLoading, setApproveLoading] = useState<boolean>(false);

  // Destructive confirmations
  const [rollbackTarget, setRollbackTarget] = useState<AdminInstallationDto | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AdminInstallationDto | null>(null);
  const [actionPending, setActionPending] = useState<boolean>(false);

  const resolvedClient = useMemo(() => {
    return clientProp ?? getApiClientForProfile(profileId);
  }, [clientProp, profileId]);

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
    void loadInstallations();
  }, [loadInstallations]);

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
      await resolvedClient.plugins.adminApprove(stageReview.stageId, {
        expectedSha256: stageReview.archiveSha256,
        expectedSecurityRevision: securityRevision,
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
          Plugin lifecycle and package management operations are restricted to root-seeded
          administrator accounts. Authenticate with a configured administrator bearer token to view and manage plugins.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="plugin-management-section">
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
              Security Revision: {securityRevision} · Active runner-supervised plugin instances
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
            {installations.map((inst) => (
              <div
                key={inst.installationId}
                className="p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-muted/5 hover:bg-muted/10 transition-colors"
                data-testid={`plugin-item-${inst.installationId}`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stage & Install New Package */}
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
          /* Immutable Review Card */
          <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-3" data-testid="stage-review-card">
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

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        open={rollbackTarget !== null}
        onClose={() => setRollbackTarget(null)}
        onConfirm={handleConfirmRollback}
        title="Rollback plugin package?"
        description={
          rollbackTarget
            ? `Rollback "${rollbackTarget.pluginId}" to previous package version "${rollbackTarget.previousPackage?.version ?? "unknown"}"?\n\n` +
              `Current security intent (grants, enablement) is preserved and will NOT be rolled back.`
            : ""
        }
        confirmText="Confirm Rollback"
        variant="danger"
        loading={actionPending}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleConfirmRemove}
        title="Remove plugin installation?"
        description={
          removeTarget
            ? `Permanently remove installation "${removeTarget.pluginId}"?\n\n` +
              `The worker will be stopped and unreferenced package files cleaned from the registry. Workspace sources are never modified.`
            : ""
        }
        confirmText="Remove Installation"
        variant="danger"
        loading={actionPending}
      />
    </div>
  );
}
