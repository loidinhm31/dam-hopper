import { useState, useEffect } from "react";
import { 
  FolderOpen, 
  ChevronRight, 
  ChevronLeft, 
  Loader2, 
  CheckCircle2, 
  Package, 
  FolderGit2,
  AlertCircle,
  Server
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useDiscoverProjects, useInitWorkspace } from "@/api/queries.js";
import type { DiscoveredProject } from "@/api/client.js";
import { getActiveProfile } from "@/api/server-config.js";

interface Props {
  onComplete: () => void;
}

type Step = "path" | "projects" | "confirm";

const PROJECT_TYPE_ICONS: Record<string, string> = {
  npm: "📦",
  pnpm: "📦",
  maven: "☕",
  gradle: "🐘",
  cargo: "🦀",
  custom: "📁",
};

export function WorkspaceSetupWizard({ onComplete }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("path");
  const [selectedPath, setSelectedPath] = useState("");
  const [inputPath, setInputPath] = useState("");
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [workspaceName, setWorkspaceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  
  const activeProfile = getActiveProfile();
  const { data: discoverData, isLoading: discovering, error: discoverError } = useDiscoverProjects(
    step === "projects" ? selectedPath : null
  );
  const initMutation = useInitWorkspace();

  function handleInputPathSubmit() {
    const path = inputPath.trim();
    if (!path) return;
    setSelectedPath(path);
    setWorkspaceName(path.split("/").filter(Boolean).pop() || "workspace");
    setError(null);
    setStep("projects");
  }

  // Auto-select all discovered projects
  useEffect(() => {
    if (discoverData?.projects) {
      setSelectedProjects(discoverData.projects.map((p) => p.path));
    }
  }, [discoverData]);

  function toggleProject(path: string) {
    setSelectedProjects((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  }

  function toggleAll() {
    if (!discoverData?.projects) return;
    if (selectedProjects.length === discoverData.projects.length) {
      setSelectedProjects([]);
    } else {
      setSelectedProjects(discoverData.projects.map((p) => p.path));
    }
  }

  async function handleInitialize() {
    setError(null);
    try {
      await initMutation.mutateAsync(selectedPath);
      void qc.invalidateQueries({ queryKey: ["workspace-status"] });
      void qc.invalidateQueries({ queryKey: ["workspace"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize workspace");
    }
  }

  const projects = discoverData?.projects ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg)]/95 backdrop-blur-md">
      <div className="w-full max-w-2xl mx-4">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[var(--color-primary)]/20 mb-4">
            <Server className="w-8 h-8 text-[var(--color-primary)]" />
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-text)] mb-2">
            Set Up Your Workspace
          </h1>
          {activeProfile && (
            <p className="text-sm text-[var(--color-text-muted)]">
              Connected to <span className="text-[var(--color-primary)]">{activeProfile.name}</span>
            </p>
          )}
        </div>

        {/* Progress Indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {(["path", "projects", "confirm"] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step === s
                    ? "bg-[var(--color-primary)] text-white"
                    : i < ["path", "projects", "confirm"].indexOf(step)
                    ? "bg-[var(--color-success)] text-white"
                    : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"
                }`}
              >
                {i + 1}
              </div>
              {i < 2 && (
                <div
                  className={`w-12 h-0.5 mx-1 transition-colors ${
                    i < ["path", "projects", "confirm"].indexOf(step)
                      ? "bg-[var(--color-success)]"
                      : "bg-[var(--color-border)]"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="glass-card rounded-2xl border border-[var(--color-border)] shadow-2xl overflow-hidden">
          {/* Step Content */}
          <div className="p-6">
            {step === "path" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <FolderOpen className="w-5 h-5 text-[var(--color-primary)]" />
                  <h2 className="text-lg font-semibold text-[var(--color-text)]">
                    Select Workspace Directory
                  </h2>
                </div>

                <p className="text-sm text-[var(--color-text-muted)]">
                  Enter the path to your workspace directory on the server. This is the root folder containing your projects.
                </p>

                {/* Path Input */}
                <div className="space-y-2">
                  <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
                    Workspace Path
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={inputPath}
                      onChange={(e) => setInputPath(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleInputPathSubmit()}
                      placeholder="/home/user/projects"
                      className="flex-1 glass-input rounded-lg px-3 py-2.5 text-sm outline-none font-mono"
                    />
                  </div>
                </div>

                {/* Common Paths Suggestions */}
                <div className="space-y-2">
                  <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
                    Common locations
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {["/home", "/var/www", "/opt", "/srv", "/projects", "/workspace"].map((path) => (
                      <button
                        key={path}
                        onClick={() => setInputPath(path)}
                        className="px-3 py-1.5 rounded-md text-xs font-mono bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] border border-[var(--color-border)] transition-colors"
                      >
                        {path}
                      </button>
                    ))}
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-sm text-[var(--color-error)] p-3 rounded-lg bg-[var(--color-error)]/10">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                  </div>
                )}
              </div>
            )}

            {step === "projects" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Package className="w-5 h-5 text-[var(--color-primary)]" />
                    <h2 className="text-lg font-semibold text-[var(--color-text)]">
                      Discovered Projects
                    </h2>
                  </div>
                  <span className="text-xs text-[var(--color-text-muted)] font-mono">
                    {selectedPath}
                  </span>
                </div>

                {discovering ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary)] mb-4" />
                    <p className="text-sm text-[var(--color-text-muted)]">
                      Scanning for projects...
                    </p>
                  </div>
                ) : discoverError ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <AlertCircle className="w-8 h-8 text-[var(--color-error)] mb-4" />
                    <p className="text-sm text-[var(--color-error)]">
                      {discoverError instanceof Error ? discoverError.message : "Failed to discover projects"}
                    </p>
                  </div>
                ) : projects.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <FolderOpen className="w-8 h-8 text-[var(--color-text-muted)] mb-4" />
                    <p className="text-sm text-[var(--color-text-muted)]">
                      No projects found in this directory.
                    </p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">
                      You can still use this as your workspace.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-[var(--color-text-muted)]">
                        {selectedProjects.length} of {projects.length} selected
                      </span>
                      <button
                        onClick={toggleAll}
                        className="text-xs text-[var(--color-primary)] hover:underline"
                      >
                        {selectedProjects.length === projects.length ? "Deselect all" : "Select all"}
                      </button>
                    </div>
                    
                    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                      <ul className="divide-y divide-[var(--color-border)]">
                        {projects.map((project) => (
                          <li key={project.path}>
                            <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[var(--color-surface-2)] transition-colors">
                              <input
                                type="checkbox"
                                checked={selectedProjects.includes(project.path)}
                                onChange={() => toggleProject(project.path)}
                                className="w-4 h-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                              />
                              <span className="text-lg" title={project.projectType}>
                                {PROJECT_TYPE_ICONS[project.projectType] || "📁"}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm text-[var(--color-text)]">
                                    {project.name}
                                  </span>
                                  {project.isGitRepo && (
                                    <span title="Git repository">
                                      <FolderGit2 className="w-3.5 h-3.5 text-[var(--color-success)]" />
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs text-[var(--color-text-muted)] truncate block">
                                  {project.projectType}
                                </span>
                              </div>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                )}

                {/* Workspace Name */}
                <div className="space-y-2 pt-4">
                  <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">
                    Workspace Name
                  </label>
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="my-workspace"
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm outline-none"
                  />
                </div>
              </div>
            )}

            {step === "confirm" && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle2 className="w-5 h-5 text-[var(--color-success)]" />
                  <h2 className="text-lg font-semibold text-[var(--color-text)]">
                    Ready to Initialize
                  </h2>
                </div>

                <div className="space-y-3 p-4 rounded-lg bg-[var(--color-surface-2)]">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-text-muted)]">Workspace</span>
                    <span className="text-sm font-medium text-[var(--color-text)]">{workspaceName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-text-muted)]">Path</span>
                    <span className="text-sm font-mono text-[var(--color-text)] truncate max-w-[60%]">{selectedPath}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-text-muted)]">Projects</span>
                    <span className="text-sm text-[var(--color-text)]">{selectedProjects.length}</span>
                  </div>
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-sm text-[var(--color-error)] p-3 rounded-lg bg-[var(--color-error)]/10">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]">
            <button
              onClick={() => {
                if (step === "projects") setStep("path");
                else if (step === "confirm") setStep("projects");
              }}
              disabled={step === "path"}
              className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>

            <button
              onClick={() => {
                if (step === "path") {
                  handleInputPathSubmit();
                } else if (step === "projects") {
                  setStep("confirm");
                } else if (step === "confirm") {
                  void handleInitialize();
                }
              }}
              disabled={
                (step === "path" && !inputPath.trim()) ||
                (step === "confirm" && initMutation.isPending)
              }
              className="flex items-center gap-1 px-5 py-2 rounded-lg text-sm font-semibold bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {initMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Initializing...
                </>
              ) : step === "confirm" ? (
                <>
                  Initialize
                  <CheckCircle2 className="w-4 h-4" />
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
