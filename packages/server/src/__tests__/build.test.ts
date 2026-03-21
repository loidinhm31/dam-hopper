import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import type { BuildResult } from "@dev-hub/core";
import { createBuildRoutes } from "../routes/build.js";
import { createTestContext } from "./helpers.js";

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

  it("POST /build/:project calls buildService and returns result", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    const fakeResult: BuildResult = {
      projectName: "proj-a",
      command: "echo ok",
      success: true,
      exitCode: 0,
      durationMs: 10,
      stdout: "ok",
      stderr: "",
    };
    ctx.buildService.build = async () => fakeResult;

    const app = new Hono().route("/", createBuildRoutes(ctx));
    const res = await app.request("/build/proj-a", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.projectName).toBe("proj-a");
  });

  it("POST /build/:project returns 409 if build already in progress", async () => {
    const { ctx, cleanup: c } = await createTestContext();
    cleanup = c;

    let resolve!: () => void;
    ctx.buildService.build = () =>
      new Promise<BuildResult>((res) => {
        resolve = () =>
          res({
            projectName: "proj-a",
            command: "",
            success: true,
            exitCode: 0,
            durationMs: 0,
            stdout: "",
            stderr: "",
          });
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
});
