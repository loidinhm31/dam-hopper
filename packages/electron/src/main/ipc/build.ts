import { ipcMain } from "electron";
import { CH } from "../../ipc-channels.js";
import type { CtxHolder } from "../index.js";

export function registerBuildHandlers(holder: CtxHolder): void {
  const inProgressBuilds = new Set<string>();

  ipcMain.handle(
    CH.BUILD_START,
    async (_e, projectName: string, service?: string) => {
      const ctx = holder.current;
      const project = ctx.config.projects.find((p) => p.name === projectName);
      if (!project) throw new Error(`Project "${projectName}" not found`);

      const trackKey = service ? `${projectName}:${service}` : projectName;
      if (inProgressBuilds.has(trackKey)) {
        throw Object.assign(
          new Error(`Build already in progress for "${trackKey}"`),
          { code: "BUILD_CONFLICT" },
        );
      }

      inProgressBuilds.add(trackKey);
      try {
        if (service) {
          const result = await ctx.buildService.build(
            project,
            ctx.workspaceRoot,
            service,
          );
          return [result];
        }
        return ctx.buildService.buildAll(project, ctx.workspaceRoot);
      } finally {
        inProgressBuilds.delete(trackKey);
      }
    },
  );
}
