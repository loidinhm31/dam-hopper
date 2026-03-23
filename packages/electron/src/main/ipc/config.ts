import { ipcMain } from "electron";
import { resolve } from "node:path";
import {
  writeConfig,
  readConfig,
  DevHubApiConfigSchema,
  ApiProjectSchema,
  type DevHubConfig,
  type ProjectConfig,
} from "@dev-hub/core";
import { CH } from "../../ipc-channels.js";
import type { CtxHolder } from "../index.js";

function validateProjectPaths(
  projects: { name: string; path: string }[],
  workspaceRoot: string,
): string | null {
  const root = workspaceRoot.endsWith("/")
    ? workspaceRoot
    : workspaceRoot + "/";
  for (const p of projects) {
    const resolved = resolve(workspaceRoot, p.path);
    if (resolved !== workspaceRoot && !resolved.startsWith(root)) {
      return `Project "${p.name}" path escapes workspace root: ${p.path}`;
    }
  }
  return null;
}

function createWriteLock() {
  let chain = Promise.resolve();
  return function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = chain.then(fn);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export function registerConfigHandlers(holder: CtxHolder): void {
  const withLock = createWriteLock();

  ipcMain.handle(CH.CONFIG_GET, () => holder.current.config);

  ipcMain.handle(CH.CONFIG_UPDATE, (_e, body: unknown) =>
    withLock(async () => {
      const ctx = holder.current;
      const result = DevHubApiConfigSchema.safeParse(body);
      if (!result.success) {
        throw Object.assign(new Error("Config validation failed"), {
          code: "VALIDATION_ERROR",
          issues: result.error.issues,
        });
      }
      const pathError = validateProjectPaths(
        result.data.projects,
        ctx.workspaceRoot,
      );
      if (pathError) throw new Error(pathError);

      await writeConfig(ctx.configPath, result.data as DevHubConfig);
      ctx.config = await readConfig(ctx.configPath);
      holder.sendEvent("config:changed", {});
      return ctx.config;
    }),
  );

  ipcMain.handle(
    CH.CONFIG_UPDATE_PROJECT,
    (_e, name: string, patch: Partial<ProjectConfig>) =>
      withLock(async () => {
        const ctx = holder.current;
        const idx = ctx.config.projects.findIndex((p) => p.name === name);
        if (idx === -1) throw new Error(`Project "${name}" not found`);

        const merged = { ...ctx.config.projects[idx], ...(patch as object) };
        const projectResult = ApiProjectSchema.safeParse(merged);
        if (!projectResult.success) {
          throw Object.assign(new Error("Project validation failed"), {
            code: "VALIDATION_ERROR",
            issues: projectResult.error.issues,
          });
        }
        const pathError = validateProjectPaths(
          [projectResult.data],
          ctx.workspaceRoot,
        );
        if (pathError) throw new Error(pathError);

        const updatedProjects: ProjectConfig[] = [
          ...ctx.config.projects.slice(0, idx),
          projectResult.data as ProjectConfig,
          ...ctx.config.projects.slice(idx + 1),
        ];
        const updatedConfig: DevHubConfig = {
          ...ctx.config,
          projects: updatedProjects,
        };
        await writeConfig(ctx.configPath, updatedConfig);
        ctx.config = await import("@dev-hub/core").then(({ readConfig }) =>
          readConfig(ctx.configPath),
        );
        holder.sendEvent("config:changed", {});
        return ctx.config.projects.find((p) => p.name === name);
      }),
  );
}
