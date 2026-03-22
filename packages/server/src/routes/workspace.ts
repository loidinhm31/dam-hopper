import { Hono } from "hono";
import { join, resolve, basename, sep } from "node:path";
import { homedir } from "node:os";
import { stat } from "node:fs/promises";
import {
  findConfigFile,
  readConfig,
  readGlobalConfig,
  writeGlobalConfig,
  listKnownWorkspaces,
  addKnownWorkspace,
  removeKnownWorkspace,
  discoverProjects,
  writeConfig,
  ConfigNotFoundError,
} from "@dev-hub/core";
import type { ServerContext } from "../services/context.js";

interface StatusCache {
  data: unknown[];
  expiresAt: number;
}

export function createWorkspaceRoutes(ctx: ServerContext) {
  const app = new Hono();

  // Per-context status cache — avoids global mutable state
  let statusCache: StatusCache | null = null;

  // Bust cache on status:changed and workspace:changed SSE events
  const origBroadcast = ctx.broadcast;
  ctx.broadcast = (event) => {
    if (event.type === "status:changed" || event.type === "workspace:changed") {
      statusCache = null;
    }
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
    if (!project)
      return c.json(
        { error: `Project "${name}" not found`, code: "NOT_FOUND" },
        404,
      );

    const [status] = await ctx.bulkGitService.statusAll([project]);
    return c.json({ ...project, status: status ?? null });
  });

  // GET /projects/:name/status — fresh (no cache)
  app.get("/projects/:name/status", async (c) => {
    const name = c.req.param("name");
    const project = ctx.config.projects.find((p) => p.name === name);
    if (!project)
      return c.json(
        { error: `Project "${name}" not found`, code: "NOT_FOUND" },
        404,
      );

    const [status] = await ctx.bulkGitService.statusAll([project]);
    return c.json(status ?? null);
  });

  // POST /workspace/switch
  app.post("/workspace/switch", async (c) => {
    const body = await c.req.json<{ path?: string }>();
    if (!body.path) {
      return c.json({ error: "path is required", code: "INVALID_INPUT" }, 400);
    }
    // Path traversal guard: must be within home directory
    const switchAbsPath = resolve(body.path);
    const home = homedir();
    if (switchAbsPath !== home && !switchAbsPath.startsWith(home + sep)) {
      return c.json(
        { error: "path must be within home directory", code: "INVALID_INPUT" },
        400,
      );
    }
    try {
      await ctx.switchWorkspace(body.path);
    } catch (e: unknown) {
      if (e instanceof ConfigNotFoundError) {
        return c.json({ error: e.message, code: "NOT_FOUND" }, 404);
      }
      throw e;
    }
    return c.json({
      name: ctx.config.workspace.name,
      root: ctx.workspaceRoot,
      projectCount: ctx.config.projects.length,
    });
  });

  // GET /workspace/known
  app.get("/workspace/known", async (c) => {
    const workspaces = await listKnownWorkspaces();
    return c.json({ workspaces, current: ctx.workspaceRoot });
  });

  // POST /workspace/known — add a workspace (auto-init if no dev-hub.toml)
  app.post("/workspace/known", async (c) => {
    const body = await c.req.json<{ path?: string }>();
    if (!body.path) {
      return c.json({ error: "path is required", code: "INVALID_INPUT" }, 400);
    }

    // Validate path: resolve, must be within home directory, must exist as a directory
    const absPath = resolve(body.path);
    const home = homedir();
    if (absPath !== home && !absPath.startsWith(home + sep)) {
      return c.json({ error: "path must be within home directory", code: "INVALID_INPUT" }, 400);
    }
    try {
      const s = await stat(absPath);
      if (!s.isDirectory()) {
        return c.json({ error: "path must be a directory", code: "INVALID_INPUT" }, 400);
      }
    } catch {
      return c.json({ error: `Path not found: ${absPath}`, code: "NOT_FOUND" }, 404);
    }

    // Check if dev-hub.toml exists; auto-init if not
    let configPath = await findConfigFile(absPath);
    let workspaceName: string;

    if (!configPath) {
      // Auto-init: discover projects and create config
      const discovered = await discoverProjects(absPath);
      workspaceName = basename(absPath);
      const newConfig = {
        workspace: { name: workspaceName, root: "." },
        projects: discovered.map((p) => ({
          name: p.name,
          path: p.path,
          type: p.type,
          services: undefined,
          commands: undefined,
          envFile: undefined,
          tags: undefined,
        })),
      };
      const tomlPath = join(absPath, "dev-hub.toml");
      await writeConfig(tomlPath, newConfig);
      configPath = tomlPath;
    } else {
      const existingConfig = await readConfig(configPath);
      workspaceName = existingConfig.workspace.name;
    }

    await addKnownWorkspace(workspaceName, absPath);
    return c.json({ name: workspaceName, path: absPath });
  });

  // DELETE /workspace/known
  app.delete("/workspace/known", async (c) => {
    const body = await c.req.json<{ path?: string }>();
    if (!body.path) {
      return c.json({ error: "path is required", code: "INVALID_INPUT" }, 400);
    }
    await removeKnownWorkspace(resolve(body.path));
    return c.json({ removed: true });
  });

  // GET /global-config
  app.get("/global-config", async (c) => {
    const cfg = (await readGlobalConfig()) ?? {};
    return c.json(cfg);
  });

  // PUT /global-config/defaults — only `workspace` key is permitted
  app.put("/global-config/defaults", async (c) => {
    const body = await c.req.json<{ workspace?: string }>();
    const cfg = (await readGlobalConfig()) ?? {};
    await writeGlobalConfig({
      ...cfg,
      defaults: {
        ...cfg.defaults,
        // Explicit allowlist — prevents arbitrary key injection into persisted config
        ...(body.workspace !== undefined ? { workspace: body.workspace } : {}),
      },
    });
    return c.json({ updated: true });
  });

  return app;
}
