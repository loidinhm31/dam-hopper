import React from "react";
import { render } from "ink";
import type { Command } from "commander";
import { BulkGitService } from "@dev-hub/core";
import { loadWorkspace, resolveProjects } from "../../utils/workspace.js";
import { ProgressList } from "../../components/ProgressList.js";

export function registerFetch(gitCmd: Command): void {
  gitCmd
    .command("fetch [project]")
    .description("Fetch from remote for all projects or a specific one")
    .action(async (project?: string) => {
      const { config } = await loadWorkspace();
      const projects = resolveProjects(config, project);
      const service = new BulkGitService();
      const done = service.fetchAll(projects);

      const { waitUntilExit } = render(
        React.createElement(ProgressList, {
          projects: projects.map((p) => p.name),
          emitter: service.emitter,
          done,
          label: "Fetch",
        }),
      );

      await waitUntilExit();
    });
}
