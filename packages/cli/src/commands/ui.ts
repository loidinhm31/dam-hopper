import type { Command } from "commander";
import { resolve } from "node:path";
import { printSuccess, printError } from "../utils/format.js";
import type { GlobalOptions } from "../utils/types.js";

export function registerUi(program: Command): void {
  program
    .command("ui")
    .description("Start the web dashboard and open it in the browser")
    .option("--port <port>", "Port to listen on", "4800")
    .action(async (opts: { port: string }, cmd: Command) => {
      const port = parseInt(opts.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        printError(`Invalid port: ${opts.port}. Must be 1–65535.`);
        process.exit(1);
      }

      // Forward workspace to server via env var before dynamic import
      const { workspace } = cmd.optsWithGlobals<GlobalOptions>();
      if (workspace) {
        process.env.DEV_HUB_WORKSPACE = resolve(workspace);
      }

      // Dynamic import so the server package is optional at runtime
      let serverMod: typeof import("@dev-hub/server");
      try {
        serverMod = await import("@dev-hub/server");
      } catch {
        printError(
          "@dev-hub/server is not available. Build the server package first.",
        );
        process.exit(1);
        return; // unreachable but narrows types
      }

      console.log(`Starting dev-hub server on port ${port}...`);

      // Open browser after short delay to let server start
      const { default: open } = await import("open");
      const url = `http://localhost:${port}`;

      setTimeout(() => {
        open(url).catch(() => {
          console.log(`Open your browser at: ${url}`);
        });
      }, 1000);

      printSuccess(`Dashboard available at ${url}`);
      console.log("Press Ctrl+C to stop the server.\n");

      await serverMod.startServer({ port });
    });
}
