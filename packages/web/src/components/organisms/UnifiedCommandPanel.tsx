import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Play,
  Square,
  RotateCcw,
  Plus,
  Check,
  X,
} from "lucide-react";
import { Button, inputClass } from "@/components/atoms/Button.js";
import { Badge } from "@/components/atoms/Badge.js";
import { CommandPreview } from "@/components/atoms/CommandPreview.js";
import { TerminalPanel } from "@/components/organisms/TerminalPanel.js";
import { useUpdateProject } from "@/api/queries.js";
import { getEffectiveCommand } from "@/lib/presets.js";
import type { ProjectWithStatus } from "@/api/client.js";
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

  // Build state
  const [buildStarted, setBuildStarted] = useState(false);
  const [buildExitCode, setBuildExitCode] = useState<number | null | undefined>(
    undefined,
  );

  // Run state — key increments on restart to force TerminalPanel remount
  const [runStarted, setRunStarted] = useState(false);
  const [runKey, setRunKey] = useState(0);

  // Custom command state: which keys have been started
  const [customStarted, setCustomStarted] = useState<Set<string>>(new Set());
  const [customKeys, setCustomKeys] = useState<Record<string, number>>({});
  const [customExitCodes, setCustomExitCodes] = useState<
    Record<string, number | null>
  >({});

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
    setBuildExitCode(undefined);
    setBuildStarted(true);
    if (!expanded.has("build")) toggleExpand("build");
  }

  // Run
  function handleRunStart() {
    setRunKey((k) => k + 1);
    setRunStarted(true);
    if (!expanded.has("run")) toggleExpand("run");
  }

  function handleRunStop() {
    window.devhub.terminal.kill(`run:${project.name}`);
    setRunStarted(false);
  }

  function handleRunRestart() {
    window.devhub.terminal.kill(`run:${project.name}`);
    setRunKey((k) => k + 1);
    setRunStarted(true);
    if (!expanded.has("run")) toggleExpand("run");
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

  function runCustomCmd(key: string) {
    setCustomExitCodes((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setCustomKeys((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
    setCustomStarted((prev) => new Set([...prev, key]));
    if (!expanded.has(`custom:${key}`)) toggleExpand(`custom:${key}`);
  }

  function stopCustomCmd(key: string) {
    window.devhub.terminal.kill(`custom:${project.name}:${key}`);
    setCustomStarted((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
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
              {buildExitCode !== undefined && (
                <Badge variant={buildExitCode === 0 ? "success" : "danger"}>
                  {buildExitCode === 0 ? "success" : `exit ${buildExitCode}`}
                </Badge>
              )}
              <Button variant="primary" size="sm" onClick={handleBuild}>
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

            {/* Keep TerminalPanel mounted (hidden when collapsed) to preserve PTY output */}
            {buildStarted && (
              <div
                className={cn(
                  "border-t border-[var(--color-border)]",
                  !expanded.has("build") && "hidden",
                )}
              >
                <TerminalPanel
                  key={`build:${project.name}:${buildExitCode === undefined ? "running" : "done"}`}
                  sessionId={`build:${project.name}`}
                  project={project.name}
                  command={buildCmd.command}
                  onExit={(code) => setBuildExitCode(code)}
                  className="min-h-64 max-h-96"
                />
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
                  disabled={runStarted}
                  onClick={handleRunStart}
                >
                  <Play className="h-3 w-3" /> Start
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!runStarted}
                  onClick={handleRunStop}
                >
                  <Square className="h-3 w-3" /> Stop
                </Button>
                <Button
                  size="sm"
                  disabled={!runStarted}
                  onClick={handleRunRestart}
                >
                  <RotateCcw className="h-3 w-3" /> Restart
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

            {runStarted && (
              <div
                className={cn(
                  "border-t border-[var(--color-border)]",
                  !expanded.has("run") && "hidden",
                )}
              >
                <TerminalPanel
                  key={`run:${project.name}:${runKey}`}
                  sessionId={`run:${project.name}`}
                  project={project.name}
                  command={runEffective.command}
                  onExit={() => setRunStarted(false)}
                  className="min-h-64 max-h-96"
                />
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
                            className={cn(
                              inputClass,
                              "h-8 flex-none w-32",
                              editKeyError && "border-[var(--color-danger)]",
                            )}
                            value={editKey}
                            onChange={(e) => {
                              setEditKey(e.target.value);
                              setEditKeyError("");
                            }}
                            placeholder="name"
                          />
                          {editKeyError && (
                            <span className="text-[10px] text-[var(--color-danger)]">
                              {editKeyError}
                            </span>
                          )}
                        </div>
                        <input
                          className={cn(
                            inputClass,
                            "h-8 flex-1 font-mono text-xs",
                          )}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          placeholder="shell command"
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          loading={updateProject.isPending}
                          onClick={saveEdit}
                        >
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
                        {customExitCodes[key] !== undefined && (
                          <Badge
                            variant={
                              customExitCodes[key] === 0 ? "success" : "danger"
                            }
                          >
                            {customExitCodes[key] === 0
                              ? "success"
                              : `exit ${customExitCodes[key]}`}
                          </Badge>
                        )}
                        {customStarted.has(key) ? (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => stopCustomCmd(key)}
                          >
                            <Square className="h-3 w-3" /> Stop
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => runCustomCmd(key)}>
                            <Play className="h-3 w-3" /> Run
                          </Button>
                        )}
                        <Button size="sm" onClick={() => startEdit(key)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={updateProject.isPending}
                          onClick={() => deleteCmd(key)}
                        >
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

                  {customStarted.has(key) && (
                    <div
                      className={cn(
                        "border-t border-[var(--color-border)]",
                        !expanded.has(`custom:${key}`) && "hidden",
                      )}
                    >
                      <TerminalPanel
                        key={`custom:${project.name}:${key}:${customKeys[key] ?? 0}`}
                        sessionId={`custom:${project.name}:${key}`}
                        project={project.name}
                        command={value}
                        onExit={(code) => {
                          setCustomExitCodes((prev) => ({
                            ...prev,
                            [key]: code,
                          }));
                          setCustomStarted((prev) => {
                            const next = new Set(prev);
                            next.delete(key);
                            return next;
                          });
                        }}
                        className="min-h-48 max-h-96"
                      />
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
                      className={cn(
                        inputClass,
                        "h-8 flex-none w-32",
                        newKeyError && "border-[var(--color-danger)]",
                      )}
                      value={newKey}
                      onChange={(e) => {
                        setNewKey(e.target.value);
                        setNewKeyError("");
                      }}
                      placeholder="name"
                      autoFocus
                    />
                    {newKeyError && (
                      <span className="text-[10px] text-[var(--color-danger)]">
                        {newKeyError}
                      </span>
                    )}
                  </div>
                  <input
                    className={cn(inputClass, "h-8 flex-1 font-mono text-xs")}
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="shell command"
                    onKeyDown={(e) => e.key === "Enter" && saveNew()}
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    loading={updateProject.isPending}
                    onClick={saveNew}
                  >
                    <Check className="h-3 w-3" /> Add
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setAddMode(false);
                      setNewKeyError("");
                    }}
                  >
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
