import { AppLayout } from "@/components/templates/AppLayout.js";
import { useConfig, useUpdateConfig } from "@/api/queries.js";
import { ConfigEditor } from "@/components/organisms/ConfigEditor.js";
import { GlobalConfigEditor } from "@/components/organisms/GlobalConfigEditor.js";

export function SettingsPage() {
  const { data: config, isLoading, error } = useConfig();
  const {
    mutateAsync: updateConfig,
    isPending,
    error: saveError,
  } = useUpdateConfig();

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
      </div>
    </AppLayout>
  );
}
