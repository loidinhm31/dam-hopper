import { readFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { parse as parseYaml } from "yaml";
import { SkillFrontmatterSchema, CommandFrontmatterSchema } from "./schema.js";
import type { SkillMeta, CommandMeta } from "./types.js";

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns parsed data and the body content after the frontmatter.
 */
export function parseFrontmatter(content: string): {
  data: Record<string, unknown>;
  body: string;
} {
  // Normalize line endings
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return { data: {}, body: normalized };
  const yamlStr = match[1] ?? "";
  const body = normalized.slice(match[0].length);
  let data: Record<string, unknown> = {};
  try {
    data = (parseYaml(yamlStr) as Record<string, unknown>) ?? {};
  } catch {
    // Malformed YAML frontmatter — treat as no frontmatter
  }
  return { data, body };
}

/** Parse a SKILL.md file and validate frontmatter */
export async function parseSkillMd(skillDir: string): Promise<SkillMeta> {
  const content = await readFile(join(skillDir, "SKILL.md"), "utf-8");
  const { data } = parseFrontmatter(content);
  const parsed = SkillFrontmatterSchema.parse(data);
  return {
    name: parsed.name,
    description: parsed.description,
    license: parsed.license,
    allowedTools: parsed["allowed-tools"],
    metadata: parsed.metadata,
  };
}

/** Parse a command .md file and extract frontmatter */
export async function parseCommandMd(filePath: string): Promise<CommandMeta> {
  const content = await readFile(filePath, "utf-8");
  const { data } = parseFrontmatter(content);
  const parsed = CommandFrontmatterSchema.parse(data);
  return {
    name: basename(filePath, ".md"),
    description: parsed.description,
    argumentHint: parsed["argument-hint"],
  };
}

/** Calculate total size of a directory recursively in bytes */
export async function dirSize(dirPath: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(entryPath);
    } else {
      const s = await stat(entryPath);
      total += s.size;
    }
  }
  return total;
}
