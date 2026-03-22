import type { CtxHolder } from "../index.js";
import { registerWorkspaceHandlers } from "./workspace.js";
import { registerGitHandlers } from "./git.js";
import { registerConfigHandlers } from "./config.js";
import { registerBuildHandlers } from "./build.js";
import { registerProcessHandlers } from "./processes.js";
import { wireEventEmitters } from "./events.js";

export function registerIpcHandlers(holder: CtxHolder): void {
  registerWorkspaceHandlers(holder);
  registerGitHandlers(holder);
  registerConfigHandlers(holder);
  registerBuildHandlers(holder);
  registerProcessHandlers(holder);
  wireEventEmitters(holder);
}
