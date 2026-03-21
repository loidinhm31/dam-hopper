import React from "react";
import { render } from "ink";
import type { Command } from "commander";
import { BuildService } from "@dev-hub/core";
import { loadWorkspace, resolveProjects } from "../utils/workspace.js";
import { BuildOutput } from "../components/BuildOutput.js";
import { ProgressList } from "../components/ProgressList.js";
import { printSuccess, printError, formatDuration } from "../utils/format.js";

export function registerBuild(program: Command): void {
  program
    .command("build [project]")
    .description("Build a project (or all with --all)")
    .option("--all", "Build all projects")
    .action(async (project?: string, opts?: { all?: boolean }) => {
      const { config, workspaceRoot } = await loadWorkspace();

      if (opts?.all || !project) {
        // Build all projects with ProgressList
        const projects = config.projects;
        if (projects.length === 0) {
          printError("No projects configured.");
          process.exit(1);
        }

        const service = new BuildService();
        const done = service.buildMultiple(projects, workspaceRoot).then((results) => {
          return results.map((r) => ({ success: r.success }));
        });

        // Create a GitProgressEmitter-compatible adapter
        const { createProgressEmitter } = await import("@dev-hub/core");
        const gitEmitter = createProgressEmitter();

        service.emitter.on("progress", (event) => {
          if (event.phase === "started") {
            gitEmitter.emit("progress", { projectName: event.projectName, operation: "build", phase: "started", message: "Building..." });
          } else if (event.phase === "completed") {
            const dur = event.result ? formatDuration(event.result.durationMs) : "";
            gitEmitter.emit("progress", { projectName: event.projectName, operation: "build", phase: "completed", message: `Done (${dur})` });
          } else if (event.phase === "failed") {
            gitEmitter.emit("progress", { projectName: event.projectName, operation: "build", phase: "failed", message: event.result?.error ?? "failed" });
          }
        });

        const { waitUntilExit } = render(
          React.createElement(ProgressList, {
            projects: projects.map((p) => p.name),
            emitter: gitEmitter,
            done,
            label: "Build",
          }),
        );
        await waitUntilExit();
      } else {
        // Single project with live output
        const [p] = resolveProjects(config, project);
        const service = new BuildService();
        const command = p.buildCommand ?? "(preset)";
        const done = service.build(p, workspaceRoot);

        const { waitUntilExit } = render(
          React.createElement(BuildOutput, {
            projectName: p.name,
            command,
            emitter: service.emitter,
            done,
          }),
        );
        await waitUntilExit();

        const result = await done;
        if (!result.success) process.exit(1);
      }
    });
}
