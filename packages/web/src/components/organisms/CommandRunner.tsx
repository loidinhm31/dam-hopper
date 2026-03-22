import { useState } from "react";
import { Pencil, Trash2, Play, Plus, Check, X } from "lucide-react";
import { Button, inputClass } from "@/components/atoms/Button.js";
import { Badge } from "@/components/atoms/Badge.js";
import { useExecCommand, useUpdateProject } from "@/api/queries.js";
import type { ProjectWithStatus, BuildResult } from "@/api/client.js";
import { cn } from "@/lib/utils.js";

interface Props {
  project: ProjectWithStatus;
}

export function CommandRunner({ project }: Props) {
  const commands = project.commands ?? {};

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editKey, setEditKey] = useState("");
  const [editValue, setEditValue] = useState("");

  const [addMode, setAddMode] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const [editKeyError, setEditKeyError] = useState("");
  const [newKeyError, setNewKeyError] = useState("");
  const [results, setResults] = useState<Record<string, BuildResult>>({});
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const execCmd = useExecCommand();
  const updateProject = useUpdateProject();

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
          setExpandedKey(key);
          setRunningKey(null);
        },
        onError: () => setRunningKey(null),
      },
    );
  }

  const entries = Object.entries(commands);

  return (
    <div className="space-y-3">
      {/* Command list */}
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        {entries.length === 0 && !addMode ? (
          <p className="px-4 py-6 text-sm text-[var(--color-text-muted)]">
            No custom commands defined. Add one below.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {entries.map(([key, value]) => (
              <li key={key} className="px-4 py-3 space-y-2">
                {editingKey === key ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
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
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-[var(--color-text)] w-32 flex-none truncate">
                      {key}
                    </span>
                    <code className="flex-1 font-mono text-xs text-[var(--color-text-muted)] truncate">
                      {value}
                    </code>
                    <Button
                      size="sm"
                      loading={runningKey === key}
                      onClick={() => runCmd(key)}
                    >
                      <Play className="h-3 w-3" /> Run
                    </Button>
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
                  </div>
                )}

                {/* Inline result */}
                {results[key] && expandedKey === key && (
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
                        onClick={() => setExpandedKey(null)}
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
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

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
            <Button
              size="sm"
              variant="primary"
              loading={updateProject.isPending}
              onClick={saveNew}
            >
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
    </div>
  );
}
