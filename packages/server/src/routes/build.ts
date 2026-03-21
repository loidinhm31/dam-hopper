import { Hono } from "hono";
import type { ServerContext } from "../services/context.js";

export function createBuildRoutes(ctx: ServerContext) {
  const app = new Hono();

  // Per-context in-progress build tracking (not module-global)
  const inProgressBuilds = new Set<string>();

  // POST /build/:project
  app.post("/build/:project", async (c) => {
    const name = c.req.param("project");
    const project = ctx.config.projects.find((p) => p.name === name);
    if (!project) return c.json({ error: `Project "${name}" not found`, code: "NOT_FOUND" }, 404);

    if (inProgressBuilds.has(name)) {
      return c.json({ error: `Build already in progress for "${name}"`, code: "BUILD_CONFLICT" }, 409);
    }

    inProgressBuilds.add(name);
    try {
      const result = await ctx.buildService.build(project, ctx.workspaceRoot);
      return c.json(result);
    } finally {
      inProgressBuilds.delete(name);
    }
  });

  return app;
}
