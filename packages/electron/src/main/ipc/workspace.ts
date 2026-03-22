import { ipcMain } from "electron";
import { resolve, basename, join, sep } from "node:path";
import { homedir } from "node:os";
import { stat } from "node:fs/promises";
import {
  findConfigFile,
  readConfig,
  readGlobalConfig,
  writeGlobalConfig,
  listKnownWorkspaces,
  addKnownWorkspace,
  removeKnownWorkspace,
  discoverProjects,
  writeConfig,
} from "@dev-hub/core";
import { CH } from "../../ipc-channels.js";
import type { CtxHolder } from "../index.js";

export function registerWorkspaceHandlers(holder: CtxHolder): void {
  ipcMain.handle(CH.WORKSPACE_GET, () => {
    const ctx = holder.current;
    return {
      name: ctx.config.workspace.name,
      root: ctx.workspaceRoot,
      projectCount: ctx.config.projects.length,
    };
  });

  ipcMain.handle(CH.WORKSPACE_SWITCH, async (_e, path: string) => {
    if (!path) throw new Error("path is required");
    const absPath = resolve(path);
    const home = homedir();
    if (absPath !== home && !absPath.startsWith(home + sep)) {
      throw new Error("path must be within home directory");
    }
    await holder.switchWorkspace(absPath);
    const ctx = holder.current;
    return {
      name: ctx.config.workspace.name,
      root: ctx.workspaceRoot,
      projectCount: ctx.config.projects.length,
    };
  });

  ipcMain.handle(CH.WORKSPACE_KNOWN, async () => {
    const workspaces = await listKnownWorkspaces();
    return { workspaces, current: holder.current.workspaceRoot };
  });

  ipcMain.handle(CH.WORKSPACE_ADD_KNOWN, async (_e, path: string) => {
    if (!path) throw new Error("path is required");
    const absPath = resolve(path);
    const home = homedir();
    if (absPath !== home && !absPath.startsWith(home + sep)) {
      throw new Error("path must be within home directory");
    }
    const s = await stat(absPath).catch(() => null);
    if (!s) throw new Error(`Path not found: ${absPath}`);
    if (!s.isDirectory()) throw new Error("path must be a directory");

    let configPath = await findConfigFile(absPath);
    let workspaceName: string;

    if (!configPath) {
      const discovered = await discoverProjects(absPath);
      workspaceName = basename(absPath);
      const newConfig = {
        workspace: { name: workspaceName, root: "." },
        projects: discovered.map((p) => ({
          name: p.name,
          path: p.path,
          type: p.type,
          services: undefined,
          commands: undefined,
          envFile: undefined,
          tags: undefined,
        })),
      };
      const tomlPath = join(absPath, "dev-hub.toml");
      await writeConfig(tomlPath, newConfig);
      configPath = tomlPath;
    } else {
      const existing = await readConfig(configPath);
      workspaceName = existing.workspace.name;
    }

    await addKnownWorkspace(workspaceName, absPath);
    return { name: workspaceName, path: absPath };
  });

  ipcMain.handle(CH.WORKSPACE_REMOVE_KNOWN, async (_e, path: string) => {
    if (!path) throw new Error("path is required");
    await removeKnownWorkspace(resolve(path));
    return { removed: true };
  });

  ipcMain.handle(CH.GLOBAL_CONFIG_GET, async () => {
    return (await readGlobalConfig()) ?? {};
  });

  ipcMain.handle(
    CH.GLOBAL_CONFIG_UPDATE_DEFAULTS,
    async (_e, defaults: { workspace?: string }) => {
      const cfg = (await readGlobalConfig()) ?? {};
      await writeGlobalConfig({
        ...cfg,
        defaults: {
          ...cfg.defaults,
          ...(defaults.workspace !== undefined
            ? { workspace: defaults.workspace }
            : {}),
        },
      });
      return { updated: true };
    },
  );

  ipcMain.handle(CH.PROJECTS_LIST, async () => {
    const ctx = holder.current;
    const statuses = await ctx.bulkGitService.statusAll(ctx.config.projects);
    const statusMap = new Map(statuses.map((s) => [s.projectName, s]));
    return ctx.config.projects.map((p) => ({
      ...p,
      status: statusMap.get(p.name) ?? null,
    }));
  });

  ipcMain.handle(CH.PROJECTS_GET, async (_e, name: string) => {
    const ctx = holder.current;
    const project = ctx.config.projects.find((p) => p.name === name);
    if (!project) throw new Error(`Project "${name}" not found`);
    const [status] = await ctx.bulkGitService.statusAll([project]);
    return { ...project, status: status ?? null };
  });

  ipcMain.handle(CH.PROJECTS_STATUS, async (_e, name: string) => {
    const ctx = holder.current;
    const project = ctx.config.projects.find((p) => p.name === name);
    if (!project) throw new Error(`Project "${name}" not found`);
    const [status] = await ctx.bulkGitService.statusAll([project]);
    return status ?? null;
  });
}
