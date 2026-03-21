import React, { useState, useEffect } from "react";
import { render } from "ink";
import { Box, Text, useApp, useInput } from "ink";
import type { Command } from "commander";
import {
  RunService,
  getProjectServices,
  type RunProgressEvent,
} from "@dev-hub/core";
import { loadWorkspace, resolveProjects } from "../utils/workspace.js";
import { printError } from "../utils/format.js";

// --- Single-service runner UI ---
interface RunnerProps {
  projectName: string;
  serviceName: string;
  service: RunService;
}

function Runner({ projectName, serviceName, service }: RunnerProps) {
  const { exit } = useApp();
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState("starting");

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      service.stop(projectName, serviceName).then(() => exit());
    }
  });

  useEffect(() => {
    const handler = (event: RunProgressEvent) => {
      if (event.projectName !== projectName) return;
      if (event.serviceName !== serviceName) return;
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
    return () => {
      service.emitter.off("progress", handler);
    };
  }, [service, projectName, serviceName]);

  const statusColor =
    status === "running" ? "green" : status === "crashed" ? "red" : "yellow";

  const label =
    serviceName !== "default" ? `${projectName} > ${serviceName}` : projectName;

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text bold>{label}</Text>
        <Text color={statusColor}>[{status}]</Text>
        <Text dimColor>Ctrl+C to stop</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((l, i) => (
          <Text key={i}>{l}</Text>
        ))}
      </Box>
    </Box>
  );
}

// --- Multi-service runner UI ---
interface ServiceState {
  name: string;
  status: "starting" | "running" | "stopped" | "crashed";
  lines: string[];
}

interface MultiRunnerProps {
  projectName: string;
  serviceNames: string[];
  service: RunService;
}

function MultiRunner({ projectName, serviceNames, service }: MultiRunnerProps) {
  const { exit } = useApp();
  const [states, setStates] = useState<Map<string, ServiceState>>(
    () =>
      new Map(
        serviceNames.map((name) => [
          name,
          { name, status: "starting", lines: [] },
        ]),
      ),
  );

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      service.stop(projectName).then(() => exit());
    }
  });

  useEffect(() => {
    const handler = (event: RunProgressEvent) => {
      if (event.projectName !== projectName) return;
      const svcName = event.serviceName;
      if (!svcName || !serviceNames.includes(svcName)) return;

      setStates((prev) => {
        const next = new Map(prev);
        const cur = next.get(svcName) ?? {
          name: svcName,
          status: "starting" as const,
          lines: [],
        };

        if (event.phase === "started") {
          next.set(svcName, { ...cur, status: "running" });
        } else if (event.phase === "stopped") {
          next.set(svcName, { ...cur, status: "stopped" });
        } else if (event.phase === "crashed") {
          next.set(svcName, { ...cur, status: "crashed" });
        } else if (event.phase === "output" && event.line !== undefined) {
          next.set(svcName, {
            ...cur,
            lines: [...cur.lines.slice(-9), event.line!],
          });
        }
        return next;
      });
    };
    service.emitter.on("progress", handler);
    return () => {
      service.emitter.off("progress", handler);
    };
  }, [service, projectName, serviceNames]);

  // Exit when all services have stopped or crashed
  useEffect(() => {
    const allDone = Array.from(states.values()).every(
      (s) => s.status === "stopped" || s.status === "crashed",
    );
    if (allDone && states.size > 0) {
      setTimeout(() => exit(), 100);
    }
  }, [states]);

  const list = Array.from(states.values());

  return (
    <Box flexDirection="column">
      <Box gap={1} marginBottom={1}>
        <Text bold>{projectName}</Text>
        <Text dimColor>— {serviceNames.length} services — Ctrl+C to stop all</Text>
      </Box>
      {list.map((s) => {
        const color =
          s.status === "running"
            ? "green"
            : s.status === "crashed"
              ? "red"
              : "yellow";
        return (
          <Box key={s.name} flexDirection="column" marginBottom={1}>
            <Box gap={1}>
              <Text bold color={color}>
                {s.name}
              </Text>
              <Text color={color}>[{s.status}]</Text>
            </Box>
            <Box flexDirection="column" marginLeft={2}>
              {s.lines.map((l, i) => (
                <Text key={i} dimColor>
                  {l}
                </Text>
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export function registerRun(program: Command): void {
  program
    .command("run <project>")
    .description("Start a project and stream its output (Ctrl+C to stop)")
    .option("--service <name>", "Start a specific service")
    .action(async (project: string, opts: { service?: string }) => {
      const { config, workspaceRoot } = await loadWorkspace();
      const [p] = resolveProjects(config, project);

      const runSvc = new RunService();
      const services = getProjectServices(p);

      if (opts.service) {
        // Start single named service
        const target = services.find((s) => s.name === opts.service);
        if (!target) {
          printError(
            `Service "${opts.service}" not found for project "${p.name}". ` +
              `Available: ${services.map((s) => s.name).join(", ")}`,
          );
          process.exit(1);
        }

        await runSvc
          .start(p, workspaceRoot, opts.service)
          .catch((err: Error) => {
            printError(err.message);
            process.exit(1);
          });

        process.once("SIGINT", () => {
          runSvc.stop(p.name, opts.service).then(() => process.exit(0));
        });

        const { waitUntilExit } = render(
          React.createElement(Runner, {
            projectName: p.name,
            serviceName: opts.service,
            service: runSvc,
          }),
        );
        await waitUntilExit();
        await runSvc.stopAll();
      } else if (services.length === 1) {
        // Single service (default or preset) — use simple Runner
        const svc = services[0];

        await runSvc.start(p, workspaceRoot).catch((err: Error) => {
          printError(err.message);
          process.exit(1);
        });

        process.once("SIGINT", () => {
          runSvc.stop(p.name).then(() => process.exit(0));
        });

        const { waitUntilExit } = render(
          React.createElement(Runner, {
            projectName: p.name,
            serviceName: svc.name,
            service: runSvc,
          }),
        );
        await waitUntilExit();
        await runSvc.stopAll();
      } else {
        // Multiple services — start all and use MultiRunner
        await runSvc.startAll(p, workspaceRoot).catch((err: Error) => {
          printError(err.message);
          process.exit(1);
        });

        process.once("SIGINT", () => {
          runSvc.stop(p.name).then(() => process.exit(0));
        });

        const { waitUntilExit } = render(
          React.createElement(MultiRunner, {
            projectName: p.name,
            serviceNames: services.map((s) => s.name),
            service: runSvc,
          }),
        );
        await waitUntilExit();
        await runSvc.stopAll();
      }
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
    .action(async (project: string) => {
      const { config } = await loadWorkspace();
      const [p] = resolveProjects(config, project);
      // Logs are only available during a foreground `dev-hub run` session.
      // Phase 06 (server) provides persistent log access via `dev-hub ui`.
      printError(
        `No active session for "${p.name}". ` +
          `Logs are only available while a foreground \`dev-hub run\` session is active. ` +
          `Use \`dev-hub ui\` to access persistent logs.`,
      );
      process.exit(1);
    });
}
