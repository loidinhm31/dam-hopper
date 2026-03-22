import { Hono } from "hono";
import type { ServerContext } from "../services/context.js";

export function createBuildRoutes(ctx: ServerContext) {
  const app = new Hono();

  // Per-context in-progress build tracking (not module-global)
  const inProgressBuilds = new Set<string>();

  // POST /build/:project
  // Optional JSON body: { service?: string }
  // Returns BuildResult[] — single element if service specified, all services otherwise.
  app.post("/build/:project", async (c) => {
    const name = c.req.param("project");
    const project = ctx.config.projects.find((p) => p.name === name);
    if (!project)
      return c.json(
        { error: `Project "${name}" not found`, code: "NOT_FOUND" },
        404,
      );

    const body = await c.req.json<{ service?: string }>().catch(() => ({}));
    const service = body?.service;
    // Track per "project:service" when a specific service is targeted, else per "project"
    const trackKey = service ? `${name}:${service}` : name;

    if (inProgressBuilds.has(trackKey)) {
      return c.json(
        {
          error: `Build already in progress for "${trackKey}"`,
          code: "BUILD_CONFLICT",
        },
        409,
      );
    }

    inProgressBuilds.add(trackKey);
    try {
      if (service) {
        const result = await ctx.buildService.build(
          project,
          ctx.workspaceRoot,
          service,
        );
        return c.json([result]);
      }
      const results = await ctx.buildService.buildAll(
        project,
        ctx.workspaceRoot,
      );
      return c.json(results);
    } finally {
      inProgressBuilds.delete(trackKey);
    }
  });

  return app;
}
