import { ipcMain, dialog } from "electron";
import { join } from "node:path";
import {
  scanAllProjects,
  ship,
  unship,
  bulkShip,
  absorb,
  getDistributionMatrix,
  healthCheck,
  listMemoryTemplates,
  getMemoryFile,
  updateMemoryFile,
  applyTemplate,
  scanRepo,
  importFromRepo,
  cleanupImport,
  type TemplateContext,
  type AgentItemCategory,
  type AgentType,
  type DistributionMethod,
} from "@dev-hub/core";
import { CH } from "../../ipc-channels.js";
import type { CtxHolder } from "../index.js";

const VALID_AGENTS: AgentType[] = ["claude", "gemini"];
const VALID_CATEGORIES: AgentItemCategory[] = [
  "skill", "command", "hook", "mcp-server", "subagent", "memory-template",
];
const CATEGORIES_REQUIRING_FILENAME: AgentItemCategory[] = [
  "hook", "mcp-server", "subagent", "memory-template",
];

function assertAgent(agent: string): asserts agent is AgentType {
  if (!VALID_AGENTS.includes(agent as AgentType)) {
    throw new Error(`Invalid agent: "${agent}". Must be one of: ${VALID_AGENTS.join(", ")}`);
  }
}

function assertCategory(category: string): asserts category is AgentItemCategory {
  if (!VALID_CATEGORIES.includes(category as AgentItemCategory)) {
    throw new Error(`Invalid category: "${category}"`);
  }
}

