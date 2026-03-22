import { Hono } from "hono";
import { resolve } from "node:path";
import { writeConfig, DevHubApiConfigSchema, ApiProjectSchema } from "@dev-hub/core";
import type { DevHubConfig, ProjectConfig } from "@dev-hub/core";
import type { ServerContext } from "../services/context.js";

/** Reject any project path that escapes the workspace root. */
function validateProjectPaths(
  projects: { name: string; path: string }[],
  workspaceRoot: string,
): string | null {
  // resolve() handles both relative and already-absolute paths correctly
  const root = workspaceRoot.endsWith("/") ? workspaceRoot : workspaceRoot + "/";
  for (const p of projects) {
    const resolved = resolve(workspaceRoot, p.path);
    if (resolved !== workspaceRoot && !resolved.startsWith(root)) {
      return `Project "${p.name}" path escapes workspace root: ${p.path}`;
    }
  }
  return null;
}

/** Simple async write-lock — serializes concurrent config mutations. */
function createWriteLock() {
  let chain = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = chain.then(fn);
    // absorb errors on the chain so a failed write doesn't block future writes
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export function createConfigRoutes(ctx: ServerContext) {
  const app = new Hono();
  const withLock = createWriteLock();

  // GET /config — return full workspace config
  app.get("/config", (c) => {
    return c.json(ctx.config);
  });

  // PUT /config — validate camelCase body, write atomically, reload, broadcast
  app.put("/config", (c) =>
    withLock(async () => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
      }

      const result = DevHubApiConfigSchema.safeParse(body);
      if (!result.success) {
        return c.json(
          {
            error: "Config validation failed",
            code: "VALIDATION_ERROR",
            issues: result.error.issues,
          },
          400,
        );
      }

      const pathError = validateProjectPaths(result.data.projects, ctx.workspaceRoot);
      if (pathError) {
        return c.json({ error: pathError, code: "INVALID_PATH" }, 400);
      }

      await writeConfig(ctx.configPath, result.data as DevHubConfig);
      await ctx.reloadConfig();
      ctx.broadcast({ type: "config:changed", data: {} });

      return c.json(ctx.config);
    }),
  );

  // PATCH /config/projects/:name — validate patch first, then merge, write, reload
  app.patch("/config/projects/:name", (c) =>
    withLock(async () => {
      const name = c.req.param("name");
      const projectIndex = ctx.config.projects.findIndex((p) => p.name === name);
      if (projectIndex === -1) {
        return c.json(
          { error: `Project "${name}" not found`, code: "NOT_FOUND" },
          404,
        );
      }

      let patch: unknown;
      try {
        patch = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
      }

      // Merge onto existing then validate the full result through Zod
      // (Zod strips unknown keys, so no prototype pollution via unknown fields)
      const existing = ctx.config.projects[projectIndex];
      const merged = { ...existing, ...(patch as object) };

      const projectResult = ApiProjectSchema.safeParse(merged);
      if (!projectResult.success) {
        return c.json(
          {
            error: "Project validation failed",
            code: "VALIDATION_ERROR",
            issues: projectResult.error.issues,
          },
          400,
        );
      }

      const pathError = validateProjectPaths([projectResult.data], ctx.workspaceRoot);
      if (pathError) {
        return c.json({ error: pathError, code: "INVALID_PATH" }, 400);
      }

      const updatedProjects: ProjectConfig[] = [
        ...ctx.config.projects.slice(0, projectIndex),
        projectResult.data as ProjectConfig,
        ...ctx.config.projects.slice(projectIndex + 1),
      ];

      const updatedConfig: DevHubConfig = { ...ctx.config, projects: updatedProjects };
      await writeConfig(ctx.configPath, updatedConfig);
      await ctx.reloadConfig();
      ctx.broadcast({ type: "config:changed", data: {} });

      return c.json(ctx.config.projects.find((p) => p.name === name));
    }),
  );

  return app;
}
