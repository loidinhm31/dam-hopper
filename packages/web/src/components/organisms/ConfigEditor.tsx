import { useState, useEffect, useRef } from "react";
import { Button, inputClass } from "@/components/atoms/Button.js";
import type {
  DevHubConfig,
  ProjectConfig,
  ServiceConfig,
} from "@/api/client.js";

// ── Small helpers ──────────────────────────────────────────────────────────

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-[var(--color-text-muted)]">
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

const selectClass = inputClass;

const PROJECT_TYPES = [
  "maven",
  "gradle",
  "npm",
  "pnpm",
  "cargo",
  "custom",
] as const;

// ── ServiceForm ──────────────────────────────────────────────────────────

function ServiceForm({
  service,
  onChange,
  onRemove,
  disabled,
}: {
  service: ServiceConfig;
  onChange: (s: ServiceConfig) => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-background)] p-3 space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-[var(--color-text)]">
          Service
        </span>
        <Button
          size="sm"
          variant="danger"
          onClick={onRemove}
          disabled={disabled}
        >
          Remove
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Name">
          <input
            className={inputClass}
            value={service.name}
            onChange={(e) => onChange({ ...service, name: e.target.value })}
            placeholder="frontend"
            disabled={disabled}
          />
        </Field>
        <Field label="Build command">
          <input
            className={inputClass}
            value={service.buildCommand ?? ""}
            onChange={(e) =>
              onChange({
                ...service,
                buildCommand: e.target.value || undefined,
              })
            }
            placeholder="pnpm build"
            disabled={disabled}
          />
        </Field>
        <Field label="Run command">
          <input
            className={inputClass}
            value={service.runCommand ?? ""}
            onChange={(e) =>
              onChange({ ...service, runCommand: e.target.value || undefined })
            }
            placeholder="pnpm dev"
            disabled={disabled}
          />
        </Field>
      </div>
    </div>
  );
}

// ── CommandsForm ─────────────────────────────────────────────────────────

function CommandsForm({
  commands,
  onChange,
  disabled,
}: {
  commands: Record<string, string>;
  onChange: (c: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const entries = Object.entries(commands);

  function updateKey(oldKey: string, newKey: string) {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(commands)) {
      next[k === oldKey ? newKey : k] = v;
    }
    onChange(next);
  }

  function updateValue(key: string, value: string) {
    onChange({ ...commands, [key]: value });
  }

  function remove(key: string) {
    const next = { ...commands };
    delete next[key];
    onChange(next);
  }

  function add() {
    // Generate a unique key that doesn't already exist
    let i = entries.length + 1;
    while (`cmd${i}` in commands) i++;
    onChange({ ...commands, [`cmd${i}`]: "" });
  }

  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-2">
          <input
            className={inputClass}
            value={key}
            onChange={(e) => updateKey(key, e.target.value)}
            placeholder="test"
            disabled={disabled}
          />
          <span className="text-[var(--color-text-muted)] text-sm">=</span>
          <input
            className={inputClass}
            value={value}
            onChange={(e) => updateValue(key, e.target.value)}
            placeholder="pnpm test"
            disabled={disabled}
          />
          <Button
            size="sm"
            variant="danger"
            onClick={() => remove(key)}
            disabled={disabled}
          >
            ×
          </Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={add} disabled={disabled}>
        + Add command
      </Button>
    </div>
  );
}

// ── ProjectForm ──────────────────────────────────────────────────────────

