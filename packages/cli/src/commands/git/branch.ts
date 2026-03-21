import React from "react";
import { render } from "ink";
import type { Command } from "commander";
import { listBranches, BulkGitService } from "@dev-hub/core";
import { loadWorkspace, resolveProjects } from "../../utils/workspace.js";
import { ProgressList } from "../../components/ProgressList.js";
import chalk from "chalk";

export function registerBranch(gitCmd: Command): void {
  const branchCmd = gitCmd
    .command("branch")
    .description("Manage git branches");

  branchCmd
    .command("list [project]")
    .description("List branches for a project or all projects")
    .action(async (project?: string) => {
      const { config } = await loadWorkspace();
      const projects = resolveProjects(config, project);

      const allBranches = await Promise.all(
        projects.map((p) =>
          listBranches(p.path)
            .then((branches) => ({ name: p.name, branches }))
            .catch((err: Error) => {
              console.error(`${p.name}: ${err.message}`);
              return { name: p.name, branches: [] };
            }),
        ),
      );

      for (const { name, branches } of allBranches) {
        if (branches.length === 0) continue;
        console.log(`\n${chalk.bold(name)}:`);
        const localBranches = branches.filter((b) => !b.isRemote);
        for (const b of localBranches) {
          const current = b.isCurrent ? chalk.green("* ") : "  ";
          const tracking = b.trackingBranch ? chalk.dim(` → ${b.trackingBranch}`) : "";
          const aheadBehind = (b.ahead > 0 || b.behind > 0)
            ? chalk.cyan(` ↑${b.ahead}↓${b.behind}`)
            : "";
          console.log(`${current}${b.name}${tracking}${aheadBehind}`);
        }
      }
    });

  branchCmd
    .command("update [project]")
    .description("Update local branches from remote")
    .action(async (project?: string) => {
      const { config } = await loadWorkspace();
      const projects = resolveProjects(config, project);
      const service = new BulkGitService();
      const done = service.updateAllBranches(projects).then((map) =>
        Array.from(map.values())
          .flat()
          .map((r) => ({ success: r.success })),
      );

      const { waitUntilExit } = render(
        React.createElement(ProgressList, {
          projects: projects.map((p) => p.name),
          emitter: service.emitter,
          done,
          label: "Branch update",
        }),
      );

      await waitUntilExit();
    });
}
