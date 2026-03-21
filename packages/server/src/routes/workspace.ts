import { Hono } from "hono";
import type { ServerContext } from "../services/context.js";

interface StatusCache {
  data: unknown[];
  expiresAt: number;
}

export function createWorkspaceRoutes(ctx: ServerContext) {
  const app = new Hono();

  // Per-context status cache — avoids global mutable state
  let statusCache: StatusCache | null = null;

  // Bust cache on status:changed SSE events
  const origBroadcast = ctx.broadcast;
  ctx.broadcast = (event) => {
    if (event.type === "status:changed") statusCache = null;
    origBroadcast(event);
  };

  // GET /workspace
  app.get("/workspace", (c) => {
    return c.json({
      name: ctx.config.workspace.name,
      root: ctx.workspaceRoot,
      projectCount: ctx.config.projects.length,
    });
  });

  // GET /projects — with 10s cached status
  app.get("/projects", async (c) => {
    const now = Date.now();
    if (statusCache && now < statusCache.expiresAt) {
      return c.json(statusCache.data);
    }

    const statuses = await ctx.bulkGitService.statusAll(ctx.config.projects);
    const statusMap = new Map(statuses.map((s) => [s.projectName, s]));

    const result = ctx.config.projects.map((p) => ({
      ...p,
      status: statusMap.get(p.name) ?? null,
    }));

    statusCache = { data: result, expiresAt: now + 10_000 };
    return c.json(result);
  });

  // GET /projects/:name
  app.get("/projects/:name", async (c) => {
    const name = c.req.param("name");
    const project = ctx.config.projects.find((p) => p.name === name);
    if (!project) return c.json({ error: `Project "${name}" not found`, code: "NOT_FOUND" }, 404);

    const [status] = await ctx.bulkGitService.statusAll([project]);
    return c.json({ ...project, status: status ?? null });
  });

  // GET /projects/:name/status — fresh (no cache)
  app.get("/projects/:name/status", async (c) => {
    const name = c.req.param("name");
    const project = ctx.config.projects.find((p) => p.name === name);
    if (!project) return c.json({ error: `Project "${name}" not found`, code: "NOT_FOUND" }, 404);

    const [status] = await ctx.bulkGitService.statusAll([project]);
    return c.json(status ?? null);
  });

  return app;
}
