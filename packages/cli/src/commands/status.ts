import React from "react";
import { render } from "ink";
import type { Command } from "commander";
import { BulkGitService } from "@dev-hub/core";
import { loadWorkspace } from "../utils/workspace.js";
import { StatusLoader } from "../components/StatusTable.js";

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Show git status for all projects")
    .action(async () => {
      const { config } = await loadWorkspace();
      const service = new BulkGitService();

      const loader = () => service.statusAll(config.projects);

      const { unmount, waitUntilExit } = render(
        React.createElement(StatusLoader, { loader }),
      );

      await waitUntilExit();
      unmount();
    });
}
