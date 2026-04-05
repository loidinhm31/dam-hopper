use std::collections::HashMap;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentType {
    Claude,
    Gemini,
}

impl AgentType {
    pub fn all() -> &'static [AgentType] {
        &[AgentType::Claude, AgentType::Gemini]
    }
}

impl std::fmt::Display for AgentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentType::Claude => write!(f, "claude"),
            AgentType::Gemini => write!(f, "gemini"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentItemCategory {
    Skill,
    Command,
    Hook,
    McpServer,
    Subagent,
    MemoryTemplate,
}

impl AgentItemCategory {
    pub fn all() -> &'static [AgentItemCategory] {
        &[
            AgentItemCategory::Skill,
            AgentItemCategory::Command,
            AgentItemCategory::Hook,
            AgentItemCategory::McpServer,
            AgentItemCategory::Subagent,
            AgentItemCategory::MemoryTemplate,
        ]
    }

    pub fn store_dir(&self) -> &'static str {
        match self {
            AgentItemCategory::Skill => "skills",
            AgentItemCategory::Command => "commands",
            AgentItemCategory::Hook => "hooks",
            AgentItemCategory::McpServer => "mcp-servers",
            AgentItemCategory::Subagent => "subagents",
            AgentItemCategory::MemoryTemplate => "memory-templates",
        }
    }
}

impl std::fmt::Display for AgentItemCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentItemCategory::Skill => write!(f, "skill"),
            AgentItemCategory::Command => write!(f, "command"),
            AgentItemCategory::Hook => write!(f, "hook"),
            AgentItemCategory::McpServer => write!(f, "mcp-server"),
            AgentItemCategory::Subagent => write!(f, "subagent"),
            AgentItemCategory::MemoryTemplate => write!(f, "memory-template"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DistributionMethod {
    Symlink,
    Copy,
}

/// Paths within a project for each agent type.
#[derive(Debug, Clone)]
pub struct AgentPathConfig {
    pub root: &'static str,
    pub skills: &'static str,
    pub commands: &'static str,
    pub hooks: &'static str,
    pub mcp_config: &'static str,
    pub memory_file: &'static str,
}

pub static CLAUDE_PATHS: AgentPathConfig = AgentPathConfig {
    root: ".claude",
    skills: ".claude/skills",
    commands: ".claude/commands",
    hooks: ".claude/hooks",
    mcp_config: ".claude/.mcp.json",
    memory_file: "CLAUDE.md",
};

pub static GEMINI_PATHS: AgentPathConfig = AgentPathConfig {
    root: ".gemini",
    skills: ".gemini/skills",
    commands: ".gemini/commands",
    hooks: ".gemini/hooks",
    mcp_config: ".gemini/.mcp.json",
    memory_file: "GEMINI.md",
};

pub fn agent_paths(agent: AgentType) -> &'static AgentPathConfig {
    match agent {
        AgentType::Claude => &CLAUDE_PATHS,
        AgentType::Gemini => &GEMINI_PATHS,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStoreItem {
    pub name: String,
    pub category: AgentItemCategory,
    /// Relative path from agent store root to this item.
    pub relative_path: String,
    pub description: Option<String>,
    pub compatible_agents: Vec<AgentType>,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShipResult {
    pub item: String,
    pub category: AgentItemCategory,
    pub project: String,
    pub agent: AgentType,
    pub method: DistributionMethod,
    pub success: bool,
    pub error: Option<String>,
    pub target_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckResult {
    pub broken_symlinks: Vec<BrokenSymlink>,
    pub orphaned_items: Vec<OrphanedItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokenSymlink {
    pub project: String,
    pub path: PathBuf,
    pub target: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrphanedItem {
    pub project: String,
    pub path: PathBuf,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentPresence {
    pub has_config: bool,
    pub skills: Vec<String>,
    pub commands: Vec<String>,
    pub hooks: Vec<String>,
    pub has_memory_file: bool,
    pub has_mcp_config: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectAgentScanResult {
    pub project_name: String,
    pub project_path: PathBuf,
    pub agents: HashMap<String, AgentPresence>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DistributionStatus {
    pub shipped: bool,
    pub method: Option<DistributionMethod>,
}
