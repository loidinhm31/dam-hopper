import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { createServerContext, type ServerContext } from "./services/context.js";
import { onError } from "./middleware/error-handler.js";
import { createWorkspaceRoutes } from "./routes/workspace.js";
import { createGitRoutes } from "./routes/git.js";
import { createBuildRoutes } from "./routes/build.js";
import { createProcessRoutes } from "./routes/processes.js";
import { createEventsRoute } from "./routes/events.js";
import { createConfigRoutes } from "./routes/config.js";

// Resolve @dev-hub/web/dist relative to this package — works whether installed
// locally in a monorepo or globally via npm/pnpm link.
const _require = createRequire(import.meta.url);
const webDistPath = resolve(
  dirname(_require.resolve("@dev-hub/web/package.json")),
  "dist",
);

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
    .route("/", createEventsRoute(ctx))
    .route("/", createConfigRoutes(ctx));

  app.route("/api", api);

  // Static file serving for the web dashboard
  // Serve from @dev-hub/web/dist, resolved relative to this package — not CWD.
  app.use(
    "/*",
    serveStatic({
      root: webDistPath,
    }),
  );

  // SPA fallback — return index.html for non-API, non-file routes
  app.get("/*", serveStatic({ path: resolve(webDistPath, "index.html") }));

  return app;
}

// Re-export for Hono RPC type inference in the web package
export type AppType = ReturnType<typeof createApp>;

export { createServerContext };
