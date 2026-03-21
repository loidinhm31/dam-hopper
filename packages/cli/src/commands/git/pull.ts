import React from "react";
import { render } from "ink";
import type { Command } from "commander";
import { BulkGitService } from "@dev-hub/core";
import { loadWorkspace, resolveProjects } from "../../utils/workspace.js";
import { ProgressList } from "../../components/ProgressList.js";
import { printWarn } from "../../utils/format.js";
import { getStatus } from "@dev-hub/core";

export function registerPull(gitCmd: Command): void {
  gitCmd
    .command("pull [project]")
    .description("Pull from remote for all projects or a specific one")
    .action(async (project?: string) => {
      const { config } = await loadWorkspace();
      const projects = resolveProjects(config, project);

      // Warn about dirty repos
      const statuses = await Promise.all(
        projects.map((p) => getStatus(p.path, p.name).catch(() => null)),
      );
      for (const s of statuses) {
        if (s && !s.isClean) {
          printWarn(`${s.projectName} has uncommitted changes — pull may fail.`);
        }
      }

      const service = new BulkGitService();
      const done = service.pullAll(projects);

      const { waitUntilExit } = render(
        React.createElement(ProgressList, {
          projects: projects.map((p) => p.name),
          emitter: service.emitter,
          done,
          label: "Pull",
        }),
      );

      await waitUntilExit();
    });
}
