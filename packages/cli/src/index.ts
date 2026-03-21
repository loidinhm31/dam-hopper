import { Command } from "commander";
import { VERSION } from "@dev-hub/core";

const program = new Command();

program
  .name("dev-hub")
  .description("Workspace management CLI for multi-project development environments")
  .version(VERSION);

program.parse(process.argv);
