import { ipcMain } from "electron";
import { CH } from "../../ipc-channels.js";
import type { CtxHolder } from "../index.js";

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
        cols: number;
        rows: number;
      },
    ) => {
      const ctx = holder.current;
      const project = ctx.config.projects.find((p) => p.name === opts.project);
      if (!project) throw new Error(`Project "${opts.project}" not found`);

      const { resolveEnv } = await import("@dev-hub/core");
      const env = await resolveEnv(project, ctx.workspaceRoot);

      const cols = Math.max(1, Math.min(opts.cols, 500));
      const rows = Math.max(1, Math.min(opts.rows, 500));

      holder.ptyManager.create({
        id: opts.id,
        command: opts.command,
        cwd: project.path,
        env,
        cols,
        rows,
      });

      return opts.id;
    },
  );

  // Write stdin to PTY (fire-and-forget, no invoke needed)
  ipcMain.on(CH.TERMINAL_WRITE, (_e, { id, data }: { id: string; data: string }) => {
    holder.ptyManager.write(id, data);
  });

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
}
