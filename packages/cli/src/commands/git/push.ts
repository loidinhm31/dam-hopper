import type { Command } from "commander";
import { gitPush } from "@dev-hub/core";
import { loadWorkspace, resolveProjects } from "../../utils/workspace.js";
import {
  printSuccess,
  printError,
  formatDuration,
} from "../../utils/format.js";
import type { GlobalOptions } from "../../utils/types.js";

export function registerPush(gitCmd: Command): void {
  gitCmd
    .command("push <project>")
    .description("Push a specific project to its remote")
    .action(async (project: string, _opts: Record<string, unknown>, cmd: Command) => {
      const { workspace } = cmd.optsWithGlobals<GlobalOptions>();
      const { config } = await loadWorkspace(workspace);
      const [p] = resolveProjects(config, project);

      console.log(`Pushing ${p.name}...`);
      const result = await gitPush(p.path, p.name);

      if (result.success) {
        printSuccess(
          `${p.name} — ${result.summary} (${formatDuration(result.durationMs)})`,
        );
      } else {
        printError(`${p.name} — ${result.error?.message ?? "push failed"}`);
        process.exit(1);
      }
    });
}
