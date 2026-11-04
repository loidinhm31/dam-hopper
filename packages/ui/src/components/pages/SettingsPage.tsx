import { ConfirmDialog } from "@/components/ui/ConfirmDialog.js";
import { useState, useEffect, useRef } from "react";
import { Switch } from "@/components/atoms/Switch.js";
import type { DamHopperConfig } from "@/api/client.js";
import {
  useConfig,
  useUpdateConfig,
  useClearCache,
  useResetWorkspace,
  useExportSettings,
  useImportSettings,
} from "@/api/queries.js";
import { readServerProfiles, type ServerProfile } from "@/api/server-config.js";
import { getConnectionSnapshot } from "@/api/connections.js";
import { useWorkbenchSelectionsStore } from "@/stores/workbench-selections.js";
import { useSettingsStore } from "@/stores/settings.js";
import { SettingsAppearanceSection } from "@/components/organisms/SettingsAppearanceSection.js";
import { SettingsKeyboardShortcutsSection } from "@/components/organisms/SettingsKeyboardShortcutsSection.js";
import { DiagnosticsExportButton } from "@/components/organisms/DiagnosticsExportButton.js";
import { SettingsIdleSuspendTimingSection } from "@/components/organisms/SettingsIdleSuspendTimingSection.js";
import { SettingsSectionAccordion } from "@/components/pages/settings-page/SettingsSectionAccordion.js";
import { SettingsMaintenancePanel } from "@/components/pages/settings-page/SettingsMaintenancePanel.js";
import { SettingsImportExportPanel } from "@/components/pages/settings-page/SettingsImportExportPanel.js";
import {
  SettingsGlobalConfigPanel,
  SettingsWorkspaceConfigPanel,
} from "@/components/pages/settings-page/SettingsConfigPanels.js";
const SETTINGS_DIAGNOSTICS_SCOPE = {
  page: "settings",
  route: "/settings",
  frontendScopes: ["SettingsPage", "settings"],
};

export interface SettingsPageProps {
  noLayout?: boolean;
  targetProfileId?: string | null;
  onTargetProfileChange?: (profileId: string | null) => void;
}

