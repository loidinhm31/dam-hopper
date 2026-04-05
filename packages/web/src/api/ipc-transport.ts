/**
 * IpcTransport — wraps window.devhub.* (Electron contextBridge).
 *
 * This is a behavioral no-op for desktop mode: all calls are
 * 1:1 delegated to the existing preload bridge.
 *
 * The invoke() method uses the channel name to route to the correct
 * preload method so that client.ts can call transport.invoke(channel, data)
 * for all request/response operations.
 */

import type { Transport } from "./transport.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

type DevHub = typeof window.devhub;

/** Map IPC channel strings to preload method calls. */
function invokeOnBridge(devhub: DevHub, channel: string, data: unknown): Promise<unknown> {
  switch (channel) {
    // Workspace
    case "workspace:get": return devhub.workspace.get();
    case "workspace:switch": return devhub.workspace.switch(data as string);
    case "workspace:known": return devhub.workspace.known();
    case "workspace:addKnown": return devhub.workspace.addKnown(data as string);
    case "workspace:removeKnown": return devhub.workspace.removeKnown(data as string);
    case "workspace:open-dialog": return devhub.workspace.openDialog();
    case "workspace:status": return devhub.workspace.status();
    case "workspace:init": return devhub.workspace.init(data as string);

    // Global config
    case "globalConfig:get": return devhub.globalConfig.get();
    case "globalConfig:updateDefaults":
      return devhub.globalConfig.updateDefaults(data as { workspace?: string });

    // Projects
    case "projects:list": return devhub.projects.list();
    case "projects:get": return devhub.projects.get(data as string);
    case "projects:status": return devhub.projects.status(data as string);

    // Git
    case "git:fetch": return devhub.git.fetch(data as string[] | undefined);
    case "git:pull": return devhub.git.pull(data as string[] | undefined);
    case "git:push": return devhub.git.push(data as string);
    case "git:worktrees": return devhub.git.worktrees(data as string);
    case "git:addWorktree": {
      const d = data as { project: string; options: { path: string; branch: string; createBranch?: boolean } };
      return devhub.git.addWorktree(d.project, d.options);
    }
    case "git:removeWorktree": {
      const d = data as { project: string; path: string };
      return devhub.git.removeWorktree(d.project, d.path);
    }
    case "git:branches": return devhub.git.branches(data as string);
    case "git:updateBranch": {
      const d = data as { project: string; branch?: string };
      return devhub.git.updateBranch(d.project, d.branch);
    }

    // Config
    case "config:get": return devhub.config.get();
    case "config:update": return devhub.config.update(data as any);
    case "config:updateProject": {
      const d = data as { name: string; patch: any };
      return devhub.config.updateProject(d.name, d.patch);
    }

    // SSH
    case "ssh:addKey": {
      const d = data as { passphrase: string; keyPath?: string };
      return devhub.ssh.addKey(d.passphrase, d.keyPath);
    }
    case "ssh:checkAgent": return devhub.ssh.checkAgent();
    case "ssh:listKeys": return devhub.ssh.listKeys();

    // Settings
    case "cache:clear": return devhub.settings.clearCache();
    case "workspace:reset": return devhub.settings.reset();
    case "settings:export": return devhub.settings.exportConfig();
    case "settings:import": return devhub.settings.importConfig();

    // Commands
    case "commands:search": {
      const d = data as { query: string; projectType?: string; limit?: number };
      return devhub.commands.search(d.query, d.projectType, d.limit);
    }
    case "commands:list": {
      const d = data as { projectType: string };
      return devhub.commands.list(d.projectType);
    }

    // Terminal
    case "terminal:create": return devhub.terminal.create(data as any);
    case "terminal:list": return devhub.terminal.list();
    case "terminal:listDetailed": return devhub.terminal.listDetailed();
    case "terminal:buffer": return devhub.terminal.getBuffer(data as string);
    case "terminal:kill": {
      devhub.terminal.kill(data as string);
      return Promise.resolve();
    }
    case "terminal:remove": {
      devhub.terminal.remove(data as string);
      return Promise.resolve();
    }

    // Agent Store
    case "agent-store:list": return devhub.agentStore.list(data as any);
    case "agent-store:get": return devhub.agentStore.get(data as any);
    case "agent-store:getContent": return devhub.agentStore.getContent(data as any);
    case "agent-store:add": return devhub.agentStore.add(data as any);
    case "agent-store:remove": return devhub.agentStore.remove(data as any);
    case "agent-store:ship": return devhub.agentStore.ship(data as any);
    case "agent-store:unship": return devhub.agentStore.unship(data as any);
    case "agent-store:absorb": return devhub.agentStore.absorb(data as any);
    case "agent-store:bulkShip": return devhub.agentStore.bulkShip(data as any);
    case "agent-store:matrix": return devhub.agentStore.matrix();
    case "agent-store:scan": return devhub.agentStore.scan();
    case "agent-store:health": return devhub.agentStore.health();

    // Agent Memory
    case "agent-memory:list": return devhub.agentMemory.list(data as any);
    case "agent-memory:get": return devhub.agentMemory.get(data as any);
    case "agent-memory:update": return devhub.agentMemory.update(data as any);
    case "agent-memory:templates": return devhub.agentMemory.templates();
    case "agent-memory:apply": return devhub.agentMemory.apply(data as any);

    // Agent Import
    case "agent-store:importScan": return devhub.agentImport.scan(data as any);
    case "agent-store:importScanLocal": return devhub.agentImport.scanLocal(data as any);
    case "agent-store:importConfirm": return devhub.agentImport.confirm(data as any);

    default:
      return Promise.reject(new Error(`Unknown IPC channel: ${channel}`));
  }
}

export class IpcTransport implements Transport {
  private get devhub(): DevHub {
    return window.devhub;
  }

  invoke<T>(channel: string, data?: unknown): Promise<T> {
    return invokeOnBridge(this.devhub, channel, data) as Promise<T>;
  }

  onTerminalData(id: string, cb: (data: string) => void): () => void {
    return this.devhub.terminal.onData(id, cb);
  }

  onTerminalExit(id: string, cb: (exitCode: number | null) => void): () => void {
    return this.devhub.terminal.onExit(id, cb);
  }

  onEvent(channel: string, cb: (payload: unknown) => void): () => void {
    return this.devhub.on(channel, cb);
  }

  terminalWrite(id: string, data: string): void {
    this.devhub.terminal.write(id, data);
  }

  terminalResize(id: string, cols: number, rows: number): void {
    this.devhub.terminal.resize(id, cols, rows);
  }
}
