import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import type { BuildResult } from "@dev-hub/core";
import { createBuildRoutes } from "../routes/build.js";
import { createTestContext } from "./helpers.js";

const fakeResult: BuildResult = {
  projectName: "proj-a",
  serviceName: "default",
  command: "echo ok",
  success: true,
  exitCode: 0,
  durationMs: 10,
  stdout: "ok",
  stderr: "",
};

describe("build routes", () => {
  let cleanup: () => Promise<void>;

  afterEach(async () => {
    await cleanup?.();
  });

  it("POST /build/:project returns 404 for unknown project", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const app = new Hono().route("/", createBuildRoutes(ctx));
    const res = await app.request("/build/no-such-project", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("POST /build/:project calls buildAll and returns array", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    ctx.buildService.buildAll = async () => [fakeResult];

    const app = new Hono().route("/", createBuildRoutes(ctx));
    const res = await app.request("/build/proj-a", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].success).toBe(true);
    expect(body[0].projectName).toBe("proj-a");
  });

  it("POST /build/:project with service calls build and returns single-element array", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    ctx.buildService.build = async () => fakeResult;

    const app = new Hono().route("/", createBuildRoutes(ctx));
    const res = await app.request("/build/proj-a", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: "default" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].serviceName).toBe("default");
  });

  it("POST /build/:project returns 409 if build already in progress", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    let resolve!: () => void;
    ctx.buildService.buildAll = () =>
      new Promise<BuildResult[]>((res) => {
        resolve = () => res([fakeResult]);
      });

    const app = new Hono().route("/", createBuildRoutes(ctx));

    // Start first build (don't await)
    const first = app.request("/build/proj-a", { method: "POST" });

    // Second concurrent request
    const second = await app.request("/build/proj-a", { method: "POST" });
    expect(second.status).toBe(409);

    // Clean up
    resolve();
    await first;
  });

  it("POST /build/:project with service returns 409 if service build already in progress", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    let resolve!: () => void;
    ctx.buildService.build = () =>
      new Promise<BuildResult>((res) => {
        resolve = () => res(fakeResult);
      });

    const app = new Hono().route("/", createBuildRoutes(ctx));

    const reqOpts = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service: "default" }),
    };

    const first = app.request("/build/proj-a", reqOpts);
    const second = await app.request("/build/proj-a", reqOpts);
    expect(second.status).toBe(409);

    resolve();
    await first;
  });
});
