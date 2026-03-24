import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import { CH, EVENT_CHANNELS } from "../ipc-channels.js";

type Unsubscribe = () => void;

/** Stores wrapped listeners so off() can remove the correct wrapper. */
const listenerRegistry = new Map<
  string,
  Map<(data: unknown) => void, (_e: IpcRendererEvent, data: unknown) => void>
>();

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
    addKnown: (path: string) =>
      ipcRenderer.invoke(CH.WORKSPACE_ADD_KNOWN, path),
    removeKnown: (path: string) =>
      ipcRenderer.invoke(CH.WORKSPACE_REMOVE_KNOWN, path),
    openDialog: () => ipcRenderer.invoke(CH.WORKSPACE_OPEN_DIALOG),
    status: () => ipcRenderer.invoke(CH.WORKSPACE_STATUS),
    init: (path: string) => ipcRenderer.invoke(CH.WORKSPACE_INIT, path),
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
    branches: (project: string) => ipcRenderer.invoke(CH.GIT_BRANCHES, project),
    updateBranch: (project: string, branch?: string) =>
      ipcRenderer.invoke(CH.GIT_UPDATE_BRANCH, project, branch),
  },

  config: {
    get: () => ipcRenderer.invoke(CH.CONFIG_GET),
    update: (config: unknown) => ipcRenderer.invoke(CH.CONFIG_UPDATE, config),
    updateProject: (name: string, data: unknown) =>
      ipcRenderer.invoke(CH.CONFIG_UPDATE_PROJECT, name, data),
  },

  ssh: {
    addKey: (passphrase: string, keyPath?: string) =>
      ipcRenderer.invoke(CH.SSH_ADD_KEY, passphrase, keyPath),
    checkAgent: () => ipcRenderer.invoke(CH.SSH_CHECK_AGENT),
    listKeys: () => ipcRenderer.invoke(CH.SSH_LIST_KEYS),
  },

  terminal: {
    create: (opts: {
      id: string;
      project: string;
      command: string;
      cols: number;
      rows: number;
    }) => ipcRenderer.invoke(CH.TERMINAL_CREATE, opts),

    write: (id: string, data: string) =>
      ipcRenderer.send(CH.TERMINAL_WRITE, { id, data }),

    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send(CH.TERMINAL_RESIZE, { id, cols, rows }),

    kill: (id: string) => ipcRenderer.send(CH.TERMINAL_KILL, { id }),

    list: () => ipcRenderer.invoke(CH.TERMINAL_LIST),

    listDetailed: () => ipcRenderer.invoke(CH.TERMINAL_LIST_DETAILED),

    getBuffer: (id: string): Promise<string> =>
      ipcRenderer.invoke(CH.TERMINAL_BUFFER, id),

    onData: (id: string, cb: (data: string) => void): Unsubscribe => {
      const channel = `terminal:data:${id}`;
      const listener = (_e: IpcRendererEvent, data: string) => cb(data);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },

    onExit: (
      id: string,
      cb: (exitCode: number | null) => void,
    ): Unsubscribe => {
      const channel = `terminal:exit:${id}`;
      const listener = (
        _e: IpcRendererEvent,
        payload: { exitCode: number | null },
      ) => cb(payload.exitCode);
      ipcRenderer.once(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },

  on(channel: string, callback: (data: unknown) => void): Unsubscribe {
    const listener = (_event: IpcRendererEvent, data: unknown) =>
      callback(data);
    ipcRenderer.on(channel, listener);
    // Register wrapper so off() can remove the correct listener
    if (!listenerRegistry.has(channel)) {
      listenerRegistry.set(channel, new Map());
    }
    listenerRegistry.get(channel)!.set(callback, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
      listenerRegistry.get(channel)?.delete(callback);
    };
  },

  off(channel: string, callback: (data: unknown) => void): void {
    const listener = listenerRegistry.get(channel)?.get(callback);
    if (listener) {
      ipcRenderer.removeListener(channel, listener);
      listenerRegistry.get(channel)!.delete(callback);
    }
  },

  /** All push-event channel names — renderer uses these to subscribe */
  eventChannels: EVENT_CHANNELS,
});
