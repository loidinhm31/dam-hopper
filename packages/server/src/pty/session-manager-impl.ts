/**
 * PtySessionManager — pure Node.js implementation (no Electron dependency).
 * Identical logic to packages/electron/src/main/pty/session-manager.ts,
 * but EventSink is injected via constructor instead of importing Electron APIs.
 */

import { spawn } from "node-pty";
import type { IPty } from "node-pty";
import type { EventSink } from "../ws/event-sink.js";

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

const SESSION_ID_RE = /^[\w:.-]+$/;
const SCROLLBACK_LIMIT = 256 * 1024;
const DEAD_META_TTL_MS = 60_000;

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

  constructor(private readonly eventSink: EventSink) {}

  create(opts: PtyCreateOpts): void {
    if (!SESSION_ID_RE.test(opts.id)) {
      throw new Error(`Invalid session id: "${opts.id}"`);
    }

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

    const isInteractive = !opts.command;
    const rawShell = opts.env["SHELL"] ?? "";
    const safeShell =
      process.platform === "win32" ? "cmd.exe" : rawShell.startsWith("/") ? rawShell : "/bin/bash";
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

    if (isInteractive) console.log(`[pty] interactive shell: ${exe}`);

    const pty = spawn(exe, args, {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: { ...opts.env },
    });

    if (process.platform === "win32" && opts.command) {
      pty.write(`${opts.command}\r`);
    }

    this.sessions.set(opts.id, pty);
    this.eventSink.sendTerminalChanged();

    pty.onData((data) => {
      const current = this.scrollback.get(opts.id) ?? "";
      const next = current + data;
      this.scrollback.set(
        opts.id,
        next.length > SCROLLBACK_LIMIT ? next.slice(next.length - SCROLLBACK_LIMIT) : next,
      );
      this.eventSink.sendTerminalData(opts.id, data);
    });

    pty.onExit(({ exitCode }) => {
      console.log(`[pty] exit id=${opts.id} code=${exitCode}`);
      this.sessions.delete(opts.id);
      const m = this.meta.get(opts.id);
      if (m) { m.alive = false; m.exitCode = exitCode; }
      this.scheduleMetaCleanup(opts.id);
      this.eventSink.sendTerminalExit(opts.id, exitCode);
      this.eventSink.sendTerminalChanged();
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
      try { pty.kill(signal); } catch { /* already dead */ }
      this.sessions.delete(id);
    }
    const m = this.meta.get(id);
    if (m && m.alive) { m.alive = false; m.exitCode = null; this.scheduleMetaCleanup(id); }
    this.scrollback.delete(id);
  }

  /** Kill + immediately remove all metadata (no 60s TTL). */
  remove(id: string): void {
    const pty = this.sessions.get(id);
    if (pty) {
      console.log(`[pty] remove id=${id}`);
      try { pty.kill(); } catch { /* already dead */ }
      this.sessions.delete(id);
    }
    const timer = this.cleanupTimers.get(id);
    if (timer) { clearTimeout(timer); this.cleanupTimers.delete(id); }
    this.meta.delete(id);
    this.scrollback.delete(id);
    this.eventSink.sendTerminalChanged();
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
    for (const id of [...this.sessions.keys()]) this.kill(id);
    for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
    this.cleanupTimers.clear();
    this.meta.clear();
  }

  private scheduleMetaCleanup(id: string): void {
    const existing = this.cleanupTimers.get(id);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => {
      this.meta.delete(id);
      this.cleanupTimers.delete(id);
    }, DEAD_META_TTL_MS);
    this.cleanupTimers.set(id, handle);
  }
}
