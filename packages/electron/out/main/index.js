"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const node_path = require("node:path");
const node_os = require("node:os");
const promises = require("node:fs/promises");
const Store = require("electron-store");
const core = require("@dev-hub/core");
const nodePty = require("node-pty");
const path = require("path");
const node_child_process = require("node:child_process");
const node_util = require("node:util");
function getMainWindow() {
  return electron.BrowserWindow.getAllWindows()[0];
}
const SESSION_ID_RE = /^[\w:.-]+$/;
const SCROLLBACK_LIMIT = 256 * 1024;
const DEAD_META_TTL_MS = 6e4;
function deriveType(id) {
  if (id.startsWith("build:")) return "build";
  if (id.startsWith("run:")) return "run";
  if (id.startsWith("custom:")) return "custom";
  if (id.startsWith("shell:")) return "shell";
  if (id.startsWith("terminal:")) return "terminal";
  return "unknown";
}
class PtySessionManager {
  sessions = /* @__PURE__ */ new Map();
  scrollback = /* @__PURE__ */ new Map();
  meta = /* @__PURE__ */ new Map();
  cleanupTimers = /* @__PURE__ */ new Map();
  create(opts) {
    if (!SESSION_ID_RE.test(opts.id)) {
      throw new Error(`Invalid session id: "${opts.id}"`);
    }
    this.kill(opts.id);
    this.scrollback.set(opts.id, "");
    const sessionMeta = {
      id: opts.id,
      project: opts.project ?? "",
      command: opts.command,
      cwd: opts.cwd,
      type: deriveType(opts.id),
      alive: true,
      startedAt: Date.now()
    };
    this.meta.set(opts.id, sessionMeta);
    console.log(`[pty] create id=${opts.id} cmd="${opts.command}"`);
    const pty = nodePty.spawn(
      process.platform === "win32" ? "cmd.exe" : "/bin/sh",
      process.platform === "win32" ? [] : ["-c", opts.command],
      {
        name: "xterm-256color",
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.cwd,
        env: { ...opts.env }
      }
    );
    if (process.platform === "win32") {
      pty.write(`${opts.command}\r`);
    }
    this.sessions.set(opts.id, pty);
    pty.onData((data) => {
      const current = this.scrollback.get(opts.id) ?? "";
      const next = current + data;
      this.scrollback.set(
        opts.id,
        next.length > SCROLLBACK_LIMIT ? next.slice(next.length - SCROLLBACK_LIMIT) : next
      );
      getMainWindow()?.webContents.send(`terminal:data:${opts.id}`, data);
    });
    pty.onExit(({ exitCode }) => {
      console.log(`[pty] exit id=${opts.id} code=${exitCode}`);
      this.sessions.delete(opts.id);
      const m = this.meta.get(opts.id);
      if (m) {
        m.alive = false;
        m.exitCode = exitCode;
      }
      this.scheduleMetaCleanup(opts.id);
      getMainWindow()?.webContents.send(`terminal:exit:${opts.id}`, {
        exitCode
      });
    });
  }
  write(id, data) {
    this.sessions.get(id)?.write(data);
  }
  resize(id, cols, rows) {
    this.sessions.get(id)?.resize(cols, rows);
  }
  getBuffer(id) {
    return this.scrollback.get(id) ?? "";
  }
  kill(id, signal) {
    const pty = this.sessions.get(id);
    if (pty) {
      console.log(`[pty] kill id=${id}`);
      try {
        pty.kill(signal);
      } catch {
      }
      this.sessions.delete(id);
    }
    const m = this.meta.get(id);
    if (m && m.alive) {
      m.alive = false;
      m.exitCode = null;
      this.scheduleMetaCleanup(id);
    }
    this.scrollback.delete(id);
  }
  isAlive(id) {
    return this.sessions.has(id);
  }
  getAll() {
    return Array.from(this.sessions.keys());
  }
  getDetailed() {
    return Array.from(this.meta.values());
  }
  dispose() {
    console.log(`[pty] dispose all (${this.sessions.size} sessions)`);
    for (const id of [...this.sessions.keys()]) {
      this.kill(id);
    }
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    this.meta.clear();
  }
  scheduleMetaCleanup(id) {
    const existing = this.cleanupTimers.get(id);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => {
      this.meta.delete(id);
      this.cleanupTimers.delete(id);
    }, DEAD_META_TTL_MS);
    this.cleanupTimers.set(id, handle);
  }
}
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
  CONFIG_CHANGED: "config:changed",
  WORKSPACE_CHANGED: "workspace:changed"
  // terminal:data:${id} and terminal:exit:${id} are dynamic — not in this list
};
function registerPreWorkspaceHandlers(holder) {
  electron.ipcMain.handle(CH.WORKSPACE_STATUS, () => {
    const ctx = holder.current;
    if (!ctx) return { ready: false };
    return { ready: true, name: ctx.config.workspace.name, root: ctx.workspaceRoot };
  });
  electron.ipcMain.handle(CH.WORKSPACE_KNOWN, async () => {
    const workspaces = await core.listKnownWorkspaces();
    return { workspaces, current: holder.current?.workspaceRoot ?? null };
  });
  electron.ipcMain.handle(CH.WORKSPACE_OPEN_DIALOG, async () => {
    const result = await electron.dialog.showOpenDialog({
      title: "Select workspace folder",
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}
function registerWorkspaceHandlers(holder) {
  electron.ipcMain.handle(CH.WORKSPACE_GET, () => {
    const ctx = holder.current;
    return {
      name: ctx.config.workspace.name,
      root: ctx.workspaceRoot,
      projectCount: ctx.config.projects.length
    };
  });
  electron.ipcMain.handle(CH.WORKSPACE_SWITCH, async (_e, path2) => {
    if (!path2) throw new Error("path is required");
    const absPath = node_path.resolve(path2);
    const home = node_os.homedir();
    const realAbs = await promises.realpath(absPath).catch(() => absPath);
    if (realAbs !== home && !realAbs.startsWith(home + node_path.sep)) {
      throw new Error("path must be within home directory");
    }
    await holder.switchWorkspace(realAbs);
    const ctx = holder.current;
    return {
      name: ctx.config.workspace.name,
      root: ctx.workspaceRoot,
      projectCount: ctx.config.projects.length
    };
  });
  electron.ipcMain.handle(CH.WORKSPACE_ADD_KNOWN, async (_e, path2) => {
    if (!path2) throw new Error("path is required");
    const absPath = node_path.resolve(path2);
    const home = node_os.homedir();
    const realAbs = await promises.realpath(absPath).catch(() => absPath);
    if (realAbs !== home && !realAbs.startsWith(home + node_path.sep)) {
      throw new Error("path must be within home directory");
    }
    const s = await promises.stat(realAbs).catch(() => null);
    if (!s) throw new Error(`Path not found: ${realAbs}`);
    if (!s.isDirectory()) throw new Error("path must be a directory");
    let configPath = await core.findConfigFile(realAbs);
    let workspaceName;
    if (!configPath) {
      const discovered = await core.discoverProjects(realAbs);
      workspaceName = node_path.basename(realAbs);
      const newConfig = {
        workspace: { name: workspaceName, root: "." },
        projects: discovered.map((p) => ({
          name: p.name,
          path: p.path,
          type: p.type,
          services: void 0,
          commands: void 0,
          terminals: [],
          envFile: void 0,
          tags: void 0
        }))
      };
      const tomlPath = node_path.join(realAbs, "dev-hub.toml");
      await core.writeConfig(tomlPath, newConfig);
      configPath = tomlPath;
    } else {
      const existing = await core.readConfig(configPath);
      workspaceName = existing.workspace.name;
    }
    await core.addKnownWorkspace(workspaceName, realAbs);
    return { name: workspaceName, path: realAbs };
  });
  electron.ipcMain.handle(CH.WORKSPACE_REMOVE_KNOWN, async (_e, path2) => {
    if (!path2) throw new Error("path is required");
    await core.removeKnownWorkspace(node_path.resolve(path2));
    return { removed: true };
  });
  electron.ipcMain.handle(CH.GLOBAL_CONFIG_GET, async () => {
    return await core.readGlobalConfig() ?? {};
  });
  electron.ipcMain.handle(
    CH.GLOBAL_CONFIG_UPDATE_DEFAULTS,
    async (_e, defaults) => {
      const cfg = await core.readGlobalConfig() ?? {};
      await core.writeGlobalConfig({
        ...cfg,
        defaults: {
          ...cfg.defaults,
          ...defaults.workspace !== void 0 ? { workspace: defaults.workspace } : {}
        }
      });
      return { updated: true };
    }
  );
  electron.ipcMain.handle(CH.PROJECTS_LIST, async () => {
    const ctx = holder.current;
    const statuses = await ctx.bulkGitService.statusAll(ctx.config.projects);
    const statusMap = new Map(statuses.map((s) => [s.projectName, s]));
    return ctx.config.projects.map((p) => ({
      ...p,
      status: statusMap.get(p.name) ?? null
    }));
  });
  electron.ipcMain.handle(CH.PROJECTS_GET, async (_e, name) => {
    const ctx = holder.current;
    const project = ctx.config.projects.find((p) => p.name === name);
    if (!project) throw new Error(`Project "${name}" not found`);
    const [status] = await ctx.bulkGitService.statusAll([project]);
    return { ...project, status: status ?? null };
  });
  electron.ipcMain.handle(CH.PROJECTS_STATUS, async (_e, name) => {
    const ctx = holder.current;
    const project = ctx.config.projects.find((p) => p.name === name);
    if (!project) throw new Error(`Project "${name}" not found`);
    const [status] = await ctx.bulkGitService.statusAll([project]);
    return status ?? null;
  });
}
function validateProjectPath(project, workspaceRoot) {
  const root = workspaceRoot.endsWith("/") ? workspaceRoot : workspaceRoot + "/";
  const resolved = node_path.resolve(workspaceRoot, project.path);
  if (resolved !== workspaceRoot && !resolved.startsWith(root)) {
    throw new Error(
      `Project "${project.name}" path escapes workspace root: ${project.path}`
    );
  }
}
function registerGitHandlers(holder) {
  const inProgress = /* @__PURE__ */ new Set();
  function guard(key, fn) {
    if (inProgress.has(key)) {
      throw Object.assign(
        new Error(`Operation already in progress: "${key}"`),
        {
          code: "CONFLICT"
        }
      );
    }
    inProgress.add(key);
    return fn().finally(() => inProgress.delete(key));
  }
  electron.ipcMain.handle(
    CH.GIT_FETCH,
    (_e, projectNames) => guard("fetch", async () => {
      const ctx = holder.current;
      const projects = projectNames && projectNames.length > 0 ? ctx.config.projects.filter((p) => projectNames.includes(p.name)) : ctx.config.projects;
      return ctx.bulkGitService.fetchAll(projects);
    })
  );
  electron.ipcMain.handle(
    CH.GIT_PULL,
    (_e, projectNames) => guard("pull", async () => {
      const ctx = holder.current;
      const projects = projectNames && projectNames.length > 0 ? ctx.config.projects.filter((p) => projectNames.includes(p.name)) : ctx.config.projects;
      return ctx.bulkGitService.pullAll(projects);
    })
  );
  electron.ipcMain.handle(
    CH.GIT_PUSH,
    (_e, projectName) => guard(`push:${projectName}`, async () => {
      const ctx = holder.current;
      const project = ctx.config.projects.find((p) => p.name === projectName);
      if (!project) throw new Error(`Project "${projectName}" not found`);
      validateProjectPath(project, ctx.workspaceRoot);
      return core.gitPush(project.path, project.name, ctx.bulkGitService.emitter);
    })
  );
  electron.ipcMain.handle(CH.GIT_WORKTREES, async (_e, projectName) => {
    const ctx = holder.current;
    const project = ctx.config.projects.find((p) => p.name === projectName);
    if (!project) throw new Error(`Project "${projectName}" not found`);
    validateProjectPath(project, ctx.workspaceRoot);
    return core.listWorktrees(project.path);
  });
  electron.ipcMain.handle(
    CH.GIT_ADD_WORKTREE,
    async (_e, projectName, options) => {
      const ctx = holder.current;
      const project = ctx.config.projects.find((p) => p.name === projectName);
      if (!project) throw new Error(`Project "${projectName}" not found`);
      validateProjectPath(project, ctx.workspaceRoot);
      return core.addWorktree(project.path, options);
    }
  );
  electron.ipcMain.handle(
    CH.GIT_REMOVE_WORKTREE,
    async (_e, projectName, worktreePath) => {
      const ctx = holder.current;
      const project = ctx.config.projects.find((p) => p.name === projectName);
      if (!project) throw new Error(`Project "${projectName}" not found`);
      validateProjectPath(project, ctx.workspaceRoot);
      await core.removeWorktree(project.path, worktreePath);
    }
  );
  electron.ipcMain.handle(CH.GIT_BRANCHES, async (_e, projectName) => {
    const ctx = holder.current;
    const project = ctx.config.projects.find((p) => p.name === projectName);
    if (!project) throw new Error(`Project "${projectName}" not found`);
    validateProjectPath(project, ctx.workspaceRoot);
    return core.listBranches(project.path);
  });
  electron.ipcMain.handle(
    CH.GIT_UPDATE_BRANCH,
    (_e, projectName, branch) => guard(`updateBranch:${projectName}`, async () => {
      const ctx = holder.current;
      const project = ctx.config.projects.find((p) => p.name === projectName);
      if (!project) throw new Error(`Project "${projectName}" not found`);
      validateProjectPath(project, ctx.workspaceRoot);
      if (branch) {
        const result = await core.updateBranch(project.path, branch);
        return [result];
      }
      return core.updateAllBranches(project.path, ctx.bulkGitService.emitter);
    })
  );
}
function validateProjectPaths(projects, workspaceRoot) {
  const root = workspaceRoot.endsWith("/") ? workspaceRoot : workspaceRoot + "/";
  for (const p of projects) {
    const resolved = node_path.resolve(workspaceRoot, p.path);
    if (resolved !== workspaceRoot && !resolved.startsWith(root)) {
      return `Project "${p.name}" path escapes workspace root: ${p.path}`;
    }
  }
  return null;
}
function createWriteLock() {
  let chain = Promise.resolve();
  return function withLock(fn) {
    const result = chain.then(fn);
    chain = result.then(
      () => void 0,
      () => void 0
    );
    return result;
  };
}
function registerConfigHandlers(holder) {
  const withLock = createWriteLock();
  electron.ipcMain.handle(CH.CONFIG_GET, () => holder.current.config);
  electron.ipcMain.handle(
    CH.CONFIG_UPDATE,
    (_e, body) => withLock(async () => {
      const ctx = holder.current;
      const result = core.DevHubApiConfigSchema.safeParse(body);
      if (!result.success) {
        throw Object.assign(new Error("Config validation failed"), {
          code: "VALIDATION_ERROR",
          issues: result.error.issues
        });
      }
      const pathError = validateProjectPaths(
        result.data.projects,
        ctx.workspaceRoot
      );
      if (pathError) throw new Error(pathError);
      await core.writeConfig(ctx.configPath, result.data);
      ctx.config = await core.readConfig(ctx.configPath);
      holder.sendEvent("config:changed", {});
      return ctx.config;
    })
  );
  electron.ipcMain.handle(
    CH.CONFIG_UPDATE_PROJECT,
    (_e, name, patch) => withLock(async () => {
      const ctx = holder.current;
      const idx = ctx.config.projects.findIndex((p) => p.name === name);
      if (idx === -1) throw new Error(`Project "${name}" not found`);
      const merged = { ...ctx.config.projects[idx], ...patch };
      const projectResult = core.ApiProjectSchema.safeParse(merged);
      if (!projectResult.success) {
        throw Object.assign(new Error("Project validation failed"), {
          code: "VALIDATION_ERROR",
          issues: projectResult.error.issues
        });
      }
      const pathError = validateProjectPaths(
        [projectResult.data],
        ctx.workspaceRoot
      );
      if (pathError) throw new Error(pathError);
      const updatedProjects = [
        ...ctx.config.projects.slice(0, idx),
        projectResult.data,
        ...ctx.config.projects.slice(idx + 1)
      ];
      const updatedConfig = {
        ...ctx.config,
        projects: updatedProjects
      };
      await core.writeConfig(ctx.configPath, updatedConfig);
      ctx.config = await import("@dev-hub/core").then(
        ({ readConfig: readConfig2 }) => readConfig2(ctx.configPath)
      );
      holder.sendEvent("config:changed", {});
      return ctx.config.projects.find((p) => p.name === name);
    })
  );
}
const SAFE_ENV_KEYS = ["PATH", "HOME", "SHELL", "TERM", "LANG", "TMPDIR", "USER", "LOGNAME"];
function registerTerminalHandlers(holder) {
  electron.ipcMain.handle(
    CH.TERMINAL_CREATE,
    async (_e, opts) => {
      const ctx = holder.current;
      const project = ctx.config.projects.find((p) => p.name === opts.project);
      if (!project && opts.project) {
        console.warn(`[terminal] project "${opts.project}" not found — launching without project context`);
      }
      const { resolveEnv } = await import("@dev-hub/core");
      const env = project ? await resolveEnv(project, ctx.workspaceRoot) : Object.fromEntries(
        SAFE_ENV_KEYS.flatMap((k) => process.env[k] ? [[k, process.env[k]]] : [])
      );
      const rawCwd = opts.cwd ?? project?.path ?? ctx.workspaceRoot;
      const basePath = project?.path ?? ctx.workspaceRoot;
      const effectiveCwd = path.isAbsolute(rawCwd) ? rawCwd : path.resolve(basePath, rawCwd);
      const cols = Math.max(1, Math.min(opts.cols, 500));
      const rows = Math.max(1, Math.min(opts.rows, 500));
      holder.ptyManager.create({
        id: opts.id,
        command: opts.command,
        cwd: effectiveCwd,
        env,
        cols,
        rows,
        project: opts.project
      });
      return opts.id;
    }
  );
  electron.ipcMain.on(
    CH.TERMINAL_WRITE,
    (_e, { id, data }) => {
      holder.ptyManager.write(id, data);
    }
  );
  electron.ipcMain.on(
    CH.TERMINAL_RESIZE,
    (_e, { id, cols, rows }) => {
      const safeCols = Math.max(1, Math.min(cols, 500));
      const safeRows = Math.max(1, Math.min(rows, 500));
      holder.ptyManager.resize(id, safeCols, safeRows);
    }
  );
  electron.ipcMain.on(CH.TERMINAL_KILL, (_e, { id }) => {
    holder.ptyManager.kill(id);
  });
  electron.ipcMain.handle(CH.TERMINAL_LIST, () => holder.ptyManager.getAll());
  electron.ipcMain.handle(
    CH.TERMINAL_LIST_DETAILED,
    () => holder.ptyManager.getDetailed()
  );
  electron.ipcMain.handle(
    CH.TERMINAL_BUFFER,
    (_e, id) => holder.ptyManager.getBuffer(id)
  );
}
const execFileAsync = node_util.promisify(node_child_process.execFile);
const SSH_DIR = node_path.join(node_os.homedir(), ".ssh");
const ADD_KEY_TIMEOUT_MS = 15e3;
const EXCLUDED_SSH_FILES = /* @__PURE__ */ new Set([
  "known_hosts",
  "known_hosts.old",
  "config",
  "authorized_keys",
  "environment"
]);
async function sshListKeys() {
  try {
    const entries = await promises.readdir(SSH_DIR);
    return entries.filter(
      (f) => !f.endsWith(".pub") && !EXCLUDED_SSH_FILES.has(f)
    );
  } catch {
    return [];
  }
}
async function resolveKeyPath(keyPath) {
  const name = node_path.basename(keyPath);
  if (name !== keyPath) {
    throw new Error("keyPath must be a filename within ~/.ssh/");
  }
  const resolved = node_path.resolve(SSH_DIR, name);
  if (!resolved.startsWith(SSH_DIR + "/") && resolved !== SSH_DIR) {
    throw new Error("keyPath escapes ~/.ssh/");
  }
  const knownKeys = await sshListKeys();
  if (!knownKeys.includes(name)) {
    throw new Error(`Key "${name}" not found in ~/.ssh/`);
  }
  return resolved;
}
async function ensureSshAgent() {
  try {
    const { stdout } = await execFileAsync("ssh-agent", [], {
      env: process.env,
      timeout: 5e3
    });
    const sockMatch = stdout.match(/SSH_AUTH_SOCK=([^;]+)/);
    const pidMatch = stdout.match(/SSH_AGENT_PID=(\d+)/);
    if (sockMatch?.[1] && pidMatch?.[1]) {
      process.env["SSH_AUTH_SOCK"] = sockMatch[1];
      process.env["SSH_AGENT_PID"] = pidMatch[1];
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
async function sshCheckAgent() {
  try {
    const { stdout } = await execFileAsync("ssh-add", ["-l"], {
      env: process.env,
      timeout: 5e3
    });
    const lines = stdout.split("\n").filter((l) => l.trim() && !l.includes("The agent has no identities"));
    return { hasKeys: lines.length > 0, keyCount: lines.length };
  } catch {
    return { hasKeys: false, keyCount: 0 };
  }
}
async function sshAddKey(passphrase, resolvedKeyPath, _retried = false) {
  const askpassPath = node_path.join(
    node_os.tmpdir(),
    `.devhub-askpass-${process.pid}-${Date.now()}.sh`
  );
  const escaped = passphrase.replace(/'/g, "'\\''");
  try {
    await promises.writeFile(
      askpassPath,
      `#!/bin/sh
printf '%s' '${escaped}'
`,
      { mode: 448 }
    );
    const args = resolvedKeyPath ? [resolvedKeyPath] : [];
    await execFileAsync("ssh-add", args, {
      env: {
        ...process.env,
        SSH_ASKPASS: askpassPath,
        // Force ssh-add to use SSH_ASKPASS even without a display (OpenSSH >= 8.4)
        SSH_ASKPASS_REQUIRE: "force",
        // Fallback for older OpenSSH that requires DISPLAY to use SSH_ASKPASS
        DISPLAY: process.env["DISPLAY"] ?? ":0"
      },
      timeout: ADD_KEY_TIMEOUT_MS
    });
    return { success: true };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (!_retried && raw.toLowerCase().includes("could not open a connection")) {
      const started = await ensureSshAgent();
      if (started) {
        return sshAddKey(passphrase, resolvedKeyPath, true);
      }
      return { success: false, error: "ssh-agent is not running and could not be started. Run: eval $(ssh-agent)" };
    }
    const msg = raw.split("\n").filter(
      (l) => l.trim() && !l.startsWith("Command failed") && !l.includes("ssh-add")
    ).join(" ").trim();
    return { success: false, error: msg || "Failed to add SSH key" };
  } finally {
    await promises.unlink(askpassPath).catch(() => {
    });
  }
}
function registerSshHandlers(_holder) {
  electron.ipcMain.handle(
    CH.SSH_ADD_KEY,
    async (_e, passphrase, keyPath) => {
      let resolvedKeyPath;
      if (keyPath) {
        resolvedKeyPath = await resolveKeyPath(keyPath);
      }
      return sshAddKey(passphrase, resolvedKeyPath);
    }
  );
  electron.ipcMain.handle(CH.SSH_CHECK_AGENT, async () => {
    return sshCheckAgent();
  });
  electron.ipcMain.handle(CH.SSH_LIST_KEYS, async () => {
    return sshListKeys();
  });
}
function send(channel, data) {
  try {
    electron.BrowserWindow.getAllWindows()[0]?.webContents.send(channel, data);
  } catch {
  }
}
function wireEventEmitters(holder) {
  const wire = () => {
    const ctx = holder.current;
    ctx.bulkGitService.emitter.on("progress", (event) => {
      send(EV.GIT_PROGRESS, event);
    });
  };
  wire();
  holder.onSwitch = wire;
}
function registerSettingsHandlers(holder, store2) {
  electron.ipcMain.handle(CH.CACHE_CLEAR, async () => {
    store2.clear();
    return { cleared: true };
  });
  electron.ipcMain.handle(CH.WORKSPACE_RESET, async () => {
    holder.ptyManager.dispose();
    store2.clear();
    holder.current?.bulkGitService.emitter.removeAllListeners();
    holder.current = null;
    holder.sendEvent(EV.WORKSPACE_CHANGED, null);
    return { reset: true };
  });
  electron.ipcMain.handle(CH.SETTINGS_EXPORT, async () => {
    const ctx = holder.current;
    if (!ctx) throw new Error("No workspace loaded");
    const result = await electron.dialog.showSaveDialog({
      title: "Export workspace settings",
      defaultPath: "dev-hub.toml",
      filters: [{ name: "TOML", extensions: ["toml"] }]
    });
    if (result.canceled || !result.filePath) return { exported: false };
    const raw = await promises.readFile(ctx.configPath, "utf-8");
    await promises.writeFile(result.filePath, raw, "utf-8");
    return { exported: true, path: result.filePath };
  });
  electron.ipcMain.handle(CH.SETTINGS_IMPORT, async () => {
    const ctx = holder.current;
    if (!ctx) throw new Error("No workspace loaded");
    const result = await electron.dialog.showOpenDialog({
      title: "Import workspace settings",
      filters: [{ name: "TOML", extensions: ["toml"] }],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0)
      return { imported: false };
    const sourcePath = result.filePaths[0];
    const validated = await core.readConfig(sourcePath);
    await core.writeConfig(ctx.configPath, validated);
    ctx.config = await core.readConfig(ctx.configPath);
    holder.sendEvent(EV.CONFIG_CHANGED, {});
    return { imported: true };
  });
}
function registerIpcHandlers(holder, store2) {
  registerWorkspaceHandlers(holder);
  registerGitHandlers(holder);
  registerConfigHandlers(holder);
  registerTerminalHandlers(holder);
  registerSshHandlers();
  registerSettingsHandlers(holder, store2);
  wireEventEmitters(holder);
}
process.env["GIT_TERMINAL_PROMPT"] = "0";
process.env["GIT_SSH_COMMAND"] = (process.env["GIT_SSH_COMMAND"] ?? "ssh") + " -o BatchMode=yes";
const store = new Store();
async function normalizeInputPath(input) {
  const abs = node_path.resolve(input);
  try {
    const s = await promises.stat(abs);
    if (s.isFile()) return node_path.dirname(abs);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return abs;
}
async function initContext(workspacePath) {
  const input = await normalizeInputPath(workspacePath);
  let resolvedPath = await core.findConfigFile(input);
  if (!resolvedPath) {
    const globalCfg = await core.readGlobalConfig();
    if (globalCfg?.defaults?.workspace) {
      const fallbackDir = node_path.resolve(globalCfg.defaults.workspace);
      resolvedPath = await core.findConfigFile(fallbackDir);
    }
  }
  if (!resolvedPath) {
    const discovered = await core.discoverProjects(input);
    const workspaceName = node_path.basename(input);
    const newConfig = {
      workspace: { name: workspaceName, root: "." },
      projects: discovered.map((p) => ({
        name: p.name,
        path: p.path,
        type: p.type,
        services: void 0,
        commands: void 0,
        terminals: [],
        envFile: void 0,
        tags: void 0
      }))
    };
    const tomlPath = node_path.join(input, "dev-hub.toml");
    await core.writeConfig(tomlPath, newConfig);
    resolvedPath = tomlPath;
  }
  const config = await core.readConfig(resolvedPath);
  const workspaceRoot = node_path.dirname(resolvedPath);
  store.set("lastWorkspacePath", workspaceRoot);
  await core.addKnownWorkspace(config.workspace.name, workspaceRoot);
  return {
    config,
    configPath: resolvedPath,
    workspaceRoot,
    bulkGitService: new core.BulkGitService()
  };
}
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(node_path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
let appHolder = null;
let fullIpcRegistered = false;
let loadWorkspacePromise = null;
electron.app.whenReady().then(async () => {
  const ptyManager = new PtySessionManager();
  const holder = {
    current: null,
    ptyManager,
    sendEvent(channel, data) {
      getMainWindow()?.webContents.send(channel, data);
    },
    async switchWorkspace(workspacePath) {
      ptyManager.dispose();
      const newInput = await normalizeInputPath(workspacePath);
      const newConfigPath = await core.findConfigFile(newInput);
      if (!newConfigPath) throw new core.ConfigNotFoundError(newInput);
      const newConfig = await core.readConfig(newConfigPath);
      const newWorkspaceRoot = node_path.dirname(newConfigPath);
      holder.current?.bulkGitService.emitter.removeAllListeners();
      holder.current = {
        config: newConfig,
        configPath: newConfigPath,
        workspaceRoot: newWorkspaceRoot,
        bulkGitService: new core.BulkGitService()
      };
      holder.onSwitch?.();
      store.set("lastWorkspacePath", newWorkspaceRoot);
      await core.addKnownWorkspace(newConfig.workspace.name, newWorkspaceRoot);
      getMainWindow()?.webContents.send(EV.WORKSPACE_CHANGED, {
        name: newConfig.workspace.name,
        root: newWorkspaceRoot
      });
    },
    onSwitch: null
  };
  appHolder = holder;
  createWindow();
  registerPreWorkspaceHandlers(holder);
  async function loadWorkspace(workspacePath) {
    if (fullIpcRegistered) {
      await holder.switchWorkspace(workspacePath);
      return;
    }
    if (loadWorkspacePromise) {
      await loadWorkspacePromise;
      if (fullIpcRegistered) await holder.switchWorkspace(workspacePath);
      return;
    }
    loadWorkspacePromise = (async () => {
      const ctx = await initContext(workspacePath);
      holder.current = ctx;
      registerIpcHandlers(holder, store);
      fullIpcRegistered = true;
      getMainWindow()?.webContents.send(EV.WORKSPACE_CHANGED, {
        name: ctx.config.workspace.name,
        root: ctx.workspaceRoot
      });
    })();
    try {
      await loadWorkspacePromise;
    } finally {
      loadWorkspacePromise = null;
    }
  }
  electron.ipcMain.handle(CH.WORKSPACE_INIT, async (_e, path2) => {
    if (!path2 || typeof path2 !== "string") throw new Error("path is required");
    const absPath = node_path.resolve(path2);
    const home = node_os.homedir();
    let realAbs;
    try {
      realAbs = await promises.realpath(absPath);
    } catch {
      realAbs = absPath;
    }
    if (realAbs !== home && !realAbs.startsWith(home + node_path.sep)) {
      throw new Error("Workspace path must be within home directory");
    }
    await loadWorkspace(path2);
    return {
      name: holder.current.config.workspace.name,
      root: holder.current.workspaceRoot
    };
  });
  const lastPath = store.get("lastWorkspacePath");
  const envPath = process.env.DEV_HUB_WORKSPACE;
  const autoPath = lastPath ?? envPath;
  if (autoPath) {
    try {
      const normalizedAutoPath = await normalizeInputPath(autoPath);
      const found = await core.findConfigFile(normalizedAutoPath);
      if (found) {
        await loadWorkspace(autoPath);
      } else {
        console.warn(`[dev-hub] Auto-resolve: no dev-hub.toml found at "${autoPath}", clearing persisted path`);
        store.delete("lastWorkspacePath");
      }
    } catch (err) {
      console.warn(`[dev-hub] Auto-resolve failed for "${autoPath}":`, err);
      store.delete("lastWorkspacePath");
    }
  }
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("before-quit", (e) => {
  if (!appHolder) return;
  e.preventDefault();
  appHolder.ptyManager.dispose();
  electron.app.exit(0);
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
