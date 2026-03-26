import { spawn } from "node-pty";
import type { IPty } from "node-pty";
import { getMainWindow } from "../window.js";

export interface PtyCreateOpts {
  id: string;
  command: string;
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  project?: string;
}

export interface SessionMeta {
  id: string;
  project?: string;
  command: string;
  cwd: string;
  type: "build" | "run" | "custom" | "shell" | "terminal" | "free" | "unknown";
  alive: boolean;
  exitCode?: number | null;
  startedAt: number;
}

/** Session IDs must be alphanumeric + colon/dash/underscore only. */
const SESSION_ID_RE = /^[\w:.-]+$/;

/** Max bytes to keep per session for reconnect replay (256 KB). */
const SCROLLBACK_LIMIT = 256 * 1024;

/** Keep dead session metadata for 60 seconds before cleanup. */
const DEAD_META_TTL_MS = 60_000;

// Order matters: more-specific prefixes must come before any that could overlap.
function deriveType(id: string): SessionMeta["type"] {
  if (id.startsWith("build:")) return "build";
  if (id.startsWith("run:")) return "run";
  if (id.startsWith("custom:")) return "custom";
  if (id.startsWith("shell:")) return "shell";
  if (id.startsWith("terminal:")) return "terminal";
  if (id.startsWith("free:")) return "free";
  return "unknown";
}

export class PtySessionManager {
  private readonly sessions = new Map<string, IPty>();
  private readonly scrollback = new Map<string, string>();
  private readonly meta = new Map<string, SessionMeta>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  create(opts: PtyCreateOpts): void {
    if (!SESSION_ID_RE.test(opts.id)) {
      throw new Error(`Invalid session id: "${opts.id}"`);
    }

    // Kill existing session with same id before creating a new one
    this.kill(opts.id);
    this.scrollback.set(opts.id, "");

    const sessionMeta: SessionMeta = {
      id: opts.id,
      project: opts.project,
      command: opts.command,
      cwd: opts.cwd,
      type: deriveType(opts.id),
      alive: true,
      startedAt: Date.now(),
    };
    this.meta.set(opts.id, sessionMeta);

    console.log(`[pty] create id=${opts.id} cmd="${opts.command}"`);

    // Empty command = interactive login shell (e.g. free terminals).
    // Spawn the user's preferred shell directly instead of wrapping in /bin/sh -c.
    const isInteractive = !opts.command;
    // Validate $SHELL is an absolute path before trusting it as an executable.
    // Fall back to /bin/bash if unset or looks like an injection attempt.
    const rawShell = opts.env["SHELL"] ?? "";
    const safeShell =
      process.platform === "win32"
        ? "cmd.exe"
        : rawShell.startsWith("/")
          ? rawShell
          : "/bin/bash";
    const exe = isInteractive
      ? safeShell
      : process.platform === "win32"
        ? "cmd.exe"
        : "/bin/sh";
    const args = isInteractive
      ? []
      : process.platform === "win32"
        ? []
        : ["-c", opts.command];

    if (isInteractive) {
      console.log(`[pty] interactive shell: ${exe}`);
    }

    const pty = spawn(exe, args, {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: { ...opts.env },
    });

    // On Windows, send the command as stdin since cmd.exe doesn't support -c
    if (process.platform === "win32" && opts.command) {
      pty.write(`${opts.command}\r`);
    }

    this.sessions.set(opts.id, pty);

    pty.onData((data) => {
      // Append to scrollback buffer, trimming oldest bytes when over limit
      const current = this.scrollback.get(opts.id) ?? "";
      const next = current + data;
      this.scrollback.set(
        opts.id,
        next.length > SCROLLBACK_LIMIT ? next.slice(next.length - SCROLLBACK_LIMIT) : next,
      );
      getMainWindow()?.webContents.send(`terminal:data:${opts.id}`, data);
    });

    pty.onExit(({ exitCode }) => {
      console.log(`[pty] exit id=${opts.id} code=${exitCode}`);
      this.sessions.delete(opts.id);

      const m = this.meta.get(opts.id);
      if (m) {
        m.alive = false;
        m.exitCode = exitCode;
      }

      // Schedule metadata cleanup after TTL
      this.scheduleMetaCleanup(opts.id);

      getMainWindow()?.webContents.send(`terminal:exit:${opts.id}`, {
        exitCode,
      });
    });
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.resize(cols, rows);
  }

  getBuffer(id: string): string {
    return this.scrollback.get(id) ?? "";
  }

  kill(id: string, signal?: string): void {
    const pty = this.sessions.get(id);
    if (pty) {
      console.log(`[pty] kill id=${id}`);
      try {
        pty.kill(signal);
      } catch {
        // Already dead — ignore
      }
      this.sessions.delete(id);
    }

    const m = this.meta.get(id);
    if (m && m.alive) {
      m.alive = false;
      m.exitCode = null;
      this.scheduleMetaCleanup(id);
    }

    this.scrollback.delete(id);
  }

  isAlive(id: string): boolean {
    return this.sessions.has(id);
  }

  getAll(): string[] {
    return Array.from(this.sessions.keys());
  }

  getDetailed(): SessionMeta[] {
    return Array.from(this.meta.values());
  }

  dispose(): void {
    console.log(`[pty] dispose all (${this.sessions.size} sessions)`);
    for (const id of [...this.sessions.keys()]) {
      this.kill(id);
    }
    // Clear all pending cleanup timers to prevent post-dispose callbacks
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    this.meta.clear();
  }

  private scheduleMetaCleanup(id: string): void {
    // Cancel any existing timer for this id (e.g., session restarted)
    const existing = this.cleanupTimers.get(id);
    if (existing) clearTimeout(existing);

    const handle = setTimeout(() => {
      this.meta.delete(id);
      this.cleanupTimers.delete(id);
    }, DEAD_META_TTL_MS);
    this.cleanupTimers.set(id, handle);
  }
}
