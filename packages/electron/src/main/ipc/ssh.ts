import { ipcMain } from "electron";
import { execFile } from "node:child_process";
import { writeFile, unlink, readdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { CH } from "../../ipc-channels.js";
import type { CtxHolder } from "../index.js";

const execFileAsync = promisify(execFile);

const SSH_DIR = join(homedir(), ".ssh");
const ADD_KEY_TIMEOUT_MS = 15_000;

const EXCLUDED_SSH_FILES = new Set([
  "known_hosts",
  "known_hosts.old",
  "config",
  "authorized_keys",
  "environment",
]);

async function sshListKeys(): Promise<string[]> {
  try {
    const entries = await readdir(SSH_DIR);
    return entries.filter(
      (f) => !f.endsWith(".pub") && !EXCLUDED_SSH_FILES.has(f),
    );
  } catch {
    return [];
  }
}

/**
 * Validate that keyPath is a plain filename within ~/.ssh/ and is known.
 * Returns the resolved absolute path or throws on invalid input.
 */
async function resolveKeyPath(keyPath: string): Promise<string> {
  const name = basename(keyPath);
  if (name !== keyPath) {
    throw new Error("keyPath must be a filename within ~/.ssh/");
  }
  const resolved = resolve(SSH_DIR, name);
  if (!resolved.startsWith(SSH_DIR + "/") && resolved !== SSH_DIR) {
    throw new Error("keyPath escapes ~/.ssh/");
  }
  const knownKeys = await sshListKeys();
  if (!knownKeys.includes(name)) {
    throw new Error(`Key "${name}" not found in ~/.ssh/`);
  }
  return resolved;
}

/**
 * Start ssh-agent and inject SSH_AUTH_SOCK + SSH_AGENT_PID into process.env
 * so all subsequent child processes (ssh-add, git) can reach it.
 * Returns true if the agent was started successfully.
 */
async function ensureSshAgent(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ssh-agent", [], {
      env: process.env as Record<string, string>,
      timeout: 5_000,
    });
    const sockMatch = stdout.match(/SSH_AUTH_SOCK=([^;]+)/);
    const pidMatch = stdout.match(/SSH_AGENT_PID=(\d+)/);
    if (sockMatch?.[1] && pidMatch?.[1]) {
      process.env["SSH_AUTH_SOCK"] = sockMatch[1];
      process.env["SSH_AGENT_PID"] = pidMatch[1];
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function sshCheckAgent(): Promise<{ hasKeys: boolean; keyCount: number }> {
  try {
    const { stdout } = await execFileAsync("ssh-add", ["-l"], {
      env: process.env as Record<string, string>,
      timeout: 5_000,
    });
    const lines = stdout
      .split("\n")
      .filter((l) => l.trim() && !l.includes("The agent has no identities"));
    return { hasKeys: lines.length > 0, keyCount: lines.length };
  } catch {
    // exit 1 = no keys, exit 2 = no agent — both mean no loaded keys
    return { hasKeys: false, keyCount: 0 };
  }
}

/**
 * Add an SSH key to the agent using the SSH_ASKPASS mechanism.
 *
 * Why SSH_ASKPASS instead of PTY:
 * - PTY data arrives in arbitrary chunks; the passphrase prompt can be split
 *   across multiple onData calls, making detection fragile.
 * - SSH_ASKPASS is the standard programmatic way to pass a passphrase:
 *   ssh-add calls the askpass script instead of reading from the TTY.
 * - No race conditions between process exit and remaining PTY data.
 */
async function sshAddKey(
  passphrase: string,
  resolvedKeyPath?: string,
  _retried = false,
): Promise<{ success: boolean; error?: string }> {
  // Write a temporary askpass script that prints the passphrase.
  // The file is mode 700 and deleted immediately after ssh-add runs.
  const askpassPath = join(
    tmpdir(),
    `.devhub-askpass-${process.pid}-${Date.now()}.sh`,
  );

  // Shell-escape the passphrase for safe embedding in a single-quoted string
  const escaped = passphrase.replace(/'/g, "'\\''");

  try {
    await writeFile(
      askpassPath,
      `#!/bin/sh\nprintf '%s' '${escaped}'\n`,
      { mode: 0o700 },
    );

    const args = resolvedKeyPath ? [resolvedKeyPath] : [];

    await execFileAsync("ssh-add", args, {
      env: {
        ...process.env,
        SSH_ASKPASS: askpassPath,
        // Force ssh-add to use SSH_ASKPASS even without a display (OpenSSH >= 8.4)
        SSH_ASKPASS_REQUIRE: "force",
        // Fallback for older OpenSSH that requires DISPLAY to use SSH_ASKPASS
        DISPLAY: process.env["DISPLAY"] ?? ":0",
      },
      timeout: ADD_KEY_TIMEOUT_MS,
    });

    return { success: true };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);

    // Auto-start ssh-agent if it isn't running, then retry once
    if (!_retried && raw.toLowerCase().includes("could not open a connection")) {
      const started = await ensureSshAgent();
      if (started) {
        return sshAddKey(passphrase, resolvedKeyPath, true);
      }
      return { success: false, error: "ssh-agent is not running and could not be started. Run: eval $(ssh-agent)" };
    }

    // execFile includes stderr in the error message — extract the useful part
    const msg = raw
      .split("\n")
      .filter(
        (l) =>
          l.trim() &&
          !l.startsWith("Command failed") &&
          !l.includes("ssh-add"),
      )
      .join(" ")
      .trim();
    return { success: false, error: msg || "Failed to add SSH key" };
  } finally {
    await unlink(askpassPath).catch(() => {});
  }
}

export function registerSshHandlers(_holder: CtxHolder): void {
  ipcMain.handle(
    CH.SSH_ADD_KEY,
    async (_e, passphrase: string, keyPath?: string) => {
      let resolvedKeyPath: string | undefined;
      if (keyPath) {
        resolvedKeyPath = await resolveKeyPath(keyPath);
      }
      return sshAddKey(passphrase, resolvedKeyPath);
    },
  );

  ipcMain.handle(CH.SSH_CHECK_AGENT, async () => {
    return sshCheckAgent();
  });

  ipcMain.handle(CH.SSH_LIST_KEYS, async () => {
    return sshListKeys();
  });
}
