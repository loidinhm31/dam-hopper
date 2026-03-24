import type Store from "electron-store";
import type { CtxHolder } from "../index.js";
import { registerWorkspaceHandlers } from "./workspace.js";
import { registerGitHandlers } from "./git.js";
import { registerConfigHandlers } from "./config.js";
import { registerTerminalHandlers } from "./terminal.js";
import { registerSshHandlers } from "./ssh.js";
import { wireEventEmitters } from "./events.js";
import { registerSettingsHandlers } from "./settings.js";

interface StoreSchema {
  lastWorkspacePath?: string;
}

export function registerIpcHandlers(
  holder: CtxHolder,
  store: Store<StoreSchema>,
): void {
  registerWorkspaceHandlers(holder);
  registerGitHandlers(holder);
  registerConfigHandlers(holder);
  registerTerminalHandlers(holder);
  registerSshHandlers(holder);
  registerSettingsHandlers(holder, store);
  wireEventEmitters(holder);
}
