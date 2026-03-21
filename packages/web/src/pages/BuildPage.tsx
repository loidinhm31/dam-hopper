import { useEffect, useState } from "react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { Button } from "@/components/atoms/Button.js";
import { BuildLog } from "@/components/organisms/BuildLog.js";
import { useProjects, useBuild } from "@/api/queries.js";
import { cn } from "@/lib/utils.js";

export function BuildPage() {
  const { data: projects = [] } = useProjects();
  const [selected, setSelected] = useState("");
  const build = useBuild();

  // Sync selected to first project once projects load (W2 fix)
  useEffect(() => {
    if (!selected && projects.length > 0) {
      setSelected(projects[0].name);
    }
  }, [projects, selected]);

  const projectName = selected || projects[0]?.name || "";

  return (
    <AppLayout title="Build">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <select
            className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none"
            value={selected || projectName}
            onChange={(e) => setSelected(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            loading={build.isPending}
            disabled={!projectName}
            onClick={() => build.mutate(projectName)}
          >
            Build
          </Button>
        </div>

        {build.data && (
          <div
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              build.data.success
                ? "bg-[var(--color-success)]/10 border-[var(--color-success)]/30 text-[var(--color-success)]"
                : "bg-[var(--color-danger)]/10 border-[var(--color-danger)]/30 text-[var(--color-danger)]",
            )}
          >
            {build.data.success
              ? "✓ Build succeeded"
              : `✗ Build failed (exit ${build.data.exitCode})`}{" "}
            — {(build.data.durationMs / 1000).toFixed(1)}s
          </div>
        )}

        <BuildLog project={projectName} className="h-[60vh]" showTimestamps />
      </div>
    </AppLayout>
  );
}
