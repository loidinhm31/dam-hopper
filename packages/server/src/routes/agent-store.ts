import type { FastifyInstance } from "fastify";
import type { ServerContext } from "../context.js";
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
  scanLocalDir,
  importFromRepo,
  cleanupImport,
  type AgentItemCategory,
  type AgentType,
  type DistributionMethod,
  type TemplateContext,
} from "@dev-hub/core";
import { join } from "node:path";

const VALID_AGENTS: AgentType[] = ["claude", "gemini"];
const VALID_CATEGORIES: AgentItemCategory[] = [
  "skill", "command", "hook", "mcp-server", "subagent", "memory-template",
];

function assertAgent(agent: string): asserts agent is AgentType {
  if (!VALID_AGENTS.includes(agent as AgentType))
    throw new Error(`Invalid agent: "${agent}"`);
}
function assertCategory(category: string): asserts category is AgentItemCategory {
  if (!VALID_CATEGORIES.includes(category as AgentItemCategory))
    throw new Error(`Invalid category: "${category}"`);
}

export function registerAgentStoreRoutes(app: FastifyInstance, ctx: ServerContext): void {
  function getCtx() {
    if (!ctx.current) throw new Error("No workspace loaded");
    return ctx.current;
  }
  function resolveProjectPath(projectName: string) {
    const c = getCtx();
    const project = c.config.projects.find((p) => p.name === projectName);
    if (!project) throw new Error(`Project not found: ${projectName}`);
    return join(c.workspaceRoot, project.path);
  }

  // GET /api/agent-store?category=...
  app.get<{ Querystring: { category?: string } }>("/api/agent-store", async (request, reply) => {
    try {
      const c = getCtx();
      if (request.query.category) assertCategory(request.query.category);
      return reply.send(await c.agentStore.list(request.query.category as AgentItemCategory | undefined));
    } catch (e) { return reply.status(400).send({ error: String(e) }); }
  });

  // GET /api/agent-store/:category/:name
  app.get<{ Params: { category: string; name: string } }>(
    "/api/agent-store/:category/:name",
    async (request, reply) => {
      try {
        assertCategory(request.params.category);
        return reply.send(await getCtx().agentStore.get(request.params.name, request.params.category as AgentItemCategory));
      } catch (e) { return reply.status(400).send({ error: String(e) }); }
    },
  );

  // GET /api/agent-store/:category/:name/content
  app.get<{ Params: { category: string; name: string }; Querystring: { fileName?: string } }>(
    "/api/agent-store/:category/:name/content",
    async (request, reply) => {
      try {
        assertCategory(request.params.category);
        return reply.send(await getCtx().agentStore.getContent(
          request.params.name,
          request.params.category as AgentItemCategory,
          request.query.fileName,
        ));
      } catch (e) { return reply.status(400).send({ error: String(e) }); }
    },
  );

  // DELETE /api/agent-store/:category/:name
  app.delete<{ Params: { category: string; name: string } }>(
    "/api/agent-store/:category/:name",
    async (request, reply) => {
      try {
        assertCategory(request.params.category);
        await getCtx().agentStore.remove(request.params.name, request.params.category as AgentItemCategory);
        return reply.send({ removed: true });
      } catch (e) { return reply.status(400).send({ error: String(e) }); }
    },
  );

  // POST /api/agent-store/ship
  app.post<{ Body: { itemName: string; category: string; projectName: string; agent: string; method?: string } }>(
    "/api/agent-store/ship",
    async (request, reply) => {
      try {
        const { itemName, category, projectName, agent, method } = request.body;
        assertCategory(category); assertAgent(agent);
        const c = getCtx();
        return reply.send(await ship(
          c.agentStore.storePath, itemName, category as AgentItemCategory,
          resolveProjectPath(projectName), agent as AgentType, (method ?? "symlink") as DistributionMethod,
        ));
      } catch (e) { return reply.status(400).send({ error: String(e) }); }
    },
  );

  // POST /api/agent-store/unship
  app.post<{ Body: { itemName: string; category: string; projectName: string; agent: string } }>(
    "/api/agent-store/unship",
    async (request, reply) => {
      try {
        const { itemName, category, projectName, agent } = request.body;
        assertCategory(category); assertAgent(agent);
        const c = getCtx();
        return reply.send(await unship(
          c.agentStore.storePath, itemName, category as AgentItemCategory,
          resolveProjectPath(projectName), agent as AgentType,
        ));
      } catch (e) { return reply.status(400).send({ error: String(e) }); }
    },
  );

  // POST /api/agent-store/absorb
  app.post<{ Body: { itemName: string; category: string; projectName: string; agent: string } }>(
    "/api/agent-store/absorb",
    async (request, reply) => {
      try {
        const { itemName, category, projectName, agent } = request.body;
        assertCategory(category); assertAgent(agent);
        const c = getCtx();
        return reply.send(await absorb(
          c.agentStore.storePath, itemName, category as AgentItemCategory,
          resolveProjectPath(projectName), agent as AgentType,
        ));
      } catch (e) { return reply.status(400).send({ error: String(e) }); }
    },
  );

  // POST /api/agent-store/bulk-ship
  app.post<{
    Body: {
      items: Array<{ name: string; category: string }>;
      targets: Array<{ projectName: string; agent: string }>;
      method?: string;
    };
  }>("/api/agent-store/bulk-ship", async (request, reply) => {
    try {
      const { items, targets, method } = request.body;
      items.forEach((i) => assertCategory(i.category));
      targets.forEach((t) => assertAgent(t.agent));
      const c = getCtx();
      const resolvedTargets = targets.map((t) => ({
        path: resolveProjectPath(t.projectName),
        agent: t.agent as AgentType,
      }));
      return reply.send(await bulkShip(
        c.agentStore.storePath,
        items as Array<{ name: string; category: AgentItemCategory }>,
        resolvedTargets,
        method as DistributionMethod | undefined,
      ));
    } catch (e) { return reply.status(400).send({ error: String(e) }); }
  });

  // GET /api/agent-store/matrix
  app.get("/api/agent-store/matrix", async (_req, reply) => {
    try {
      const c = getCtx();
      const items = await c.agentStore.list();
      const projects = c.config.projects.map((p) => ({ name: p.name, path: join(c.workspaceRoot, p.path) }));
      const matrix = await getDistributionMatrix(
        c.agentStore.storePath,
        items.map((i) => ({ name: i.name, category: i.category })),
        projects,
        ["claude", "gemini"],
      );
      const plain: Record<string, Record<string, { shipped: boolean; method: string | null }>> = {};
      for (const [itemKey, projMap] of matrix) plain[itemKey] = Object.fromEntries(projMap);
      return reply.send(plain);
    } catch (e) { return reply.status(400).send({ error: String(e) }); }
  });

  // GET /api/agent-store/scan
  app.get("/api/agent-store/scan", async (_req, reply) => {
    try {
      const c = getCtx();
      return reply.send(await scanAllProjects(
        c.config.projects.map((p) => ({ name: p.name, path: p.path })),
        c.workspaceRoot,
      ));
    } catch (e) { return reply.status(400).send({ error: String(e) }); }
  });

  // GET /api/agent-store/health
  app.get("/api/agent-store/health", async (_req, reply) => {
    try {
      const c = getCtx();
      const projects = c.config.projects.map((p) => ({ name: p.name, path: join(c.workspaceRoot, p.path) }));
      return reply.send(await healthCheck(c.agentStore.storePath, projects, ["claude", "gemini"]));
    } catch (e) { return reply.status(400).send({ error: String(e) }); }
  });

  // — Memory —

  // GET /api/agent-memory/:project
  app.get<{ Params: { project: string } }>("/api/agent-memory/:project", async (request, reply) => {
    try {
      const c = getCtx();
      const proj = c.config.projects.find((p) => p.name === request.params.project);
      if (!proj) return reply.status(404).send({ error: "Project not found" });
      const projectPath = join(c.workspaceRoot, proj.path);
      return reply.send({
        claude: await getMemoryFile(projectPath, "claude"),
        gemini: await getMemoryFile(projectPath, "gemini"),
      });
    } catch (e) { return reply.status(400).send({ error: String(e) }); }
  });

  // GET /api/agent-memory/:project/:agent
  app.get<{ Params: { project: string; agent: string } }>(
    "/api/agent-memory/:project/:agent",
    async (request, reply) => {
      try {
        assertAgent(request.params.agent);
        const c = getCtx();
        const proj = c.config.projects.find((p) => p.name === request.params.project);
        if (!proj) return reply.status(404).send({ error: "Project not found" });
        return reply.send(await getMemoryFile(join(c.workspaceRoot, proj.path), request.params.agent as AgentType));
      } catch (e) { return reply.status(400).send({ error: String(e) }); }
    },
  );

  // PUT /api/agent-memory/:project/:agent
  app.put<{ Params: { project: string; agent: string }; Body: { content: string } }>(
    "/api/agent-memory/:project/:agent",
    async (request, reply) => {
      try {
        assertAgent(request.params.agent);
        const c = getCtx();
        const proj = c.config.projects.find((p) => p.name === request.params.project);
        if (!proj) return reply.status(404).send({ error: "Project not found" });
        await updateMemoryFile(join(c.workspaceRoot, proj.path), request.params.agent as AgentType, request.body.content);
        return reply.send({ updated: true });
      } catch (e) { return reply.status(400).send({ error: String(e) }); }
    },
  );

  // GET /api/agent-memory/templates
  app.get("/api/agent-memory/templates", async (_req, reply) => {
    try {
      return reply.send(await listMemoryTemplates(getCtx().agentStore.storePath));
    } catch (e) { return reply.status(400).send({ error: String(e) }); }
  });

  // POST /api/agent-memory/apply
  app.post<{ Body: { templateName: string; projectName: string; agent: string } }>(
    "/api/agent-memory/apply",
    async (request, reply) => {
      try {
        const { templateName, projectName, agent } = request.body;
        assertAgent(agent);
        if (!/^[a-zA-Z0-9_-]+$/.test(templateName))
          throw new Error(`Invalid template name: "${templateName}"`);
        const c = getCtx();
        const proj = c.config.projects.find((p) => p.name === projectName);
        if (!proj) return reply.status(404).send({ error: "Project not found" });
        const templateCtx: TemplateContext = {
          project: { name: proj.name, path: proj.path, type: proj.type, tags: proj.tags },
          workspace: { name: c.config.workspace.name, root: c.workspaceRoot },
          agent: agent as AgentType,
        };
        const content = await applyTemplate(c.agentStore.storePath, templateName, templateCtx);
        return reply.send({ content });
      } catch (e) { return reply.status(400).send({ error: String(e) }); }
    },
  );

  // — Import —

  // POST /api/agent-import/scan
  app.post<{ Body: { repoUrl: string } }>("/api/agent-import/scan", async (request, reply) => {
    try {
      return reply.send(await scanRepo(request.body.repoUrl));
    } catch (e) { return reply.status(400).send({ error: String(e) }); }
  });

  // POST /api/agent-import/scan-local
  app.post<{ Body: { dirPath: string } }>("/api/agent-import/scan-local", async (request, reply) => {
    try {
      return reply.send(await scanLocalDir(request.body.dirPath));
    } catch (e) { return reply.status(400).send({ error: String(e) }); }
  });

  // POST /api/agent-import/confirm
  app.post<{
    Body: {
      tmpDir: string;
      selectedItems: Array<{ name: string; category: string; relativePath: string }>;
      skipCleanup?: boolean;
    };
  }>("/api/agent-import/confirm", async (request, reply) => {
    try {
      const { tmpDir, selectedItems, skipCleanup } = request.body;
      selectedItems.forEach((i) => assertCategory(i.category));
      const c = getCtx();
      try {
        const result = await importFromRepo(
          tmpDir,
          selectedItems as Array<{ name: string; category: AgentItemCategory; relativePath: string }>,
          c.agentStore.storePath,
        );
        return reply.send(result);
      } finally {
        if (!skipCleanup) await cleanupImport(tmpDir);
      }
    } catch (e) { return reply.status(400).send({ error: String(e) }); }
  });
}
