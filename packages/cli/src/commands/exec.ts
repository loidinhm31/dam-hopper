import React from "react";
import { render } from "ink";
import type { Command } from "commander";
import { CommandService } from "@dev-hub/core";
import { loadWorkspace, resolveProjects } from "../utils/workspace.js";
import { BuildOutput } from "../components/BuildOutput.js";
import { printError, printSuccess } from "../utils/format.js";

export function registerExec(program: Command): void {
  program
    .command("exec <project> [command]")
    .description("Run a custom command defined in dev-hub.toml")
    .option("--list", "List available custom commands for the project")
    .action(
      async (
        project: string,
        commandName: string | undefined,
        opts: { list?: boolean },
      ) => {
        const { config, workspaceRoot } = await loadWorkspace();
        const [p] = resolveProjects(config, project);

        if (opts.list) {
          const commands = p.commands ?? {};
          const names = Object.keys(commands);
          if (names.length === 0) {
            printError(`No custom commands configured for "${p.name}".`);
            process.exit(1);
          }
          console.log(`Custom commands for ${p.name}:`);
          for (const [name, cmd] of Object.entries(commands)) {
            console.log(`  ${name.padEnd(16)} ${cmd}`);
          }
          return;
        }

        if (!commandName) {
          printError(
            "Specify a command name or use --list to see available commands.",
          );
          process.exit(1);
        }

        const commands = p.commands ?? {};
        if (!(commandName in commands)) {
          const available = Object.keys(commands);
          printError(
            available.length > 0
              ? `Command "${commandName}" not found for "${p.name}". Available: ${available.join(", ")}`
              : `No custom commands configured for "${p.name}".`,
          );
          process.exit(1);
        }

        const svc = new CommandService();
        const done = svc.execute(p, commandName, workspaceRoot);

        const { waitUntilExit } = render(
          React.createElement(BuildOutput, {
            projectName: p.name,
            command: `exec: ${commandName}`,
            emitter: svc.emitter,
            done,
          }),
        );
        await waitUntilExit();

        const result = await done;
        if (!result.success) process.exit(1);
        printSuccess(`Command "${commandName}" completed successfully.`);
      },
    );
}
