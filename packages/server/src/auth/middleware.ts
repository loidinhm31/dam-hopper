import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { validateToken } from "./token.js";

const AUTH_COOKIE = "devhub-auth";

/** Routes that bypass auth. */
const PUBLIC_PREFIXES = ["/api/auth/", "/api/health"];

function isPublic(url: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Register an onRequest hook that validates the auth cookie on all
 * non-public REST routes. WebSocket upgrade auth is handled in ws/handler.ts.
 */
export function registerAuthMiddleware(
  app: FastifyInstance,
  getToken: () => string,
): void {
  app.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const url = request.url.split("?")[0];

      // Static files and auth routes are public
      if (!url.startsWith("/api/") || isPublic(url)) return;
      // WebSocket upgrades handled separately
      if (request.headers.upgrade?.toLowerCase() === "websocket") return;

      const cookie = (request.cookies as Record<string, string | undefined>)[
        AUTH_COOKIE
      ];
      if (!cookie || !validateToken(cookie, getToken())) {
        await reply.status(401).send({ error: "Unauthorized" });
      }
    },
  );
}
