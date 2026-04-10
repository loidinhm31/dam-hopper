import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { IdeShell } from "@/components/templates/IdeShell.js";
import { FileTree } from "@/components/organisms/FileTree.js";
import { EditorTabs } from "@/components/organisms/EditorTabs.js";
import { TerminalDock } from "@/components/organisms/TerminalDock.js";
import { useFeatureFlag } from "@/hooks/useFeatureFlag.js";
import { useEditorStore } from "@/stores/editor.js";
import { api } from "@/api/client.js";
import type { FsArborNode } from "@/api/fs-types.js";

export default function IdePage() {
  const ideEnabled = useFeatureFlag("ide_explorer");
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const openFile = useEditorStore((s) => s.open);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects.list(),
  });

  const projectName =
    activeProject ?? (projects && projects.length > 0 ? projects[0].name : null);

  if (!ideEnabled) {
    return <Navigate to="/" replace />;
  }

  function handleFileOpen(node: FsArborNode) {
    if (projectName) void openFile(projectName, node);
  }

  return (
    <IdeShell
      tree={
        <div className="flex flex-col h-full">
          {projects && projects.length > 1 && (
            <div className="shrink-0 px-2 py-1.5 border-b border-[var(--color-border)]">
              <select
                value={projectName ?? ""}
                onChange={(e) => setActiveProject(e.target.value)}
                className="w-full text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-sm px-1.5 py-1 text-[var(--color-text)] focus:outline-none focus:border-[var(--color-primary)]"
              >
                {projects.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {projectName ? (
            <FileTree
              key={projectName}
              project={projectName}
              path=""
              onFileOpen={handleFileOpen}
              className="flex-1"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
              No projects configured
            </div>
          )}
        </div>
      }
      editor={<EditorTabs />}
      terminal={projectName ? <TerminalDock project={projectName} /> : <div />}
    />
  );
}
