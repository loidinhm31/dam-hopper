import { Hono } from "hono";
import type { ProjectConfig } from "@dev-hub/core";
import type { ServerContext } from "../services/context.js";

function findProject(
  ctx: ServerContext,
  name: string,
): ProjectConfig | undefined {
  return ctx.config.projects.find((p) => p.name === name);
}

export function createProcessRoutes(ctx: ServerContext) {
  const app = new Hono();

  // GET /processes
  app.get("/processes", (c) => {
    return c.json(ctx.runService.getAllProcesses());
  });

  // POST /run/:project
  // Optional JSON body: { service?: string }
  app.post("/run/:project", async (c) => {
    const name = c.req.param("project");
    const project = findProject(ctx, name);
    if (!project)
      return c.json(
        { error: `Project "${name}" not found`, code: "NOT_FOUND" },
        404,
      );

    const body = await c.req.json<{ service?: string }>().catch(() => ({}));
    const service = body?.service;

    try {
      const process = await ctx.runService.start(
        project,
        ctx.workspaceRoot,
        service,
      );
      return c.json(process, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg, code: "PROCESS_CONFLICT" }, 409);
    }
  });

  // DELETE /run/:project
  // Optional query param: ?service=<name>
  app.delete("/run/:project", async (c) => {
    const name = c.req.param("project");
    const project = findProject(ctx, name);
    if (!project)
      return c.json(
        { error: `Project "${name}" not found`, code: "NOT_FOUND" },
        404,
      );

    const service = c.req.query("service");
    await ctx.runService.stop(name, service);
    return new Response(null, { status: 204 });
  });

  // POST /run/:project/restart
  // Optional JSON body: { service?: string }
  app.post("/run/:project/restart", async (c) => {
    const name = c.req.param("project");
    if (!findProject(ctx, name))
      return c.json(
        { error: `Project "${name}" not found`, code: "NOT_FOUND" },
        404,
      );

    const body = await c.req.json<{ service?: string }>().catch(() => ({}));
    const service = body?.service;
    try {
      const process = await ctx.runService.restart(name, service);
      return c.json(process);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg, code: "NOT_FOUND" }, 404);
    }
  });

  // GET /run/:project/logs
  // Optional query param: ?service=<name>&lines=<n>
  app.get("/run/:project/logs", (c) => {
    const name = c.req.param("project");
    if (!findProject(ctx, name))
      return c.json(
        { error: `Project "${name}" not found`, code: "NOT_FOUND" },
        404,
      );

    const service = c.req.query("service");
    const lines = c.req.query("lines");
    const parsed = lines ? parseInt(lines, 10) : 100;
    const count = Number.isNaN(parsed)
      ? 100
      : Math.min(Math.max(parsed, 1), 10_000);

    const logs = service
      ? ctx.runService.getServiceLogs(name, service, count)
      : ctx.runService.getLogs(name, count);
    return c.json(logs);
  });

  // POST /exec/:project
  // Body: { command: string }
  app.post("/exec/:project", async (c) => {
    const name = c.req.param("project");
    const project = findProject(ctx, name);
    if (!project)
      return c.json(
        { error: `Project "${name}" not found`, code: "NOT_FOUND" },
        404,
      );

    const body = await c.req.json<{ command?: string }>().catch(() => ({}));
    const command = body?.command;
    if (!command)
      return c.json(
        { error: "Request body must include 'command'", code: "BAD_REQUEST" },
        400,
      );

    const result = await ctx.commandService.execute(
      project,
      command,
      ctx.workspaceRoot,
    );
    return c.json(result);
  });

  return app;
}
