import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import { createConfigRoutes } from "../routes/config.js";
import { createTestContext } from "./helpers.js";

describe("config routes", () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    await cleanup?.();
  });

  it("GET /config returns workspace config", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createConfigRoutes(ctx));
    const res = await app.request("/config");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.workspace.name).toBe("test-ws");
    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.projects[0].name).toBe("proj-a");
  });

  it("PUT /config validates and writes full config", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createConfigRoutes(ctx));

    const newConfig = {
      workspace: { name: "updated-ws", root: "." },
      projects: [
        { name: "proj-a", path: ".", type: "custom" },
        {
          name: "proj-b",
          path: "./proj-b",
          type: "npm",
          tags: ["frontend"],
        },
      ],
    };

    const res = await app.request("/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newConfig),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.workspace.name).toBe("updated-ws");
    expect(body.projects).toHaveLength(2);
    expect(body.projects[1].name).toBe("proj-b");

    // Verify in-memory config was reloaded
    expect(ctx.config.workspace.name).toBe("updated-ws");
  });

  it("PUT /config returns 400 for invalid JSON", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createConfigRoutes(ctx));
    const res = await app.request("/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not json{",
    });
    expect(res.status).toBe(400);
  });

  it("PUT /config returns 400 for validation error", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createConfigRoutes(ctx));
    const res = await app.request("/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: { name: "" }, projects: [] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("PUT /config returns 400 for duplicate project names", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createConfigRoutes(ctx));
    const res = await app.request("/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace: { name: "ws" },
        projects: [
          { name: "dup", path: ".", type: "custom" },
          { name: "dup", path: "./other", type: "custom" },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("PUT /config broadcasts config:changed SSE event", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const events: string[] = [];
    ctx.sseClients.add({
      send: (e) => events.push(e.type),
    });

    const app = new Hono().route("/", createConfigRoutes(ctx));
    const validConfig = {
      workspace: { name: "ws-sse" },
      projects: [{ name: "proj-a", path: ".", type: "custom" }],
    };

    await app.request("/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validConfig),
    });

    expect(events).toContain("config:changed");
  });

  it("PATCH /config/projects/:name returns 404 for unknown project", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createConfigRoutes(ctx));
    const res = await app.request("/config/projects/no-such-project", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["backend"] }),
    });
    expect(res.status).toBe(404);
  });

  it("PATCH /config/projects/:name merges and updates project", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createConfigRoutes(ctx));
    const res = await app.request("/config/projects/proj-a", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: ["backend"], commands: { test: "pnpm test" } }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.tags).toEqual(["backend"]);
    expect(body.commands?.test).toBe("pnpm test");

    // Verify in-memory reload
    const updated = ctx.config.projects.find((p) => p.name === "proj-a");
    expect(updated?.tags).toEqual(["backend"]);
  });

  it("PATCH /config/projects/:name returns 400 for invalid JSON", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createConfigRoutes(ctx));
    const res = await app.request("/config/projects/proj-a", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "bad json",
    });
    expect(res.status).toBe(400);
  });

  it("PUT /config returns 400 for path traversal attempt", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createConfigRoutes(ctx));
    const res = await app.request("/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspace: { name: "ws" },
        projects: [{ name: "evil", path: "../../../../etc", type: "custom" }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_PATH");
  });

  it("PATCH /config/projects/:name returns 400 for invalid project type", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createConfigRoutes(ctx));
    const res = await app.request("/config/projects/proj-a", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "invalid-type" }),
    });
    expect(res.status).toBe(400);
  });
});
