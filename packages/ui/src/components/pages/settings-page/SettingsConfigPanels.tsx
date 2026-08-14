import { lazy, Suspense } from "react";
import { ApiRequestError } from "@/api/client.js";
import type { DamHopperConfig } from "@/api/client.js";
import {
  useSemanticNavigationSettings,
  useUpdateSemanticNavigationSettings,
} from "@/api/queries.js";
import { SettingRow } from "@/components/molecules/SettingRow.js";
import { Switch } from "@/components/atoms/Switch.js";

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

const SEMANTIC_UNAVAILABLE_FALLBACK =
  "A valid signed semantic bundle is required on this server.";
const MAX_SAFE_SERVER_REASON_LENGTH = 160;

function semanticMutationStatus(error: unknown): string {
  if (
    error instanceof ApiRequestError &&
    (error.status === 409 || error.code === "CONFIG_PERSISTENCE_DESYNCHRONIZED")
  ) {
    const reason = error.message.trim();
    if (reason) {
      return reason.length > MAX_SAFE_SERVER_REASON_LENGTH
        ? `${reason.slice(0, MAX_SAFE_SERVER_REASON_LENGTH - 1)}…`
        : reason;
    }
  }
  return "Semantic navigation setting was not changed.";
}

function SemanticNavigationSetting() {
  const settings = useSemanticNavigationSettings();
  const update = useUpdateSemanticNavigationSettings();
  const value = settings.data?.enabled ?? false;
  const unavailable = settings.data !== undefined && !settings.data.available;
  const description = settings.isError
    ? "Unable to load the server setting."
    : unavailable
      ? (settings.data?.disabledReason ?? SEMANTIC_UNAVAILABLE_FALLBACK)
      : "Server-scoped across all projects in the active workspace; applies immediately.";
  const status = update.isPending
    ? "Applying semantic navigation setting…"
    : update.error
      ? semanticMutationStatus(update.error)
      : null;

  return (
    <>
      <SettingRow title="Semantic navigation" description={description}>
        <Switch
          checked={value}
          disabled={
            settings.isLoading ||
            settings.isError ||
            (unavailable && !value) ||
            update.isPending
          }
          ariaLabel="Enable semantic navigation"
          onCheckedChange={(checked) => update.mutate(checked)}
        />
      </SettingRow>
      {status && (
        <p
          className={`text-xs ${update.error ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"}`}
          role={update.error ? "alert" : "status"}
          aria-live="polite"
        >
          {status}
        </p>
      )}
    </>
  );
}

export function SettingsGlobalConfigPanel() {
  return (
    <div className="space-y-4">
      <SemanticNavigationSetting />
      <div className="border-t border-[var(--color-border)]" />
      <Suspense fallback={SETTINGS_FALLBACK}>
        <GlobalConfigEditor />
      </Suspense>
    </div>
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