export function registerAgentStoreHandlers(holder: CtxHolder): void {
  const getCtx = () => {
    if (!holder.current) throw new Error("No workspace loaded");
    return holder.current;
  };

  const resolveProjectPath = (projectName: string): string => {
    const ctx = getCtx();
    const project = ctx.config.projects.find((p) => p.name === projectName);
    if (!project) throw new Error(`Project not found: ${projectName}`);
    return join(ctx.workspaceRoot, project.path);
  };

  // ── Store CRUD ──────────────────────────────────────────────────────

  ipcMain.handle(
    CH.AGENT_STORE_LIST,
    async (_e, opts?: { category?: AgentItemCategory }) => {
      if (opts?.category) assertCategory(opts.category);
      const ctx = getCtx();
      return ctx.agentStore.list(opts?.category);
    },
  );

  ipcMain.handle(
    CH.AGENT_STORE_GET,
    async (_e, opts: { name: string; category: AgentItemCategory }) => {
      assertCategory(opts.category);
      const ctx = getCtx();
      return ctx.agentStore.get(opts.name, opts.category);
    },
  );

  ipcMain.handle(
    CH.AGENT_STORE_GET_CONTENT,
    async (
      _e,
      opts: { name: string; category: AgentItemCategory; fileName?: string },
    ) => {
      assertCategory(opts.category);
      if (
        CATEGORIES_REQUIRING_FILENAME.includes(opts.category) &&
        !opts.fileName
      ) {
        throw new Error(
          `fileName is required for category "${opts.category}"`,
        );
      }
      const ctx = getCtx();
      return ctx.agentStore.getContent(opts.name, opts.category, opts.fileName);
    },
  );

  ipcMain.handle(
    CH.AGENT_STORE_ADD,
    async (_e, opts: { category: AgentItemCategory; name?: string }) => {
      assertCategory(opts.category);
      const ctx = getCtx();
      const isFolder = opts.category === "skill" || opts.category === "subagent";
      const result = await dialog.showOpenDialog({
        title: `Add ${opts.category} to Agent Store`,
        defaultPath: ctx.workspaceRoot,
        properties: isFolder ? ["openDirectory"] : ["openFile"],
        filters: isFolder ? [] : [{ name: "Markdown", extensions: ["md"] }],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return ctx.agentStore.add(result.filePaths[0], opts.category, opts.name);
    },
  );

  ipcMain.handle(
    CH.AGENT_STORE_REMOVE,
    async (_e, opts: { name: string; category: AgentItemCategory }) => {
      assertCategory(opts.category);
      const ctx = getCtx();
      await ctx.agentStore.remove(opts.name, opts.category);
      return { removed: true };
    },
  );

  // ── Distribution ────────────────────────────────────────────────────

  ipcMain.handle(
    CH.AGENT_STORE_SHIP,
    async (
      _e,
      opts: {
        itemName: string;
        category: AgentItemCategory;
        projectName: string;
        agent: AgentType;
        method?: DistributionMethod;
      },
    ) => {
      assertCategory(opts.category);
      assertAgent(opts.agent);
      const ctx = getCtx();
      return ship(
        ctx.agentStore.storePath,
        opts.itemName,
        opts.category,
        resolveProjectPath(opts.projectName),
        opts.agent,
        opts.method ?? "symlink",
      );
    },
  );

  ipcMain.handle(
    CH.AGENT_STORE_UNSHIP,
    async (
      _e,
      opts: {
        itemName: string;
        category: AgentItemCategory;
        projectName: string;
        agent: AgentType;
      },
    ) => {
      assertCategory(opts.category);
      assertAgent(opts.agent);
      const ctx = getCtx();
      return unship(
        ctx.agentStore.storePath,
        opts.itemName,
        opts.category,
        resolveProjectPath(opts.projectName),
        opts.agent,
      );
    },
  );

  ipcMain.handle(
    CH.AGENT_STORE_ABSORB,
    async (
      _e,
      opts: {
        itemName: string;
        category: AgentItemCategory;
        projectName: string;
        agent: AgentType;
      },
    ) => {
      assertCategory(opts.category);
      assertAgent(opts.agent);
      const ctx = getCtx();
      return absorb(
        ctx.agentStore.storePath,
        opts.itemName,
        opts.category,
        resolveProjectPath(opts.projectName),
        opts.agent,
      );
    },
  );

  ipcMain.handle(
    CH.AGENT_STORE_BULK_SHIP,
    async (
      _e,
      opts: {
        items: Array<{ name: string; category: AgentItemCategory }>;
        targets: Array<{ projectName: string; agent: AgentType }>;
        method?: DistributionMethod;
      },
    ) => {
      opts.items.forEach((i) => assertCategory(i.category));
      opts.targets.forEach((t) => assertAgent(t.agent));
      const ctx = getCtx();
      const resolvedTargets = opts.targets.map((t) => ({
        path: resolveProjectPath(t.projectName),
        agent: t.agent,
      }));
      return bulkShip(
        ctx.agentStore.storePath,
        opts.items,
        resolvedTargets,
        opts.method,
      );
    },
  );

  ipcMain.handle(CH.AGENT_STORE_MATRIX, async () => {
    const ctx = getCtx();
    const items = await ctx.agentStore.list();
    const projects = ctx.config.projects.map((p) => ({
      name: p.name,
      path: join(ctx.workspaceRoot, p.path),
    }));
    const matrix = await getDistributionMatrix(
      ctx.agentStore.storePath,
      items.map((i) => ({ name: i.name, category: i.category })),
      projects,
      ["claude", "gemini"],
    );
    // Convert nested Maps → plain objects for safe IPC serialization
    const plain: Record<string, Record<string, { shipped: boolean; method: string | null }>> = {};
    for (const [itemKey, projMap] of matrix) {
      plain[itemKey] = Object.fromEntries(projMap);
    }
    return plain;
  });

  // ── Scanner / Health ────────────────────────────────────────────────

  ipcMain.handle(CH.AGENT_STORE_SCAN, async () => {
    const ctx = getCtx();
    // Pass raw p.path (relative) — scanAllProjects joins with workspaceRoot internally
    return scanAllProjects(
      ctx.config.projects.map((p) => ({ name: p.name, path: p.path })),
      ctx.workspaceRoot,
    );
  });

  ipcMain.handle(CH.AGENT_STORE_HEALTH, async () => {
    const ctx = getCtx();
    const projects = ctx.config.projects.map((p) => ({
      name: p.name,
      path: join(ctx.workspaceRoot, p.path),
    }));
    return healthCheck(ctx.agentStore.storePath, projects, ["claude", "gemini"]);
  });

  // ── Memory ────────────────────────────────────────────────────────────────────

  ipcMain.handle(CH.AGENT_MEMORY_LIST, async (_e, opts: { projectName: string }) => {
    const ctx = getCtx();
    const project = ctx.config.projects.find((p) => p.name === opts.projectName);
    if (!project) throw new Error(`Project not found: ${opts.projectName}`);
    const projectPath = join(ctx.workspaceRoot, project.path);
    return {
      claude: await getMemoryFile(projectPath, "claude"),
      gemini: await getMemoryFile(projectPath, "gemini"),
    };
  });

  ipcMain.handle(
    CH.AGENT_MEMORY_GET,
    async (_e, opts: { projectName: string; agent: AgentType }) => {
      assertAgent(opts.agent);
      const ctx = getCtx();
      const project = ctx.config.projects.find((p) => p.name === opts.projectName);
      if (!project) throw new Error(`Project not found: ${opts.projectName}`);
      return getMemoryFile(join(ctx.workspaceRoot, project.path), opts.agent);
    },
  );

  ipcMain.handle(
    CH.AGENT_MEMORY_UPDATE,
    async (_e, opts: { projectName: string; agent: AgentType; content: string }) => {
      assertAgent(opts.agent);
      const ctx = getCtx();
      const project = ctx.config.projects.find((p) => p.name === opts.projectName);
      if (!project) throw new Error(`Project not found: ${opts.projectName}`);
      await updateMemoryFile(join(ctx.workspaceRoot, project.path), opts.agent, opts.content);
      return { updated: true };
    },
  );

  ipcMain.handle(CH.AGENT_MEMORY_TEMPLATES, async () => {
    const ctx = getCtx();
    return listMemoryTemplates(ctx.agentStore.storePath);
  });

  ipcMain.handle(
    CH.AGENT_MEMORY_APPLY,
    async (_e, opts: { templateName: string; projectName: string; agent: AgentType }) => {
      assertAgent(opts.agent);
      // Allowlist: only alphanumeric, hyphens, underscores — prevents path traversal
      if (!/^[a-zA-Z0-9_-]+$/.test(opts.templateName)) {
        throw new Error(`Invalid template name: "${opts.templateName}"`);
      }
      const ctx = getCtx();
      const project = ctx.config.projects.find((p) => p.name === opts.projectName);
      if (!project) throw new Error(`Project not found: ${opts.projectName}`);
      const context: TemplateContext = {
        project: {
          name: project.name,
          path: project.path,
          type: project.type,
          tags: project.tags,
        },
        workspace: { name: ctx.config.workspace.name, root: ctx.workspaceRoot },
        agent: opts.agent,
      };
      const content = await applyTemplate(ctx.agentStore.storePath, opts.templateName, context);
      return { content };
    },
  );

  // ── Import from repo ──────────────────────────────────────────────────────────

  ipcMain.handle(CH.AGENT_STORE_IMPORT_SCAN, async (_e, opts: { repoUrl: string }) => {
    return scanRepo(opts.repoUrl);
  });

  ipcMain.handle(
    CH.AGENT_STORE_IMPORT_CONFIRM,
    async (
      _e,
      opts: {
        tmpDir: string;
        selectedItems: Array<{ name: string; category: AgentItemCategory; relativePath: string }>;
      },
    ) => {
      opts.selectedItems.forEach((i) => assertCategory(i.category));
      const ctx = getCtx();
      try {
        return await importFromRepo(opts.tmpDir, opts.selectedItems, ctx.agentStore.storePath);
      } finally {
        // Always clean up temp dir, even if import throws
        await cleanupImport(opts.tmpDir);
      }
    },
  );
}
