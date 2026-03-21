import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import type { RunningProcess } from "@dev-hub/core";
import { createProcessRoutes } from "../routes/processes.js";
import { createTestContext } from "./helpers.js";

const mockProcess: RunningProcess = {
  projectName: "proj-a",
  command: "echo hello",
  pid: 1234,
  startedAt: new Date("2024-01-01"),
  status: "running",
  restartCount: 0,
};

describe("process routes", () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    await cleanup?.();
  });

  it("GET /processes returns array", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/processes");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("POST /run/:project returns 404 for unknown project", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/run/no-such-project", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("POST /run/:project starts process and returns 201", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    ctx.runService.start = async () => ({ ...mockProcess });

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/run/proj-a", { method: "POST" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.projectName).toBe("proj-a");
    expect(body.status).toBe("running");
  });

  it("POST /run/:project returns 409 if already running", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    ctx.runService.start = async () => {
      throw new Error("Process for 'proj-a' is already running");
    };

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/run/proj-a", { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("DELETE /run/:project returns 204", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    ctx.runService.stop = async () => {};

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/run/proj-a", { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  it("POST /run/:project/restart returns updated process", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    ctx.runService.restart = async () => ({ ...mockProcess, restartCount: 1 });

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/run/proj-a/restart", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.restartCount).toBe(1);
  });

  it("GET /run/:project/logs returns array", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    ctx.runService.getLogs = () => [
      { timestamp: new Date(), stream: "stdout", line: "hello" },
    ];

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/run/proj-a/logs?lines=10");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].line).toBe("hello");
  });
});
