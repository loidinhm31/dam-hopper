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
  WORKSPACE_STATUS: "workspace:status",
  WORKSPACE_INIT: "workspace:init",

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

  // SSH
  SSH_ADD_KEY: "ssh:addKey",
  SSH_CHECK_AGENT: "ssh:checkAgent",
  SSH_LIST_KEYS: "ssh:listKeys",

  // Settings & Maintenance
  CACHE_CLEAR: "cache:clear",
  WORKSPACE_RESET: "workspace:reset",
  SETTINGS_EXPORT: "settings:export",
  SETTINGS_IMPORT: "settings:import",

  // Commands (predefined command database)
  COMMAND_SEARCH: "commands:search",
  COMMAND_LIST: "commands:list",

  // Terminal (PTY)
  TERMINAL_CREATE: "terminal:create",
  TERMINAL_WRITE: "terminal:write",
  TERMINAL_RESIZE: "terminal:resize",
  TERMINAL_KILL: "terminal:kill",
  TERMINAL_LIST: "terminal:list",
  TERMINAL_LIST_DETAILED: "terminal:listDetailed",
  TERMINAL_BUFFER: "terminal:buffer",

  // Agent Store — CRUD
  AGENT_STORE_INIT: "agent-store:init",
  AGENT_STORE_LIST: "agent-store:list",
  AGENT_STORE_GET: "agent-store:get",
  AGENT_STORE_GET_CONTENT: "agent-store:getContent",
  AGENT_STORE_ADD: "agent-store:add",
  AGENT_STORE_REMOVE: "agent-store:remove",

  // Agent Store — Distribution
  AGENT_STORE_SHIP: "agent-store:ship",
  AGENT_STORE_UNSHIP: "agent-store:unship",
  AGENT_STORE_BULK_SHIP: "agent-store:bulkShip",
  AGENT_STORE_ABSORB: "agent-store:absorb",
  AGENT_STORE_MATRIX: "agent-store:matrix",

  // Agent Store — Scanner / Health
  AGENT_STORE_SCAN: "agent-store:scan",
  AGENT_STORE_HEALTH: "agent-store:health",

  // Agent Store — Memory files
  AGENT_MEMORY_LIST: "agent-memory:list",
  AGENT_MEMORY_GET: "agent-memory:get",
  AGENT_MEMORY_UPDATE: "agent-memory:update",
  AGENT_MEMORY_TEMPLATES: "agent-memory:templates",
  AGENT_MEMORY_APPLY: "agent-memory:apply",

  // Agent Store — Import from repo
  AGENT_STORE_IMPORT_SCAN: "agent-store:importScan",
  AGENT_STORE_IMPORT_CONFIRM: "agent-store:importConfirm",
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
