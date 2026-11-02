import type { AppManifest, OsAppId, OsWindow, WindowContext } from "./types.js";

export const APP_MANIFESTS: Record<OsAppId, AppManifest> = {
  terminals: {
    appId: "terminals",
    displayName: "Terminals",
    instancing: "multi-instance",
    minimumCtx: "profile",
    defaultPlacement: "tile",
    minSize: { width: 320, height: 240 },
    intents: ["terminal:open", "terminal:focus"],
  },
  editor: {
    appId: "editor",
    displayName: "Editor",
    instancing: "multi-instance",
    minimumCtx: "project",
    defaultPlacement: "tile",
    minSize: { width: 360, height: 280 },
    intents: ["file:edit", "file:open"],
  },
  browser: {
    appId: "browser",
    displayName: "Browser Preview",
    instancing: "multi-instance",
    minimumCtx: "profile",
    defaultPlacement: "float",
    minSize: { width: 400, height: 300 },
    intents: ["browser:preview", "browser:open"],
  },
  files: {
    appId: "files",
    displayName: "Files",
    instancing: "worktree-instance",
    minimumCtx: "project",
    defaultPlacement: "tile",
    minSize: { width: 240, height: 200 },
    intents: ["file:reveal"],
  },
  search: {
    appId: "search",
    displayName: "Search",
    instancing: "worktree-instance",
    minimumCtx: "project",
    defaultPlacement: "tile",
    minSize: { width: 280, height: 240 },
    intents: ["search:query"],
  },
  changes: {
    appId: "changes",
    displayName: "Changes",
    instancing: "worktree-instance",
    minimumCtx: "project",
    defaultPlacement: "tile",
    minSize: { width: 300, height: 240 },
    intents: ["changes:diff", "changes:commit", "changes:stage"],
  },
  git: {
    appId: "git",
    displayName: "Git",
    instancing: "worktree-instance",
    minimumCtx: "project",
    defaultPlacement: "tile",
    minSize: { width: 380, height: 280 },
    intents: ["git:status", "git:diff", "git:history", "git:branch"],
  },
  "conflict-resolver": {
    appId: "conflict-resolver",
    displayName: "Conflict Resolver",
    instancing: "project-instance",
    minimumCtx: "project",
    defaultPlacement: "float",
    minSize: { width: 500, height: 400 },
    intents: ["conflict:resolve", "conflict:reveal"],
  },
  "session-changes": {
    appId: "session-changes",
    displayName: "Session Changes",
    instancing: "tuple-instance",
    minimumCtx: "profile",
    defaultPlacement: "float",
    minSize: { width: 500, height: 400 },
    intents: ["session-changes:open"],
  },
  "workflow-plans": {
    appId: "workflow-plans",
    displayName: "Workflow & Plans",
    instancing: "project-instance",
    minimumCtx: "project",
    defaultPlacement: "tile",
    minSize: { width: 340, height: 280 },
    intents: ["workflow:open-item", "workflow:open-plan"],
  },
  "ports-tunnels": {
    appId: "ports-tunnels",
    displayName: "Ports & Tunnels",
    instancing: "profile-instance",
    minimumCtx: "profile",
    defaultPlacement: "float",
    minSize: { width: 420, height: 320 },
    intents: ["ports:open", "ports:open-tunnel"],
  },
  "project-info": {
    appId: "project-info",
    displayName: "Project Info",
    instancing: "project-instance",
    minimumCtx: "project",
    defaultPlacement: "float",
    minSize: { width: 400, height: 320 },
    intents: ["project:info", "project:config"],
  },
  "agent-store": {
    appId: "agent-store",
    displayName: "Agent Store",
    instancing: "profile-instance",
    minimumCtx: "profile",
    defaultPlacement: "tile",
    minSize: { width: 480, height: 360 },
    intents: ["agent-store:open"],
  },
  settings: {
    appId: "settings",
    displayName: "Settings",
    instancing: "single-instance",
    minimumCtx: "none",
    defaultPlacement: "tile",
    minSize: { width: 480, height: 360 },
    intents: ["settings:open", "settings:devices"],
  },
};

export function getAppManifest(appId: OsAppId): AppManifest | undefined {
  return APP_MANIFESTS[appId];
}

export function listAppManifests(): AppManifest[] {
  return Object.values(APP_MANIFESTS);
}

export function isAppId(id: string): id is OsAppId {
  return Object.prototype.hasOwnProperty.call(APP_MANIFESTS, id);
}

export function findExistingWindowForApp(
  windows: Record<string, OsWindow>,
  appId: OsAppId,
  ctx: WindowContext,
  appState?: Record<string, unknown>,
): OsWindow | undefined {
  const manifest = APP_MANIFESTS[appId];
  if (!manifest) return undefined;

  const windowList = Object.values(windows);

  if (manifest.instancing === "single-instance") {
    return windowList.find((w) => w.appId === appId);
  }

  if (manifest.instancing === "profile-instance") {
    return windowList.find(
      (w) => w.appId === appId && w.ctx.profileId === ctx.profileId,
    );
  }

  if (manifest.instancing === "project-instance") {
    if (appId === "conflict-resolver") {
      const targetRoot = (appState?.root as string | undefined) ?? ctx.gitRootId;
      const targetOp =
        (appState?.operation as string | undefined) ?? ctx.operation;
      return windowList.find(
        (w) =>
          w.appId === "conflict-resolver" &&
          w.ctx.profileId === ctx.profileId &&
          w.ctx.projectId === ctx.projectId &&
          w.ctx.worktreeId === ctx.worktreeId &&
          ((w.appState?.root as string | undefined) ?? w.ctx.gitRootId) ===
            targetRoot &&
          ((w.appState?.operation as string | undefined) ?? w.ctx.operation) ===
            targetOp,
      );
    }
    return windowList.find(
      (w) =>
        w.appId === appId &&
        w.ctx.profileId === ctx.profileId &&
        w.ctx.projectId === ctx.projectId,
    );
  }

  if (manifest.instancing === "worktree-instance") {
    return windowList.find(
      (w) =>
        w.appId === appId &&
        w.ctx.profileId === ctx.profileId &&
        w.ctx.projectId === ctx.projectId &&
        w.ctx.worktreeId === ctx.worktreeId,
    );
  }

  if (manifest.instancing === "tuple-instance") {
    const terminalId = appState?.terminalId;
    const incarnation = appState?.terminalIncarnation;
    const ompSession = appState?.ompSessionId;
    const rootId = appState?.rootId ?? ".";
    const generation =
      ctx.generation ?? (appState?.generation as number | undefined);
    return windowList.find(
      (w) =>
        w.appId === appId &&
        w.ctx.profileId === ctx.profileId &&
        (generation === undefined ||
          (w.ctx.generation ?? w.appState?.generation) === undefined ||
          (w.ctx.generation ?? w.appState?.generation) === generation) &&
        w.appState?.terminalId === terminalId &&
        w.appState?.terminalIncarnation === incarnation &&
        w.appState?.ompSessionId === ompSession &&
        (w.appState?.rootId ?? ".") === rootId,
    );
  }

  return undefined;
}
