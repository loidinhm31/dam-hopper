import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../context.js";
import { readFile, writeFile } from "node:fs/promises";
import { readConfig, writeConfig } from "@dev-hub/core";

export function registerSettingsRoutes(app: FastifyInstance, ctx: ServerContext): void {
  // POST /api/settings/cache-clear — web mode has no electron-store, return success
  app.post("/api/settings/cache-clear", async (_req, reply) => {
    return reply.send({ cleared: true });
  });

  // POST /api/settings/reset
  app.post("/api/settings/reset", async (_req, reply) => {
    ctx.ptyManager.dispose();
    ctx.current?.bulkGitService.emitter.removeAllListeners();
    ctx.current = null;
    ctx.sendEvent("workspace:changed", null);
    return reply.send({ reset: true });
  });

  // GET /api/settings/export — returns raw TOML as text
  app.get("/api/settings/export", async (_req, reply) => {
    if (!ctx.current) return reply.status(400).send({ error: "No workspace loaded" });
    const raw = await readFile(ctx.current.configPath, "utf-8");
    return reply
      .header("Content-Type", "text/plain; charset=utf-8")
      .header("Content-Disposition", "attachment; filename=\"dev-hub.toml\"")
      .send(raw);
  });

  // POST /api/settings/import — accepts TOML body text
  app.post<{ Body: string }>("/api/settings/import", async (request, reply) => {
    if (!ctx.current) return reply.status(400).send({ error: "No workspace loaded" });
    const c = ctx.current;
    // Body should be TOML text; validate by writing to temp then parsing
    const tmp = c.configPath + ".import_tmp";
    await writeFile(tmp, request.body as unknown as string, "utf-8");
    try {
      const validated = await readConfig(tmp);
      await writeConfig(c.configPath, validated);
      c.config = await readConfig(c.configPath);
      ctx.sendEvent("config:changed", {});
      return reply.send({ imported: true });
    } catch (e) {
      return reply.status(400).send({ error: String(e) });
    } finally {
      await writeFile(tmp, "", "utf-8").catch(() => {});
    }
  });
}
