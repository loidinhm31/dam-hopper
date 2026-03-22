import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { createWorkspaceRoutes } from "../routes/workspace.js";
import { createApp } from "../app.js";
import { createTestContext } from "./helpers.js";

describe("workspace routes", () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    await cleanup?.();
  });

  it("GET /workspace returns name and projectCount", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createWorkspaceRoutes(ctx));
    const res = await app.request("/workspace");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("test-ws");
    expect(body.projectCount).toBe(1);
    expect(typeof body.root).toBe("string");
  });

  it("GET /projects/:name returns 404 for unknown project", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createWorkspaceRoutes(ctx));
    const res = await app.request("/projects/no-such-project");
    expect(res.status).toBe(404);
  });

  it("GET /projects/:name/status returns 404 for unknown project", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createWorkspaceRoutes(ctx));
    const res = await app.request("/projects/no-such-project/status");
    expect(res.status).toBe(404);
  });

  it("returns 503 with SWITCHING code when ctx.switching is true", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    ctx.switching = true;
    const app = createApp(ctx);
    const res = await app.request("/api/workspace");

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("SWITCHING");

    ctx.switching = false;
  });

  it("POST /workspace/switch rejects path outside home directory with 400", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = createApp(ctx);
    const res = await app.request("/api/workspace/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/etc" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_INPUT");
  });

  it("SSE /api/events is exempt from 503 during switching", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    ctx.switching = true;
    const app = createApp(ctx);
    const res = await app.request("/api/events");

    // /events returns 200 with SSE stream (not 503)
    expect(res.status).toBe(200);

    ctx.switching = false;
  });
});
