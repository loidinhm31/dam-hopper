import { useState } from "react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import {
  useConfig,
  useUpdateConfig,
  useClearCache,
  useResetWorkspace,
  useExportSettings,
  useImportSettings,
  useManualProjectStatus,
} from "@/api/queries.js";
import { SettingsAppearanceSection } from "@/components/organisms/SettingsAppearanceSection.js";
import { SettingsProjectStatusSection } from "@/components/organisms/SettingsProjectStatusSection.js";
import { SettingsKeyboardShortcutsSection } from "@/components/organisms/SettingsKeyboardShortcutsSection.js";
import { SettingsUsageInsightsSection } from "@/components/organisms/SettingsUsageInsightsSection.js";
import { DiagnosticsExportButton } from "@/components/organisms/DiagnosticsExportButton.js";
import { SettingsSectionAccordion } from "@/components/pages/settings-page/SettingsSectionAccordion.js";
import { SettingsMaintenancePanel } from "@/components/pages/settings-page/SettingsMaintenancePanel.js";
import { SettingsImportExportPanel } from "@/components/pages/settings-page/SettingsImportExportPanel.js";
import {
  SettingsGlobalConfigPanel,
  SettingsWorkspaceConfigPanel,
} from "@/components/pages/settings-page/SettingsConfigPanels.js";
import { useWorkspaceStore } from "@/stores/workspace.js";

const SETTINGS_DIAGNOSTICS_SCOPE = {
  page: "settings",
  route: "/settings",
  frontendScopes: ["SettingsPage", "settings"],
};

export function SettingsPage() {
  const { data: config, isLoading, error } = useConfig();
  const {
    mutateAsync: updateConfig,
    isPending,
    error: saveError,
  } = useUpdateConfig();

  const clearCache = useClearCache();
  const resetWorkspace = useResetWorkspace();
  const exportSettings = useExportSettings();
  const importSettings = useImportSettings();
  const activeProject = useWorkspaceStore((state) => state.activeProject);
  const projectStatus = useManualProjectStatus();
  const refreshedProjectStatus =
    projectStatus.data?.project === activeProject
      ? projectStatus.data.status
      : undefined;
  const projectStatusError =
    projectStatus.variables === activeProject ? projectStatus.error : null;
  const projectStatusLoading =
    projectStatus.isPending && projectStatus.variables === activeProject;

  const [clearMsg, setClearMsg] = useState<string | null>(null);
  const [clearErr, setClearErr] = useState<string | null>(null);
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  async function handleClearCache() {
    setClearMsg(null);
    setClearErr(null);
    try {
      await clearCache.mutateAsync();
      setClearMsg("Cache cleared — all queries will refetch fresh data.");
    } catch (err) {
      setClearErr(err instanceof Error ? err.message : String(err));
    }
    setTimeout(() => {
      setClearMsg(null);
      setClearErr(null);
    }, 4000);
  }

  async function handleNuclearReset() {
    setResetErr(null);
    const confirmed = window.confirm(
      "This will kill all terminal sessions and clear all workspace state. Use the sidebar workspace switcher to open a new workspace. Continue?",
    );
    if (!confirmed) return;
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
      const result = await exportSettings.mutateAsync();
      setExportMsg(
        result.exported
          ? `Exported → ${result.path ?? "saved"}`
          : "Export cancelled.",
      );
    } catch (err) {
      setExportErr(err instanceof Error ? err.message : String(err));
    }
    setTimeout(() => {
      setExportMsg(null);
      setExportErr(null);
    }, 5000);
  }

  async function handleImport() {
    setImportMsg(null);
    setImportErr(null);
    try {
      const result = await importSettings.mutateAsync();
      setImportMsg(
        result.imported
          ? "Settings imported and config reloaded."
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

  return (
    <AppLayout
      title="Settings"
      actions={
        <DiagnosticsExportButton
          compact
          terminalIds={[]}
          scope={SETTINGS_DIAGNOSTICS_SCOPE}
        />
      }
    >
      <div className="max-w-4xl space-y-3">
        <SettingsSectionAccordion
          title="Appearance"
          description="Theme, layout density, editor behavior, and notification preferences."
          defaultOpen
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
          title="Usage insights"
          description="Opt in to privacy-safe local terminal aggregates and optional Codex token telemetry."
          defaultOpen
        >
          <SettingsUsageInsightsSection />
        </SettingsSectionAccordion>

        <SettingsSectionAccordion
          title="Global Settings"
          description="Edit machine-level defaults that apply across DamHopper workspaces."
          defaultOpen
        >
          <SettingsGlobalConfigPanel />
        </SettingsSectionAccordion>

        <SettingsSectionAccordion
          title="Workspace Config"
          description="Edit the active workspace TOML config and project definitions."
          defaultOpen
        >
          <SettingsWorkspaceConfigPanel
            config={config}
            isLoading={isLoading}
            error={error}
            onSave={updateConfig}
            isSaving={isPending}
            saveError={saveError}
          />
        </SettingsSectionAccordion>

        <SettingsSectionAccordion
          title="Project status"
          description="Inspect the latest Git commit for the active project."
        >
          <SettingsProjectStatusSection
            activeProject={activeProject}
            status={refreshedProjectStatus}
            isLoading={projectStatusLoading}
            error={projectStatusError}
            onRefresh={() => {
              if (activeProject) projectStatus.mutate(activeProject);
            }}
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
            onImport={() => void handleImport()}
            importPending={importSettings.isPending}
            importMsg={importMsg}
            importErr={importErr}
          />
        </SettingsSectionAccordion>
      </div>
    </AppLayout>
  );
}
