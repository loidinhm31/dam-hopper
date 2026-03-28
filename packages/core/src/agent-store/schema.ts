import { z } from "zod";

/** Schema for SKILL.md YAML frontmatter */
export const SkillFrontmatterSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Must be lowercase hyphen-case"),
  description: z.string().min(1),
  license: z.string().optional(),
  "allowed-tools": z.array(z.string()).optional(),
  metadata: z.record(z.string()).optional(),
});

/** Schema for command .md YAML frontmatter */
export const CommandFrontmatterSchema = z.object({
  description: z.string().min(1),
  "argument-hint": z.string().optional(),
});

/** Schema for [agent_store] section in dev-hub.toml */
export const AgentStoreConfigSchema = z.object({
  path: z.string().default(".dev-hub/agent-store"),
});

export type AgentStoreConfig = z.infer<typeof AgentStoreConfigSchema>;

/** Schema for per-project [projects.agents.*] config */
export const AgentAssignmentSchema = z
  .object({
    skills: z.array(z.string()).optional(),
    commands: z.array(z.string()).optional(),
    hooks: z.array(z.string()).optional(),
    mcp_servers: z.array(z.string()).optional(),
    subagents: z.array(z.string()).optional(),
    distribution: z.enum(["symlink", "copy"]).default("symlink"),
    memory_template: z.string().optional(),
  })
  .transform((a) => ({
    skills: a.skills,
    commands: a.commands,
    hooks: a.hooks,
    mcpServers: a.mcp_servers,
    subagents: a.subagents,
    distribution: a.distribution,
    memoryTemplate: a.memory_template,
  }));

export const ProjectAgentsSchema = z
  .object({
    claude: AgentAssignmentSchema.optional(),
    gemini: AgentAssignmentSchema.optional(),
  })
  .optional();
