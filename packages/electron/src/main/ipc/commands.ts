import { ipcMain } from "electron";
import { CommandRegistry } from "@dev-hub/core";
import { CH } from "../../ipc-channels.js";
import type { ProjectType } from "@dev-hub/core";

const VALID_PROJECT_TYPES = new Set<string>(["maven", "gradle", "npm", "pnpm", "cargo", "custom"]);
const MAX_LIMIT = 50;

const registry = new CommandRegistry();

export function registerCommandHandlers(): void {
  ipcMain.handle(CH.COMMAND_SEARCH, (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") return [];
    const { query, projectType, limit } = payload as Record<string, unknown>;

    if (typeof query !== "string") return [];
    const safeLimit =
      typeof limit === "number" && limit > 0 ? Math.min(limit, MAX_LIMIT) : 8;
    const safeType =
      typeof projectType === "string" && VALID_PROJECT_TYPES.has(projectType)
        ? (projectType as ProjectType)
        : undefined;

    return safeType
      ? registry.searchByType(query, safeType, safeLimit)
      : registry.search(query, safeLimit);
  });

  ipcMain.handle(CH.COMMAND_LIST, (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") return [];
    const { projectType } = payload as Record<string, unknown>;
    if (typeof projectType !== "string" || !VALID_PROJECT_TYPES.has(projectType)) return [];
    return registry.getCommands(projectType as ProjectType);
  });
}
