import { lazy, Suspense } from "react";
import type { DamHopperConfig } from "@/api/client.js";

const ConfigEditor = lazy(() =>
  import("@/components/organisms/ConfigEditor.js").then((m) => ({
    default: m.ConfigEditor,
  })),
);
const GlobalConfigEditor = lazy(() =>
  import("@/components/organisms/GlobalConfigEditor.js").then((m) => ({
    default: m.GlobalConfigEditor,
  })),
);

const SETTINGS_FALLBACK = (
  <div className="flex min-h-24 items-center text-xs text-[var(--color-text-muted)]">
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
    <span className="ml-2">Loading settings…</span>
  </div>
);

interface SettingsWorkspaceConfigPanelProps {
  config?: DamHopperConfig;
  isLoading: boolean;
  error: unknown;
  onSave: (config: DamHopperConfig) => Promise<DamHopperConfig>;
  isSaving: boolean;
  saveError: unknown;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function SettingsGlobalConfigPanel() {
  return (
    <Suspense fallback={SETTINGS_FALLBACK}>
      <GlobalConfigEditor />
    </Suspense>
  );
}

export function SettingsWorkspaceConfigPanel({
  config,
  isLoading,
  error,
  onSave,
  isSaving,
  saveError,
}: SettingsWorkspaceConfigPanelProps) {
  return (
    <>
      {isLoading && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Loading config…
        </p>
      )}
      {error && (
        <p className="text-sm text-[var(--color-danger)]" role="alert">
          Failed to load config: {errorMessage(error)}
        </p>
      )}
      {config && (
        <Suspense fallback={SETTINGS_FALLBACK}>
          <ConfigEditor
            config={config}
            onSave={onSave}
            isSaving={isSaving}
            saveError={saveError ? errorMessage(saveError) : null}
          />
        </Suspense>
      )}
    </>
  );
}
