import { ipcMain } from "electron";
import { CH } from "../../ipc-channels.js";
import type { CtxHolder } from "../index.js";

export function registerProcessHandlers(holder: CtxHolder): void {
  const inProgress = new Set<string>();

  function guard(key: string, fn: () => Promise<unknown>) {
    if (inProgress.has(key)) {
      throw Object.assign(new Error(`Operation already in progress: "${key}"`), {
        code: "CONFLICT",
      });
    }
    inProgress.add(key);
    return fn().finally(() => inProgress.delete(key));
  }

  ipcMain.handle(CH.PROCESSES_LIST, () =>
    holder.current.runService.getAllProcesses(),
  );

  ipcMain.handle(CH.RUN_START, (_e, projectName: string, service?: string) =>
    guard(`start:${projectName}:${service ?? ""}`, async () => {
      const ctx = holder.current;
      const project = ctx.config.projects.find((p) => p.name === projectName);
      if (!project) throw new Error(`Project "${projectName}" not found`);
      return ctx.runService.start(project, ctx.workspaceRoot, service);
    }),
  );

  ipcMain.handle(
    CH.RUN_STOP,
    async (_e, projectName: string, service?: string) => {
      await holder.current.runService.stop(projectName, service);
    },
  );

  ipcMain.handle(
    CH.RUN_RESTART,
    (_e, projectName: string, service?: string) =>
      guard(`restart:${projectName}:${service ?? ""}`, async () => {
        const ctx = holder.current;
        if (!ctx.config.projects.find((p) => p.name === projectName)) {
          throw new Error(`Project "${projectName}" not found`);
        }
        return ctx.runService.restart(projectName, service);
      }),
  );

  ipcMain.handle(
    CH.RUN_LOGS,
    (_e, projectName: string, service?: string, lines = 100) => {
      const ctx = holder.current;
      if (!ctx.config.projects.find((p) => p.name === projectName)) {
        throw new Error(`Project "${projectName}" not found`);
      }
      const count = Math.min(Math.max(lines, 1), 10_000);
      return service
        ? ctx.runService.getServiceLogs(projectName, service, count)
        : ctx.runService.getLogs(projectName, count);
    },
  );

  ipcMain.handle(
    CH.EXEC_RUN,
    async (_e, projectName: string, command: string) => {
      const ctx = holder.current;
      const project = ctx.config.projects.find((p) => p.name === projectName);
      if (!project) throw new Error(`Project "${projectName}" not found`);
      if (!command) throw new Error("command is required");
      return ctx.commandService.execute(project, command, ctx.workspaceRoot);
    },
  );
}
