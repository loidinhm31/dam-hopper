import { useEffect, useState } from "react";
import { BellRing, ShieldCheck, AlertCircle, RefreshCw, Folder } from "lucide-react";
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
} from "@/api/queries.js";
import type { ConnectionRef } from "@/api/ownership.js";
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

  const [ompFeedback, setOmpFeedback] = useState<{
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

  // Update drafts when store preferences change externally
  useEffect(() => {
    if (agentSettingsPaths?.ompAgentDir) {
      setOmpPathDraft(agentSettingsPaths.ompAgentDir);
    }
    if (agentSettingsPaths?.codexDir) {
      setCodexPathDraft(agentSettingsPaths.codexDir);
    }
  }, [agentSettingsPaths?.ompAgentDir, agentSettingsPaths?.codexDir]);

  const {
    data: verification,
    isLoading: isVerifying,
    refetch: refetchVerification,
  } = useAgentPathsVerification(
    { agentDir: ompPathDraft, codexDir: codexPathDraft },
    { owner },
  );

  const {
    data: ompReport,
    isLoading: isOmpReportLoading,
    refetch: refetchOmpReport,
  } = useOmpExtensionStatus(ompPathDraft, { owner });

  const installMutation = useInstallOmpExtension({ owner });
  const uninstallMutation = useUninstallOmpExtension({ owner });

  const handleSaveOmpPath = () => {
    saveAgentSettingsPaths({ ompAgentDir: ompPathDraft });
    void refetchVerification();
    void refetchOmpReport();
  };

  const handleSaveCodexPath = () => {
    saveAgentSettingsPaths({ codexDir: codexPathDraft });
    void refetchVerification();
  };

  const handleInstallOmp = async () => {
    setOmpFeedback(null);
    try {
      await installMutation.mutateAsync(ompPathDraft);
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
      await uninstallMutation.mutateAsync(ompPathDraft);
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
    installMutation.isPending || uninstallMutation.isPending;

  const ompPolicy = terminalAgentNotifications.agents.omp;
  const codexPolicy = terminalAgentNotifications.agents.codex;

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
                Configure installation paths, manage extension lifecycles, and
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
            }}
            disabled={isVerifying || isOmpReportLoading}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 mr-1.5 ${
                isVerifying || isOmpReportLoading ? "animate-spin" : ""
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
              {uninstallMutation.isPending ? "Removing…" : "Remove Extension"}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleInstallOmp}
              disabled={isPendingOmpAction || ompReport?.status === "modified"}
            >
              {installMutation.isPending
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
        {/* Title & Badge */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-[var(--color-surface-2)] text-[var(--color-text)] flex items-center justify-center font-bold text-sm">
              C
            </div>
            <div>
              <h4 className="text-sm font-semibold text-[var(--color-text)]">
                Codex Configuration & Notifications
              </h4>
              <p className="text-xs text-[var(--color-text-muted)]">
                Config.toml TUI notification sync and OSC9 terminal alert tracking
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {verification?.codexConfigExists ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Config Verified
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Config Missing
              </span>
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
              Codex Directory (Config & Notification Target)
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
            Target config file: {verification?.codexConfigDir ? `${verification.codexConfigDir}/config.toml` : `${codexPathDraft}/config.toml`}
          </p>
        </div>

        {/* Strict Notification Path Verification Gate */}
        <div className="border-t border-[var(--color-border)] pt-4 flex flex-col gap-3">
          <h5 className="text-xs font-semibold text-[var(--color-text)] uppercase tracking-wider">
            Codex Notification Policy
          </h5>

          {!verification?.codexCanEnable && (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-200">
                  Notifications Unavailable for Codex
                </p>
                <p className="text-[11px] text-amber-300/90 mt-0.5">
                  {verification?.codexReason ||
                    "Configured path must match runtime path and config.toml must exist before notifications can be enabled."}
                </p>
              </div>
            </div>
          )}

          <SettingRow
            title="Enable Codex notifications"
            description={
              verification?.codexCanEnable
                ? 'Syncs `tui.notifications`, `tui.notification_method = "osc9"` to config.toml'
                : "Disabled: Requires matching directory and existing config.toml."
            }
          >
            <Switch
              checked={codexPolicy.enabled && (verification?.codexCanEnable ?? false)}
              ariaLabel="Enable Codex notifications"
              disabled={!verification?.codexCanEnable}
              onCheckedChange={(enabled) =>
                saveAgentNotificationPolicy("codex", { enabled })
              }
            />
          </SettingRow>

          <SettingRow
            title="In-app toast"
            description="Show transient popup notification on completed turns."
          >
            <Switch
              checked={codexPolicy.toast}
              ariaLabel="Enable Codex in-app toast"
              disabled={!codexPolicy.enabled || !verification?.codexCanEnable}
              onCheckedChange={(toast) =>
                saveAgentNotificationPolicy("codex", { toast })
              }
            />
          </SettingRow>

          <SettingRow
            title="Browser popup"
            description="Display native OS / browser notification when app is in the background."
          >
            <Switch
              checked={codexPolicy.browser}
              ariaLabel="Enable Codex browser popup"
              disabled={!codexPolicy.enabled || !verification?.codexCanEnable}
              onCheckedChange={(browser) =>
                saveAgentNotificationPolicy("codex", { browser })
              }
            />
          </SettingRow>

          <TerminalNotificationSoundControls
            masterEnabled={codexPolicy.enabled && (verification?.codexCanEnable ?? false)}
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
                (!ompPolicy.enabled && !codexPolicy.enabled) ||
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
