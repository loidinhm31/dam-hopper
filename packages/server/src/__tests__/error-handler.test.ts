import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { GitError } from "@dev-hub/core";
import { onError } from "../middleware/error-handler.js";

function makeApp(throwFn: () => never) {
  const app = new Hono();
  app.onError(onError);
  app.get("/test", () => throwFn());
  return app;
}

describe("onError handler", () => {
  it("maps GitError network -> 502", async () => {
    const app = makeApp(() => {
      throw new GitError("connection refused", "network", "proj");
    });
    const res = await app.request("/test");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("NETWORK");
    expect(body.error).toContain("connection refused");
  });

  it("maps GitError auth -> 401", async () => {
    const app = makeApp(() => {
      throw new GitError("permission denied", "auth", "proj");
    });
    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  it("maps GitError conflict -> 409", async () => {
    const app = makeApp(() => {
      throw new GitError("conflict", "conflict", "proj");
    });
    const res = await app.request("/test");
    expect(res.status).toBe(409);
  });

  it("maps GitError lock -> 423", async () => {
    const app = makeApp(() => {
      throw new GitError("locked", "lock", "proj");
    });
    const res = await app.request("/test");
    expect(res.status).toBe(423);
  });

  it("maps GitError not_repo -> 404", async () => {
    const app = makeApp(() => {
      throw new GitError("not a git repository", "not_repo", "proj");
    });
    const res = await app.request("/test");
    expect(res.status).toBe(404);
  });

  it("maps GitError unknown -> 500", async () => {
    const app = makeApp(() => {
      throw new GitError("unknown issue", "unknown", "proj");
    });
    const res = await app.request("/test");
    expect(res.status).toBe(500);
  });

  it("maps generic Error -> 500 with JSON body", async () => {
    const app = makeApp(() => {
      throw new Error("something broke");
    });
    const res = await app.request("/test");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.error).toBe("something broke");
  });
});
