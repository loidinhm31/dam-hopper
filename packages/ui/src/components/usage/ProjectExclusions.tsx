import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, inputClass } from "@/components/atoms/Button.js";

interface ProjectExclusionsProps {
  excludedProjects: readonly string[];
  isPending: boolean;
  projects: readonly { name: string }[];
  settingsLoaded: boolean;
  onAdd: (project: string, onSuccess: () => void, onError: () => void) => void;
  onRemove: (project: string, onSuccess: () => void, onError: () => void) => void;
}

export function ProjectExclusions({
  excludedProjects,
  isPending,
  projects,
  settingsLoaded,
  onAdd,
  onRemove,
}: ProjectExclusionsProps) {
  const [projectToExclude, setProjectToExclude] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const availableProjects = projects.filter((project) => !excludedProjects.includes(project.name));
  const reportError = () => setError("Could not update project exclusions. Please try again.");

  return (
    <section aria-labelledby="project-exclusions-heading" className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="project-exclusions-heading" className="text-xs font-semibold text-[var(--color-text)]">Project exclusions</h2>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">Excluded projects are not included in future usage aggregates.</p>
        </div>
        <p aria-live="polite" role="status" className="text-xs text-[var(--color-text-muted)]">
          {isPending ? "Updating project exclusions…" : status}
        </p>
      </div>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (!projectToExclude) return;
          onAdd(
            projectToExclude,
            () => {
              setStatus(`Usage collection will exclude ${projectToExclude}.`);
              setError("");
              setProjectToExclude("");
            },
            reportError,
          );
        }}
      >
        <label className="grid min-w-0 flex-1 gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
          Project to exclude
          <select
            className={`${inputClass} min-h-11`}
            value={projectToExclude}
            onChange={(event) => setProjectToExclude(event.target.value)}
            disabled={!settingsLoaded || isPending || availableProjects.length === 0}
          >
            <option value="">{availableProjects.length === 0 ? "No available projects" : "Select a project"}</option>
            {availableProjects.map((project) => <option key={project.name} value={project.name}>{project.name}</option>)}
          </select>
        </label>
        <Button type="submit" variant="secondary" size="sm" className="!h-11" disabled={!projectToExclude || !settingsLoaded || isPending} loading={isPending}>
          <Plus className="h-3.5 w-3.5" /> Exclude project
        </Button>
      </form>
      {error ? <p role="alert" className="mt-2 text-xs text-[var(--color-danger)]">{error}</p> : null}
      {excludedProjects.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">No projects are excluded.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Excluded projects">
          {excludedProjects.map((projectName) => (
            <li key={projectName} className="flex min-h-7 items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] py-0.5 pl-2 text-xs text-[var(--color-text)]">
              <span>{projectName}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="!h-11 !w-11 px-0"
                aria-label={`Remove ${projectName}`}
                disabled={!settingsLoaded || isPending}
                loading={isPending}
                onClick={() => onRemove(projectName, () => {
                  setStatus(`Usage collection will include ${projectName}.`);
                  setError("");
                }, reportError)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
