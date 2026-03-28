import { spawn } from "node:child_process";
import { readdir, cp, rm, mkdtemp } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import type { Dirent } from "node:fs";
import { fileExists } from "../utils/fs.js";
import { parseFrontmatter } from "./parsers.js";
import { readFile } from "node:fs/promises";
import type { AgentItemCategory } from "./types.js";

export interface RepoScanItem {
  name: string;
  category: AgentItemCategory;
  description?: string;
  /** Relative path from the cloned repo root to this item (dir or file) */
  relativePath: string;
}

export interface RepoScanResult {
  repoUrl: string;
  tmpDir: string;
  items: RepoScanItem[];
}

export interface ImportResult {
  name: string;
  success: boolean;
  error?: string;
}

/**
 * Clone a repo (shallow) to a temp dir and scan for importable items.
 * The caller is responsible for calling cleanupImport(result.tmpDir) when done.
 */
export async function scanRepo(repoUrl: string): Promise<RepoScanResult> {
  const tmpDir = await mkdtemp(join(tmpdir(), "devhub-import-"));
  await gitClone(repoUrl, tmpDir);
  const [skills, commands] = await Promise.all([
    findSkills(tmpDir),
    findCommands(tmpDir),
  ]);
  return { repoUrl, tmpDir, items: [...skills, ...commands] };
}

/**
 * Copy selected items from a cloned repo's tmpDir into the central store.
 * Does NOT overwrite existing items — returns error for conflicts.
 */
export async function importFromRepo(
  tmpDir: string,
  selectedItems: Array<{ name: string; category: AgentItemCategory; relativePath: string }>,
  storePath: string,
): Promise<ImportResult[]> {
  const resolvedTmpDir = resolve(tmpDir);
  const results: ImportResult[] = [];
  for (const item of selectedItems) {
    // Guard against path traversal via malicious relativePath (e.g. "../../etc/passwd")
    const source = resolve(join(resolvedTmpDir, item.relativePath));
    if (!source.startsWith(resolvedTmpDir + sep) && source !== resolvedTmpDir) {
      results.push({ name: item.name, success: false, error: "Invalid path: traversal detected" });
      continue;
    }
    const categoryDir = item.category === "skill" ? "skills" : "commands";
    const isCommand = item.category === "command";
    // Commands are stored as <name>.md; skills as directories
    const targetName = isCommand ? `${item.name}.md` : item.name;
    const target = join(storePath, categoryDir, targetName);

    if (await fileExists(target)) {
      results.push({ name: item.name, success: false, error: "Already exists in store" });
      continue;
    }
    try {
      await cp(source, target, { recursive: true });
      results.push({ name: item.name, success: true });
    } catch (err) {
      results.push({
        name: item.name,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/** Remove the temp directory created by scanRepo. */
export async function cleanupImport(tmpDir: string): Promise<void> {
  await rm(tmpDir, { recursive: true, force: true });
}

// ── Internals ─────────────────────────────────────────────────────────────────

/** Spawn git clone --depth 1 and await completion. Non-blocking. */
function gitClone(repoUrl: string, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Validate URL format to prevent command injection — only allow git URLs
    if (!/^(https?:\/\/|ssh:\/\/|git@|git:\/\/)/.test(repoUrl)) {
      reject(new Error(`Unsupported repo URL format: "${repoUrl}"`));
      return;
    }
    const proc = spawn("git", ["clone", "--depth", "1", repoUrl, targetDir], {
      stdio: "pipe",
      timeout: 30_000,
    });
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git clone failed (exit ${code}): ${stderr.slice(0, 400)}`));
    });
  });
}

/** Walk a directory tree, find all directories that contain a SKILL.md. */
async function findSkills(rootDir: string): Promise<RepoScanItem[]> {
  const results: RepoScanItem[] = [];
  await walkDir(rootDir, async (entryPath, entry) => {
    if (!entry.isDirectory()) return;
    const skillMd = join(entryPath, "SKILL.md");
    if (!(await fileExists(skillMd))) return;
    const content = await readFile(skillMd, "utf-8");
    const { data } = parseFrontmatter(content);
    results.push({
      name: (data["name"] as string | undefined) ?? entry.name,
      category: "skill",
      description: data["description"] as string | undefined,
      relativePath: relative(rootDir, entryPath),
    });
  });
  return results;
}

/** Find .md files that look like slash commands (have description frontmatter). */
async function findCommands(rootDir: string): Promise<RepoScanItem[]> {
  const results: RepoScanItem[] = [];
  await walkDir(rootDir, async (entryPath, entry) => {
    const name = entry.name;
    if (!entry.isFile() || !name.endsWith(".md")) return;
    if (name === "SKILL.md" || name === "README.md") return;
    const content = await readFile(entryPath, "utf-8");
    const { data } = parseFrontmatter(content);
    if (!data["description"]) return; // skip non-command markdown
    results.push({
      name: name.replace(/\.md$/, ""),
      category: "command",
      description: data["description"] as string | undefined,
      relativePath: relative(rootDir, entryPath),
    });
  });
  return results;
}

type EntryCallback = (entryPath: string, entry: Dirent<string>) => Promise<void>;

async function walkDir(dir: string, fn: EntryCallback): Promise<void> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    // Skip hidden directories except .claude/.gemini
    if (entry.isDirectory() && entry.name.startsWith(".") &&
      entry.name !== ".claude" && entry.name !== ".gemini") continue;
    const entryPath = join(dir, entry.name);
    await fn(entryPath, entry);
    if (entry.isDirectory()) {
      await walkDir(entryPath, fn);
    }
  }
}
