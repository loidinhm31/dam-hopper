import { useState } from "react";
import { AppLayout } from "@/components/templates/AppLayout.js";
import { Button } from "@/components/atoms/Button.js";
import { TerminalPanel } from "@/components/organisms/TerminalPanel.js";
import { useProjects } from "@/api/queries.js";
import { getEffectiveCommand } from "@/lib/presets.js";
import { Badge } from "@/components/atoms/Badge.js";

export function BuildPage() {
  const { data: projects = [] } = useProjects();
  const [selected, setSelected] = useState("");
  const [buildKey, setBuildKey] = useState(0);
  const [buildStarted, setBuildStarted] = useState(false);
  const [exitCode, setExitCode] = useState<number | null | undefined>(
    undefined,
  );

  const projectName = selected || projects[0]?.name || "";
  const project = projects.find((p) => p.name === projectName);
  const buildCmd = project ? getEffectiveCommand(project, "build") : null;

  function handleBuild() {
    setExitCode(undefined);
    setBuildKey((k) => k + 1);
    setBuildStarted(true);
  }

  return (
    <AppLayout title="Build">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <select
            className="h-8 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] outline-none"
            value={selected || projectName}
            onChange={(e) => {
              setSelected(e.target.value);
              setBuildStarted(false);
              setExitCode(undefined);
            }}
          >
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            disabled={!buildCmd?.command}
            onClick={handleBuild}
          >
            Build
          </Button>
          {exitCode !== undefined && (
            <Badge variant={exitCode === 0 ? "success" : "danger"}>
              {exitCode === 0 ? "success" : `exit ${exitCode}`}
            </Badge>
          )}
        </div>

        {buildStarted && buildCmd && (
          <TerminalPanel
            key={`build-page:${projectName}:${buildKey}`}
            sessionId={`build-page:${projectName}`}
            project={projectName}
            command={buildCmd.command}
            onExit={(code) => setExitCode(code)}
            className="h-[60vh]"
          />
        )}
      </div>
    </AppLayout>
  );
}
