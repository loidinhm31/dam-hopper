import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createApp, createServerContext } from "@dev-hub/server";

const execFileAsync = promisify(execFile);

const WORKSPACE_TOML = `
[workspace]
name = "e2e-workspace"

[[projects]]
name = "pnpm-project"
path = "./pnpm-project"
type = "pnpm"
build_command = "echo built-ok"
`;

let tmpDir: string;
let app: ReturnType<typeof createApp>;

async function initGitRepo(dir: string): Promise<void> {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@test.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@test.com",
  };
  await execFileAsync("git", ["init", "-b", "main"], { cwd: dir, env });
  await execFileAsync("git", ["add", "."], { cwd: dir, env });
  await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd: dir, env });
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "dev-hub-e2e-"));
  const configPath = join(tmpDir, "dev-hub.toml");
  await writeFile(configPath, WORKSPACE_TOML, "utf-8");

  const projDir = join(tmpDir, "pnpm-project");
  await mkdir(projDir, { recursive: true });
  await writeFile(join(projDir, "package.json"), JSON.stringify({ name: "pnpm-project", version: "1.0.0" }), "utf-8");
  await writeFile(join(projDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf-8");

  await initGitRepo(projDir);

  const ctx = await createServerContext(configPath);
  app = createApp(ctx);
}, 30000);

afterAll(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

describe("E2E: Server API", () => {
  it("GET /api/workspace returns workspace info", async () => {
    const res = await app.request("/api/workspace");
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; projectCount: number };
    expect(body.name).toBe("e2e-workspace");
    expect(body.projectCount).toBe(1);
  });

  it("GET /api/projects returns project array", async () => {
    const res = await app.request("/api/projects");
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ name: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].name).toBe("pnpm-project");
  });

  it("GET /api/projects/:name returns project details", async () => {
    const res = await app.request("/api/projects/pnpm-project");
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; type: string };
    expect(body.name).toBe("pnpm-project");
    expect(body.type).toBe("pnpm");
  });

  it("GET /api/projects/nonexistent returns 404", async () => {
    const res = await app.request("/api/projects/nonexistent");
    expect(res.status).toBe(404);
  });

  it("POST /api/build/pnpm-project executes build command", async () => {
    const res = await app.request("/api/build/pnpm-project", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; exitCode: number };
    expect(body.success).toBe(true);
    expect(body.exitCode).toBe(0);
  }, 30000);

  it("POST /api/build/nonexistent returns 404", async () => {
    const res = await app.request("/api/build/nonexistent", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("GET /api/processes returns empty array initially", async () => {
    const res = await app.request("/api/processes");
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});
