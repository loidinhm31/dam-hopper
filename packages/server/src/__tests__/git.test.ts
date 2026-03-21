import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { createGitRoutes } from "../routes/git.js";
import { createTestContext } from "./helpers.js";

describe("git routes", () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    await cleanup?.();
  });

  it("POST /git/push/:project returns 404 for unknown project", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createGitRoutes(ctx));
    const res = await app.request("/git/push/no-such-project", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("GET /git/worktrees/:project returns 404 for unknown project", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createGitRoutes(ctx));
    const res = await app.request("/git/worktrees/no-such-project");
    expect(res.status).toBe(404);
  });

  it("GET /git/branches/:project returns 404 for unknown project", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createGitRoutes(ctx));
    const res = await app.request("/git/branches/no-such-project");
    expect(res.status).toBe(404);
  });

  it("POST /git/fetch with empty body fetches all projects", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    // Mock fetchAll to avoid real git calls
    ctx.bulkGitService.fetchAll = async () => [];

    const app = new Hono().route("/", createGitRoutes(ctx));
    const res = await app.request("/git/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("POST /git/pull with empty body pulls all projects", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    ctx.bulkGitService.pullAll = async () => [];

    const app = new Hono().route("/", createGitRoutes(ctx));
    const res = await app.request("/git/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
  });
});
