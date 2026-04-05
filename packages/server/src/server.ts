import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fastifyWebSocket from "@fastify/websocket";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import type { ServerContext } from "./context.js";
import { registerAuthMiddleware } from "./auth/middleware.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerWorkspaceRoutes } from "./routes/workspace.js";
import { registerGitRoutes } from "./routes/git.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerTerminalRoutes } from "./routes/terminal.js";
import { registerAgentStoreRoutes } from "./routes/agent-store.js";
import { registerCommandRoutes } from "./routes/commands.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerWsHandler } from "./ws/handler.js";

/** Resolve the @dev-hub/web dist directory for static file serving. */
function resolveWebDist(): string | null {
  // Check common locations relative to this package
  const candidates = [
    resolve(import.meta.url.replace("file://", ""), "../../web/dist"),
    resolve(process.cwd(), "packages/web/dist"),
  ];

  // Try to resolve via require if available
  try {
    const req = createRequire(import.meta.url);
    const webPkg = req.resolve("@dev-hub/web/package.json");
    candidates.unshift(join(webPkg, "../dist"));
  } catch {
    // @dev-hub/web not in node_modules — monorepo mode
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export interface ServerOptions {
  host: string;
  port: number;
  ctx: ServerContext;
  getToken: () => string;
}

export async function createServer(opts: ServerOptions) {
  const app = Fastify({ logger: false });

  // ── Plugins ──────────────────────────────────────────────────────────────────

  await app.register(fastifyCookie);

  await app.register(fastifyCors, {
    // Only serve our own origin — no cross-origin requests
    origin: false,
  });

  await app.register(fastifyRateLimit, {
    global: false, // apply only where explicitly configured
    max: 200,
    timeWindow: "1 minute",
  });

  await app.register(fastifyWebSocket);

  // ── Static file serving ───────────────────────────────────────────────────────

  const webDist = resolveWebDist();
  if (webDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      index: ["index.html"], // serve index.html for root/directory requests
      decorateReply: true,   // required so reply.sendFile() is available
    });

    // SPA fallback: serve index.html for all non-API routes
    app.setNotFoundHandler(async (request, reply) => {
      if (!request.url.startsWith("/api/") && !request.url.startsWith("/ws")) {
        return reply.sendFile("index.html", webDist);
      }
      return reply.status(404).send({ error: "Not found" });
    });
  } else {
    console.warn("[server] ⚠ @dev-hub/web dist not found — UI not served. Run: pnpm build:web");
    app.setNotFoundHandler(async (_request, reply) => {
      return reply.status(404).send({ error: "Not found" });
    });
  }

  // ── Health check (public) ─────────────────────────────────────────────────────

  app.get("/api/health", async (_req, reply) => {
    return reply.send({ ok: true, version: "0.1.0" });
  });

  // ── Auth middleware + routes ──────────────────────────────────────────────────

  registerAuthMiddleware(app, opts.getToken);
  registerAuthRoutes(app, opts.getToken);

  // ── API routes ────────────────────────────────────────────────────────────────

  registerWorkspaceRoutes(app, opts.ctx);
  registerGitRoutes(app, opts.ctx);
  registerConfigRoutes(app, opts.ctx);
  registerTerminalRoutes(app, opts.ctx);
  registerAgentStoreRoutes(app, opts.ctx);
  registerCommandRoutes(app);
  registerSettingsRoutes(app, opts.ctx);

  // ── WebSocket ─────────────────────────────────────────────────────────────────

  registerWsHandler(app, opts.ctx.ptyManager, opts.ctx.wsSink, opts.getToken);

  return app;
}
