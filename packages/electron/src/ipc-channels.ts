/** Single source of truth for all IPC channel names. */

// ── Request/response channels ─────────────────────────────────────────────────
export const CH = {
  // Workspace
  WORKSPACE_GET: "workspace:get",
  WORKSPACE_SWITCH: "workspace:switch",
  WORKSPACE_KNOWN: "workspace:known",
  WORKSPACE_ADD_KNOWN: "workspace:addKnown",
  WORKSPACE_REMOVE_KNOWN: "workspace:removeKnown",
  WORKSPACE_OPEN_DIALOG: "workspace:open-dialog",

  // Global config
  GLOBAL_CONFIG_GET: "globalConfig:get",
  GLOBAL_CONFIG_UPDATE_DEFAULTS: "globalConfig:updateDefaults",

  // Projects
  PROJECTS_LIST: "projects:list",
  PROJECTS_GET: "projects:get",
  PROJECTS_STATUS: "projects:status",

  // Git
  GIT_FETCH: "git:fetch",
  GIT_PULL: "git:pull",
  GIT_PUSH: "git:push",
  GIT_WORKTREES: "git:worktrees",
  GIT_ADD_WORKTREE: "git:addWorktree",
  GIT_REMOVE_WORKTREE: "git:removeWorktree",
  GIT_BRANCHES: "git:branches",
  GIT_UPDATE_BRANCH: "git:updateBranch",

  // Config
  CONFIG_GET: "config:get",
  CONFIG_UPDATE: "config:update",
  CONFIG_UPDATE_PROJECT: "config:updateProject",

  // Terminal (PTY)
  TERMINAL_CREATE: "terminal:create",
  TERMINAL_WRITE: "terminal:write",
  TERMINAL_RESIZE: "terminal:resize",
  TERMINAL_KILL: "terminal:kill",
  TERMINAL_LIST: "terminal:list",
} as const;

// ── Push event channels (main → renderer) ─────────────────────────────────────
export const EV = {
  GIT_PROGRESS: "git:progress",
  STATUS_CHANGED: "status:changed",
  CONFIG_CHANGED: "config:changed",
  WORKSPACE_CHANGED: "workspace:changed",
  // terminal:data:${id} and terminal:exit:${id} are dynamic — not in this list
} as const;

export type EventChannel = (typeof EV)[keyof typeof EV];

/** All push event channels — used by preload to register listeners and by renderer to subscribe. */
export const EVENT_CHANNELS: EventChannel[] = Object.values(EV);
