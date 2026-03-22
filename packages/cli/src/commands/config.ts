import type { Command } from "commander";
import { resolve } from "node:path";
import { globalConfigPath, writeGlobalConfig, readGlobalConfig } from "@dev-hub/core";

export function registerConfig(program: Command): void {
  const configCmd = program
    .command("config")
    .description("Manage dev-hub global configuration");

  const setCmd = configCmd
    .command("set")
    .description("Set a global config value");

  setCmd
    .command("workspace <path>")
    .description(
      "Set the default workspace path in ~/.config/dev-hub/config.toml",
    )
    .action(async (workspacePath: string) => {
      const absPath = resolve(workspacePath);
      const existing = (await readGlobalConfig()) ?? {};
      await writeGlobalConfig({
        ...existing,
        defaults: { ...existing.defaults, workspace: absPath },
      });
      console.log(
        `Global workspace set to: ${absPath}\n  (${globalConfigPath()})`,
      );
    });

  configCmd
    .command("get")
    .description("Show current global config")
    .action(async () => {
      const cfg = await readGlobalConfig();
      if (!cfg) {
        console.log(`No global config found at: ${globalConfigPath()}`);
        return;
      }
      if (cfg.defaults?.workspace) {
        console.log(`defaults.workspace = ${cfg.defaults.workspace}`);
      } else {
        console.log("Global config exists but no defaults.workspace set.");
      }
    });
}
