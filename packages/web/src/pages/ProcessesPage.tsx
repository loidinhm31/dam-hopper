import { Fragment, useState } from "react";
import { Play, Square, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { Badge } from "@/components/atoms/Badge.js";
import { Button } from "@/components/atoms/Button.js";
import {
  useProjects,
  useProcesses,
  useProcessLogs,
  useStartProcess,
  useStopProcess,
  useRestartProcess,
} from "@/api/queries.js";
import { formatUptime } from "@/lib/utils.js";
import type { ProcessInfo } from "@/api/client.js";

function ProcessLogExpander({ project }: { project: string }) {
  const { data: logs = [] } = useProcessLogs(project, 100);
  return (
    <tr>
      <td colSpan={6} className="px-4 pb-3">
        <div className="rounded bg-[#0a0a0f] log-container overflow-y-auto max-h-48 p-3">
          {logs.length === 0 ? (
            <span className="text-[var(--color-text-muted)]">No logs.</span>
          ) : (
            logs.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all text-[var(--color-text)]">
                {line}
              </div>
            ))
          )}
        </div>
      </td>
    </tr>
  );
}

function statusVariant(s: ProcessInfo["status"]) {
  if (s === "running") return "success" as const;
  if (s === "error") return "danger" as const;
  return "neutral" as const;
}

export function ProcessesPage() {
  const { data: processes = [] } = useProcesses();
  const { data: projects = [] } = useProjects();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [startTarget, setStartTarget] = useState("");

  const startProcess = useStartProcess();
  const stopProcess = useStopProcess();
  const restartProcess = useRestartProcess();

  const runningNames = new Set(processes.map((p) => p.projectName));
  const notRunning = projects.filter((p) => !runningNames.has(p.name));

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <AppLayout title="Processes">
      {/* Start new */}
      <div className="flex items-center gap-3 mb-5">
        <select
          className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)] outline-none"
          value={startTarget}
          onChange={(e) => setStartTarget(e.target.value)}
        >
          <option value="">Start new process…</option>
          {notRunning.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <Button
          variant="primary"
          size="sm"
          disabled={!startTarget}
          loading={startProcess.isPending}
          onClick={() => {
            startProcess.mutate(startTarget, { onSuccess: () => setStartTarget("") });
          }}
        >
          <Play className="h-3 w-3" /> Start
        </Button>
      </div>

      <div className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
              <th className="px-4 py-3 text-left font-medium w-6" />
              <th className="px-4 py-3 text-left font-medium">Project</th>
              <th className="px-4 py-3 text-left font-medium">Command</th>
              <th className="px-4 py-3 text-left font-medium">PID</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Uptime</th>
              <th className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {processes.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--color-text-muted)]">
                  No running processes
                </td>
              </tr>
            )}
            {processes.map((p) => (
              <Fragment key={p.projectName}>
                <tr
                  className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors"
                >
                  <td className="px-4 py-3">
                    <button
                      className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                      onClick={() => toggleExpand(p.projectName)}
                    >
                      {expanded.has(p.projectName) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-medium text-[var(--color-text)]">{p.projectName}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">{p.command}</td>
                  <td className="px-4 py-3 font-mono text-xs">{p.pid ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant(p.status)}>{p.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                    {p.startedAt ? formatUptime(p.startedAt) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="danger"
                        loading={stopProcess.isPending && stopProcess.variables === p.projectName}
                        onClick={() => stopProcess.mutate(p.projectName)}
                        title="Stop"
                      >
                        <Square className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm"
                        loading={restartProcess.isPending && restartProcess.variables === p.projectName}
                        onClick={() => restartProcess.mutate(p.projectName)}
                        title="Restart"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
                {expanded.has(p.projectName) && (
                  <ProcessLogExpander project={p.projectName} />
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </AppLayout>
  );
}
