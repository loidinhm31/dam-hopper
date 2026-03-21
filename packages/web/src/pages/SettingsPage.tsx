import { AppLayout } from "@/components/templates/AppLayout.js";
import { useWorkspace } from "@/api/queries.js";

export function SettingsPage() {
  const { data: workspace } = useWorkspace();

  return (
    <AppLayout title="Settings">
      <div className="max-w-2xl space-y-4">
        <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] p-4">
          <h2 className="text-sm font-medium text-[var(--color-text)] mb-3">Workspace</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--color-text-muted)]">Name</dt>
              <dd className="text-[var(--color-text)] font-medium">{workspace?.name ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--color-text-muted)]">Root</dt>
              <dd className="font-mono text-xs text-[var(--color-text)]">{workspace?.root ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[var(--color-text-muted)]">Projects</dt>
              <dd className="text-[var(--color-text)]">{workspace?.projectCount ?? 0}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] p-4">
          <h2 className="text-sm font-medium text-[var(--color-text)] mb-2">Config</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Config file path:{" "}
            <span className="font-mono">{workspace?.root ? `${workspace.root}/dev-hub.toml` : "—"}</span>
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-2">
            Edit <span className="font-mono">dev-hub.toml</span> directly in your workspace root to modify
            the configuration. Restart the server after changes.
          </p>
        </div>
      </div>
    </AppLayout>
  );
}