export function SettingsPage({
  noLayout = false,
  targetProfileId: explicitTargetProfileId,
  onTargetProfileChange,
}: SettingsPageProps = {}) {
  const profilesResult = readServerProfiles();
  const profiles: ServerProfile[] =
    profilesResult.status === "available" ? profilesResult.profiles : [];

  const {
    settingsProfileId: globalSettingsProfileId,
    setSettingsProfileId,
    preferencesProfileId,
    preferencesStatus,
  } = useWorkbenchSelectionsStore();

  const [localSettingsProfileId, setLocalSettingsProfileId] = useState<
    string | null
  >(() => explicitTargetProfileId ?? null);

  useEffect(() => {
    if (explicitTargetProfileId !== undefined) {
      setLocalSettingsProfileId(explicitTargetProfileId);
    }
  }, [explicitTargetProfileId]);

  const effectiveSettingsProfileId =
    explicitTargetProfileId !== undefined
      ? explicitTargetProfileId
      : noLayout
        ? localSettingsProfileId
        : globalSettingsProfileId;

  const effectiveSettingsProfileIdRef = useRef(effectiveSettingsProfileId);
  effectiveSettingsProfileIdRef.current = effectiveSettingsProfileId;

  function getCurrentEffectiveProfileId() {
    if (noLayout || explicitTargetProfileId !== undefined) {
      return effectiveSettingsProfileIdRef.current;
    }
    return useWorkbenchSelectionsStore.getState().settingsProfileId;
  }
  const switchPreferenceSource = useSettingsStore(
    (s) => s.switchPreferenceSource,
  );

  const targetSnapshot = effectiveSettingsProfileId
    ? getConnectionSnapshot(effectiveSettingsProfileId)
    : null;
  const targetProfile =
    profiles.find((p) => p.id === effectiveSettingsProfileId) ?? null;
  const targetOwner = effectiveSettingsProfileId
    ? (targetSnapshot?.owner ?? { profileId: effectiveSettingsProfileId, generation: 1 })
    : undefined;

  const prefProfile =
    profiles.find((p) => p.id === preferencesProfileId) ?? null;
  const prefSnapshot = preferencesProfileId
    ? getConnectionSnapshot(preferencesProfileId)
    : null;

  const { data: config, isLoading, error } = useConfig(targetOwner);
  const {
    mutateAsync: updateConfig,
    isPending,
    error: saveError,
  } = useUpdateConfig(targetOwner);

  const clearCache = useClearCache(targetOwner);
  const resetWorkspace = useResetWorkspace(targetOwner);
  const exportSettings = useExportSettings(targetOwner);
  const importSettings = useImportSettings(targetOwner);
  const [clearMsg, setClearMsg] = useState<string | null>(null);
  const [clearErr, setClearErr] = useState<string | null>(null);
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [nuclearResetConfirmOpen, setNuclearResetConfirmOpen] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [sessionChangesNotice, setSessionChangesNotice] = useState<string | null>(null);
  const [sessionChangesError, setSessionChangesError] = useState<string | null>(null);
  const [sessionChangesMutating, setSessionChangesMutating] = useState(false);

  useEffect(() => {
    setSessionChangesNotice(null);
    setSessionChangesError(null);
  }, [effectiveSettingsProfileId, targetOwner?.generation]);

  const isTargetReady = effectiveSettingsProfileId
    ? Boolean(
        targetProfile &&
          (!targetSnapshot || targetSnapshot.status === "connected"),
      )
    : true;
  const sessionChangesEnabled = Boolean(config?.server?.sessionChangesEnabled);

  async function handleToggleSessionChanges(nextChecked: boolean) {
    if (sessionChangesMutating || isPending || !config || !isTargetReady) {
      return;
    }
    setSessionChangesMutating(true);
    setSessionChangesNotice(null);
    setSessionChangesError(null);

    const actionProfileId = effectiveSettingsProfileId;
    const actionGeneration = targetOwner?.generation ?? 1;

    try {
      const nextConfig: DamHopperConfig = {
        ...config,
        server: {
          ...config.server,
          sessionChangesEnabled: nextChecked,
        },
      };
      await updateConfig(nextConfig);

      const currentSettingsProfileId = getCurrentEffectiveProfileId();
      const currentSnapshot = currentSettingsProfileId
        ? getConnectionSnapshot(currentSettingsProfileId)
        : null;
      const currentGeneration = currentSettingsProfileId
        ? (currentSnapshot?.owner.generation ?? 1)
        : 1;
      const isStillCurrentTarget =
        currentSettingsProfileId === actionProfileId &&
        currentGeneration === actionGeneration;

      if (isStillCurrentTarget) {
        if (nextChecked) {
          setSessionChangesNotice(
            "Restart active OMP sessions to load the Session Changes extension",
          );
        } else {
          setSessionChangesNotice(null);
        }
      }
    } catch (err) {
      const currentSettingsProfileId = getCurrentEffectiveProfileId();
      const currentSnapshot = currentSettingsProfileId
        ? getConnectionSnapshot(currentSettingsProfileId)
        : null;
      const currentGeneration = currentSettingsProfileId
        ? (currentSnapshot?.owner.generation ?? 1)
        : 1;
      const isStillCurrentTarget =
        currentSettingsProfileId === actionProfileId &&
        currentGeneration === actionGeneration;

      if (isStillCurrentTarget) {
        setSessionChangesError(
          err instanceof Error ? err.message : String(err),
        );
      }
    } finally {
      setSessionChangesMutating(false);
    }
  }


  async function handleClearCache() {
    setClearMsg(null);
    setClearErr(null);
    try {
      await clearCache.mutateAsync();
      const serverLabel = targetProfile ? ` on ${targetProfile.name}` : "";
      setClearMsg(
        `Cache cleared${serverLabel} — all queries will refetch fresh data.`,
      );
    } catch (err) {
      setClearErr(err instanceof Error ? err.message : String(err));
    }
    setTimeout(() => {
      setClearMsg(null);
      setClearErr(null);
    }, 4000);
  }

  function handleNuclearReset() {
    setResetErr(null);
    setNuclearResetConfirmOpen(true);
  }

  async function handleConfirmNuclearReset() {
    setNuclearResetConfirmOpen(false);
    setResetErr(null);
    try {
      await resetWorkspace.mutateAsync();
    } catch (err) {
      setResetErr(err instanceof Error ? err.message : String(err));
      setTimeout(() => setResetErr(null), 5000);
    }
  }

  async function handleExport() {
    setExportMsg(null);
    setExportErr(null);
    try {
      const tomlContent = await exportSettings.mutateAsync();
      const blob = new Blob([tomlContent], {
        type: "application/toml; charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const downloadFilename = targetProfile
        ? `dam-hopper-${targetProfile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-config.toml`
        : "config.toml";
      a.download = downloadFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportMsg(`Downloaded ${downloadFilename}`);
    } catch (err) {
      setExportErr(err instanceof Error ? err.message : String(err));
    }
    setTimeout(() => {
      setExportMsg(null);
      setExportErr(null);
    }, 5000);
  }

  const MAX_IMPORT_SIZE = 1024 * 1024; // 1 MiB

  function handleImportFile(file: File) {
    setImportMsg(null);
    setImportErr(null);

    if (file.size > MAX_IMPORT_SIZE) {
      setImportErr("File size exceeds 1 MiB limit.");
      setTimeout(() => setImportErr(null), 6000);
      return;
    }

    setPendingImportFile(file);
  }

  async function handleConfirmImportFile() {
    if (!pendingImportFile) return;
    const file = pendingImportFile;
    setPendingImportFile(null);

    const targetAtStart = effectiveSettingsProfileId;
    const generationAtStart = targetSnapshot?.owner.generation ?? 1;
    const currentSnap = targetAtStart
      ? getConnectionSnapshot(targetAtStart)
      : null;
    if (
      getCurrentEffectiveProfileId() !== targetAtStart ||
      (currentSnap && currentSnap.owner.generation !== generationAtStart)
    ) {
      setImportErr(
        "Import cancelled: settings target server or connection changed during confirmation.",
      );
      setTimeout(() => setImportErr(null), 6000);
      return;
    }

    try {
      const tomlContent = await file.text();
      const result = await importSettings.mutateAsync(tomlContent);
      setImportMsg(
        result.imported
          ? `Settings imported. Backup saved to ${result.backupFileName}.`
          : "Import cancelled.",
      );
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : String(err));
    }
    setTimeout(() => {
      setImportMsg(null);
      setImportErr(null);
    }, 6000);
  }

  const content = (
    <>
      <div className="max-w-4xl space-y-3">
        <section
          data-testid="settings-profile-targets"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-4"
        >
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
            <div className="space-y-0.5">
              <label
                htmlFor="settings-target-select"
                className="text-sm font-semibold text-[var(--color-text)]"
              >
                Settings Target Server
              </label>
              <p className="text-xs text-[var(--color-text-muted)]">
                Server whose workspace configuration, global defaults, and
                maintenance are inspected and modified.
              </p>
              {targetProfile && (
                <div className="flex items-center gap-2 pt-1 text-xs font-mono text-[var(--color-text-muted)]">
                  <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-success)]" />
                  <span>{targetProfile.name}</span>
                  <span>
                    ({targetSnapshot?.serverUrl || targetProfile.url})
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <select
                id="settings-target-select"
                className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                value={effectiveSettingsProfileId ?? ""}
                onChange={(e) => {
                  const val = e.target.value || null;
                  if (noLayout || explicitTargetProfileId !== undefined) {
                    setLocalSettingsProfileId(val);
                    onTargetProfileChange?.(val);
                  } else {
                    setSettingsProfileId(val);
                  }
                }}
              >
                <option value="">(Current / Default Server)</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.url})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between pt-3 border-t border-[var(--color-border)]">
            <div className="space-y-0.5">
              <label
                htmlFor="preferences-source-select"
                className="text-sm font-semibold text-[var(--color-text)]"
              >
                Workbench Preferences Source
              </label>
              <p className="text-xs text-[var(--color-text-muted)]">
                Server providing shared UI appearance, editor settings, keyboard
                shortcuts, and notification rules.
              </p>
              <div className="flex items-center gap-2 pt-1 text-xs font-mono text-[var(--color-text-muted)]">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    preferencesStatus === "active"
                      ? "bg-[var(--color-success)]"
                      : "bg-[var(--color-warning)]"
                  }`}
                />
                <span>Status: {preferencesStatus}</span>
                {prefProfile && (
                  <span>
                    — {prefProfile.name} (
                    {prefSnapshot?.serverUrl || prefProfile.url})
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                id="preferences-source-select"
                className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-xs text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                value={preferencesProfileId ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  void switchPreferenceSource(val || null);
                }}
              >
                <option value="">(None / Unset — Local Defaults)</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.url})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>
        <SettingsSectionAccordion
          title="Appearance"
          description="Theme, layout density, editor behavior, and notification preferences."
        >
          <SettingsAppearanceSection />
        </SettingsSectionAccordion>

        <SettingsSectionAccordion
          title="Keyboard Shortcuts"
          description="Tune command keys used across workspace navigation and terminals."
        >
          <SettingsKeyboardShortcutsSection />
        </SettingsSectionAccordion>
        <SettingsSectionAccordion
          title="Terminal Idle Suspend"
          description="Configure quiet duration and scheduled RTC wake timer for server-authoritative suspend."
        >
          <SettingsIdleSuspendTimingSection owner={targetOwner} />
        </SettingsSectionAccordion>
        <SettingsSectionAccordion
          title="Session Changes"
          description="Capture tool-observed pre-edit file states for lightweight review in active OMP sessions."
        >
          <div
            data-testid="settings-session-changes-section"
            className="space-y-3 p-1"
          >
            <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-sm font-semibold text-[var(--color-text)]">
                  Session Changes Tracking
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Records first-touch original file content for lightweight
                  terminal review before agent modifications.
                </p>
                <div className="pt-1 text-xs font-mono text-[var(--color-text-muted)]">
                  Target Server:{" "}
                  {targetProfile
                    ? `${targetProfile.name} (${targetSnapshot?.serverUrl || targetProfile.url})`
                    : "(Current / Default Server)"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={sessionChangesEnabled}
                  onCheckedChange={(checked) =>
                    void handleToggleSessionChanges(checked)
                  }
                  ariaLabel="Toggle Session Changes tracking"
                  disabled={
                    isLoading ||
                    !config ||
                    !isTargetReady ||
                    sessionChangesMutating ||
                    isPending
                  }
                />
              </div>
            </div>

            {sessionChangesNotice && (
              <div
                data-testid="session-changes-restart-notice"
                role="status"
                className="rounded border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-warning)]"
              >
                {sessionChangesNotice}
              </div>
            )}

            {sessionChangesError && (
              <div
                data-testid="session-changes-error"
                role="alert"
                className="rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]"
              >
                {sessionChangesError}
              </div>
            )}
          </div>
        </SettingsSectionAccordion>


        <SettingsSectionAccordion
          title="Global Settings"
          description="Edit machine-level defaults that apply across DamHopper workspaces."
        >
          <SettingsGlobalConfigPanel owner={targetOwner} />
        </SettingsSectionAccordion>

        <SettingsSectionAccordion
          title="Workspace Config"
          description="Edit the active workspace TOML config and project definitions."
        >
          <SettingsWorkspaceConfigPanel
            config={config}
            isLoading={isLoading}
            error={error}
            onSave={updateConfig}
            isSaving={isPending}
            saveError={saveError}
            serverUrl={targetSnapshot?.serverUrl || targetProfile?.url}
            serverName={targetProfile?.name}
          />
        </SettingsSectionAccordion>

        <SettingsSectionAccordion
          title="Maintenance"
          description="Refresh local data, export diagnostics, or reset workspace runtime state."
        >
          <SettingsMaintenancePanel
            diagnosticsScope={SETTINGS_DIAGNOSTICS_SCOPE}
            onClearCache={() => void handleClearCache()}
            clearCachePending={clearCache.isPending}
            clearMsg={clearMsg}
            clearErr={clearErr}
            onResetWorkspace={() => void handleNuclearReset()}
            resetPending={resetWorkspace.isPending}
            resetErr={resetErr}
            targetServerLabel={
              targetProfile
                ? `${targetProfile.name} (${targetSnapshot?.serverUrl || targetProfile.url})`
                : undefined
            }
          />
        </SettingsSectionAccordion>

        <SettingsSectionAccordion
          title="Import / Export Settings"
          description="Move workspace configuration between files without changing server contracts."
        >
          <SettingsImportExportPanel
            onExport={() => void handleExport()}
            exportPending={exportSettings.isPending}
            exportMsg={exportMsg}
            exportErr={exportErr}
            onImportFile={(file) => void handleImportFile(file)}
            importPending={importSettings.isPending}
            importMsg={importMsg}
            importErr={importErr}
            targetServerLabel={
              targetProfile
                ? `${targetProfile.name} (${targetSnapshot?.serverUrl || targetProfile.url})`
                : undefined
            }
          />
        </SettingsSectionAccordion>
      </div>
      <ConfirmDialog
        open={nuclearResetConfirmOpen}
        onClose={() => setNuclearResetConfirmOpen(false)}
        onConfirm={handleConfirmNuclearReset}
        title="Reset workspace state?"
        description={`This will kill all terminal sessions and clear all workspace state${
          targetProfile
            ? ` on server "${targetProfile.name}" (${targetSnapshot?.serverUrl || targetProfile.url})`
            : ""
        }. Use the sidebar workspace switcher to open a new workspace.`}
        confirmText="Reset workspace"
        variant="danger"
        loading={resetWorkspace.isPending}
      />

      <ConfirmDialog
        open={pendingImportFile !== null}
        onClose={() => {
          setPendingImportFile(null);
          setImportMsg("Import cancelled.");
          setTimeout(() => setImportMsg(null), 5000);
        }}
        onConfirm={handleConfirmImportFile}
        title="Replace configuration?"
        description={`Replace configuration for active workspace "${config?.workspace.name ?? "current workspace"}"${
          targetProfile
            ? ` on server "${targetProfile.name}" (${targetSnapshot?.serverUrl || targetProfile.url})`
            : ""
        } with "${pendingImportFile?.name}"?\n\nAn automatic backup will be created before applying.`}
        confirmText="Apply configuration"
        variant="danger"
        loading={importSettings.isPending}
      />
    </>
  );

  if (noLayout) {
    return content;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 gradient-bg">
      <div className="flex items-center justify-between pb-3 border-b border-[var(--color-border)] mb-4">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">Settings</h1>
        <DiagnosticsExportButton
          compact
          terminalIds={[]}
          scope={SETTINGS_DIAGNOSTICS_SCOPE}
        />
      </div>
      {content}
    </div>
  );
}
