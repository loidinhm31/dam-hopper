import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2, Play, Plus, Check, X } from "lucide-react";
import { Button, inputClass } from "@/components/atoms/Button.js";
import { Badge } from "@/components/atoms/Badge.js";
import { CommandPreview } from "@/components/atoms/CommandPreview.js";
import { BuildLog } from "@/components/organisms/BuildLog.js";
import {
  useBuild,
  useStartProcess,
  useStopProcess,
  useRestartProcess,
  useProcessLogs,
  useExecCommand,
  useUpdateProject,
} from "@/api/queries.js";
import { getEffectiveCommand } from "@/lib/presets.js";
import type { ProjectWithStatus, BuildResult } from "@/api/client.js";
import { cn } from "@/lib/utils.js";

type FilterType = "all" | "build" | "run" | "custom";

interface Props {
  project: ProjectWithStatus;
}

export function UnifiedCommandPanel({ project }: Props) {
  const commands = project.commands ?? {};
  const customEntries = Object.entries(commands);

  // Filter state
  const [filter, setFilter] = useState<FilterType>("all");

  // Expanded output panels (keys: "build", "run", "custom:<key>")
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Custom command editing state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editKey, setEditKey] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editKeyError, setEditKeyError] = useState("");

  // Add command state
  const [addMode, setAddMode] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newKeyError, setNewKeyError] = useState("");

  // Custom command results & loading
  const [results, setResults] = useState<Record<string, BuildResult>>({});
  const [runningKey, setRunningKey] = useState<string | null>(null);

  // Build result
  const [buildResult, setBuildResult] = useState<BuildResult[] | null>(null);

  // Hooks
  const build = useBuild();
  const startProcess = useStartProcess();
  const stopProcess = useStopProcess();
  const restartProcess = useRestartProcess();
  const { data: processLogs = [] } = useProcessLogs(
    expanded.has("run") ? project.name : "",
    200,
  );
  const execCmd = useExecCommand();
  const updateProject = useUpdateProject();

  // Expand toggle
  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Build
  function handleBuild() {
    setBuildResult(null);
    if (!expanded.has("build")) toggleExpand("build");
    build.mutate(project.name, {
      onSuccess: (data) => setBuildResult(data),
    });
  }

  // Custom command editing
  function startEdit(key: string) {
    setEditingKey(key);
    setEditKey(key);
    setEditValue(commands[key] ?? "");
    setEditKeyError("");
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditKey("");
    setEditValue("");
    setEditKeyError("");
  }

  function saveEdit() {
    const trimmedKey = editKey.trim();
    if (!trimmedKey || !editingKey) return;
    if (trimmedKey !== editingKey && trimmedKey in commands) {
      setEditKeyError(`"${trimmedKey}" already exists`);
      return;
    }
    setEditKeyError("");
    const updated = { ...commands };
    if (trimmedKey !== editingKey) delete updated[editingKey];
    updated[trimmedKey] = editValue.trim();
    updateProject.mutate(
      { name: project.name, data: { commands: updated } },
      { onSuccess: cancelEdit },
    );
  }

  function deleteCmd(key: string) {
    const updated = { ...commands };
    delete updated[key];
    updateProject.mutate({ name: project.name, data: { commands: updated } });
  }

  function saveNew() {
    const trimmedKey = newKey.trim();
    if (!trimmedKey) return;
    if (trimmedKey in commands) {
      setNewKeyError(`"${trimmedKey}" already exists`);
      return;
    }
    setNewKeyError("");
    const updated = { ...commands, [trimmedKey]: newValue.trim() };
    updateProject.mutate(
      { name: project.name, data: { commands: updated } },
      {
        onSuccess: () => {
          setAddMode(false);
          setNewKey("");
          setNewValue("");
        },
      },
    );
  }

  function runCmd(key: string) {
    setRunningKey(key);
    execCmd.mutate(
      { project: project.name, command: key },
      {
        onSuccess: (result) => {
          setResults((prev) => ({ ...prev, [key]: result }));
          if (!expanded.has(`custom:${key}`)) toggleExpand(`custom:${key}`);
          setRunningKey(null);
        },
        onError: () => setRunningKey(null),
      },
    );
  }

  // Filter visibility
  const showBuild = filter === "all" || filter === "build";
  const showRun = filter === "all" || filter === "run";
  const showCustom = filter === "all" || filter === "custom";

  const buildCmd = getEffectiveCommand(project, "build");
  const runEffective = getEffectiveCommand(project, "run");

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border)] pb-0">
        {(["all", "build", "run", "custom"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors inline-flex items-center gap-1.5",
              filter === f
                ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === "custom" && customEntries.length > 0 && (
              <span className="rounded-full bg-[var(--color-border)] px-1.5 py-0.5 text-[10px] leading-none font-medium text-[var(--color-text-muted)]">
                {customEntries.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Command cards */}
      <div className="space-y-3">
        {/* Build card */}
        {showBuild && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <Badge variant="primary">build</Badge>
              <span className="font-medium text-sm text-[var(--color-text)] flex-none">
                build
              </span>
              <code className="flex-1 font-mono text-xs text-[var(--color-text-muted)] truncate">
                {buildCmd.command || "(no command)"}
              </code>
              <span className="text-xs text-[var(--color-text-muted)]">
                {buildCmd.source === "service" ? "custom" : "preset"}
              </span>
              <Button
                variant="primary"
                size="sm"
                loading={build.isPending}
                onClick={handleBuild}
              >
                Build
              </Button>
              <button
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                onClick={() => toggleExpand("build")}
              >
                {expanded.has("build") ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            </div>

            {expanded.has("build") && (
              <div className="border-t border-[var(--color-border)] p-3 space-y-2">
                {buildResult && buildResult.length > 0 && (() => {
                  const allSucceeded = buildResult.every((r) => r.success);
                  const failed = buildResult.find((r) => !r.success);
                  const totalMs = buildResult.reduce((sum, r) => sum + r.durationMs, 0);
                  return (
                    <div
                      className={cn(
                        "rounded border px-3 py-2 text-xs",
                        allSucceeded
                          ? "bg-[var(--color-success)]/10 border-[var(--color-success)]/30 text-[var(--color-success)]"
                          : "bg-[var(--color-danger)]/10 border-[var(--color-danger)]/30 text-[var(--color-danger)]",
                      )}
                    >
                      {allSucceeded
                        ? "✓ Build succeeded"
                        : `✗ Build failed (exit ${failed?.exitCode ?? 1})`}
                      {" — "}
                      {(totalMs / 1000).toFixed(1)}s
                    </div>
                  );
                })()}
                <BuildLog project={project.name} />
              </div>
            )}
          </div>
        )}

        {/* Run card */}
        {showRun && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3">
              <Badge variant="success">run</Badge>
              <span className="font-medium text-sm text-[var(--color-text)] flex-none">
                run
              </span>
              <code className="flex-1 font-mono text-xs text-[var(--color-text-muted)] truncate">
                {runEffective.command || "(no command)"}
              </code>
              <span className="text-xs text-[var(--color-text-muted)]">
                {runEffective.source === "service" ? "custom" : "preset"}
              </span>
              <div className="flex gap-1.5">
                <Button
                  variant="primary"
                  size="sm"
                  loading={startProcess.isPending}
                  onClick={() => startProcess.mutate(project.name)}
                >
                  Start
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={stopProcess.isPending}
                  onClick={() => stopProcess.mutate(project.name)}
                >
                  Stop
                </Button>
                <Button
                  size="sm"
                  loading={restartProcess.isPending}
                  onClick={() => restartProcess.mutate(project.name)}
                >
                  Restart
                </Button>
              </div>
              <button
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                onClick={() => toggleExpand("run")}
              >
                {expanded.has("run") ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
            </div>

            {expanded.has("run") && (
              <div className="border-t border-[var(--color-border)]">
                <div className="px-3 py-2 border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
                  Process Logs
                </div>
                <div className="log-container overflow-y-auto max-h-96 p-3 bg-[#0a0a0f]">
                  {processLogs.length === 0 ? (
                    <span className="text-[var(--color-text-muted)]">
                      No logs available.
                    </span>
                  ) : (
                    processLogs.map((entry, i) => (
                      <div
                        key={i}
                        className="whitespace-pre-wrap break-all text-[var(--color-text)]"
                      >
                        {entry.line}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Custom command cards */}
        {showCustom && (
          <>
            {customEntries.length === 0 && !addMode ? (
              <p className="text-sm text-[var(--color-text-muted)] px-1">
                No custom commands defined. Add one below.
              </p>
            ) : (
              customEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden"
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Badge>custom</Badge>
                    {editingKey === key ? (
                      <div className="flex flex-1 gap-2 items-start">
                        <div className="flex flex-col gap-1">
                          <input
                            className={cn(inputClass, "h-8 flex-none w-32", editKeyError && "border-[var(--color-danger)]")}
                            value={editKey}
                            onChange={(e) => { setEditKey(e.target.value); setEditKeyError(""); }}
                            placeholder="name"
                          />
                          {editKeyError && (
                            <span className="text-[10px] text-[var(--color-danger)]">{editKeyError}</span>
                          )}
                        </div>
                        <input
                          className={cn(inputClass, "h-8 flex-1 font-mono text-xs")}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          placeholder="shell command"
                        />
                        <Button size="sm" variant="primary" loading={updateProject.isPending} onClick={saveEdit}>
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button size="sm" onClick={cancelEdit}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <span className="font-medium text-sm text-[var(--color-text)] w-32 flex-none truncate">
                          {key}
                        </span>
                        <code className="flex-1 font-mono text-xs text-[var(--color-text-muted)] truncate">
                          {value}
                        </code>
                        <Button size="sm" loading={runningKey === key} onClick={() => runCmd(key)}>
                          <Play className="h-3 w-3" /> Run
                        </Button>
                        <Button size="sm" onClick={() => startEdit(key)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="danger" loading={updateProject.isPending} onClick={() => deleteCmd(key)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                        <button
                          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                          onClick={() => toggleExpand(`custom:${key}`)}
                        >
                          {expanded.has(`custom:${key}`) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </>
                    )}
                  </div>

                  {/* Exec result */}
                  {expanded.has(`custom:${key}`) && results[key] && (
                    <div className="border-t border-[var(--color-border)] p-3">
                      <div
                        className={cn(
                          "rounded border px-3 py-2 text-xs space-y-1.5",
                          results[key].success
                            ? "border-[var(--color-success)]/30 bg-[var(--color-success)]/5"
                            : "border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant={results[key].success ? "success" : "danger"}>
                            {results[key].success ? "success" : `exit ${results[key].exitCode}`}
                          </Badge>
                          <span className="text-[var(--color-text-muted)]">
                            {(results[key].durationMs / 1000).toFixed(1)}s
                          </span>
                          <button
                            className="ml-auto text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                            onClick={() => toggleExpand(`custom:${key}`)}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        {(results[key].stdout || results[key].stderr) && (
                          <pre className="overflow-y-auto max-h-48 font-mono text-[var(--color-text)] whitespace-pre-wrap break-all bg-[#0a0a0f] rounded p-2">
                            {results[key].stdout || results[key].stderr}
                          </pre>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Add command form */}
            {addMode ? (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 space-y-2">
                <div className="flex gap-2">
                  <div className="flex flex-col gap-1">
                    <input
                      className={cn(inputClass, "h-8 flex-none w-32", newKeyError && "border-[var(--color-danger)]")}
                      value={newKey}
                      onChange={(e) => { setNewKey(e.target.value); setNewKeyError(""); }}
                      placeholder="name"
                      autoFocus
                    />
                    {newKeyError && (
                      <span className="text-[10px] text-[var(--color-danger)]">{newKeyError}</span>
                    )}
                  </div>
                  <input
                    className={cn(inputClass, "h-8 flex-1 font-mono text-xs")}
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="shell command"
                    onKeyDown={(e) => e.key === "Enter" && saveNew()}
                  />
                  <Button size="sm" variant="primary" loading={updateProject.isPending} onClick={saveNew}>
                    <Check className="h-3 w-3" /> Add
                  </Button>
                  <Button size="sm" onClick={() => { setAddMode(false); setNewKeyError(""); }}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" onClick={() => setAddMode(true)}>
                <Plus className="h-3 w-3" /> Add Command
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
