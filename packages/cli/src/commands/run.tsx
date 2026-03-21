import React, { useState, useEffect } from "react";
import { render } from "ink";
import { Box, Text, useApp, useInput } from "ink";
import type { Command } from "commander";
import { RunService, type RunProgressEvent } from "@dev-hub/core";
import { loadWorkspace, resolveProjects } from "../utils/workspace.js";
import { LogViewer } from "../components/LogViewer.js";
import { printSuccess, printError } from "../utils/format.js";

// --- Live runner UI ---
interface RunnerProps {
  projectName: string;
  service: RunService;
}

function Runner({ projectName, service }: RunnerProps) {
  const { exit } = useApp();
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState("starting");

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      service.stop(projectName).then(() => exit());
    }
  });

  useEffect(() => {
    const handler = (event: RunProgressEvent) => {
      if (event.projectName !== projectName) return;
      if (event.phase === "started") setStatus("running");
      if (event.phase === "stopped") {
        setStatus("stopped");
        setTimeout(() => exit(), 100);
      }
      if (event.phase === "crashed") {
        setStatus("crashed");
        setTimeout(() => exit(), 200);
      }
      if (event.phase === "output" && event.line !== undefined) {
        setLines((prev) => [...prev.slice(-50), event.line!]);
      }
    };
    service.emitter.on("progress", handler);
    return () => { service.emitter.off("progress", handler); };
  }, [service, projectName]);

  const statusColor = status === "running" ? "green" : status === "crashed" ? "red" : "yellow";

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text bold>{projectName}</Text>
        <Text color={statusColor}>[{status}]</Text>
        <Text dimColor>Ctrl+C to stop</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((l, i) => <Text key={i}>{l}</Text>)}
      </Box>
    </Box>
  );
}

export function registerRun(program: Command): void {
  program
    .command("run <project>")
    .description("Start a project and stream its output (Ctrl+C to stop)")
    .action(async (project: string) => {
      const { config, workspaceRoot } = await loadWorkspace();
      const [p] = resolveProjects(config, project);

      // Each `run` invocation is its own process — create a fresh service
      const service = new RunService();

      const proc = await service.start(p, workspaceRoot).catch((err: Error) => {
        printError(err.message);
        process.exit(1);
      });

      // Graceful SIGINT handler (e.g., when running via shell pipes/scripts)
      process.on("SIGINT", () => {
        service.stop(p.name).then(() => process.exit(0));
      });

      const { waitUntilExit } = render(
        React.createElement(Runner, { projectName: p.name, service }),
      );

      await waitUntilExit();
      await service.stopAll();
    });

  program
    .command("stop <project>")
    .description("Stop a running project (requires dev-hub ui to be running)")
    .action(async (project: string) => {
      const { config } = await loadWorkspace();
      const [p] = resolveProjects(config, project);
      // In Phase 05 (CLI-only), stop works via the server's RunService (Phase 06).
      // For foreground `dev-hub run`, Ctrl+C is the stop mechanism.
      printError(
        `${p.name}: \`dev-hub stop\` requires the server to be running (\`dev-hub ui\`). ` +
        `Use Ctrl+C to stop a foreground process.`,
      );
      process.exit(1);
    });

  program
    .command("logs <project>")
    .description("View recent logs for a running project")
    .option("--lines <n>", "Number of lines to show", "50")
    .action(async (project: string, opts: { lines: string }) => {
      const { config } = await loadWorkspace();
      const [p] = resolveProjects(config, project);

      const lines = parseInt(opts.lines, 10);
      if (isNaN(lines) || lines < 1) {
        printError(`Invalid --lines value: ${opts.lines}. Must be a positive integer.`);
        process.exit(1);
      }

      // Logs are held in-process by RunService. In Phase 05, logs are only
      // available during a foreground `dev-hub run` session. Phase 06 (server)
      // provides persistent log access.
      const service = new RunService();
      const logs = service.getLogs(p.name, lines);

      const { unmount, waitUntilExit } = render(
        React.createElement(LogViewer, { logs, projectName: p.name }),
      );

      setTimeout(() => unmount(), 50);
      await waitUntilExit();
    });
}
