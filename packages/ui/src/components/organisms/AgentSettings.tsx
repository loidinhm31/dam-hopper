import { useEffect, useState } from "react";
import { BellRing, ShieldCheck, AlertCircle, RefreshCw, Folder, TerminalSquare, Sparkles } from "lucide-react";
import { Badge } from "@/components/atoms/Badge.js";
import { Button } from "@/components/atoms/Button.js";
import { Switch } from "@/components/atoms/Switch.js";
import { SettingRow } from "@/components/molecules/SettingRow.js";
import { TerminalNotificationSoundControls } from "@/components/molecules/TerminalNotificationSoundControls.js";
import {
  useAgentPathsVerification,
  useOmpExtensionStatus,
  useInstallOmpExtension,
  useUninstallOmpExtension,
  useNativeIntegrationStatus,
  useInstallNativeIntegration,
  useUninstallNativeIntegration,
} from "@/api/queries.js";
import type { ConnectionRef } from "@/api/ownership.js";
import type { ManagedReadinessStatus } from "@/api/agent-status-types.js";
import { useSettingsStore } from "@/stores/settings.js";
import {
  getBrowserNotificationPermissionState,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermissionState,
} from "@/lib/browser-notification-service.js";
import { recordClientDiagnostic } from "@/lib/diagnostics-client.js";

interface AgentSettingsProps {
  owner?: ConnectionRef;
  profileId?: string;
}

const PERMISSION_VARIANT: Record<
  BrowserNotificationPermissionState,
  "success" | "danger" | "warning" | "neutral"
> = {
  granted: "success",
  denied: "danger",
  default: "warning",
  unsupported: "neutral",
};

const PERMISSION_LABEL: Record<BrowserNotificationPermissionState, string> = {
  granted: "Granted",
  denied: "Denied",
  default: "Not requested",
  unsupported: "Unsupported",
};

const READINESS_LABEL: Record<ManagedReadinessStatus, string> = {
  ready: "Ready",
  "restart-required": "Restart Required",
  "trust-required": "Trust Required",
  "policy-disabled": "Policy Disabled",
  "path-mismatch": "Path Mismatch",
  "permission-denied": "Permission Denied",
  "unsupported-version": "Unsupported Version",
  unverified: "Unverified",
};

const READINESS_VARIANT: Record<
  ManagedReadinessStatus,
  "success" | "warning" | "danger" | "neutral"
> = {
  ready: "success",
  "restart-required": "warning",
  "trust-required": "warning",
  "policy-disabled": "neutral",
  "path-mismatch": "warning",
  "permission-denied": "danger",
  "unsupported-version": "danger",
  unverified: "neutral",
};

