import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../context.js";
import { resolveEnv } from "@dev-hub/core";
import path from "node:path";

const SAFE_ENV_KEYS = ["PATH", "HOME", "SHELL", "TERM", "LANG", "TMPDIR", "USER", "LOGNAME"];

export function registerTerminalRoutes(
  app: FastifyInstance,
  ctx: ServerContext,
): void {
  // POST /api/terminal — create PTY session
  app.post<{
    Body: {
      id: string;
      project?: string;
      command: string;
      cwd?: string;
      cols: number;
      rows: number;
    };
  }>("/api/terminal", async (request, reply) => {
    if (!ctx.current) return reply.status(400).send({ error: "No workspace loaded" });
    const opts = request.body;
    if (!opts.id) return reply.status(400).send({ error: "id is required" });
    const c = ctx.current;
    const project = c.config.projects.find((p) => p.name === opts.project);

    const env = project
      ? await resolveEnv(project, c.workspaceRoot)
      : Object.fromEntries(
          SAFE_ENV_KEYS.flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : [])),
        );

    const rawCwd = opts.cwd ?? project?.path ?? c.workspaceRoot;
    const basePath = project?.path ?? c.workspaceRoot;
    const effectiveCwd = path.isAbsolute(rawCwd) ? rawCwd : path.resolve(basePath, rawCwd);

    const cols = Math.max(1, Math.min(opts.cols, 500));
    const rows = Math.max(1, Math.min(opts.rows, 500));

    ctx.ptyManager.create({ id: opts.id, command: opts.command, cwd: effectiveCwd, env, cols, rows, project: opts.project });
    return reply.send({ id: opts.id });
  });

  // GET /api/terminal — list sessions
  app.get("/api/terminal", async (_req, reply) => {
    return reply.send(ctx.ptyManager.getAll());
  });

  // GET /api/terminal/detailed — list with metadata
  app.get("/api/terminal/detailed", async (_req, reply) => {
    return reply.send(ctx.ptyManager.getDetailed());
  });

  // GET /api/terminal/:id/buffer — scrollback buffer for reconnect
  app.get<{ Params: { id: string } }>("/api/terminal/:id/buffer", async (request, reply) => {
    return reply.send({ buffer: ctx.ptyManager.getBuffer(request.params.id) });
  });

  // DELETE /api/terminal/:id — kill session (keeps dead record for 60s)
  app.delete<{ Params: { id: string } }>("/api/terminal/:id", async (request, reply) => {
    ctx.ptyManager.kill(request.params.id);
    return reply.send({ killed: true });
  });

  // DELETE /api/terminal/:id/remove — kill + immediate metadata removal
  app.delete<{ Params: { id: string } }>("/api/terminal/:id/remove", async (request, reply) => {
    ctx.ptyManager.remove(request.params.id);
    return reply.send({ removed: true });
  });
}
