import type { FastifyInstance } from "fastify";
import { validateToken } from "../auth/token.js";

const AUTH_COOKIE = "devhub-auth";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year in seconds

export function registerAuthRoutes(
  app: FastifyInstance,
  getToken: () => string,
): void {
  // GET /api/auth/status — check if current request is authenticated
  app.get("/api/auth/status", async (request, reply) => {
    const cookie = (request.cookies as Record<string, string | undefined>)[
      AUTH_COOKIE
    ];
    const authenticated = Boolean(cookie && validateToken(cookie, getToken()));
    return reply.send({ authenticated });
  });

  // POST /api/auth/login — validate token, set httpOnly cookie
  app.post<{ Body: { token?: string } }>(
    "/api/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = request.body?.token;
      if (!input || typeof input !== "string") {
        return reply.status(400).send({ error: "token is required" });
      }
      if (!validateToken(input, getToken())) {
        return reply.status(401).send({ error: "Invalid token" });
      }
      reply.setCookie(AUTH_COOKIE, getToken(), {
        httpOnly: true,
        sameSite: "strict",
        secure: false, // Tailscale provides network-layer encryption over HTTP
        path: "/",
        maxAge: COOKIE_MAX_AGE,
      });
      return reply.send({ ok: true });
    },
  );

  // POST /api/auth/logout — clear cookie
  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie(AUTH_COOKIE, { path: "/" });
    return reply.send({ ok: true });
  });
}
