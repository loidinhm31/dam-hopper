import { useState } from "react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import {
  useConfig,
  useUpdateConfig,
  useClearCache,
  useResetWorkspace,
  useExportSettings,
  useImportSettings,
} from "@/api/queries.js";
import { ConfigEditor } from "@/components/organisms/ConfigEditor.js";
import { GlobalConfigEditor } from "@/components/organisms/GlobalConfigEditor.js";

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
    setTimeout(() => { setClearMsg(null); setClearErr(null); }, 4000);
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
      setExportMsg(result.exported ? `Exported → ${result.path ?? "saved"}` : "Export cancelled.");
    } catch (err) {
      setExportErr(err instanceof Error ? err.message : String(err));
    }
    setTimeout(() => { setExportMsg(null); setExportErr(null); }, 5000);
  }

  async function handleImport() {
    setImportMsg(null);
    setImportErr(null);
    try {
      const result = await importSettings.mutateAsync();
      if (result.imported) {
        setImportMsg("Settings imported and config reloaded.");
      } else {
        setImportMsg("Import cancelled.");
      }
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : String(err));
    }
    setTimeout(() => {
      setImportMsg(null);
      setImportErr(null);
    }, 6000);
  }

  return (
    <AppLayout title="Settings">
      <div className="max-w-3xl space-y-10">
        <section>
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            Global Settings
          </h2>
          <GlobalConfigEditor />
        </section>

        <section>
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            Workspace Config
          </h2>
          {isLoading && (
            <p className="text-sm text-[var(--color-text-muted)]">
              Loading config…
            </p>
          )}
          {error && (
            <p className="text-sm text-[var(--color-danger)]">
              Failed to load config: {(error as Error).message}
            </p>
          )}
          {config && (
            <ConfigEditor
              config={config}
              onSave={updateConfig}
              isSaving={isPending}
              saveError={
                saveError
                  ? saveError instanceof Error
                    ? saveError.message
                    : String(saveError)
                  : null
              }
            />
          )}
        </section>

        {/* ── Maintenance ─────────────────────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            Maintenance
          </h2>
          <div className="glass-card rounded-lg p-5 space-y-4">
            {/* Revalidate */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-text)]">
                  Revalidate Cache
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Clear all cached query data so every panel refetches fresh
                  data from disk. Useful after external changes.
                </p>
                {clearMsg && (
                  <p className="text-xs text-[var(--color-success)] mt-1">
                    ✓ {clearMsg}
                  </p>
                )}
                {clearErr && (
                  <p className="text-xs text-[var(--color-danger)] mt-1">
                    ✗ {clearErr}
                  </p>
                )}
              </div>
              <button
                className="btn-bracket shrink-0"
                onClick={() => void handleClearCache()}
                disabled={clearCache.isPending}
              >
                {clearCache.isPending ? "Clearing…" : "Revalidate"}
              </button>
            </div>

            <div className="border-t border-[var(--color-border)]" />

            {/* Nuclear Reset */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-danger)]">
                  Nuclear Reset
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Kill all terminal sessions, clear cached state, and return to
                  workspace selection. This cannot be undone.
                </p>
                {resetErr && (
                  <p className="text-xs text-[var(--color-danger)] mt-1">
                    ✗ {resetErr}
                  </p>
                )}
              </div>
              <button
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide rounded-sm border border-[var(--color-danger)] text-[var(--color-danger)] bg-transparent cursor-pointer transition-all duration-150 hover:bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => void handleNuclearReset()}
                disabled={resetWorkspace.isPending}
              >
                {resetWorkspace.isPending ? "Resetting…" : "⚠ Nuclear Reset"}
              </button>
            </div>
          </div>
        </section>

        {/* ── Import / Export ───────────────────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            Import / Export Settings
          </h2>
          <div className="glass-card rounded-lg p-5 space-y-4">
            {/* Export */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-text)]">
                  Export Settings
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Save a copy of the current{" "}
                  <code className="text-[var(--color-primary)]">
                    dev-hub.toml
                  </code>{" "}
                  to a chosen location. Preserves all formatting and comments.
                </p>
                {exportMsg && (
                  <p className="text-xs text-[var(--color-success)] mt-1">
                    ✓ {exportMsg}
                  </p>
                )}
                {exportErr && (
                  <p className="text-xs text-[var(--color-danger)] mt-1">
                    ✗ {exportErr}
                  </p>
                )}
              </div>
              <button
                className="btn-bracket shrink-0"
                onClick={() => void handleExport()}
                disabled={exportSettings.isPending}
              >
                {exportSettings.isPending ? "Exporting…" : "Export"}
              </button>
            </div>

            <div className="border-t border-[var(--color-border)]" />

            {/* Import */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-text)]">
                  Import Settings
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  Replace the current workspace config with a{" "}
                  <code className="text-[var(--color-primary)]">.toml</code>{" "}
                  file. The file is validated before being written.
                </p>
                {importMsg && (
                  <p className="text-xs text-[var(--color-success)] mt-1">
                    ✓ {importMsg}
                  </p>
                )}
                {importErr && (
                  <p className="text-xs text-[var(--color-danger)] mt-1">
                    ✗ {importErr}
                  </p>
                )}
              </div>
              <button
                className="btn-bracket shrink-0"
                onClick={() => void handleImport()}
                disabled={importSettings.isPending}
              >
                {importSettings.isPending ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
