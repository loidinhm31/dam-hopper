import { ipcMain } from "electron";
import path from "path";
import { CH } from "../../ipc-channels.js";
import type { CtxHolder } from "../index.js";

/** Safe env keys to inherit when no project is configured. */
const SAFE_ENV_KEYS = ["PATH", "HOME", "SHELL", "TERM", "LANG", "TMPDIR", "USER", "LOGNAME"];

export function registerTerminalHandlers(holder: CtxHolder): void {
  // Create PTY session. Returns session id on success.
  ipcMain.handle(
    CH.TERMINAL_CREATE,
    async (
      _e,
      opts: {
        id: string;
        project: string;
        command: string;
        cwd?: string;
        cols: number;
        rows: number;
      },
    ) => {
      const ctx = holder.current!;
      const project = ctx.config.projects.find((p) => p.name === opts.project);

      if (!project && opts.project) {
        console.warn(`[terminal] project "${opts.project}" not found — launching without project context`);
      }

      const { resolveEnv } = await import("@dev-hub/core");
      const env = project
        ? await resolveEnv(project, ctx.workspaceRoot)
        : Object.fromEntries(
            SAFE_ENV_KEYS.flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : [])),
          );

      const rawCwd = opts.cwd ?? project?.path ?? ctx.workspaceRoot;
      const basePath = project?.path ?? ctx.workspaceRoot;
      const effectiveCwd = path.isAbsolute(rawCwd)
        ? rawCwd
        : path.resolve(basePath, rawCwd);

      const cols = Math.max(1, Math.min(opts.cols, 500));
      const rows = Math.max(1, Math.min(opts.rows, 500));

      holder.ptyManager.create({
        id: opts.id,
        command: opts.command,
        cwd: effectiveCwd,
        env,
        cols,
        rows,
        project: opts.project,
      });

      return opts.id;
    },
  );

  // Write stdin to PTY (fire-and-forget, no invoke needed)
  ipcMain.on(
    CH.TERMINAL_WRITE,
    (_e, { id, data }: { id: string; data: string }) => {
      holder.ptyManager.write(id, data);
    },
  );

  // Resize PTY dimensions
  ipcMain.on(
    CH.TERMINAL_RESIZE,
    (_e, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
      const safeCols = Math.max(1, Math.min(cols, 500));
      const safeRows = Math.max(1, Math.min(rows, 500));
      holder.ptyManager.resize(id, safeCols, safeRows);
    },
  );

  // Kill PTY session
  ipcMain.on(CH.TERMINAL_KILL, (_e, { id }: { id: string }) => {
    holder.ptyManager.kill(id);
  });

  // List active session IDs
  ipcMain.handle(CH.TERMINAL_LIST, () => holder.ptyManager.getAll());

  // List sessions with metadata (project, command, type, alive, exitCode)
  ipcMain.handle(CH.TERMINAL_LIST_DETAILED, () =>
    holder.ptyManager.getDetailed(),
  );

  // Get scrollback buffer for a session (used to replay output on reconnect)
  ipcMain.handle(CH.TERMINAL_BUFFER, (_e, id: string) =>
    holder.ptyManager.getBuffer(id),
  );
}
