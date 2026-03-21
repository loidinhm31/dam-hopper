import { serve } from "@hono/node-server";
import { createApp, createServerContext } from "./app.js";

export interface StartServerOptions {
  port?: number;
  configPath?: string;
}

export async function startServer(options: StartServerOptions = {}): Promise<void> {
  const port = options.port ?? 4800;

  const ctx = await createServerContext(options.configPath);
  const app = createApp(ctx);

  const server = serve({ fetch: app.fetch, port }, () => {
    console.log(`Dev-Hub server running on http://localhost:${port}`);
  });

  // Graceful shutdown
  async function shutdown() {
    await ctx.runService.stopAll();
    server.close();
  }

  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
}

// Only start when executed directly
if (import.meta.url === new URL(process.argv[1], "file://").href) {
  const PORT = Number(process.env.PORT ?? 4800);
  const CONFIG = process.env.DEV_HUB_CONFIG;
  await startServer({ port: PORT, configPath: CONFIG });
}

export { createApp, createServerContext };
export type { AppType } from "./app.js";
// SSEEvent exported for web package consumers; SSEClient/ServerContext are server-internal
export type { SSEEvent } from "./types.js";
