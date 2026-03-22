import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import { CH, EVENT_CHANNELS } from "../ipc-channels.js";

type Unsubscribe = () => void;

contextBridge.exposeInMainWorld("devhub", {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
  },

  workspace: {
    get: () => ipcRenderer.invoke(CH.WORKSPACE_GET),
    switch: (path: string) => ipcRenderer.invoke(CH.WORKSPACE_SWITCH, path),
    known: () => ipcRenderer.invoke(CH.WORKSPACE_KNOWN),
    addKnown: (path: string) => ipcRenderer.invoke(CH.WORKSPACE_ADD_KNOWN, path),
    removeKnown: (path: string) =>
      ipcRenderer.invoke(CH.WORKSPACE_REMOVE_KNOWN, path),
    openDialog: () => ipcRenderer.invoke(CH.WORKSPACE_OPEN_DIALOG),
  },

  globalConfig: {
    get: () => ipcRenderer.invoke(CH.GLOBAL_CONFIG_GET),
    updateDefaults: (defaults: { workspace?: string }) =>
      ipcRenderer.invoke(CH.GLOBAL_CONFIG_UPDATE_DEFAULTS, defaults),
  },

  projects: {
    list: () => ipcRenderer.invoke(CH.PROJECTS_LIST),
    get: (name: string) => ipcRenderer.invoke(CH.PROJECTS_GET, name),
    status: (name: string) => ipcRenderer.invoke(CH.PROJECTS_STATUS, name),
  },

  git: {
    fetch: (projects?: string[]) => ipcRenderer.invoke(CH.GIT_FETCH, projects),
    pull: (projects?: string[]) => ipcRenderer.invoke(CH.GIT_PULL, projects),
    push: (project: string) => ipcRenderer.invoke(CH.GIT_PUSH, project),
    worktrees: (project: string) =>
      ipcRenderer.invoke(CH.GIT_WORKTREES, project),
    addWorktree: (
      project: string,
      options: { path: string; branch: string; createBranch?: boolean },
    ) => ipcRenderer.invoke(CH.GIT_ADD_WORKTREE, project, options),
    removeWorktree: (project: string, path: string) =>
      ipcRenderer.invoke(CH.GIT_REMOVE_WORKTREE, project, path),
    branches: (project: string) =>
      ipcRenderer.invoke(CH.GIT_BRANCHES, project),
    updateBranch: (project: string, branch?: string) =>
      ipcRenderer.invoke(CH.GIT_UPDATE_BRANCH, project, branch),
  },

  config: {
    get: () => ipcRenderer.invoke(CH.CONFIG_GET),
    update: (config: unknown) => ipcRenderer.invoke(CH.CONFIG_UPDATE, config),
    updateProject: (name: string, data: unknown) =>
      ipcRenderer.invoke(CH.CONFIG_UPDATE_PROJECT, name, data),
  },

  build: {
    start: (project: string, service?: string) =>
      ipcRenderer.invoke(CH.BUILD_START, project, service),
  },

  exec: {
    run: (project: string, command: string) =>
      ipcRenderer.invoke(CH.EXEC_RUN, project, command),
  },

  processes: {
    list: () => ipcRenderer.invoke(CH.PROCESSES_LIST),
    start: (project: string, service?: string) =>
      ipcRenderer.invoke(CH.RUN_START, project, service),
    stop: (project: string, service?: string) =>
      ipcRenderer.invoke(CH.RUN_STOP, project, service),
    restart: (project: string, service?: string) =>
      ipcRenderer.invoke(CH.RUN_RESTART, project, service),
    logs: (project: string, service?: string, lines?: number) =>
      ipcRenderer.invoke(CH.RUN_LOGS, project, service, lines),
  },

  on(channel: string, callback: (data: unknown) => void): Unsubscribe {
    const listener = (_event: IpcRendererEvent, data: unknown) =>
      callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  off(channel: string, callback: (data: unknown) => void): void {
    ipcRenderer.removeAllListeners(channel);
    void callback;
  },

  /** All push-event channel names — renderer uses these to subscribe */
  eventChannels: EVENT_CHANNELS,

  // Phase 03: terminal methods added here
  terminal: {},
});
