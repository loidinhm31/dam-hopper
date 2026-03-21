import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { createWorkspaceRoutes } from "../routes/workspace.js";
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
});
