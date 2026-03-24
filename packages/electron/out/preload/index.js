"use strict";
const electron = require("electron");
const CH = {
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
  // Terminal (PTY)
  TERMINAL_CREATE: "terminal:create",
  TERMINAL_WRITE: "terminal:write",
  TERMINAL_RESIZE: "terminal:resize",
  TERMINAL_KILL: "terminal:kill",
  TERMINAL_LIST: "terminal:list",
  TERMINAL_LIST_DETAILED: "terminal:listDetailed",
  TERMINAL_BUFFER: "terminal:buffer"
};
const EV = {
  GIT_PROGRESS: "git:progress",
  STATUS_CHANGED: "status:changed",
  CONFIG_CHANGED: "config:changed",
  WORKSPACE_CHANGED: "workspace:changed"
  // terminal:data:${id} and terminal:exit:${id} are dynamic — not in this list
};
const EVENT_CHANNELS = Object.values(EV);
const listenerRegistry = /* @__PURE__ */ new Map();
electron.contextBridge.exposeInMainWorld("devhub", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node
  },
  workspace: {
    get: () => electron.ipcRenderer.invoke(CH.WORKSPACE_GET),
    switch: (path) => electron.ipcRenderer.invoke(CH.WORKSPACE_SWITCH, path),
    known: () => electron.ipcRenderer.invoke(CH.WORKSPACE_KNOWN),
    addKnown: (path) => electron.ipcRenderer.invoke(CH.WORKSPACE_ADD_KNOWN, path),
    removeKnown: (path) => electron.ipcRenderer.invoke(CH.WORKSPACE_REMOVE_KNOWN, path),
    openDialog: () => electron.ipcRenderer.invoke(CH.WORKSPACE_OPEN_DIALOG),
    status: () => electron.ipcRenderer.invoke(CH.WORKSPACE_STATUS),
    init: (path) => electron.ipcRenderer.invoke(CH.WORKSPACE_INIT, path)
  },
  globalConfig: {
    get: () => electron.ipcRenderer.invoke(CH.GLOBAL_CONFIG_GET),
    updateDefaults: (defaults) => electron.ipcRenderer.invoke(CH.GLOBAL_CONFIG_UPDATE_DEFAULTS, defaults)
  },
  projects: {
    list: () => electron.ipcRenderer.invoke(CH.PROJECTS_LIST),
    get: (name) => electron.ipcRenderer.invoke(CH.PROJECTS_GET, name),
    status: (name) => electron.ipcRenderer.invoke(CH.PROJECTS_STATUS, name)
  },
  git: {
    fetch: (projects) => electron.ipcRenderer.invoke(CH.GIT_FETCH, projects),
    pull: (projects) => electron.ipcRenderer.invoke(CH.GIT_PULL, projects),
    push: (project) => electron.ipcRenderer.invoke(CH.GIT_PUSH, project),
    worktrees: (project) => electron.ipcRenderer.invoke(CH.GIT_WORKTREES, project),
    addWorktree: (project, options) => electron.ipcRenderer.invoke(CH.GIT_ADD_WORKTREE, project, options),
    removeWorktree: (project, path) => electron.ipcRenderer.invoke(CH.GIT_REMOVE_WORKTREE, project, path),
    branches: (project) => electron.ipcRenderer.invoke(CH.GIT_BRANCHES, project),
    updateBranch: (project, branch) => electron.ipcRenderer.invoke(CH.GIT_UPDATE_BRANCH, project, branch)
  },
  config: {
    get: () => electron.ipcRenderer.invoke(CH.CONFIG_GET),
    update: (config) => electron.ipcRenderer.invoke(CH.CONFIG_UPDATE, config),
    updateProject: (name, data) => electron.ipcRenderer.invoke(CH.CONFIG_UPDATE_PROJECT, name, data)
  },
  ssh: {
    addKey: (passphrase, keyPath) => electron.ipcRenderer.invoke(CH.SSH_ADD_KEY, passphrase, keyPath),
    checkAgent: () => electron.ipcRenderer.invoke(CH.SSH_CHECK_AGENT),
    listKeys: () => electron.ipcRenderer.invoke(CH.SSH_LIST_KEYS)
  },
  settings: {
    clearCache: () => electron.ipcRenderer.invoke(CH.CACHE_CLEAR),
    reset: () => electron.ipcRenderer.invoke(CH.WORKSPACE_RESET),
    exportConfig: () => electron.ipcRenderer.invoke(CH.SETTINGS_EXPORT),
    importConfig: () => electron.ipcRenderer.invoke(CH.SETTINGS_IMPORT)
  },
  terminal: {
    create: (opts) => electron.ipcRenderer.invoke(CH.TERMINAL_CREATE, opts),
    write: (id, data) => electron.ipcRenderer.send(CH.TERMINAL_WRITE, { id, data }),
    resize: (id, cols, rows) => electron.ipcRenderer.send(CH.TERMINAL_RESIZE, { id, cols, rows }),
    kill: (id) => electron.ipcRenderer.send(CH.TERMINAL_KILL, { id }),
    list: () => electron.ipcRenderer.invoke(CH.TERMINAL_LIST),
    listDetailed: () => electron.ipcRenderer.invoke(CH.TERMINAL_LIST_DETAILED),
    getBuffer: (id) => electron.ipcRenderer.invoke(CH.TERMINAL_BUFFER, id),
    onData: (id, cb) => {
      const channel = `terminal:data:${id}`;
      const listener = (_e, data) => cb(data);
      electron.ipcRenderer.on(channel, listener);
      return () => electron.ipcRenderer.removeListener(channel, listener);
    },
    onExit: (id, cb) => {
      const channel = `terminal:exit:${id}`;
      const listener = (_e, payload) => cb(payload.exitCode);
      electron.ipcRenderer.once(channel, listener);
      return () => electron.ipcRenderer.removeListener(channel, listener);
    }
  },
  on(channel, callback) {
    const listener = (_event, data) => callback(data);
    electron.ipcRenderer.on(channel, listener);
    if (!listenerRegistry.has(channel)) {
      listenerRegistry.set(channel, /* @__PURE__ */ new Map());
    }
    listenerRegistry.get(channel).set(callback, listener);
    return () => {
      electron.ipcRenderer.removeListener(channel, listener);
      listenerRegistry.get(channel)?.delete(callback);
    };
  },
  off(channel, callback) {
    const listener = listenerRegistry.get(channel)?.get(callback);
    if (listener) {
      electron.ipcRenderer.removeListener(channel, listener);
      listenerRegistry.get(channel).delete(callback);
    }
  },
  /** All push-event channel names — renderer uses these to subscribe */
  eventChannels: EVENT_CHANNELS
});
