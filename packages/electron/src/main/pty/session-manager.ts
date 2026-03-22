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
}

/** Session IDs must be alphanumeric + colon/dash/underscore only. */
const SESSION_ID_RE = /^[\w:.-]+$/;

export class PtySessionManager {
  private readonly sessions = new Map<string, IPty>();

  create(opts: PtyCreateOpts): void {
    if (!SESSION_ID_RE.test(opts.id)) {
      throw new Error(`Invalid session id: "${opts.id}"`);
    }

    // Kill existing session with same id before creating a new one
    this.kill(opts.id);
    console.log(`[pty] create id=${opts.id} cmd="${opts.command}"`);

    const pty = spawn(
      process.platform === "win32" ? "cmd.exe" : "/bin/sh",
      process.platform === "win32" ? [] : ["-c", opts.command],
      {
        name: "xterm-256color",
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.cwd,
        env: { ...opts.env },
      },
    );

    // On Windows, send the command as stdin since cmd.exe doesn't support -c
    if (process.platform === "win32") {
      pty.write(`${opts.command}\r`);
    }

    this.sessions.set(opts.id, pty);

    pty.onData((data) => {
      getMainWindow()?.webContents.send(`terminal:data:${opts.id}`, data);
    });

    pty.onExit(({ exitCode }) => {
      console.log(`[pty] exit id=${opts.id} code=${exitCode}`);
      this.sessions.delete(opts.id);
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

  kill(id: string, signal?: string): void {
    const pty = this.sessions.get(id);
    if (!pty) return;
    console.log(`[pty] kill id=${id}`);
    try {
      pty.kill(signal);
    } catch {
      // Already dead — ignore
    }
    this.sessions.delete(id);
  }

  isAlive(id: string): boolean {
    return this.sessions.has(id);
  }

  getAll(): string[] {
    return Array.from(this.sessions.keys());
  }

  dispose(): void {
    console.log(`[pty] dispose all (${this.sessions.size} sessions)`);
    for (const id of [...this.sessions.keys()]) {
      this.kill(id);
    }
  }
}
