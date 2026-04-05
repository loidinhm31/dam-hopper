import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../context.js";
import {
  gitPush,
  listWorktrees,
  addWorktree,
  removeWorktree,
  listBranches,
  updateBranch,
  updateAllBranches,
  type WorktreeAddOptions,
  type ProjectConfig,
} from "@dev-hub/core";
import { resolve } from "node:path";

function validateProjectPath(project: ProjectConfig, workspaceRoot: string): void {
  const root = workspaceRoot.endsWith("/") ? workspaceRoot : workspaceRoot + "/";
  const resolved = resolve(workspaceRoot, project.path);
  if (resolved !== workspaceRoot && !resolved.startsWith(root)) {
    throw new Error(`Project "${project.name}" path escapes workspace root: ${project.path}`);
  }
}

export function registerGitRoutes(app: FastifyInstance, ctx: ServerContext): void {
  function getCtx() {
    if (!ctx.current) throw new Error("No workspace loaded");
    return ctx.current;
  }

  const inProgress = new Set<string>();
  function guard<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (inProgress.has(key)) {
      throw Object.assign(new Error(`Operation already in progress: "${key}"`), { code: "CONFLICT" });
    }
    inProgress.add(key);
    return fn().finally(() => inProgress.delete(key));
  }

  // POST /api/git/fetch
  app.post<{ Body: { projects?: string[] } }>("/api/git/fetch", async (request, reply) => {
    try {
      const c = getCtx();
      const projects = request.body?.projects?.length
        ? c.config.projects.filter((p) => request.body.projects!.includes(p.name))
        : c.config.projects;
      const result = await guard("fetch", () => c.bulkGitService.fetchAll(projects));
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ error: String(e) });
    }
  });

  // POST /api/git/pull
  app.post<{ Body: { projects?: string[] } }>("/api/git/pull", async (request, reply) => {
    try {
      const c = getCtx();
      const projects = request.body?.projects?.length
        ? c.config.projects.filter((p) => request.body.projects!.includes(p.name))
        : c.config.projects;
      const result = await guard("pull", () => c.bulkGitService.pullAll(projects));
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ error: String(e) });
    }
  });

  // POST /api/git/push
  app.post<{ Body: { project?: string } }>("/api/git/push", async (request, reply) => {
    try {
      const c = getCtx();
      const projectName = request.body?.project;
      if (!projectName) return reply.status(400).send({ error: "project is required" });
      const project = c.config.projects.find((p) => p.name === projectName);
      if (!project) return reply.status(404).send({ error: `Project "${projectName}" not found` });
      validateProjectPath(project, c.workspaceRoot);
      const result = await guard(`push:${projectName}`, () =>
        gitPush(project.path, project.name, c.bulkGitService.emitter),
      );
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ error: String(e) });
    }
  });

  // GET /api/git/:project/worktrees
  app.get<{ Params: { project: string } }>("/api/git/:project/worktrees", async (request, reply) => {
    try {
      const c = getCtx();
      const project = c.config.projects.find((p) => p.name === request.params.project);
      if (!project) return reply.status(404).send({ error: "Project not found" });
      validateProjectPath(project, c.workspaceRoot);
      return reply.send(await listWorktrees(project.path));
    } catch (e) {
      return reply.status(500).send({ error: String(e) });
    }
  });

  // POST /api/git/:project/worktrees
  app.post<{ Params: { project: string }; Body: WorktreeAddOptions }>(
    "/api/git/:project/worktrees",
    async (request, reply) => {
      try {
        const c = getCtx();
        const project = c.config.projects.find((p) => p.name === request.params.project);
        if (!project) return reply.status(404).send({ error: "Project not found" });
        validateProjectPath(project, c.workspaceRoot);
        return reply.send(await addWorktree(project.path, request.body));
      } catch (e) {
        return reply.status(500).send({ error: String(e) });
      }
    },
  );

  // DELETE /api/git/:project/worktrees
  app.delete<{ Params: { project: string }; Body: { path: string } }>(
    "/api/git/:project/worktrees",
    async (request, reply) => {
      try {
        const c = getCtx();
        const project = c.config.projects.find((p) => p.name === request.params.project);
        if (!project) return reply.status(404).send({ error: "Project not found" });
        validateProjectPath(project, c.workspaceRoot);
        await removeWorktree(project.path, request.body.path);
        return reply.send({ removed: true });
      } catch (e) {
        return reply.status(500).send({ error: String(e) });
      }
    },
  );

  // GET /api/git/:project/branches
  app.get<{ Params: { project: string } }>("/api/git/:project/branches", async (request, reply) => {
    try {
      const c = getCtx();
      const project = c.config.projects.find((p) => p.name === request.params.project);
      if (!project) return reply.status(404).send({ error: "Project not found" });
      validateProjectPath(project, c.workspaceRoot);
      return reply.send(await listBranches(project.path));
    } catch (e) {
      return reply.status(500).send({ error: String(e) });
    }
  });

  // POST /api/git/:project/branches/update
  app.post<{ Params: { project: string }; Body: { branch?: string } }>(
    "/api/git/:project/branches/update",
    async (request, reply) => {
      try {
        const c = getCtx();
        const projectName = request.params.project;
        const project = c.config.projects.find((p) => p.name === projectName);
        if (!project) return reply.status(404).send({ error: "Project not found" });
        validateProjectPath(project, c.workspaceRoot);
        const branch = request.body?.branch;
        const result = await guard(`updateBranch:${projectName}`, async () => {
          if (branch) {
            const r = await updateBranch(project.path, branch);
            return [r];
          }
          return updateAllBranches(project.path, c.bulkGitService.emitter);
        });
        return reply.send(result);
      } catch (e) {
        return reply.status(500).send({ error: String(e) });
      }
    },
  );
}
