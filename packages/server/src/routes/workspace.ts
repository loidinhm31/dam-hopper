import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../context.js";
import {
  readGlobalConfig,
  writeGlobalConfig,
  listKnownWorkspaces,
  addKnownWorkspace,
  removeKnownWorkspace,
  findConfigFile,
  readConfig,
  discoverProjects,
  writeConfig,
} from "@dev-hub/core";
import { resolve, basename, join } from "node:path";
import { homedir } from "node:os";
import { stat } from "node:fs/promises";

export function registerWorkspaceRoutes(
  app: FastifyInstance,
  ctx: ServerContext,
): void {
  // GET /api/workspace/status
  app.get("/api/workspace/status", async (_req, reply) => {
    if (!ctx.current) return reply.send({ ready: false });
    return reply.send({
      ready: true,
      name: ctx.current.config.workspace.name,
      root: ctx.current.workspaceRoot,
    });
  });

  // GET /api/workspace
  app.get("/api/workspace", async (_req, reply) => {
    if (!ctx.current) return reply.status(400).send({ error: "No workspace loaded" });
    const c = ctx.current;
    return reply.send({
      name: c.config.workspace.name,
      root: c.workspaceRoot,
      projectCount: c.config.projects.length,
    });
  });

  // POST /api/workspace/init — load workspace from path
  app.post<{ Body: { path?: string } }>("/api/workspace/init", async (request, reply) => {
    const wsPath = request.body?.path;
    if (!wsPath || typeof wsPath !== "string") {
      return reply.status(400).send({ error: "path is required" });
    }
    const abs = resolve(wsPath);
    const home = homedir();
    if (abs !== home && !abs.startsWith(home + "/")) {
      return reply.status(400).send({ error: "Workspace path must be within home directory" });
    }
    try {
      await ctx.loadWorkspace(abs);
      return reply.send({
        name: ctx.current!.config.workspace.name,
        root: ctx.current!.workspaceRoot,
      });
    } catch (e) {
      return reply.status(500).send({ error: String(e) });
    }
  });

  // POST /api/workspace/switch
  app.post<{ Body: { path?: string } }>("/api/workspace/switch", async (request, reply) => {
    const wsPath = request.body?.path;
    if (!wsPath || typeof wsPath !== "string") {
      return reply.status(400).send({ error: "path is required" });
    }
    const abs = resolve(wsPath);
    const home = homedir();
    if (abs !== home && !abs.startsWith(home + "/")) {
      return reply.status(400).send({ error: "path must be within home directory" });
    }
    try {
      await ctx.switchWorkspace(abs);
      return reply.send({
        name: ctx.current!.config.workspace.name,
        root: ctx.current!.workspaceRoot,
        projectCount: ctx.current!.config.projects.length,
      });
    } catch (e) {
      return reply.status(500).send({ error: String(e) });
    }
  });

  // GET /api/workspace/known
  app.get("/api/workspace/known", async (_req, reply) => {
    const workspaces = await listKnownWorkspaces();
    return reply.send({ workspaces, current: ctx.current?.workspaceRoot ?? null });
  });

  // POST /api/workspace/known — add known workspace
  app.post<{ Body: { path?: string } }>("/api/workspace/known", async (request, reply) => {
    const wsPath = request.body?.path;
    if (!wsPath) return reply.status(400).send({ error: "path is required" });
    const abs = resolve(wsPath);
    const home = homedir();
    if (abs !== home && !abs.startsWith(home + "/")) {
      return reply.status(400).send({ error: "path must be within home directory" });
    }
    const s = await stat(abs).catch(() => null);
    if (!s) return reply.status(400).send({ error: `Path not found: ${abs}` });
    if (!s.isDirectory()) return reply.status(400).send({ error: "path must be a directory" });

    let configPath = await findConfigFile(abs);
    let workspaceName: string;
    if (!configPath) {
      const discovered = await discoverProjects(abs);
      workspaceName = basename(abs);
      const newConfig = {
        workspace: { name: workspaceName, root: "." },
        projects: discovered.map((p) => ({
          name: p.name, path: p.path, type: p.type,
          services: undefined, commands: undefined, terminals: [],
          envFile: undefined, tags: undefined, agents: undefined,
        })),
      };
      const tomlPath = join(abs, "dev-hub.toml");
      await writeConfig(tomlPath, newConfig);
      configPath = tomlPath;
    } else {
      const existing = await readConfig(configPath);
      workspaceName = existing.workspace.name;
    }
    await addKnownWorkspace(workspaceName, abs);
    return reply.send({ name: workspaceName, path: abs });
  });

  // DELETE /api/workspace/known
  app.delete<{ Body: { path?: string } }>("/api/workspace/known", async (request, reply) => {
    const wsPath = request.body?.path;
    if (!wsPath) return reply.status(400).send({ error: "path is required" });
    await removeKnownWorkspace(resolve(wsPath));
    return reply.send({ removed: true });
  });

  // GET /api/global-config
  app.get("/api/global-config", async (_req, reply) => {
    return reply.send((await readGlobalConfig()) ?? {});
  });

  // POST /api/global-config/defaults
  app.post<{ Body: { defaults?: { workspace?: string } } }>(
    "/api/global-config/defaults",
    async (request, reply) => {
      const defaults = request.body?.defaults;
      if (!defaults) return reply.status(400).send({ error: "defaults is required" });
      const cfg = (await readGlobalConfig()) ?? {};
      await writeGlobalConfig({ ...cfg, defaults: { ...cfg.defaults, ...defaults } });
      return reply.send({ updated: true });
    },
  );

  // GET /api/projects
  app.get("/api/projects", async (_req, reply) => {
    if (!ctx.current) return reply.status(400).send({ error: "No workspace loaded" });
    const c = ctx.current;
    const statuses = await c.bulkGitService.statusAll(c.config.projects);
    const statusMap = new Map(statuses.map((s) => [s.projectName, s]));
    return reply.send(
      c.config.projects.map((p) => ({ ...p, status: statusMap.get(p.name) ?? null })),
    );
  });

  // GET /api/projects/:name
  app.get<{ Params: { name: string } }>("/api/projects/:name", async (request, reply) => {
    if (!ctx.current) return reply.status(400).send({ error: "No workspace loaded" });
    const c = ctx.current;
    const project = c.config.projects.find((p) => p.name === request.params.name);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    const [status] = await c.bulkGitService.statusAll([project]);
    return reply.send({ ...project, status: status ?? null });
  });

  // GET /api/projects/:name/status
  app.get<{ Params: { name: string } }>("/api/projects/:name/status", async (request, reply) => {
    if (!ctx.current) return reply.status(400).send({ error: "No workspace loaded" });
    const c = ctx.current;
    const project = c.config.projects.find((p) => p.name === request.params.name);
    if (!project) return reply.status(404).send({ error: "Project not found" });
    const [status] = await c.bulkGitService.statusAll([project]);
    return reply.send(status ?? null);
  });
}
