import type { CtxHolder } from "../index.js";
import { registerWorkspaceHandlers } from "./workspace.js";
import { registerGitHandlers } from "./git.js";
import { registerConfigHandlers } from "./config.js";
import { registerTerminalHandlers } from "./terminal.js";
import { registerSshHandlers } from "./ssh.js";
import { wireEventEmitters } from "./events.js";

export function registerIpcHandlers(holder: CtxHolder): void {
  registerWorkspaceHandlers(holder);
  registerGitHandlers(holder);
  registerConfigHandlers(holder);
  registerTerminalHandlers(holder);
  registerSshHandlers(holder);
  wireEventEmitters(holder);
}
