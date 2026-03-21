import { Command } from "commander";
import { VERSION } from "@dev-hub/core";
import { registerInit } from "./commands/init.js";
import { registerStatus } from "./commands/status.js";
import { registerBuild } from "./commands/build.js";
import { registerRun } from "./commands/run.js"; // resolves run.tsx
import { registerUi } from "./commands/ui.js";
import { registerFetch } from "./commands/git/fetch.js";
import { registerPull } from "./commands/git/pull.js";
import { registerPush } from "./commands/git/push.js";
import { registerWorktree } from "./commands/git/worktree.js";
import { registerBranch } from "./commands/git/branch.js";

const program = new Command();

program
  .name("dev-hub")
  .description("Workspace management CLI for multi-project development environments")
  .version(VERSION);

// Top-level commands
registerInit(program);
registerStatus(program);
registerBuild(program);
registerRun(program);
registerUi(program);

// git subcommand group
const gitCmd = program
  .command("git")
  .description("Git operations across workspace projects");

registerFetch(gitCmd);
registerPull(gitCmd);
registerPush(gitCmd);
registerWorktree(gitCmd);
registerBranch(gitCmd);

// Centralized unhandled rejection handler
process.on("unhandledRejection", (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${msg}`);
  process.exit(1);
});

program.parse(process.argv);
