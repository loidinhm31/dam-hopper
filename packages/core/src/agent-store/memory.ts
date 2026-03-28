import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import Handlebars from "handlebars";
import { fileExists } from "../utils/fs.js";
import type { AgentType } from "./types.js";
import { AGENT_PATHS } from "./types.js";

// Register {{eq}} helper for use in templates: {{#if (eq project.type "maven")}}
Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);

export interface TemplateContext {
  project: {
    name: string;
    path: string;
    type: string;
    tags?: string[];
  };
  workspace: {
    name: string;
    root: string;
  };
  agent: string;
}

export interface MemoryTemplateInfo {
  name: string;
  content: string;
}

/**
 * Render a Handlebars memory template with project/workspace variables.
 * Supports {{variable}} substitution and block helpers like {{#if (eq project.type "maven")}}.
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  const compiled = Handlebars.compile(template, { noEscape: true });
  return compiled({
    ...context,
    project: {
      ...context.project,
      // Expose tags as both array and comma-joined string for convenience
      tagsJoined: (context.project.tags ?? []).join(", "),
    },
  });
}

/** List all memory templates in the store (.md files in memory-templates/). */
export async function listMemoryTemplates(storePath: string): Promise<MemoryTemplateInfo[]> {
  const dir = join(storePath, "memory-templates");
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const results: MemoryTemplateInfo[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const content = await readFile(join(dir, entry.name), "utf-8");
    results.push({ name: basename(entry.name, ".md"), content });
  }
  return results;
}

/** Get the current memory file content for a project + agent, or null if absent. */
export async function getMemoryFile(
  projectPath: string,
  agent: AgentType,
): Promise<string | null> {
  const filePath = join(projectPath, AGENT_PATHS[agent].memoryFile);
  if (!(await fileExists(filePath))) return null;
  return readFile(filePath, "utf-8");
}

/** Write/overwrite a project's memory file. */
export async function updateMemoryFile(
  projectPath: string,
  agent: AgentType,
  content: string,
): Promise<void> {
  const filePath = join(projectPath, AGENT_PATHS[agent].memoryFile);
  await writeFile(filePath, content, "utf-8");
}

/**
 * Render a named template from the store and return the rendered content.
 * Caller decides whether to write it to a project file.
 */
export async function applyTemplate(
  storePath: string,
  templateName: string,
  context: TemplateContext,
): Promise<string> {
  const templatePath = join(storePath, "memory-templates", `${templateName}.md`);
  const template = await readFile(templatePath, "utf-8");
  return renderTemplate(template, context);
}
