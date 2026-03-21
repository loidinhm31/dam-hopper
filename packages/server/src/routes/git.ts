import { Hono } from "hono";
import type { Context } from "hono";
import {
  gitPush,
  listWorktrees,
  addWorktree,
  removeWorktree,
  listBranches,
  updateBranch,
  updateAllBranches,
  type ProjectConfig,
  type WorktreeAddOptions,
} from "@dev-hub/core";
import type { ServerContext } from "../services/context.js";

function findProject(
  ctx: ServerContext,
  name: string,
): ProjectConfig | undefined {
  return ctx.config.projects.find((p) => p.name === name);
}

function notFound(c: Context, name: string) {
  return c.json({ error: `Project "${name}" not found` }, 404);
}

export function createGitRoutes(ctx: ServerContext) {
  const app = new Hono();

  function resolveProjects(names?: string[]) {
    if (!names || names.length === 0) return ctx.config.projects;
    return ctx.config.projects.filter((p) => names.includes(p.name));
  }

  // POST /git/fetch
  app.post("/git/fetch", async (c) => {
    const body = await c.req.json<{ projects?: string[] }>().catch(() => ({}));
    const results = await ctx.bulkGitService.fetchAll(resolveProjects(body.projects));
    return c.json(results);
  });

  // POST /git/pull
  app.post("/git/pull", async (c) => {
    const body = await c.req.json<{ projects?: string[] }>().catch(() => ({}));
    const results = await ctx.bulkGitService.pullAll(resolveProjects(body.projects));
    return c.json(results);
  });

  // POST /git/push/:project
  app.post("/git/push/:project", async (c) => {
    const name = c.req.param("project");
    const project = findProject(ctx, name);
    if (!project) return notFound(c, name);
    const result = await gitPush(project.path, project.name, ctx.bulkGitService.emitter);
    return c.json(result);
  });

  // GET /git/worktrees/:project
  app.get("/git/worktrees/:project", async (c) => {
    const name = c.req.param("project");
    const project = findProject(ctx, name);
    if (!project) return notFound(c, name);
    const worktrees = await listWorktrees(project.path);
    return c.json(worktrees);
  });

  // POST /git/worktrees/:project
  app.post("/git/worktrees/:project", async (c) => {
    const name = c.req.param("project");
    const project = findProject(ctx, name);
    if (!project) return notFound(c, name);
    const body = await c.req.json<WorktreeAddOptions>().catch(() => null);
    if (!body) return c.json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
    const worktree = await addWorktree(project.path, body);
    return c.json(worktree, 201);
  });

  // DELETE /git/worktrees/:project
  app.delete("/git/worktrees/:project", async (c) => {
    const name = c.req.param("project");
    const project = findProject(ctx, name);
    if (!project) return notFound(c, name);
    const body = await c.req.json<{ path: string }>().catch(() => null);
    if (!body?.path) return c.json({ error: "Request body must include 'path'", code: "BAD_REQUEST" }, 400);
    await removeWorktree(project.path, body.path);
    return new Response(null, { status: 204 });
  });

  // GET /git/branches/:project
  app.get("/git/branches/:project", async (c) => {
    const name = c.req.param("project");
    const project = findProject(ctx, name);
    if (!project) return notFound(c, name);
    const branches = await listBranches(project.path);
    return c.json(branches);
  });

  // POST /git/branches/:project/update
  app.post("/git/branches/:project/update", async (c) => {
    const name = c.req.param("project");
    const project = findProject(ctx, name);
    if (!project) return notFound(c, name);
    const body = await c.req.json<{ branch?: string }>().catch(() => ({}));

    if (body.branch) {
      const result = await updateBranch(project.path, body.branch);
      return c.json([result]);
    }
    const results = await updateAllBranches(project.path, ctx.bulkGitService.emitter);
    return c.json(results);
  });

  return app;
}
