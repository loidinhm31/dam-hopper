import { AppLayout } from "@/components/templates/AppLayout.js";
import { useConfig, useUpdateConfig } from "@/api/queries.js";
import { ConfigEditor } from "@/components/organisms/ConfigEditor.js";

export function SettingsPage() {
  const { data: config, isLoading, error } = useConfig();
  const { mutateAsync: updateConfig, isPending, error: saveError } = useUpdateConfig();

  return (
    <AppLayout title="Settings">
      <div className="max-w-3xl">
        {isLoading && (
          <p className="text-sm text-[var(--color-text-muted)]">Loading config…</p>
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
      </div>
    </AppLayout>
  );
}
