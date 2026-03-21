import type { Command } from "commander";
import { printSuccess, printError } from "../utils/format.js";

export function registerUi(program: Command): void {
  program
    .command("ui")
    .description("Start the web dashboard and open it in the browser")
    .option("--port <port>", "Port to listen on", "4800")
    .action(async (opts: { port: string }) => {
      const port = parseInt(opts.port, 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        printError(`Invalid port: ${opts.port}. Must be 1–65535.`);
        process.exit(1);
      }

      // Dynamic import so the server package is optional at runtime
      let startServer: ((port: number) => Promise<void>) | undefined;
      try {
        const serverMod = await import("@dev-hub/server");
        startServer = serverMod.startServer;
      } catch {
        printError(
          "@dev-hub/server is not available. Build the server package first.",
        );
        process.exit(1);
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

      await startServer(port);
    });
}
