import { useState } from "react";
import { Button } from "@/components/atoms/Button.js";
import { useBulkShip } from "@/api/queries.js";
import type { AgentStoreItem, AgentType, DistributionMethod, ProjectConfig } from "@/api/client.js";

interface Props {
  item: AgentStoreItem;
  projects: ProjectConfig[];
  onClose: () => void;
}

type AgentTarget = { projectName: string; agent: AgentType };

export function ShipDialog({ item, projects, onClose }: Props) {
  const [targets, setTargets] = useState<AgentTarget[]>([]);
  const [method, setMethod] = useState<DistributionMethod>("symlink");
  const [error, setError] = useState<string | null>(null);
  const bulkShip = useBulkShip();

  function toggleTarget(projectName: string, agent: AgentType) {
    setTargets((prev) => {
      const exists = prev.some((t) => t.projectName === projectName && t.agent === agent);
      return exists
        ? prev.filter((t) => !(t.projectName === projectName && t.agent === agent))
        : [...prev, { projectName, agent }];
    });
  }

  function isSelected(projectName: string, agent: AgentType) {
    return targets.some((t) => t.projectName === projectName && t.agent === agent);
  }

  function handleShip() {
    if (targets.length === 0) return;
    setError(null);
    bulkShip.mutate(
      {
        items: [{ name: item.name, category: item.category }],
        targets,
        method,
      },
      {
        onSuccess: () => onClose(),
        onError: (e) => setError(e instanceof Error ? e.message : String(e)),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[480px] max-h-[80vh] flex flex-col rounded-lg glass-card border border-[var(--color-border)] shadow-xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Ship <span className="text-[var(--color-primary)]">{item.name}</span> to projects
          </h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{item.category}</p>
        </div>

        {/* Project/agent selection */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {projects.map((p) => (
            <div key={p.name} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <p className="text-xs font-medium text-[var(--color-text)] mb-1.5">{p.name}</p>
              <div className="flex gap-3">
                {(["claude", "gemini"] as AgentType[]).map((agent) => (
                  <label key={agent} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isSelected(p.name, agent)}
                      onChange={() => toggleTarget(p.name, agent)}
                    />
                    <span className="text-[var(--color-text-muted)] capitalize">{agent}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mb-2 rounded bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 px-3 py-2 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}

        {/* Method + actions */}
        <div className="px-5 py-4 border-t border-[var(--color-border)] space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--color-text-muted)]">Distribution:</span>
            {(["symlink", "copy"] as DistributionMethod[]).map((m) => (
              <label key={m} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input
                  type="radio"
                  name="method"
                  value={m}
                  checked={method === m}
                  onChange={() => setMethod(m)}
                />
                <span className="text-[var(--color-text)] capitalize">{m}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              disabled={targets.length === 0}
              loading={bulkShip.isPending}
              onClick={handleShip}
            >
              Ship to {targets.length || 0} target{targets.length !== 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
