import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import type { RunningProcess, BuildResult } from "@dev-hub/core";
import { createProcessRoutes } from "../routes/processes.js";
import { createTestContext } from "./helpers.js";

const mockProcess: RunningProcess = {
  projectName: "proj-a",
  serviceName: "default",
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

  it("POST /run/:project with service starts specific service", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    let capturedService: string | undefined;
    ctx.runService.start = async (_project, _root, service) => {
      capturedService = service;
      return { ...mockProcess, serviceName: service };
    };

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/run/proj-a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: "frontend" }),
    });
    expect(res.status).toBe(201);
    expect(capturedService).toBe("frontend");
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

  it("DELETE /run/:project returns 404 for unknown project", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/run/no-such-project", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("DELETE /run/:project returns 204", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    ctx.runService.stop = async () => {};

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/run/proj-a", { method: "DELETE" });
    expect(res.status).toBe(204);
  });

  it("DELETE /run/:project?service= stops specific service", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    let capturedService: string | undefined;
    ctx.runService.stop = async (_name, service) => {
      capturedService = service;
    };

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/run/proj-a?service=backend", {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(capturedService).toBe("backend");
  });

  it("POST /run/:project/restart returns 404 for unknown project", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/run/no-such-project/restart", {
      method: "POST",
    });
    expect(res.status).toBe(404);
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

  it("GET /run/:project/logs returns 404 for unknown project", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/run/no-such-project/logs");
    expect(res.status).toBe(404);
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

  it("GET /run/:project/logs with service uses getServiceLogs", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    let capturedService: string | undefined;
    ctx.runService.getServiceLogs = (_name, service) => {
      capturedService = service;
      return [{ timestamp: new Date(), stream: "stdout", line: "svc-log" }];
    };

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/run/proj-a/logs?service=frontend&lines=10");
    expect(res.status).toBe(200);
    expect(capturedService).toBe("frontend");
    const body = await res.json();
    expect(body[0].line).toBe("svc-log");
  });

  // --- Exec endpoint ---

  it("POST /exec/:project returns 404 for unknown project", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/exec/no-such-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "test" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /exec/:project returns 400 if command missing", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/exec/proj-a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST /exec/:project executes command and returns result", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const fakeResult: BuildResult = {
      projectName: "proj-a",
      serviceName: "test",
      command: "pnpm test",
      success: true,
      exitCode: 0,
      durationMs: 50,
      stdout: "all tests pass",
      stderr: "",
    };

    ctx.commandService.execute = async () => fakeResult;

    const app = new Hono().route("/", createProcessRoutes(ctx));
    const res = await app.request("/exec/proj-a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "test" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.stdout).toBe("all tests pass");
  });
});