export function AgentSettings({ owner }: AgentSettingsProps) {
  const {
    terminalAgentNotifications,
    saveAgentNotificationPolicy,
    agentSettingsPaths,
    saveAgentSettingsPaths,
  } = useSettingsStore();

  const [ompPathDraft, setOmpPathDraft] = useState<string>(
    () => agentSettingsPaths?.ompAgentDir ?? "~/.omp/agent",
  );
  const [codexPathDraft, setCodexPathDraft] = useState<string>(
    () => agentSettingsPaths?.codexDir ?? "~/.codex",
  );
  const [claudePathDraft, setClaudePathDraft] = useState<string>(
    () => agentSettingsPaths?.claudeDir ?? "~/.claude",
  );

  const [ompFeedback, setOmpFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [codexFeedback, setCodexFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [claudeFeedback, setClaudeFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const [permission, setPermission] =
    useState<BrowserNotificationPermissionState>(() =>
      getBrowserNotificationPermissionState(),
    );
  const [permissionPending, setPermissionPending] = useState(false);

  useEffect(() => {
    const syncPermission = () =>
      setPermission(getBrowserNotificationPermissionState());
    syncPermission();
    globalThis.window?.addEventListener("focus", syncPermission);
    return () =>
      globalThis.window?.removeEventListener("focus", syncPermission);
  }, []);

  // Reset drafts and feedback when owner profile changes
  useEffect(() => {
    setOmpPathDraft(agentSettingsPaths?.ompAgentDir ?? "~/.omp/agent");
    setCodexPathDraft(agentSettingsPaths?.codexDir ?? "~/.codex");
    setClaudePathDraft(agentSettingsPaths?.claudeDir ?? "~/.claude");
    setOmpFeedback(null);
    setCodexFeedback(null);
    setClaudeFeedback(null);
  }, [owner?.profileId]);

  // Update drafts when store preferences change externally
  useEffect(() => {
    if (agentSettingsPaths?.ompAgentDir) {
      setOmpPathDraft(agentSettingsPaths.ompAgentDir);
    }
    if (agentSettingsPaths?.codexDir) {
      setCodexPathDraft(agentSettingsPaths.codexDir);
    }
    if (agentSettingsPaths?.claudeDir) {
      setClaudePathDraft(agentSettingsPaths.claudeDir);
    }
  }, [
    agentSettingsPaths?.ompAgentDir,
    agentSettingsPaths?.codexDir,
    agentSettingsPaths?.claudeDir,
  ]);

  const {
    data: verification,
    isLoading: isVerifying,
    refetch: refetchVerification,
  } = useAgentPathsVerification(
    {
      agentDir: ompPathDraft,
      codexDir: codexPathDraft,
      claudeDir: claudePathDraft,
    },
    { owner },
  );

  const {
    data: ompReport,
    isLoading: isOmpReportLoading,
    refetch: refetchOmpReport,
  } = useOmpExtensionStatus(ompPathDraft, { owner });

  const {
    data: codexReport,
    isLoading: isCodexReportLoading,
    refetch: refetchCodexReport,
  } = useNativeIntegrationStatus("codex", codexPathDraft, { owner });

  const {
    data: claudeReport,
    isLoading: isClaudeReportLoading,
    refetch: refetchClaudeReport,
  } = useNativeIntegrationStatus("claude", claudePathDraft, { owner });

  const installOmpMutation = useInstallOmpExtension({ owner });
  const uninstallOmpMutation = useUninstallOmpExtension({ owner });

  const installCodexMutation = useInstallNativeIntegration("codex", { owner });
  const uninstallCodexMutation = useUninstallNativeIntegration("codex", { owner });

  const installClaudeMutation = useInstallNativeIntegration("claude", { owner });
  const uninstallClaudeMutation = useUninstallNativeIntegration("claude", { owner });

  const handleSaveOmpPath = () => {
    saveAgentSettingsPaths({ ompAgentDir: ompPathDraft });
    void refetchVerification();
    void refetchOmpReport();
  };

  const handleSaveCodexPath = () => {
    saveAgentSettingsPaths({ codexDir: codexPathDraft });
    void refetchVerification();
    void refetchCodexReport();
  };

  const handleSaveClaudePath = () => {
    saveAgentSettingsPaths({ claudeDir: claudePathDraft });
    void refetchVerification();
    void refetchClaudeReport();
  };

  const handleInstallOmp = async () => {
    setOmpFeedback(null);
    saveAgentSettingsPaths({ ompAgentDir: ompPathDraft });
    try {
      await installOmpMutation.mutateAsync(ompPathDraft);
      setOmpFeedback({
        type: "success",
        message:
          "Extension installed successfully! Please restart any active OMP sessions in your terminals to load it.",
      });
      void refetchOmpReport();
      void refetchVerification();
    } catch (err) {
      setOmpFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to install OMP extension.",
      });
    }
  };

  const handleUninstallOmp = async () => {
    setOmpFeedback(null);
    try {
      await uninstallOmpMutation.mutateAsync(ompPathDraft);
      setOmpFeedback({
        type: "success",
        message:
          "Extension uninstalled successfully. Restart any active OMP sessions.",
      });
      void refetchOmpReport();
      void refetchVerification();
    } catch (err) {
      setOmpFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to uninstall OMP extension.",
      });
    }
  };

  const handleInstallCodex = async () => {
    setCodexFeedback(null);
    saveAgentSettingsPaths({ codexDir: codexPathDraft });
    try {
      await installCodexMutation.mutateAsync(codexPathDraft);
      setCodexFeedback({
        type: "success",
        message:
          "Codex hook installed successfully! Restart any active Codex sessions in your terminals.",
      });
      void refetchCodexReport();
      void refetchVerification();
    } catch (err) {
      setCodexFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to install Codex native hook.",
      });
    }
  };

  const handleUninstallCodex = async () => {
    setCodexFeedback(null);
    try {
      await uninstallCodexMutation.mutateAsync(codexPathDraft);
      setCodexFeedback({
        type: "success",
        message:
          "Codex hook uninstalled successfully. Restart any active Codex sessions.",
      });
      void refetchCodexReport();
      void refetchVerification();
    } catch (err) {
      setCodexFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to uninstall Codex native hook.",
      });
    }
  };

  const handleInstallClaude = async () => {
    setClaudeFeedback(null);
    saveAgentSettingsPaths({ claudeDir: claudePathDraft });
    try {
      await installClaudeMutation.mutateAsync(claudePathDraft);
      setClaudeFeedback({
        type: "success",
        message:
          "Claude hook installed successfully! Restart any active Claude Code sessions in your terminals.",
      });
      void refetchClaudeReport();
      void refetchVerification();
    } catch (err) {
      setClaudeFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to install Claude native hook.",
      });
    }
  };

  const handleUninstallClaude = async () => {
    setClaudeFeedback(null);
    try {
      await uninstallClaudeMutation.mutateAsync(claudePathDraft);
      setClaudeFeedback({
        type: "success",
        message:
          "Claude hook uninstalled successfully. Restart any active Claude Code sessions.",
      });
      void refetchClaudeReport();
      void refetchVerification();
    } catch (err) {
      setClaudeFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to uninstall Claude native hook.",
      });
    }
  };

  async function handleRequestPermission() {
    setPermissionPending(true);
    const next = await requestBrowserNotificationPermission();
    setPermission(next);
    setPermissionPending(false);
    recordClientDiagnostic(
      "custom",
      "terminal-agent-notifications",
      "browser notification permission requested",
      { permission: next },
    );
  }

  const isPendingOmpAction =
    installOmpMutation.isPending || uninstallOmpMutation.isPending;
  const isPendingCodexAction =
    installCodexMutation.isPending || uninstallCodexMutation.isPending;
  const isPendingClaudeAction =
    installClaudeMutation.isPending || uninstallClaudeMutation.isPending;

  const ompPolicy = terminalAgentNotifications.agents.omp;
  const codexPolicy = terminalAgentNotifications.agents.codex;
  const claudePolicy = terminalAgentNotifications.agents.claude;

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* ── Overview Banner ────────────────────────────────────────────── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center font-bold">
              <BellRing className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text)]">
                Agent Status & Notification Settings
              </h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Configure installation paths, manage extension & hook lifecycles, and
                enable semantic terminal notifications.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void refetchVerification();
              void refetchOmpReport();
              void refetchCodexReport();
              void refetchClaudeReport();
            }}
            disabled={
              isVerifying ||
              isOmpReportLoading ||
              isCodexReportLoading ||
              isClaudeReportLoading
            }
          >
            <RefreshCw
              className={`h-3.5 w-3.5 mr-1.5 ${
                isVerifying ||
                isOmpReportLoading ||
                isCodexReportLoading ||
                isClaudeReportLoading
                  ? "animate-spin"
                  : ""
              }`}
            />
            Verify Paths
          </Button>
        </div>
      </div>

      {/* ── OMP (Oh My Pi) Section ────────────────────────────────────── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 flex flex-col gap-4">
        {/* Title & Badge */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center font-bold text-sm">
              π
            </div>
            <div>
              <h4 className="text-sm font-semibold text-[var(--color-text)]">
                Oh My Pi (OMP) Integration & Notifications
              </h4>
              <p className="text-xs text-[var(--color-text-muted)]">
                Authoritative turn outcomes, execution state tracking, and alerts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isOmpReportLoading ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                Checking…
              </span>
            ) : ompReport?.status === "current" ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Installed (v{ompReport.version || ompReport.bundledVersion})
              </span>
            ) : ompReport?.status === "outdated" ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Update Available (v{ompReport.bundledVersion})
              </span>
            ) : ompReport?.status === "modified" ? (
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

        {/* Path Configuration */}
        <div className="flex flex-col gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <label
            htmlFor="omp-agent-dir-input"
            className="text-xs font-medium text-[var(--color-text)] flex items-center justify-between"
          >
            <span className="flex items-center gap-1.5">
              <Folder className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
              OMP Agent Directory (Install & Notification Target)
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
              Runtime: {verification?.ompNotificationDir || "~/.omp/agent"}
            </span>
          </label>
          <div className="flex items-center gap-2">
            <input
              id="omp-agent-dir-input"
              type="text"
              value={ompPathDraft}
              onChange={(e) => setOmpPathDraft(e.target.value)}
              placeholder="e.g. ~/.omp/agent or /home/user/.omp/agent"
              className="flex-1 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-3 py-1.5 font-mono text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
            <Button variant="secondary" size="sm" onClick={handleSaveOmpPath}>
              Save Path
            </Button>
          </div>
          {ompReport?.targetPath && (
            <p className="text-[11px] font-mono text-[var(--color-text-muted)] truncate">
              Target extension file: {ompReport.targetPath}
            </p>
          )}
        </div>

        {/* Security Callout */}
        <div className="rounded border border-sky-500/20 bg-sky-500/5 p-3 text-xs text-sky-300 flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-sky-400 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-sky-200">
              Hardened Single-Extension Boundary
            </p>
            <p className="text-[11px] text-sky-300/90 mt-0.5 leading-relaxed">
              Only the verified bundled DamHopper OMP adapter (<code>dam-hopper-agent-status.ts</code>) is written to the target directory. Symlinks, outside files, and arbitrary uploads are rejected.
            </p>
          </div>
        </div>

        {/* Feedback banner */}
        {ompFeedback && (
          <div
            className={`rounded border px-3 py-2 text-xs ${
              ompFeedback.type === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-300"
            }`}
          >
            {ompFeedback.message}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          {ompReport?.status === "current" ? (
            <Button
              variant="danger"
              size="sm"
              onClick={handleUninstallOmp}
              disabled={isPendingOmpAction}
            >
              {uninstallOmpMutation.isPending ? "Removing…" : "Remove Extension"}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleInstallOmp}
              disabled={isPendingOmpAction || ompReport?.status === "modified"}
            >
              {installOmpMutation.isPending
                ? "Installing…"
                : ompReport?.status === "outdated"
                  ? "Update Extension"
                  : "Install Extension"}
            </Button>
          )}
        </div>

        {/* Strict Notification Path Verification Gate */}
        <div className="border-t border-[var(--color-border)] pt-4 flex flex-col gap-3">
          <h5 className="text-xs font-semibold text-[var(--color-text)] uppercase tracking-wider">
            OMP Notification Policy
          </h5>

          {!verification?.ompCanEnable && (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-200">
                  Notifications Unavailable for OMP
                </p>
                <p className="text-[11px] text-amber-300/90 mt-0.5">
                  {verification?.ompReason ||
                    "Install path and notification runtime path must match and the extension must be installed before notifications can be enabled."}
                </p>
              </div>
            </div>
          )}

          <SettingRow
            title="Enable OMP notifications"
            description={
              verification?.ompCanEnable
                ? "Receive alerts when OMP finishes a turn or requests attention."
                : "Disabled: Requires matching installation and runtime paths with a verified extension."
            }
          >
            <Switch
              checked={ompPolicy.enabled && (verification?.ompCanEnable ?? false)}
              ariaLabel="Enable OMP notifications"
              disabled={!verification?.ompCanEnable}
              onCheckedChange={(enabled) =>
                saveAgentNotificationPolicy("omp", { enabled })
              }
            />
          </SettingRow>

          <SettingRow
            title="In-app toast"
            description="Show transient popup notification on completed turns."
          >
            <Switch
              checked={ompPolicy.toast}
              ariaLabel="Enable OMP in-app toast"
              disabled={!ompPolicy.enabled || !verification?.ompCanEnable}
              onCheckedChange={(toast) =>
                saveAgentNotificationPolicy("omp", { toast })
              }
            />
          </SettingRow>

          <SettingRow
            title="Browser popup"
            description="Display native OS / browser notification when app is in the background."
          >
            <Switch
              checked={ompPolicy.browser}
              ariaLabel="Enable OMP browser popup"
              disabled={!ompPolicy.enabled || !verification?.ompCanEnable}
              onCheckedChange={(browser) =>
                saveAgentNotificationPolicy("omp", { browser })
              }
            />
          </SettingRow>

          <TerminalNotificationSoundControls
            masterEnabled={ompPolicy.enabled && (verification?.ompCanEnable ?? false)}
            soundEnabled={ompPolicy.sound}
            soundPattern={ompPolicy.pattern}
            soundVolume={ompPolicy.volume}
            agentName="OMP"
            onSoundEnabledChange={(sound) =>
              saveAgentNotificationPolicy("omp", { sound })
            }
            onSoundPatternChange={(pattern) =>
              saveAgentNotificationPolicy("omp", { pattern })
            }
            onSoundVolumeChange={(volume) =>
              saveAgentNotificationPolicy("omp", { volume })
            }
          />
        </div>
      </div>

      {/* ── Codex Section ─────────────────────────────────────────────── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 flex flex-col gap-4">
        {/* Title & Badges */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text)] flex items-center justify-center font-bold text-sm">
              <TerminalSquare className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-[var(--color-text)]">
                Codex Configuration & Status Hooks
              </h4>
              <p className="text-xs text-[var(--color-text-muted)]">
                Native hook observation for execution state and turn tracking
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isCodexReportLoading ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                Checking…
              </span>
            ) : codexReport?.status === "current" ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Installed (v{codexReport.version || codexReport.bundledVersion})
              </span>
            ) : codexReport?.status === "outdated" ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Update Available (v{codexReport.bundledVersion})
              </span>
            ) : codexReport?.status === "modified" ? (
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

            {codexReport && (
              <Badge variant={READINESS_VARIANT[codexReport.readiness]}>
                {READINESS_LABEL[codexReport.readiness]}
              </Badge>
            )}
          </div>
        </div>

        {/* Path Configuration */}
        <div className="flex flex-col gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <label
            htmlFor="codex-dir-input"
            className="text-xs font-medium text-[var(--color-text)] flex items-center justify-between"
          >
            <span className="flex items-center gap-1.5">
              <Folder className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
              Codex Directory (Hooks & Config Target)
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
              Runtime: {verification?.codexNotificationDir || "~/.codex"}
            </span>
          </label>
          <div className="flex items-center gap-2">
            <input
              id="codex-dir-input"
              type="text"
              value={codexPathDraft}
              onChange={(e) => setCodexPathDraft(e.target.value)}
              placeholder="e.g. ~/.codex or /home/user/.codex"
              className="flex-1 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-3 py-1.5 font-mono text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
            <Button variant="secondary" size="sm" onClick={handleSaveCodexPath}>
              Save Path
            </Button>
          </div>
          <p className="text-[11px] font-mono text-[var(--color-text-muted)] truncate">
            Target launcher: {codexReport?.launcherPath || `${codexPathDraft}/hooks/dam-hopper-agent-status`}
          </p>
        </div>

        {/* Status-Only Capability Callout */}
        <div className="rounded border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-amber-200">
              Status-Only Observation
            </p>
            <p className="text-[11px] text-amber-300/90 mt-0.5 leading-relaxed">
              Codex native hooks track execution state (working/idle/unknown) only. Turn-ended alerts and attention notifications are not supported in this rollout.
            </p>
          </div>
        </div>

        {/* Feedback banner */}
        {codexFeedback && (
          <div
            className={`rounded border px-3 py-2 text-xs ${
              codexFeedback.type === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-300"
            }`}
          >
            {codexFeedback.message}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          {codexReport?.status === "current" ? (
            <Button
              variant="danger"
              size="sm"
              onClick={handleUninstallCodex}
              disabled={isPendingCodexAction}
            >
              {uninstallCodexMutation.isPending ? "Removing…" : "Remove Hook"}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleInstallCodex}
              disabled={isPendingCodexAction || codexReport?.status === "modified"}
            >
              {installCodexMutation.isPending
                ? "Installing…"
                : codexReport?.status === "outdated"
                  ? "Update Hook"
                  : "Install Hook"}
            </Button>
          )}
        </div>

        {/* Notification Policy: Disabled with honest reason */}
        <div className="border-t border-[var(--color-border)] pt-4 flex flex-col gap-3">
          <h5 className="text-xs font-semibold text-[var(--color-text)] uppercase tracking-wider">
            Codex Notification Policy
          </h5>

          <SettingRow
            title="Enable Codex notifications"
            description="Disabled: Codex provides status only in this rollout; alert notifications are unsupported."
          >
            <Switch
              checked={false}
              ariaLabel="Enable Codex notifications"
              disabled={true}
              onCheckedChange={() => {}}
            />
          </SettingRow>

          <SettingRow
            title="In-app toast"
            description="Show transient popup notification on completed turns (inactive for Codex)."
          >
            <Switch
              checked={codexPolicy.toast}
              ariaLabel="Enable Codex in-app toast"
              disabled={true}
              onCheckedChange={(toast) =>
                saveAgentNotificationPolicy("codex", { toast })
              }
            />
          </SettingRow>

          <SettingRow
            title="Browser popup"
            description="Display native OS / browser notification when app is in the background (inactive for Codex)."
          >
            <Switch
              checked={codexPolicy.browser}
              ariaLabel="Enable Codex browser popup"
              disabled={true}
              onCheckedChange={(browser) =>
                saveAgentNotificationPolicy("codex", { browser })
              }
            />
          </SettingRow>

          <TerminalNotificationSoundControls
            masterEnabled={false}
            soundEnabled={codexPolicy.sound}
            soundPattern={codexPolicy.pattern}
            soundVolume={codexPolicy.volume}
            agentName="Codex"
            onSoundEnabledChange={(sound) =>
              saveAgentNotificationPolicy("codex", { sound })
            }
            onSoundPatternChange={(pattern) =>
              saveAgentNotificationPolicy("codex", { pattern })
            }
            onSoundVolumeChange={(volume) =>
              saveAgentNotificationPolicy("codex", { volume })
            }
          />
        </div>
      </div>

      {/* ── Claude Code Section ────────────────────────────────────────── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 flex flex-col gap-4">
        {/* Title & Badges */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text)] flex items-center justify-center font-bold text-sm">
              <Sparkles className="h-4 w-4 text-[var(--color-primary)]" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-[var(--color-text)]">
                Claude Code Integration & Notifications
              </h4>
              <p className="text-xs text-[var(--color-text-muted)]">
                Native hook observation and qualified attention alerts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isClaudeReportLoading ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                Checking…
              </span>
            ) : claudeReport?.status === "current" ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Installed (v{claudeReport.version || claudeReport.bundledVersion})
              </span>
            ) : claudeReport?.status === "outdated" ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Update Available (v{claudeReport.bundledVersion})
              </span>
            ) : claudeReport?.status === "modified" ? (
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

            {claudeReport && (
              <Badge variant={READINESS_VARIANT[claudeReport.readiness]}>
                {READINESS_LABEL[claudeReport.readiness]}
              </Badge>
            )}
          </div>
        </div>

        {/* Path Configuration */}
        <div className="flex flex-col gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
          <label
            htmlFor="claude-dir-input"
            className="text-xs font-medium text-[var(--color-text)] flex items-center justify-between"
          >
            <span className="flex items-center gap-1.5">
              <Folder className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
              Claude Directory (Hooks & Settings Target)
            </span>
            <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
              Runtime: {verification?.claudeNotificationDir || "~/.claude"}
            </span>
          </label>
          <div className="flex items-center gap-2">
            <input
              id="claude-dir-input"
              type="text"
              value={claudePathDraft}
              onChange={(e) => setClaudePathDraft(e.target.value)}
              placeholder="e.g. ~/.claude or /home/user/.claude"
              className="flex-1 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded px-3 py-1.5 font-mono text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
            <Button variant="secondary" size="sm" onClick={handleSaveClaudePath}>
              Save Path
            </Button>
          </div>
          <p className="text-[11px] font-mono text-[var(--color-text-muted)] truncate">
            Target launcher: {claudeReport?.launcherPath || `${claudePathDraft}/hooks/dam-hopper-agent-status`}
          </p>
        </div>

        {/* Attention-Only Capability Callout */}
        <div className="rounded border border-sky-500/20 bg-sky-500/5 p-3 text-xs text-sky-300 flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-sky-400 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-sky-200">
              Qualified Attention Only
            </p>
            <p className="text-[11px] text-sky-300/90 mt-0.5 leading-relaxed">
              Claude Code native hooks report status and qualified attention events (approval requested, question pending, agent error). Normal turn-ended alerts are not supported.
            </p>
          </div>
        </div>

        {/* Feedback banner */}
        {claudeFeedback && (
          <div
            className={`rounded border px-3 py-2 text-xs ${
              claudeFeedback.type === "success"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-300"
            }`}
          >
            {claudeFeedback.message}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          {claudeReport?.status === "current" ? (
            <Button
              variant="danger"
              size="sm"
              onClick={handleUninstallClaude}
              disabled={isPendingClaudeAction}
            >
              {uninstallClaudeMutation.isPending ? "Removing…" : "Remove Hook"}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleInstallClaude}
              disabled={isPendingClaudeAction || claudeReport?.status === "modified"}
            >
              {installClaudeMutation.isPending
                ? "Installing…"
                : claudeReport?.status === "outdated"
                  ? "Update Hook"
                  : "Install Hook"}
            </Button>
          )}
        </div>

        {/* Strict Notification Path Verification Gate */}
        <div className="border-t border-[var(--color-border)] pt-4 flex flex-col gap-3">
          <h5 className="text-xs font-semibold text-[var(--color-text)] uppercase tracking-wider">
            Claude Notification Policy
          </h5>

          {!verification?.claudeCanEnable && (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-200">
                  Notifications Unavailable for Claude
                </p>
                <p className="text-[11px] text-amber-300/90 mt-0.5">
                  {verification?.claudeReason ||
                    "Install path and runtime path must match and native hooks must be Ready before notifications can be enabled."}
                </p>
              </div>
            </div>
          )}

          <SettingRow
            title="Enable Claude notifications"
            description={
              verification?.claudeCanEnable
                ? "Receive alerts when Claude Code requests attention (approval, question, error)."
                : "Disabled: Requires matching installation and runtime paths with verified hooks."
            }
          >
            <Switch
              checked={claudePolicy.enabled && (verification?.claudeCanEnable ?? false)}
              ariaLabel="Enable Claude notifications"
              disabled={!verification?.claudeCanEnable}
              onCheckedChange={(enabled) =>
                saveAgentNotificationPolicy("claude", { enabled })
              }
            />
          </SettingRow>

          <SettingRow
            title="In-app toast"
            description="Show transient popup notification when Claude Code requests attention."
          >
            <Switch
              checked={claudePolicy.toast}
              ariaLabel="Enable Claude in-app toast"
              disabled={!claudePolicy.enabled || !verification?.claudeCanEnable}
              onCheckedChange={(toast) =>
                saveAgentNotificationPolicy("claude", { toast })
              }
            />
          </SettingRow>

          <SettingRow
            title="Browser popup"
            description="Display native OS / browser notification when app is in the background."
          >
            <Switch
              checked={claudePolicy.browser}
              ariaLabel="Enable Claude browser popup"
              disabled={!claudePolicy.enabled || !verification?.claudeCanEnable}
              onCheckedChange={(browser) =>
                saveAgentNotificationPolicy("claude", { browser })
              }
            />
          </SettingRow>

          <TerminalNotificationSoundControls
            masterEnabled={claudePolicy.enabled && (verification?.claudeCanEnable ?? false)}
            soundEnabled={claudePolicy.sound}
            soundPattern={claudePolicy.pattern}
            soundVolume={claudePolicy.volume}
            agentName="Claude"
            onSoundEnabledChange={(sound) =>
              saveAgentNotificationPolicy("claude", { sound })
            }
            onSoundPatternChange={(pattern) =>
              saveAgentNotificationPolicy("claude", { pattern })
            }
            onSoundVolumeChange={(volume) =>
              saveAgentNotificationPolicy("claude", { volume })
            }
          />
        </div>
      </div>

      {/* ── Global Browser Permissions ─────────────────────────────────── */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 flex flex-col gap-4">
        <h4 className="text-sm font-semibold text-[var(--color-text)]">
          Browser Notification Permissions
        </h4>
        <SettingRow
          title="Browser permission"
          description="Permission must be granted in this browser for desktop/OS popups to appear"
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span aria-live="polite" role="status">
              <Badge variant={PERMISSION_VARIANT[permission]}>
                {PERMISSION_LABEL[permission]}
              </Badge>
            </span>
            <Button
              type="button"
              size="sm"
              loading={permissionPending}
              disabled={
                (!ompPolicy.enabled && !claudePolicy.enabled) ||
                permission === "unsupported"
              }
              onClick={() => void handleRequestPermission()}
            >
              Request permission
            </Button>
          </div>
        </SettingRow>
        {permission === "denied" && (
          <p className="text-xs text-[var(--color-text-muted)]">
            Notifications are blocked by the browser. Update this site&apos;s
            notification setting in your browser address bar, then request permission again.
          </p>
        )}
      </div>
    </div>
  );
}
