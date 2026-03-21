import React from "react";
import { render } from "ink";
import type { Command } from "commander";
import { BuildService, getProjectServices } from "@dev-hub/core";
import { loadWorkspace, resolveProjects } from "../utils/workspace.js";
import { BuildOutput } from "../components/BuildOutput.js";
import { ProgressList } from "../components/ProgressList.js";
import { printError } from "../utils/format.js";
import {
  bridgeBuildToGitEmitter,
  serviceLabel,
} from "../utils/buildProgress.js";

export function registerBuild(program: Command): void {
  program
    .command("build [project]")
    .description("Build a project (or all with --all)")
    .option("--all", "Build all projects")
    .option("--service <name>", "Build a specific service")
    .action(
      async (
        project?: string,
        opts?: { all?: boolean; service?: string },
      ) => {
        const { config, workspaceRoot } = await loadWorkspace();

        if (opts?.all || !project) {
          // Build all projects
          const projects = config.projects;
          if (projects.length === 0) {
            printError("No projects configured.");
            process.exit(1);
          }

          const buildSvc = new BuildService();
          const done = buildSvc
            .buildMultiple(projects, workspaceRoot)
            .then((results) => results.map((r) => ({ success: r.success })));

          const gitEmitter = bridgeBuildToGitEmitter(
            buildSvc.emitter,
            serviceLabel,
          );

          const serviceLabels = projects.flatMap((p) =>
            getProjectServices(p).map((s) => serviceLabel(p.name, s.name)),
          );

          const { waitUntilExit } = render(
            React.createElement(ProgressList, {
              projects: serviceLabels,
              emitter: gitEmitter,
              done,
              label: "Build",
            }),
          );
          await waitUntilExit();
        } else {
          // Single project
          const [p] = resolveProjects(config, project);
          const buildSvc = new BuildService();

          if (opts?.service) {
            // Build specific service with live output
            const services = getProjectServices(p);
            const target = services.find((s) => s.name === opts.service);
            if (!target) {
              printError(
                `Service "${opts.service}" not found for project "${p.name}". ` +
                  `Available: ${services.map((s) => s.name).join(", ")}`,
              );
              process.exit(1);
            }

            const command = target.buildCommand ?? "(preset)";
            const done = buildSvc.build(p, workspaceRoot, opts.service);

            const { waitUntilExit } = render(
              React.createElement(BuildOutput, {
                projectName: p.name,
                command,
                emitter: buildSvc.emitter,
                done,
              }),
            );
            await waitUntilExit();

            const result = await done;
            if (!result.success) process.exit(1);
          } else {
            // Build all services for project
            const services = getProjectServices(p);
            const serviceLabels = services.map((s) =>
              serviceLabel(p.name, s.name),
            );

            const done = buildSvc
              .buildAll(p, workspaceRoot)
              .then((results) => results.map((r) => ({ success: r.success })));

            const gitEmitter = bridgeBuildToGitEmitter(
              buildSvc.emitter,
              serviceLabel,
            );

            const { waitUntilExit } = render(
              React.createElement(ProgressList, {
                projects: serviceLabels,
                emitter: gitEmitter,
                done,
                label: "Build",
              }),
            );
            await waitUntilExit();
          }
        }
      },
    );
}
