import type { FastifyInstance } from "fastify";
import { CommandRegistry, type ProjectType } from "@dev-hub/core";

const VALID_PROJECT_TYPES = new Set<string>(["maven", "gradle", "npm", "pnpm", "cargo", "custom"]);
const MAX_LIMIT = 50;
const registry = new CommandRegistry();

export function registerCommandRoutes(app: FastifyInstance): void {
  // GET /api/commands/search?query=...&projectType=...&limit=...
  app.get<{ Querystring: { query?: string; projectType?: string; limit?: string } }>(
    "/api/commands/search",
    async (request, reply) => {
      const { query, projectType, limit } = request.query;
      if (!query) return reply.send([]);
      const safeLimit = limit ? Math.min(Number(limit), MAX_LIMIT) : 8;
      const safeType =
        projectType && VALID_PROJECT_TYPES.has(projectType)
          ? (projectType as ProjectType)
          : undefined;
      return reply.send(
        safeType ? registry.searchByType(query, safeType, safeLimit) : registry.search(query, safeLimit),
      );
    },
  );

  // GET /api/commands?projectType=...
  app.get<{ Querystring: { projectType?: string } }>("/api/commands", async (request, reply) => {
    const { projectType } = request.query;
    if (!projectType || !VALID_PROJECT_TYPES.has(projectType)) return reply.send([]);
    return reply.send(registry.getCommands(projectType as ProjectType));
  });
}
