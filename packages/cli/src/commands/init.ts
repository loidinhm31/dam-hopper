import { basename, resolve } from "node:path";
import * as p from "@clack/prompts";
import type { Command } from "commander";
import {
  discoverProjects,
  findConfigFile,
  writeConfig,
  type DevHubConfig,
  type ProjectConfig,
  type ProjectType,
} from "@dev-hub/core";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Interactive workspace setup — writes dev-hub.toml")
    .action(async () => {
      p.intro("dev-hub workspace setup");

      const cwd = process.cwd();

      // Check if config already exists
      const existing = await findConfigFile(cwd);
      if (existing) {
        const overwrite = await p.confirm({
          message: `dev-hub.toml already exists at ${existing}. Overwrite?`,
          initialValue: false,
        });
        if (p.isCancel(overwrite) || !overwrite) {
          p.outro("Aborted.");
          return;
        }
      }

      const name = await p.text({
        message: "Workspace name",
        placeholder: basename(cwd),
        defaultValue: basename(cwd),
      });
      if (p.isCancel(name)) { p.outro("Aborted."); return; }

      p.log.step("Scanning for projects...");
      const discovered = await discoverProjects(cwd);

      let selectedProjects: ProjectConfig[] = [];

      if (discovered.length === 0) {
        p.log.warn("No projects detected in current directory.");
      } else {
        const choices = discovered.map((d) => ({
          value: d.name,
          label: `${d.name} (${d.type})${d.isGitRepo ? "" : " — no git"}`,
        }));

        const selected = await p.multiselect({
          message: `Select projects to include (${discovered.length} found)`,
          options: choices,
          required: false,
        });
        if (p.isCancel(selected)) { p.outro("Aborted."); return; }

        selectedProjects = (selected as string[]).flatMap((selectedName) => {
          const d = discovered.find((x) => x.name === selectedName);
          if (!d) return [];
          return [{
            name: d.name,
            path: resolve(cwd, d.path),
            type: d.type as ProjectType,
          }];
        });
      }

      const confirm = await p.confirm({
        message: `Write dev-hub.toml to ${cwd}?`,
        initialValue: true,
      });
      if (p.isCancel(confirm) || !confirm) { p.outro("Aborted."); return; }

      const config: DevHubConfig = {
        workspace: { name: name as string, root: "." },
        projects: selectedProjects,
      };

      await writeConfig(resolve(cwd, "dev-hub.toml"), config);

      p.outro(
        `Workspace configured! Added ${selectedProjects.length} project(s). Run \`dev-hub status\` to verify.`,
      );
    });
}
