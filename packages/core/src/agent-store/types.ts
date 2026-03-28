/** Supported AI agents */
export type AgentType = "claude" | "gemini";

/** Categories of items in the agent store */
export type AgentItemCategory =
  | "skill"
  | "command"
  | "hook"
  | "mcp-server"
  | "subagent"
  | "memory-template";

/** Distribution method when shipping to projects */
export type DistributionMethod = "symlink" | "copy";

export interface AgentPathConfig {
  root: string;
  skills: string;
  commands: string;
  hooks: string;
  mcpConfig: string;
  memoryFile: string;
}

/** Where each agent expects its configs */
export const AGENT_PATHS: Record<AgentType, AgentPathConfig> = {
  claude: {
    root: ".claude",
    skills: ".claude/skills",
    commands: ".claude/commands",
    hooks: ".claude/hooks",
    mcpConfig: ".claude/.mcp.json",
    memoryFile: "CLAUDE.md",
  },
  gemini: {
    root: ".gemini",
    skills: ".gemini/skills",
    commands: ".gemini/commands",
    hooks: ".gemini/hooks",
    mcpConfig: ".gemini/.mcp.json",
    memoryFile: "GEMINI.md",
  },
};

/** Metadata for a single item in the central store */
export interface AgentStoreItem {
  /** Unique name (directory name for skills, filename without ext for commands) */
  name: string;
  category: AgentItemCategory;
  /** Relative path from agent store root to this item */
  relativePath: string;
  /** Parsed metadata (description from frontmatter, etc.) */
  description?: string;
  /** Which agents this item is compatible with */
  compatibleAgents: AgentType[];
  /** Size in bytes (total for skill folders) */
  sizeBytes?: number;
}

/** A skill parsed from SKILL.md */
export interface SkillMeta {
  name: string;
  description: string;
  license?: string;
  allowedTools?: string[];
  metadata?: Record<string, string>;
}

/** A command parsed from frontmatter */
export interface CommandMeta {
  name: string;
  description: string;
  argumentHint?: string;
}

/** Assignment: which items are shipped to which project + agent */
export interface AgentAssignment {
  skills?: string[];
  commands?: string[];
  hooks?: string[];
  mcpServers?: string[];
  subagents?: string[];
  distribution?: DistributionMethod;
  memoryTemplate?: string;
}

/** Per-project agent config: { claude: AgentAssignment, gemini: AgentAssignment } */
export type ProjectAgentConfig = Partial<Record<AgentType, AgentAssignment>>;

/** Result of scanning a project for existing agent configs */
export interface ProjectAgentScanResult {
  projectName: string;
  projectPath: string;
  agents: Partial<
    Record<
      AgentType,
      {
        hasConfig: boolean;
        skills: string[];
        commands: string[];
        hooks: string[];
        hasMemoryFile: boolean;
        hasMcpConfig: boolean;
      }
    >
  >;
}

/** Ship/unship operation result */
export interface ShipResult {
  item: string;
  category: AgentItemCategory;
  project: string;
  agent: AgentType;
  method: DistributionMethod;
  success: boolean;
  error?: string;
  /** Absolute path of created symlink or copied file */
  targetPath?: string;
}
