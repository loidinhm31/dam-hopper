import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  renderTemplate,
  listMemoryTemplates,
  getMemoryFile,
  updateMemoryFile,
  applyTemplate,
  type TemplateContext,
} from "../memory.js";

const mkTmpDir = () =>
  join(tmpdir(), `dev-hub-memory-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const baseCtx: TemplateContext = {
  project: {
    name: "api-server",
    path: "./api-server",
    type: "maven",
    tags: ["backend", "api"],
  },
  workspace: { name: "my-workspace", root: "/home/user/ws" },
  agent: "claude",
};

describe("renderTemplate()", () => {
  it("substitutes project variables", () => {
    const result = renderTemplate("name={{project.name}} type={{project.type}}", baseCtx);
    expect(result).toBe("name=api-server type=maven");
  });

  it("substitutes workspace variables", () => {
    const result = renderTemplate("ws={{workspace.name}} root={{workspace.root}}", baseCtx);
    expect(result).toBe("ws=my-workspace root=/home/user/ws");
  });

  it("substitutes agent variable", () => {
    expect(renderTemplate("agent={{agent}}", baseCtx)).toBe("agent=claude");
  });

  it("substitutes project.path", () => {
    expect(renderTemplate("path={{project.path}}", baseCtx)).toBe("path=./api-server");
  });

  it("renders tags as comma-joined via project.tagsJoined", () => {
    const result = renderTemplate("tags={{project.tagsJoined}}", baseCtx);
    expect(result).toBe("tags=backend, api");
  });

  it("renders empty string for missing tags", () => {
    const ctx: TemplateContext = { ...baseCtx, project: { ...baseCtx.project, tags: undefined } };
    expect(renderTemplate("tags={{project.tagsJoined}}", ctx)).toBe("tags=");
  });

  it("supports {{#if (eq ...)}} helper", () => {
    const tpl = "{{#if (eq project.type \"maven\")}}mvn{{else}}other{{/if}}";
    expect(renderTemplate(tpl, baseCtx)).toBe("mvn");
    const ctx = { ...baseCtx, project: { ...baseCtx.project, type: "npm" } };
    expect(renderTemplate(tpl, ctx)).toBe("other");
  });

  it("leaves unresolved variables as empty string (Handlebars default)", () => {
    const result = renderTemplate("{{unknownVar}}", baseCtx);
    expect(result).toBe("");
  });

  it("handles template with no variables", () => {
    expect(renderTemplate("static content", baseCtx)).toBe("static content");
  });
});

describe("listMemoryTemplates()", () => {
  let storePath: string;

  beforeEach(async () => {
    storePath = mkTmpDir();
    await mkdir(join(storePath, "memory-templates"), { recursive: true });
  });

  afterEach(async () => {
    await rm(storePath, { recursive: true, force: true });
  });

  it("returns empty array when no templates exist", async () => {
    const result = await listMemoryTemplates(storePath);
    expect(result).toEqual([]);
  });

  it("returns empty array when memory-templates dir missing", async () => {
    const emptyStore = join(storePath, "empty");
    await mkdir(emptyStore, { recursive: true });
    expect(await listMemoryTemplates(emptyStore)).toEqual([]);
  });

  it("lists .md templates with name and content", async () => {
    await writeFile(join(storePath, "memory-templates", "generic.md"), "# {{project.name}}");
    await writeFile(join(storePath, "memory-templates", "backend.md"), "# Backend");
    const result = await listMemoryTemplates(storePath);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name).sort()).toEqual(["backend", "generic"]);
    const generic = result.find((t) => t.name === "generic");
    expect(generic?.content).toBe("# {{project.name}}");
  });

  it("ignores non-.md files", async () => {
    await writeFile(join(storePath, "memory-templates", "readme.txt"), "ignore me");
    await writeFile(join(storePath, "memory-templates", "ok.md"), "# Ok");
    const result = await listMemoryTemplates(storePath);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("ok");
  });
});

describe("getMemoryFile() / updateMemoryFile()", () => {
  let projectPath: string;

  beforeEach(async () => {
    projectPath = mkTmpDir();
    await mkdir(projectPath, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it("returns null when CLAUDE.md does not exist", async () => {
    expect(await getMemoryFile(projectPath, "claude")).toBeNull();
  });

  it("returns null when GEMINI.md does not exist", async () => {
    expect(await getMemoryFile(projectPath, "gemini")).toBeNull();
  });

  it("returns file content when CLAUDE.md exists", async () => {
    await writeFile(join(projectPath, "CLAUDE.md"), "# Existing Claude");
    expect(await getMemoryFile(projectPath, "claude")).toBe("# Existing Claude");
  });

  it("writes CLAUDE.md via updateMemoryFile", async () => {
    await updateMemoryFile(projectPath, "claude", "# New Content");
    const written = await readFile(join(projectPath, "CLAUDE.md"), "utf-8");
    expect(written).toBe("# New Content");
  });

  it("writes GEMINI.md via updateMemoryFile", async () => {
    await updateMemoryFile(projectPath, "gemini", "# Gemini Content");
    const written = await readFile(join(projectPath, "GEMINI.md"), "utf-8");
    expect(written).toBe("# Gemini Content");
  });

  it("overwrites existing memory file", async () => {
    await writeFile(join(projectPath, "CLAUDE.md"), "old");
    await updateMemoryFile(projectPath, "claude", "new");
    expect(await getMemoryFile(projectPath, "claude")).toBe("new");
  });
});

describe("applyTemplate()", () => {
  let storePath: string;
  let projectPath: string;

  beforeEach(async () => {
    storePath = mkTmpDir();
    projectPath = mkTmpDir();
    await mkdir(join(storePath, "memory-templates"), { recursive: true });
    await mkdir(projectPath, { recursive: true });
  });

  afterEach(async () => {
    await Promise.all([
      rm(storePath, { recursive: true, force: true }),
      rm(projectPath, { recursive: true, force: true }),
    ]);
  });

  it("renders a template with context variables", async () => {
    await writeFile(
      join(storePath, "memory-templates", "test.md"),
      "# {{project.name}}\nType: {{project.type}}\nAgent: {{agent}}",
    );
    const result = await applyTemplate(storePath, "test", baseCtx);
    expect(result).toBe("# api-server\nType: maven\nAgent: claude");
  });

  it("throws when template does not exist", async () => {
    await expect(applyTemplate(storePath, "nonexistent", baseCtx)).rejects.toThrow();
  });
});
