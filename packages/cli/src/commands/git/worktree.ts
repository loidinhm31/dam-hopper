import type { Command } from "commander";
import { listWorktrees, addWorktree, removeWorktree } from "@dev-hub/core";
import { loadWorkspace, resolveProjects } from "../../utils/workspace.js";
import { printSuccess, printError } from "../../utils/format.js";
import type { GlobalOptions } from "../../utils/types.js";

export function registerWorktree(gitCmd: Command): void {
  const worktreeCmd = gitCmd
    .command("worktree")
    .description("Manage git worktrees");

  worktreeCmd
    .command("list [project]")
    .description("List worktrees for a project or all projects")
    .action(async (project: string | undefined, _opts: Record<string, unknown>, cmd: Command) => {
      const { workspace } = cmd.optsWithGlobals<GlobalOptions>();
      const { config } = await loadWorkspace(workspace);
      const projects = resolveProjects(config, project);

      for (const p of projects) {
        const worktrees = await listWorktrees(p.path).catch((err: Error) => {
          printError(`${p.name}: ${err.message}`);
          return [];
        });
        if (worktrees.length === 0) continue;

        console.log(`\n${p.name}:`);
        for (const wt of worktrees) {
          const flags = [wt.isMain ? "main" : "", wt.isLocked ? "locked" : ""]
            .filter(Boolean)
            .join(", ");
          console.log(
            `  ${wt.path}  [${wt.branch}]${flags ? `  (${flags})` : ""}`,
          );
        }
      }
    });

  worktreeCmd
    .command("add <project> <branch>")
    .description("Add a worktree for a project")
    .option("--create", "Create the branch if it doesn't exist")
    .option("--base <branch>", "Base branch for new branch creation")
    .option("--path <path>", "Custom worktree directory path")
    .action(async (project: string, branch: string, opts: { create?: boolean; base?: string; path?: string }, cmd: Command) => {
      const { workspace } = cmd.optsWithGlobals<GlobalOptions>();
      const { config } = await loadWorkspace(workspace);
      const [p] = resolveProjects(config, project);

      const worktree = await addWorktree(p.path, {
        branch,
        createBranch: opts.create ?? false,
        baseBranch: opts.base,
        path: opts.path,
      }).catch((err: Error) => {
        printError(err.message);
        process.exit(1);
      });

      printSuccess(`Worktree created: ${worktree.path}  [${worktree.branch}]`);
    });

  worktreeCmd
    .command("remove <project> <path>")
    .description("Remove a worktree")
    .action(async (project: string, wtPath: string, _opts: Record<string, unknown>, cmd: Command) => {
      const { workspace } = cmd.optsWithGlobals<GlobalOptions>();
      const { config } = await loadWorkspace(workspace);
      const [p] = resolveProjects(config, project);

      await removeWorktree(p.path, wtPath).catch((err: Error) => {
        printError(err.message);
        process.exit(1);
      });

      printSuccess(`Worktree removed: ${wtPath}`);
    });
}
