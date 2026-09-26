import { useState } from "react";
import type { ApiClient } from "@/api/client.js";
import type {
  AdminInstallationDto,
  GrantKey,
  OwnerHistorySource,
} from "@/api/plugin-types.js";

export interface PluginAccessModalProps {
  open: boolean;
  onClose: () => void;
  installation: AdminInstallationDto;
  securityRevision: number;
  client: ApiClient | null;
  onSaved: () => Promise<void>;
  availableProjects: { name: string; path?: string }[];
}

export function PluginAccessModal({
  open,
  onClose,
  installation,
  securityRevision: initialSecurityRevision,
  client,
  onSaved,
  availableProjects,
}: PluginAccessModalProps) {
  const [grants, setGrants] = useState<GrantKey[]>(installation.grants);
  const [bindings, setBindings] = useState<Record<string, string>>(
    installation.bindings,
  );
  const [enableHistory, setEnableHistory] = useState<boolean>(
    Boolean(installation.ownerHistorySource),
  );
  const [historySource, setHistorySource] = useState<OwnerHistorySource>(
    installation.ownerHistorySource ?? {
      rootPath: "",
      rootIdentity: "",
      sourceRevision: 1,
      allAuthenticatedHistoryRead: false,
    },
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutationStage, setMutationStage] = useState<string | null>(null);
  // New grant draft state
  const [newGrantActor, setNewGrantActor] = useState("");
  const [newGrantTarget, setNewGrantTarget] = useState("*");
  const [newGrantOps, setNewGrantOps] = useState("*");
  const [newGrantPolicy, setNewGrantPolicy] = useState(false);

  // New binding draft state
  const [newBindingName, setNewBindingName] = useState("");
  const [newBindingPath, setNewBindingPath] = useState("");

  if (!open) return null;

  const handleAddGrant = () => {
    const actor = newGrantActor.trim();
    if (!actor) {
      setError("Recipient username cannot be empty");
      return;
    }
    const ops = newGrantOps
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ops.length === 0) {
      setError("Allowed operations cannot be empty (use '*' for all)");
      return;
    }

    setGrants((current) => [
      ...current,
      {
        actorSubject: actor,
        installationId: installation.installationId,
        configuredProjectTarget: newGrantTarget.trim() || "*",
        allowedOperations: ops,
        allowCurrentAccountPolicy: newGrantPolicy,
      },
    ]);
    setNewGrantActor("");
    setNewGrantOps("*");
    setError(null);
  };

  const handleRemoveGrant = (index: number) => {
    setGrants((current) => current.filter((_, i) => i !== index));
  };

  const handleAddBinding = () => {
    const name = newBindingName.trim();
    const path = newBindingPath.trim();
    if (!name || !path) {
      setError("Project name and path are both required for binding");
      return;
    }
    setBindings((current) => ({
      ...current,
      [name]: path,
    }));
    setNewBindingName("");
    setNewBindingPath("");
    setError(null);
  };

  const handleRemoveBinding = (key: string) => {
    setBindings((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const handleSave = async () => {
    if (!client) return;
    try {
      setSaving(true);
      setError(null);
      setMutationStage("Updating project target bindings...");

      let currentSecRev = initialSecurityRevision;

      // 1. Update bindings
      const resBindings = await client.plugins.adminReplaceBindings(
        installation.installationId,
        {
          expectedSecurityRevision: currentSecRev,
          bindings,
        },
      );
      currentSecRev = resBindings.securityRevision;

      // 2. Update grants
      setMutationStage("Updating actor access grants...");
      const resGrants = await client.plugins.adminReplaceGrants(
        installation.installationId,
        {
          expectedSecurityRevision: currentSecRev,
          grants,
        },
      );
      currentSecRev = resGrants.securityRevision;

      // 3. Update owner history source
      setMutationStage("Updating owner history source...");
      const finalOwnerSource = enableHistory ? historySource : null;
      if (finalOwnerSource) {
        if (!finalOwnerSource.rootPath.startsWith("/")) {
          throw new Error("Owner history root path must be an absolute path");
        }
        if (!/^[a-f0-9]{64}$/.test(finalOwnerSource.rootIdentity.trim().toLowerCase())) {
          throw new Error("Owner history root identity must be a 64-character lowercase hex hash");
        }
      }

      await client.plugins.adminReplaceOwnerHistorySource(
        installation.installationId,
        {
          expectedSecurityRevision: currentSecRev,
          ownerHistorySource: finalOwnerSource,
        },
      );

      await onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`${mutationStage ?? "Operation failed"}: ${msg}`);
      // Reload server state to resync security revision and prevent repeated conflicts
      void onSaved();
    } finally {
      setSaving(false);
      setMutationStage(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="access-modal-title"
      data-testid="plugin-access-modal"
    >
      <div className="relative w-full max-w-2xl rounded-lg border border-border bg-card p-6 shadow-xl space-y-5 my-8">
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <div>
            <h2 id="access-modal-title" className="text-base font-semibold text-foreground">
              Manage Access: {installation.pluginId}
            </h2>
            <p className="text-xs text-muted-foreground">
              Configure project target bindings, recipient grants, and history sources.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-2 py-1 rounded hover:bg-secondary text-muted-foreground"
          >
            ✕
          </button>
        </div>

        {error && (
          <div
            className="rounded-md bg-destructive/15 border border-destructive/30 p-2.5 text-xs text-destructive"
            data-testid="access-modal-error"
          >
            {error}
          </div>
        )}

        {/* Section 1: Project Bindings */}
        <div className="space-y-2 border-b border-border/40 pb-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Project Target Bindings</span>
            <span className="text-[11px] text-muted-foreground">
              {Object.keys(bindings).length} target(s) bound
            </span>
          </div>

          <div className="space-y-1.5">
            {Object.entries(bindings).map(([name, path]) => (
              <div
                key={name}
                className="flex items-center justify-between p-2 rounded bg-muted/30 border border-border/40 text-xs"
              >
                <div>
                  <span className="font-semibold text-foreground mr-2">{name}</span>
                  <span className="text-muted-foreground font-mono text-[11px]">{path}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveBinding(name)}
                  className="text-destructive hover:underline text-xs"
                  data-testid={`remove-binding-${name}`}
                >
                  Remove
                </button>
              </div>
            ))}
            {Object.keys(bindings).length === 0 && (
              <p className="text-xs text-muted-foreground italic">No projects bound yet.</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2">
            <input
              type="text"
              placeholder="Project Name"
              value={newBindingName}
              onChange={(e) => {
                setNewBindingName(e.target.value);
                const match = availableProjects.find((p) => p.name === e.target.value.trim());
                if (match?.path) setNewBindingPath(match.path);
              }}
              className="text-xs px-2.5 py-1.5 rounded border border-border bg-background"
              data-testid="binding-name-input"
            />
            <input
              type="text"
              placeholder="Configured Root Path"
              value={newBindingPath}
              onChange={(e) => setNewBindingPath(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded border border-border bg-background font-mono"
              data-testid="binding-path-input"
            />
            <button
              type="button"
              onClick={handleAddBinding}
              className="text-xs px-3 py-1.5 rounded bg-secondary hover:bg-secondary/80 font-medium"
              data-testid="add-binding-btn"
            >
              + Add Binding
            </button>
          </div>
        </div>

        {/* Section 2: Recipient Grants */}
        <div className="space-y-2 border-b border-border/40 pb-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Actor Access Grants</span>
            <span className="text-[11px] text-muted-foreground">
              {grants.length} grant(s)
            </span>
          </div>

          <div className="space-y-1.5">
            {grants.map((g, index) => (
              <div
                key={`${g.actorSubject}-${g.configuredProjectTarget}-${index}`}
                className="flex items-center justify-between p-2 rounded bg-muted/30 border border-border/40 text-xs"
              >
                <div>
                  <span className="font-semibold text-foreground mr-2">{g.actorSubject}</span>
                  <span className="text-muted-foreground mr-2">Target: {g.configuredProjectTarget}</span>
                  <span className="font-mono text-[11px] text-muted-foreground mr-2">
                    [{g.allowedOperations.join(", ")}]
                  </span>
                  {g.allowCurrentAccountPolicy && (
                    <span className="text-emerald-500 text-[10px]">policy: true</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveGrant(index)}
                  className="text-destructive hover:underline text-xs"
                  data-testid={`remove-grant-${index}`}
                >
                  Remove
                </button>
              </div>
            ))}
            {grants.length === 0 && (
              <p className="text-xs text-amber-500/90 italic">
                No grants configured. Plugin is not visible to any users.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 pt-2">
            <input
              type="text"
              placeholder="Username"
              value={newGrantActor}
              onChange={(e) => setNewGrantActor(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded border border-border bg-background"
              data-testid="grant-actor-input"
            />
            <input
              type="text"
              placeholder="Target (* or project)"
              value={newGrantTarget}
              onChange={(e) => setNewGrantTarget(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded border border-border bg-background"
              data-testid="grant-target-input"
            />
            <input
              type="text"
              placeholder="Operations (* or op1,op2)"
              value={newGrantOps}
              onChange={(e) => setNewGrantOps(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded border border-border bg-background font-mono"
              data-testid="grant-ops-input"
            />
            <button
              type="button"
              onClick={handleAddGrant}
              className="text-xs px-3 py-1.5 rounded bg-secondary hover:bg-secondary/80 font-medium"
              data-testid="add-grant-btn"
            >
              + Add Grant
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
            <input
              type="checkbox"
              id="grant-policy-opt"
              checked={newGrantPolicy}
              onChange={(e) => setNewGrantPolicy(e.target.checked)}
            />
            <label htmlFor="grant-policy-opt">Allow current account policy reading</label>
          </div>
        </div>

        {/* Section 3: Owner History Source */}
        <div className="space-y-3 pb-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Global Owner History Source</span>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={enableHistory}
                onChange={(e) => setEnableHistory(e.target.checked)}
                data-testid="enable-history-checkbox"
              />
              <span>Enable History Root</span>
            </label>
          </div>

          {enableHistory && (
            <div className="p-3 rounded bg-muted/20 border border-border/40 space-y-2 text-xs">
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1">
                  Absolute Host History Path:
                </label>
                <input
                  type="text"
                  placeholder="/var/lib/... or /home/.../.evcrate/advisor-history"
                  value={historySource.rootPath}
                  onChange={(e) =>
                    setHistorySource({ ...historySource, rootPath: e.target.value.trim() })
                  }
                  className="w-full text-xs font-mono px-2.5 py-1.5 rounded border border-border bg-background"
                  data-testid="history-path-input"
                />
              </div>
              <div>
                <label className="block text-[11px] text-muted-foreground mb-1">
                  Root Identity (SHA-256):
                </label>
                <input
                  type="text"
                  placeholder="64-character lowercase hex digest"
                  value={historySource.rootIdentity}
                  onChange={(e) =>
                    setHistorySource({ ...historySource, rootIdentity: e.target.value.trim() })
                  }
                  className="w-full text-xs font-mono px-2.5 py-1.5 rounded border border-border bg-background"
                  data-testid="history-identity-input"
                />
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <input
                  type="checkbox"
                  id="all-auth-history"
                  checked={historySource.allAuthenticatedHistoryRead}
                  onChange={(e) =>
                    setHistorySource({
                      ...historySource,
                      allAuthenticatedHistoryRead: e.target.checked,
                    })
                  }
                  data-testid="history-all-auth-checkbox"
                />
                <label htmlFor="all-auth-history" className="text-muted-foreground">
                  Allow all authenticated users to read history root
                </label>
              </div>
              {historySource.allAuthenticatedHistoryRead && (
                <p className="text-[10px] text-amber-500/90 pl-5">
                  Notice: Permitting all authenticated users allows any logged-in user on this server to read this installation's history records.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/40">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="text-xs px-4 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 font-medium transition-colors"
            data-testid="save-access-btn"
          >
            {saving ? "Saving Changes..." : "Save Access Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