function ProjectForm({
  project,
  onChange,
  onRemove,
  errors,
  disabled,
}: {
  project: ProjectConfig;
  onChange: (p: ProjectConfig) => void;
  onRemove: () => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(() => !project.name);

  function updateService(i: number, s: ServiceConfig) {
    const services = [...(project.services ?? [])];
    services[i] = s;
    onChange({ ...project, services });
  }

  function removeService(i: number) {
    const services = (project.services ?? []).filter((_, idx) => idx !== i);
    onChange({
      ...project,
      services: services.length > 0 ? services : undefined,
    });
  }

  function addService() {
    const services = [
      ...(project.services ?? []),
      { name: `service${(project.services?.length ?? 0) + 1}` },
    ];
    onChange({ ...project, services });
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
        <button
          className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)] cursor-pointer"
          onClick={() => setExpanded((x) => !x)}
        >
          <span className="text-[var(--color-text-muted)] text-xs">
            {expanded ? "▾" : "▸"}
          </span>
          <span>
            {project.name || (
              <span className="text-[var(--color-text-muted)] italic">
                unnamed
              </span>
            )}
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">
            {project.type}
          </span>
        </button>
        <Button
          size="sm"
          variant="danger"
          onClick={onRemove}
          disabled={disabled}
        >
          Remove
        </Button>
      </div>

      {expanded && (
        <div className="p-3 space-y-4">
          {/* Core fields */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={errors?.name}>
              <input
                className={inputClass}
                value={project.name}
                onChange={(e) => onChange({ ...project, name: e.target.value })}
                placeholder="api-server"
                disabled={disabled}
              />
            </Field>
            <Field label="Path" error={errors?.path}>
              <input
                className={inputClass}
                value={project.path}
                onChange={(e) => onChange({ ...project, path: e.target.value })}
                placeholder="./api-server"
                disabled={disabled}
              />
            </Field>
            <Field label="Type">
              <select
                className={selectClass}
                value={project.type}
                onChange={(e) =>
                  onChange({
                    ...project,
                    type: e.target.value as ProjectConfig["type"],
                  })
                }
                disabled={disabled}
              >
                {PROJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Env file">
              <input
                className={inputClass}
                value={project.envFile ?? ""}
                onChange={(e) =>
                  onChange({ ...project, envFile: e.target.value || undefined })
                }
                placeholder=".env"
                disabled={disabled}
              />
            </Field>
          </div>

          {/* Tags */}
          <Field label="Tags (comma-separated)">
            <input
              className={inputClass}
              value={(project.tags ?? []).join(", ")}
              onChange={(e) => {
                const tags = e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean);
                onChange({
                  ...project,
                  tags: tags.length > 0 ? tags : undefined,
                });
              }}
              placeholder="backend, api"
              disabled={disabled}
            />
          </Field>

          {/* Services */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[var(--color-text-muted)]">
              Services
            </h4>
            {errors?.services && (
              <p className="text-xs text-[var(--color-danger)]">
                {errors.services}
              </p>
            )}
            {(project.services ?? []).map((s, i) => (
              <ServiceForm
                key={`${s.name}-${i}`}
                service={s}
                onChange={(s) => updateService(i, s)}
                onRemove={() => removeService(i)}
                disabled={disabled}
              />
            ))}
            <Button
              size="sm"
              variant="ghost"
              onClick={addService}
              disabled={disabled}
            >
              + Add service
            </Button>
          </div>

          {/* Custom commands */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-[var(--color-text-muted)]">
              Custom commands
            </h4>
            <CommandsForm
              commands={project.commands ?? {}}
              onChange={(c) =>
                onChange({
                  ...project,
                  commands: Object.keys(c).length > 0 ? c : undefined,
                })
              }
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ── ConfigEditor ─────────────────────────────────────────────────────────

interface Props {
  config: DevHubConfig;
  onSave: (config: DevHubConfig) => Promise<unknown>;
  isSaving?: boolean;
  saveError?: string | null;
}

export function ConfigEditor({ config, onSave, isSaving, saveError }: Props) {
  const [draft, setDraft] = useState<DevHubConfig>(() =>
    structuredClone(config),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [externalChange, setExternalChange] = useState(false);

  // Track whether draft has been modified from the current prop
  const isDirtyRef = useRef(false);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(config);
  isDirtyRef.current = isDirty;

  // C1: Detect external config changes while editor is open
  useEffect(() => {
    if (!isDirtyRef.current) {
      // No unsaved changes — silently update draft to match new config
      setDraft(structuredClone(config));
      setExternalChange(false);
    } else {
      // Has unsaved changes — warn user
      setExternalChange(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!draft.workspace.name.trim()) {
      errs["workspace.name"] = "Workspace name is required";
    }
    draft.projects.forEach((p, i) => {
      if (!p.name.trim())
        errs[`projects.${i}.name`] = "Project name is required";
      if (!p.path.trim())
        errs[`projects.${i}.path`] = "Project path is required";
      const svcNames = (p.services ?? []).map((s) => s.name);
      if (svcNames.length !== new Set(svcNames).size) {
        errs[`projects.${i}.services`] = "Service names must be unique";
      }
    });
    const projectNames = draft.projects.map((p) => p.name);
    if (projectNames.length !== new Set(projectNames).size) {
      errs["projects"] = "Project names must be unique";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // C2: wrap save in try/catch
  async function handleSave() {
    if (!validate()) return;
    setSaved(false);
    try {
      // C3: strip root from workspace before PUT — server derives root from configPath
      const payload: DevHubConfig = {
        workspace: { name: draft.workspace.name, root: draft.workspace.root },
        projects: draft.projects,
      };
      await onSave(payload);
      setSaved(true);
      setExternalChange(false);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // saveError is surfaced via the prop from the mutation
    }
  }

  function handleReset() {
    setDraft(structuredClone(config));
    setErrors({});
    setSaved(false);
    setExternalChange(false);
  }

  function updateProject(i: number, p: ProjectConfig) {
    const projects = [...draft.projects];
    projects[i] = p;
    setDraft({ ...draft, projects });
  }

  function removeProject(i: number) {
    setDraft({
      ...draft,
      projects: draft.projects.filter((_, idx) => idx !== i),
    });
  }

  function addProject() {
    setDraft({
      ...draft,
      projects: [
        ...draft.projects,
        { name: "", path: "./new-project", type: "custom" },
      ],
    });
  }

  return (
    <div className="space-y-6">
      {/* C1: External change banner */}
      {externalChange && (
        <div className="rounded border border-[var(--color-warning)] bg-[var(--color-warning)]/10 px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs text-[var(--color-warning)]">
            Config was changed externally. Your unsaved edits are still shown.
          </span>
          <Button size="sm" variant="secondary" onClick={handleReset}>
            Reset to latest
          </Button>
        </div>
      )}

      {/* Workspace */}
      <section className="rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] p-4 space-y-3">
        <h2 className="text-sm font-medium text-[var(--color-text)]">
          Workspace
        </h2>
        <Field label="Name" error={errors["workspace.name"]}>
          <input
            className={inputClass}
            value={draft.workspace.name}
            onChange={(e) =>
              setDraft({
                ...draft,
                workspace: { ...draft.workspace, name: e.target.value },
              })
            }
            placeholder="my-workspace"
            disabled={isSaving}
          />
        </Field>
      </section>

      {/* Projects */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--color-text)]">
            Projects ({draft.projects.length})
          </h2>
          <Button
            size="sm"
            variant="secondary"
            onClick={addProject}
            disabled={isSaving}
          >
            + Add project
          </Button>
        </div>

        {errors["projects"] && (
          <p className="text-xs text-[var(--color-danger)]">
            {errors["projects"]}
          </p>
        )}

        {draft.projects.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] py-4 text-center">
            No projects configured. Add one to get started.
          </p>
        ) : (
          <div className="space-y-2">
            {draft.projects.map((p, i) => (
              <ProjectForm
                key={i}
                project={p}
                onChange={(p) => updateProject(i, p)}
                onRemove={() => removeProject(i)}
                errors={Object.fromEntries(
                  Object.entries(errors)
                    .filter(([k]) => k.startsWith(`projects.${i}.`))
                    .map(([k, v]) => [k.replace(`projects.${i}.`, ""), v]),
                )}
                disabled={isSaving}
              />
            ))}
          </div>
        )}
      </section>

      {/* Save bar */}
      <div className="flex items-center gap-3 pt-2 border-t border-[var(--color-border)]">
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          loading={isSaving}
          disabled={!isDirty || isSaving}
        >
          Save changes
        </Button>
        <Button
          variant="secondary"
          onClick={handleReset}
          disabled={!isDirty || isSaving}
        >
          Reset
        </Button>

        {saved && !saveError && (
          <span className="text-xs text-[var(--color-success)]">
            Saved successfully
          </span>
        )}
        {saveError && (
          <span className="text-xs text-[var(--color-danger)]">
            {saveError}
          </span>
        )}
      </div>
    </div>
  );
}
