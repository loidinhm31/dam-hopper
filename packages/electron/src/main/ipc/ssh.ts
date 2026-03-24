import { ipcMain } from "electron";
import { spawn } from "node-pty";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { CH } from "../../ipc-channels.js";
import type { CtxHolder } from "../index.js";

const SSH_DIR = join(homedir(), ".ssh");
const PTY_TIMEOUT_MS = 15_000;

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
 * Validate that keyPath is within ~/.ssh/ and is a known key file.
 * Returns the resolved absolute path or throws on invalid input.
 */
async function resolveKeyPath(keyPath: string): Promise<string> {
  // Only allow plain filenames (no path separators) — they are relative to ~/.ssh/
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

async function sshCheckAgent(): Promise<{ hasKeys: boolean; keyCount: number }> {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;

    const pty = spawn("ssh-add", ["-l"], {
      name: "xterm",
      cols: 80,
      rows: 24,
      env: process.env as Record<string, string>,
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { pty.kill(); } catch { /* ignore */ }
        resolve({ hasKeys: false, keyCount: 0 });
      }
    }, PTY_TIMEOUT_MS);

    pty.onData((data) => {
      output += data;
    });

    pty.onExit(({ exitCode }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // exit 0 = keys present, exit 1 = no keys, exit 2 = agent not running
      if (exitCode === 2 || output.includes("Could not open")) {
        resolve({ hasKeys: false, keyCount: 0 });
        return;
      }
      const lines = output
        .split("\n")
        .filter((l) => l.trim() && !l.includes("The agent has no identities"));
      const keyCount = exitCode === 1 ? 0 : Math.max(0, lines.length);
      resolve({ hasKeys: keyCount > 0, keyCount });
    });
  });
}

async function sshAddKey(
  passphrase: string,
  resolvedKeyPath?: string,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const args = resolvedKeyPath ? [resolvedKeyPath] : [];
    const pty = spawn("ssh-add", args, {
      name: "xterm",
      cols: 80,
      rows: 24,
      env: process.env as Record<string, string>,
    });

    // Accumulate only post-prompt output to avoid capturing passphrase echo
    let prePromptDone = false;
    let postOutput = "";
    let passphraseWritten = false;
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { pty.kill(); } catch { /* ignore */ }
        resolve({ success: false, error: "Timed out waiting for ssh-add" });
      }
    }, PTY_TIMEOUT_MS);

    pty.onData((data) => {
      const lower = data.toLowerCase();
      if (
        !passphraseWritten &&
        (lower.includes("enter passphrase") || lower.includes("passphrase for"))
      ) {
        passphraseWritten = true;
        prePromptDone = true;
        pty.write(passphrase + "\r");
        return; // Don't accumulate the prompt line
      }
      if (prePromptDone) {
        postOutput += data;
      }
    });

    pty.onExit(({ exitCode }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (exitCode === 0) {
        resolve({ success: true });
      } else {
        const errMsg = postOutput
          .replace(/\r/g, "")
          .split("\n")
          .filter((l) => l.trim())
          .join(" ")
          .trim();
        resolve({
          success: false,
          error: errMsg || "Failed to add SSH key",
        });
      }
    });
  });
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
