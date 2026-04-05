import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../context.js";
import {
  writeConfig,
  readConfig,
  DevHubApiConfigSchema,
  ApiProjectSchema,
  type DevHubConfig,
  type ProjectConfig,
} from "@dev-hub/core";
import { resolve } from "node:path";

function validateProjectPaths(
  projects: { name: string; path: string }[],
  workspaceRoot: string,
): string | null {
  const root = workspaceRoot.endsWith("/") ? workspaceRoot : workspaceRoot + "/";
  for (const p of projects) {
    const resolved = resolve(workspaceRoot, p.path);
    if (resolved !== workspaceRoot && !resolved.startsWith(root)) {
      return `Project "${p.name}" path escapes workspace root: ${p.path}`;
    }
  }
  return null;
}

function createWriteLock() {
  let chain = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = chain.then(fn);
    chain = result.then(() => undefined, () => undefined);
    return result;
  };
}

export function registerConfigRoutes(app: FastifyInstance, ctx: ServerContext): void {
  const withLock = createWriteLock();

  // GET /api/config
  app.get("/api/config", async (_req, reply) => {
    if (!ctx.current) return reply.status(400).send({ error: "No workspace loaded" });
    return reply.send(ctx.current.config);
  });

  // PUT /api/config
  app.put<{ Body: unknown }>("/api/config", async (request, reply) => {
    if (!ctx.current) return reply.status(400).send({ error: "No workspace loaded" });
    try {
      const result = await withLock(async () => {
        const c = ctx.current!;
        const parsed = DevHubApiConfigSchema.safeParse(request.body);
        if (!parsed.success) {
          throw Object.assign(new Error("Config validation failed"), {
            code: "VALIDATION_ERROR",
            issues: parsed.error.issues,
          });
        }
        const pathError = validateProjectPaths(parsed.data.projects, c.workspaceRoot);
        if (pathError) throw new Error(pathError);
        await writeConfig(c.configPath, parsed.data as DevHubConfig);
        c.config = await readConfig(c.configPath);
        ctx.sendEvent("config:changed", {});
        return c.config;
      });
      return reply.send(result);
    } catch (e) {
      return reply.status(400).send({ error: String(e) });
    }
  });

  // PATCH /api/config/projects/:name
  app.patch<{ Params: { name: string }; Body: Partial<ProjectConfig> }>(
    "/api/config/projects/:name",
    async (request, reply) => {
      if (!ctx.current) return reply.status(400).send({ error: "No workspace loaded" });
      try {
        const result = await withLock(async () => {
          const c = ctx.current!;
          const idx = c.config.projects.findIndex((p) => p.name === request.params.name);
          if (idx === -1) throw new Error(`Project "${request.params.name}" not found`);
          const merged = { ...c.config.projects[idx], ...(request.body as object) };
          const projectResult = ApiProjectSchema.safeParse(merged);
          if (!projectResult.success) {
            throw Object.assign(new Error("Project validation failed"), {
              issues: projectResult.error.issues,
            });
          }
          const pathError = validateProjectPaths([projectResult.data], c.workspaceRoot);
          if (pathError) throw new Error(pathError);
          const updatedProjects: ProjectConfig[] = [
            ...c.config.projects.slice(0, idx),
            projectResult.data as ProjectConfig,
            ...c.config.projects.slice(idx + 1),
          ];
          const updatedConfig: DevHubConfig = { ...c.config, projects: updatedProjects };
          await writeConfig(c.configPath, updatedConfig);
          c.config = await readConfig(c.configPath);
          ctx.sendEvent("config:changed", {});
          return c.config.projects.find((p) => p.name === request.params.name);
        });
        return reply.send(result);
      } catch (e) {
        return reply.status(400).send({ error: String(e) });
      }
    },
  );
}
