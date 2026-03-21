import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveProjects } from "../utils/workspace.js";
import type { DevHubConfig } from "@dev-hub/core";

const mockConfig: DevHubConfig = {
  workspace: { name: "test-ws", root: "." },
  projects: [
    { name: "api", path: "/tmp/api", type: "maven" },
    { name: "web", path: "/tmp/web", type: "npm" },
  ],
};

describe("resolveProjects", () => {
  it("returns all projects when no filter given", () => {
    const result = resolveProjects(mockConfig);
    expect(result).toHaveLength(2);
  });

  it("filters by project name", () => {
    const result = resolveProjects(mockConfig, "api");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("api");
  });

  it("exits on unknown project name", () => {
    let didExit = false;
    const origExit = process.exit;
    process.exit = (() => { didExit = true; throw new Error("exit"); }) as never;
    try {
      resolveProjects(mockConfig, "nonexistent");
    } catch {
      // expected
    } finally {
      process.exit = origExit;
    }
    expect(didExit).toBe(true);
  });
});
