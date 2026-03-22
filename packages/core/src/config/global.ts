import { join } from "node:path";
import { homedir } from "node:os";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { parse, stringify } from "smol-toml";

export interface GlobalConfig {
  defaults?: { workspace?: string };
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

export async function writeGlobalConfig(config: GlobalConfig): Promise<void> {
  const cfgPath = globalConfigPath();
  const dir = join(cfgPath, "..");
  await mkdir(dir, { recursive: true });
  // Write atomically: tmp file → rename, so a crash can't leave a corrupt config
  const tmp = join(tmpdir(), `dev-hub-cfg-${randomBytes(6).toString("hex")}.tmp`);
  const content = stringify(config as Record<string, unknown>);
  await writeFile(tmp, content, { encoding: "utf-8", mode: 0o600 });
  await rename(tmp, cfgPath);
}
