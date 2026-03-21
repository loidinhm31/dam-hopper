import { Hono } from "hono";
import type { ProjectConfig } from "@dev-hub/core";
import type { ServerContext } from "../services/context.js";

function findProject(ctx: ServerContext, name: string): ProjectConfig | undefined {
  return ctx.config.projects.find((p) => p.name === name);
}

export function createProcessRoutes(ctx: ServerContext) {
  const app = new Hono();

  // GET /processes
  app.get("/processes", (c) => {
    return c.json(ctx.runService.getAllProcesses());
  });

  // POST /run/:project
  app.post("/run/:project", async (c) => {
    const name = c.req.param("project");
    const project = findProject(ctx, name);
    if (!project) return c.json({ error: `Project "${name}" not found`, code: "NOT_FOUND" }, 404);

    try {
      const process = await ctx.runService.start(project, ctx.workspaceRoot);
      return c.json(process, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg, code: "PROCESS_CONFLICT" }, 409);
    }
  });

  // DELETE /run/:project
  app.delete("/run/:project", async (c) => {
    const name = c.req.param("project");
    await ctx.runService.stop(name);
    return new Response(null, { status: 204 });
  });

  // POST /run/:project/restart
  app.post("/run/:project/restart", async (c) => {
    const name = c.req.param("project");
    try {
      const process = await ctx.runService.restart(name);
      return c.json(process);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg, code: "NOT_FOUND" }, 404);
    }
  });

  // GET /run/:project/logs
  app.get("/run/:project/logs", (c) => {
    const name = c.req.param("project");
    const lines = c.req.query("lines");
    const parsed = lines ? parseInt(lines, 10) : 100;
    const count = Number.isNaN(parsed) ? 100 : Math.min(Math.max(parsed, 1), 10_000);
    const logs = ctx.runService.getLogs(name, count);
    return c.json(logs);
  });

  return app;
}
