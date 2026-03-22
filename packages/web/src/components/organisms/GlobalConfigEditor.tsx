import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button, inputClass } from "@/components/atoms/Button.js";
import {
  useGlobalConfig,
  useUpdateGlobalDefaults,
  useKnownWorkspaces,
  useAddKnownWorkspace,
  useRemoveKnownWorkspace,
  useWorkspace,
} from "@/api/queries.js";

// ── Default Workspace Section ─────────────────────────────────────────────

function DefaultWorkspaceSection() {
  const { data: globalConfig, isLoading } = useGlobalConfig();
  const updateDefaults = useUpdateGlobalDefaults();
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const currentDefault = globalConfig?.defaults?.workspace ?? "";
  const value = draft ?? currentDefault;

  async function handleSet() {
    const trimmed = value.trim();
    await updateDefaults.mutateAsync({ workspace: trimmed || undefined });
    setDraft(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  async function handleClear() {
    await updateDefaults.mutateAsync({ workspace: undefined });
    setDraft(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const isDirty = draft !== null && draft.trim() !== currentDefault;
  const isPending = updateDefaults.isPending;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-[var(--color-text-muted)]">
          Default workspace path
        </label>
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={value}
            onChange={(e) => {
              setDraft(e.target.value);
              setSaved(false);
            }}
            placeholder="/path/to/workspace"
            disabled={isLoading || isPending}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSet()}
            disabled={!isDirty || isPending}
            loading={isPending}
          >
            Set
          </Button>
          {currentDefault && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => void handleClear()}
              disabled={isPending}
            >
              Clear
            </Button>
          )}
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          Bare <code className="font-mono">dev-hub</code> invocations will use this workspace when no config is found in CWD.
        </p>
      </div>
      {saved && !updateDefaults.error && (
        <p className="text-xs text-[var(--color-success)]">Saved successfully</p>
      )}
      {updateDefaults.error && (
        <p className="text-xs text-[var(--color-danger)]">
          {(updateDefaults.error as Error).message}
        </p>
      )}
    </div>
  );
}

// ── Known Workspaces Section ──────────────────────────────────────────────

function KnownWorkspacesSection() {
  const { data: workspace } = useWorkspace();
  const { data: known, isLoading } = useKnownWorkspaces();
  const addMutation = useAddKnownWorkspace();
  const removeMutation = useRemoveKnownWorkspace();
  const [addPath, setAddPath] = useState("");
  const [removingPath, setRemovingPath] = useState<string | null>(null);

  function handleAdd() {
    const trimmed = addPath.trim();
    if (!trimmed) return;
    removeMutation.reset();
    addMutation.mutate(trimmed, { onSuccess: () => setAddPath("") });
  }

  function handleRemove(path: string) {
    addMutation.reset();
    setRemovingPath(path);
    removeMutation.mutate(path, { onSettled: () => setRemovingPath(null) });
  }

  const currentRoot = workspace?.root;

  return (
    <div className="space-y-3">
      {isLoading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      ) : (known?.workspaces ?? []).length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No registered workspaces.</p>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-[var(--color-border)]">
              <th className="text-left text-xs font-medium text-[var(--color-text-muted)] pb-1.5">Name</th>
              <th className="text-left text-xs font-medium text-[var(--color-text-muted)] pb-1.5">Path</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {(known?.workspaces ?? []).map((ws) => {
              const isCurrent = ws.path === currentRoot;
              const isRemoving = removingPath === ws.path;
              return (
                <tr
                  key={ws.path}
                  className={`border-b border-[var(--color-border)] last:border-0 ${
                    isCurrent ? "text-[var(--color-primary)]" : "text-[var(--color-text)]"
                  }`}
                >
                  <td className="py-2 pr-3 font-medium">
                    {ws.name}
                    {isCurrent && (
                      <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
                        (current)
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-[var(--color-text-muted)] font-mono text-xs truncate max-w-xs">
                    {ws.path}
                  </td>
                  <td className="py-2 text-right">
                    {!isCurrent && (
                      <button
                        onClick={() => handleRemove(ws.path)}
                        disabled={isRemoving || removeMutation.isPending}
                        className="rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-surface-2)] transition-colors disabled:opacity-50"
                        title="Remove workspace"
                      >
                        {isRemoving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Add workspace row */}
      <div className="space-y-1.5">
        <p className="text-xs text-[var(--color-text-muted)]">Add workspace</p>
        <div className="flex gap-2">
          <input
            value={addPath}
            onChange={(e) => setAddPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            placeholder="/path/to/workspace"
            className={inputClass}
            disabled={addMutation.isPending}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleAdd}
            disabled={!addPath.trim() || addMutation.isPending}
            loading={addMutation.isPending}
          >
            Add
          </Button>
        </div>
      </div>

      {(addMutation.error ?? removeMutation.error) && (
        <p className="text-xs text-[var(--color-danger)]">
          {((addMutation.error ?? removeMutation.error) as Error).message}
        </p>
      )}
    </div>
  );
}

// ── GlobalConfigEditor ────────────────────────────────────────────────────

export function GlobalConfigEditor() {
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
        <h3 className="text-sm font-medium text-[var(--color-text)]">Default Workspace</h3>
        <DefaultWorkspaceSection />
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
        <h3 className="text-sm font-medium text-[var(--color-text)]">Known Workspaces</h3>
        <KnownWorkspacesSection />
      </section>
    </div>
  );
}
