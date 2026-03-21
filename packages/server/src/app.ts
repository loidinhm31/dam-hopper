import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { createServerContext, type ServerContext } from "./services/context.js";
import { onError } from "./middleware/error-handler.js";
import { createWorkspaceRoutes } from "./routes/workspace.js";
import { createGitRoutes } from "./routes/git.js";
import { createBuildRoutes } from "./routes/build.js";
import { createProcessRoutes } from "./routes/processes.js";
import { createEventsRoute } from "./routes/events.js";

export function createApp(ctx: ServerContext) {
  const app = new Hono();

  // Global error handler (must use onError, not middleware, for Hono v4+)
  app.onError(onError);

  // API routes
  const api = new Hono()
    .route("/", createWorkspaceRoutes(ctx))
    .route("/", createGitRoutes(ctx))
    .route("/", createBuildRoutes(ctx))
    .route("/", createProcessRoutes(ctx))
    .route("/", createEventsRoute(ctx));

  app.route("/api", api);

  // Static file serving for the web dashboard
  // Serve from @dev-hub/web/dist, resolved relative to this package's node_modules
  app.use(
    "/*",
    serveStatic({
      root: "./node_modules/@dev-hub/web/dist",
    }),
  );

  // SPA fallback — return index.html for non-API, non-file routes
  app.get("/*", serveStatic({ path: "./node_modules/@dev-hub/web/dist/index.html" }));

  return app;
}

// Re-export for Hono RPC type inference in the web package
export type AppType = ReturnType<typeof createApp>;

export { createServerContext };
