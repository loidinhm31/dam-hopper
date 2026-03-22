import { ipcMain } from "electron";
import { resolve } from "node:path";
import {
  gitPush,
  listWorktrees,
  addWorktree,
  removeWorktree,
  listBranches,
  updateBranch,
  updateAllBranches,
  type WorktreeAddOptions,
  type ProjectConfig,
} from "@dev-hub/core";
import { CH } from "../../ipc-channels.js";
import type { CtxHolder } from "../index.js";

function validateProjectPath(
  project: ProjectConfig,
  workspaceRoot: string,
): void {
  const root = workspaceRoot.endsWith("/") ? workspaceRoot : workspaceRoot + "/";
  const resolved = resolve(workspaceRoot, project.path);
  if (resolved !== workspaceRoot && !resolved.startsWith(root)) {
    throw new Error(
      `Project "${project.name}" path escapes workspace root: ${project.path}`,
    );
  }
}

export function registerGitHandlers(holder: CtxHolder): void {
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

  ipcMain.handle(CH.GIT_FETCH, (_e, projectNames?: string[]) =>
    guard("fetch", async () => {
      const ctx = holder.current;
      const projects =
        projectNames && projectNames.length > 0
          ? ctx.config.projects.filter((p) => projectNames.includes(p.name))
          : ctx.config.projects;
      return ctx.bulkGitService.fetchAll(projects);
    }),
  );

  ipcMain.handle(CH.GIT_PULL, (_e, projectNames?: string[]) =>
    guard("pull", async () => {
      const ctx = holder.current;
      const projects =
        projectNames && projectNames.length > 0
          ? ctx.config.projects.filter((p) => projectNames.includes(p.name))
          : ctx.config.projects;
      return ctx.bulkGitService.pullAll(projects);
    }),
  );

  ipcMain.handle(CH.GIT_PUSH, (_e, projectName: string) =>
    guard(`push:${projectName}`, async () => {
      const ctx = holder.current;
      const project = ctx.config.projects.find((p) => p.name === projectName);
      if (!project) throw new Error(`Project "${projectName}" not found`);
      validateProjectPath(project, ctx.workspaceRoot);
      return gitPush(project.path, project.name, ctx.bulkGitService.emitter);
    }),
  );

  ipcMain.handle(CH.GIT_WORKTREES, async (_e, projectName: string) => {
    const ctx = holder.current;
    const project = ctx.config.projects.find((p) => p.name === projectName);
    if (!project) throw new Error(`Project "${projectName}" not found`);
    validateProjectPath(project, ctx.workspaceRoot);
    return listWorktrees(project.path);
  });

  ipcMain.handle(
    CH.GIT_ADD_WORKTREE,
    async (_e, projectName: string, options: WorktreeAddOptions) => {
      const ctx = holder.current;
      const project = ctx.config.projects.find((p) => p.name === projectName);
      if (!project) throw new Error(`Project "${projectName}" not found`);
      validateProjectPath(project, ctx.workspaceRoot);
      return addWorktree(project.path, options);
    },
  );

  ipcMain.handle(
    CH.GIT_REMOVE_WORKTREE,
    async (_e, projectName: string, worktreePath: string) => {
      const ctx = holder.current;
      const project = ctx.config.projects.find((p) => p.name === projectName);
      if (!project) throw new Error(`Project "${projectName}" not found`);
      validateProjectPath(project, ctx.workspaceRoot);
      await removeWorktree(project.path, worktreePath);
    },
  );

  ipcMain.handle(CH.GIT_BRANCHES, async (_e, projectName: string) => {
    const ctx = holder.current;
    const project = ctx.config.projects.find((p) => p.name === projectName);
    if (!project) throw new Error(`Project "${projectName}" not found`);
    validateProjectPath(project, ctx.workspaceRoot);
    return listBranches(project.path);
  });

  ipcMain.handle(
    CH.GIT_UPDATE_BRANCH,
    (_e, projectName: string, branch?: string) =>
      guard(`updateBranch:${projectName}`, async () => {
        const ctx = holder.current;
        const project = ctx.config.projects.find((p) => p.name === projectName);
        if (!project) throw new Error(`Project "${projectName}" not found`);
        validateProjectPath(project, ctx.workspaceRoot);
        if (branch) {
          const result = await updateBranch(project.path, branch);
          return [result];
        }
        return updateAllBranches(project.path, ctx.bulkGitService.emitter);
      }),
  );
}
