import { join } from "node:path";
import { homedir } from "node:os";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parse, stringify } from "smol-toml";

export interface KnownWorkspace {
  name: string;
  path: string;
}

export interface GlobalConfig {
  defaults?: { workspace?: string };
  workspaces?: KnownWorkspace[];
}

export function globalConfigPath(): string {
  const xdgHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdgHome, "dev-hub", "config.toml");
}

export async function readGlobalConfig(): Promise<GlobalConfig | null> {
  const cfgPath = globalConfigPath();
  let raw: string;
  try {
    raw = await readFile(cfgPath, "utf-8");
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    // Unreadable for other reasons (e.g. EACCES) — warn so user can diagnose
    process.stderr.write(
      `Warning: Could not read global config at ${cfgPath} (${code ?? "unknown"}) — ignoring.\n`,
    );
    return null;
  }
  try {
    return parse(raw) as GlobalConfig;
  } catch {
    process.stderr.write(
      `Warning: Could not parse global config at ${cfgPath} — ignoring.\n`,
    );
    return null;
  }
}

export async function listKnownWorkspaces(): Promise<KnownWorkspace[]> {
  const cfg = await readGlobalConfig();
  return cfg?.workspaces ?? [];
}

export async function addKnownWorkspace(
  name: string,
  path: string,
): Promise<void> {
  const cfg = (await readGlobalConfig()) ?? {};
  const existing = cfg.workspaces ?? [];
  const idx = existing.findIndex((w) => w.path === path);
  if (idx >= 0) {
    // Path already registered — update name if it changed, otherwise no-op
    if (existing[idx].name === name) return;
    const updated = [...existing];
    updated[idx] = { name, path };
    await writeGlobalConfig({ ...cfg, workspaces: updated });
    return;
  }
  await writeGlobalConfig({
    ...cfg,
    workspaces: [...existing, { name, path }],
  });
}

export async function removeKnownWorkspace(path: string): Promise<void> {
  const cfg = await readGlobalConfig();
  if (!cfg?.workspaces?.some((w) => w.path === path)) return;
  await writeGlobalConfig({
    ...cfg,
    workspaces: cfg.workspaces!.filter((w) => w.path !== path),
  });
}

export async function writeGlobalConfig(config: GlobalConfig): Promise<void> {
  const cfgPath = globalConfigPath();
  const dir = join(cfgPath, "..");
  await mkdir(dir, { recursive: true });
  // Write atomically: tmp in same dir → rename (same-filesystem avoids EXDEV)
  const tmp = join(dir, `.dev-hub-cfg-${randomBytes(6).toString("hex")}.tmp`);
  const content = stringify(config as Record<string, unknown>);
  await writeFile(tmp, content, { encoding: "utf-8", mode: 0o600 });
  await rename(tmp, cfgPath);
}
