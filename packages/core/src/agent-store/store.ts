import {
  readdir,
  mkdir,
  cp,
  rm,
  stat,
  readFile,
  lstat,
} from "node:fs/promises";
import { join, basename, relative, sep } from "node:path";
import { parseSkillMd, parseCommandMd, dirSize } from "./parsers.js";
import type { AgentStoreItem, AgentItemCategory } from "./types.js";

/** Validate that a name cannot traverse outside its category directory */
function assertSafeName(name: string): void {
  if (
    name.includes("/") ||
    name.includes("\\") ||
    name.includes(sep) ||
    name === ".." ||
    name === "."
  ) {
    throw new Error(`Invalid item name: "${name}"`);
  }
}

/** Validate that a filename cannot traverse outside its parent directory */
function assertSafeFileName(fileName: string): void {
  if (
    fileName.includes("/") ||
    fileName.includes("\\") ||
    fileName === ".." ||
    fileName === "."
  ) {
    throw new Error(`Invalid file name: "${fileName}"`);
  }
}

const CATEGORY_DIRS: Record<AgentItemCategory, string> = {
  skill: "skills",
  command: "commands",
  hook: "hooks",
  "mcp-server": "mcp-servers",
  subagent: "subagents",
  "memory-template": "memory-templates",
};

export class AgentStoreService {
  constructor(private readonly _storePath: string) {}

  get storePath(): string {
    return this._storePath;
  }

  /** Ensure the store directory structure exists */
  async init(): Promise<void> {
    for (const dir of Object.values(CATEGORY_DIRS)) {
      await mkdir(join(this._storePath, dir), { recursive: true });
    }
  }

  /** List all items in the central store */
  async list(category?: AgentItemCategory): Promise<AgentStoreItem[]> {
    const categories = category
      ? [category]
      : (Object.keys(CATEGORY_DIRS) as AgentItemCategory[]);
    const items: AgentStoreItem[] = [];
    for (const cat of categories) {
      const dir = join(this._storePath, CATEGORY_DIRS[cat]);
      const catItems = await this.listCategory(dir, cat);
      items.push(...catItems);
    }
    return items;
  }

  /** Add an item to the store (copy from source path) */
  async add(
    sourcePath: string,
    category: AgentItemCategory,
    name?: string,
  ): Promise<AgentStoreItem> {
    const itemName = name ?? basename(sourcePath, ".md");
    assertSafeName(itemName);
    const categoryDir = join(this._storePath, CATEGORY_DIRS[category]);
    // Commands are stored as <name>.md files; everything else uses the name directly
    const destPath =
      category === "command"
        ? join(categoryDir, `${itemName}.md`)
        : join(categoryDir, itemName);

    await cp(sourcePath, destPath, { recursive: true, force: true });

    const item = await this.get(itemName, category);
    if (!item) {
      throw new Error(`Failed to read item after adding: ${itemName}`);
    }
    return item;
  }

  /** Remove an item from the store */
  async remove(name: string, category: AgentItemCategory): Promise<void> {
    assertSafeName(name);
    const targetPath = join(this._storePath, CATEGORY_DIRS[category], name);
    // For commands, also try with .md extension
    if (category === "command") {
      await rm(`${targetPath}.md`, { force: true });
    }
    await rm(targetPath, { recursive: true, force: true });
  }

  /** Get detailed info for a single item */
  async get(
    name: string,
    category: AgentItemCategory,
  ): Promise<AgentStoreItem | null> {
    assertSafeName(name);
    const itemPath = join(this._storePath, CATEGORY_DIRS[category], name);
    const relPath = relative(this._storePath, itemPath);
    try {
      if (category === "skill") {
        const meta = await parseSkillMd(itemPath);
        const size = await dirSize(itemPath);
        return {
          name,
          category,
          relativePath: relPath,
          description: meta.description,
          compatibleAgents: ["claude", "gemini"],
          sizeBytes: size,
        };
      } else if (category === "command") {
        // command files are <name>.md
        const filePath = itemPath.endsWith(".md")
          ? itemPath
          : `${itemPath}.md`;
        const meta = await parseCommandMd(filePath);
        const s = await stat(filePath);
        return {
          name,
          category,
          relativePath: `${relPath}.md`,
          description: meta.description,
          compatibleAgents: ["claude", "gemini"],
          sizeBytes: s.size,
        };
      } else {
        // For hooks, mcp-server, subagent, memory-template: basic stat.
        // Subagents are imported as <name>.md — try with extension when bare path not found.
        let resolvedPath = itemPath;
        if (category === "subagent" && !itemPath.endsWith(".md")) {
          try {
            await lstat(`${itemPath}.md`);
            resolvedPath = `${itemPath}.md`;
          } catch {
            // fall through to bare path
          }
        }
        const s = await lstat(resolvedPath);
        const size = s.isDirectory() ? await dirSize(resolvedPath) : s.size;
        let description: string | undefined;
        if (category === "subagent" && resolvedPath.endsWith(".md")) {
          try {
            const meta = await parseCommandMd(resolvedPath);
            description = meta.description;
          } catch {
            // description stays undefined
          }
        }
        return {
          name,
          category,
          relativePath: relative(this._storePath, resolvedPath),
          description,
          compatibleAgents: ["claude", "gemini"],
          sizeBytes: size,
        };
      }
    } catch (err) {
      // Item not found or unreadable — return null rather than propagating
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        // Unexpected error (permissions, I/O) — log for diagnostics
        console.error(`[AgentStoreService] get(${name}, ${category}):`, err);
      }
      return null;
    }
  }

  /** Get the content of the main file for an item */
  async getContent(
    name: string,
    category: AgentItemCategory,
    fileName?: string,
  ): Promise<string> {
    assertSafeName(name);
    const itemPath = join(this._storePath, CATEGORY_DIRS[category], name);
    if (fileName) {
      assertSafeFileName(fileName);
      return readFile(join(itemPath, fileName), "utf-8");
    }
    if (category === "skill") {
      return readFile(join(itemPath, "SKILL.md"), "utf-8");
    }
    // For commands and subagents: <name>.md
    if (category === "command" || category === "subagent") {
      const mdPath = itemPath.endsWith(".md") ? itemPath : `${itemPath}.md`;
      return readFile(mdPath, "utf-8");
    }
    return readFile(itemPath, "utf-8");
  }

  private async listCategory(
    dir: string,
    category: AgentItemCategory,
  ): Promise<AgentStoreItem[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Category directory doesn't exist yet
      return [];
    }

    const items: AgentStoreItem[] = [];

    if (category === "skill") {
      // Skills: subdirectories containing a SKILL.md
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const item = await this.get(entry.name, category);
        if (item) items.push(item);
      }
    } else if (category === "command") {
      // Commands: .md files
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const name = basename(entry.name, ".md");
        const item = await this.get(name, category);
        if (item) items.push(item);
      }
    } else {
      // hooks, mcp-server, subagent, memory-template: any file or directory
      for (const entry of entries) {
        const name = entry.isFile()
          ? basename(entry.name, ".md")
          : entry.name;
        const item = await this.get(
          entry.isFile() ? basename(entry.name, ".md") : entry.name,
          category,
        );
        // Avoid duplicates when stripping extension (e.g. hook.sh stays as-is)
        if (item && !items.some((i) => i.name === name)) {
          items.push(item);
        }
      }
    }

    return items;
  }
}
