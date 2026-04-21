use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

// ──────────────────────────────────────────────
// Project type
// ──────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectType {
    Maven,
    Gradle,
    Npm,
    Pnpm,
    Cargo,
    Custom,
}

impl std::fmt::Display for ProjectType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            ProjectType::Maven => "maven",
            ProjectType::Gradle => "gradle",
            ProjectType::Npm => "npm",
            ProjectType::Pnpm => "pnpm",
            ProjectType::Cargo => "cargo",
            ProjectType::Custom => "custom",
        };
        write!(f, "{}", s)
    }
}

// ──────────────────────────────────────────────
// Command kind
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandKind {
    Build,
    Run,
    Dev,
}

impl std::fmt::Display for CommandKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CommandKind::Build => write!(f, "build"),
            CommandKind::Run => write!(f, "run"),
            CommandKind::Dev => write!(f, "dev"),
        }
    }
}

// ──────────────────────────────────────────────
// Restart policy
// ──────────────────────────────────────────────

pub const DEFAULT_RESTART_MAX_RETRIES: u32 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum RestartPolicy {
    #[default]
    Never,
    OnFailure,
    Always,
}

// ──────────────────────────────────────────────
// Service config
// Single struct — on-disk TOML uses snake_case which serde handles via rename.
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceConfig {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_command: Option<String>,
}

// ──────────────────────────────────────────────
// Terminal profile
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalProfile {
    pub name: String,
    pub command: String,
    /// Absolute path (resolved at parse time, stored relative on disk).
    pub cwd: String,
}

// ──────────────────────────────────────────────
// Agent assignment
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentAssignment {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commands: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hooks: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_servers: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagents: Option<Vec<String>>,
    #[serde(default = "default_distribution")]
    pub distribution: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_template: Option<String>,
}

fn default_distribution() -> String {
    "symlink".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectAgents {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude: Option<AgentAssignment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gemini: Option<AgentAssignment>,
}

// ──────────────────────────────────────────────
// Agent store config
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStoreConfig {
    #[serde(default = "default_agent_store_path")]
    pub path: String,
}

fn default_agent_store_path() -> String {
    ".dam-hopper/agent-store".to_string()
}

impl Default for AgentStoreConfig {
    fn default() -> Self {
        AgentStoreConfig {
            path: default_agent_store_path(),
        }
    }
}

// ──────────────────────────────────────────────
// Project config (on-disk, before path resolution)
// ──────────────────────────────────────────────

/// Raw representation used during TOML deserialization.
/// Paths are relative strings; resolved into `ProjectConfig` after parsing.
#[derive(Debug, Clone, Deserialize)]
pub struct ProjectConfigRaw {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub project_type: ProjectType,
    pub services: Option<Vec<ServiceConfig>>,
    pub commands: Option<HashMap<String, String>>,
    pub env_file: Option<String>,
    pub tags: Option<Vec<String>>,
    pub terminals: Option<Vec<TerminalProfileRaw>>,
    pub agents: Option<ProjectAgents>,
    pub restart: Option<RestartPolicy>,
    pub restart_max_retries: Option<u32>,
    pub health_check_url: Option<String>,
}

/// Terminal profile as stored on disk (relative cwd).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalProfileRaw {
    pub name: String,
    pub command: String,
    pub cwd: String,
}

// ──────────────────────────────────────────────
// Project config (resolved, in-memory)
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub name: String,
    pub path: String, // absolute — String for JSON/IPC serialization boundary
    #[serde(rename = "type")]
    pub project_type: ProjectType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub services: Option<Vec<ServiceConfig>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commands: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    pub terminals: Vec<TerminalProfile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agents: Option<ProjectAgents>,
    pub restart_policy: RestartPolicy,
    pub restart_max_retries: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health_check_url: Option<String>,
}

// ──────────────────────────────────────────────
// Workspace config
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    pub name: String,
    #[serde(default = "default_root")]
    pub root: String,
}

fn default_root() -> String {
    ".".to_string()
}

// ──────────────────────────────────────────────
// Feature flags
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FeaturesConfig {
}

// ──────────────────────────────────────────────
// Server config
// ──────────────────────────────────────────────

fn default_session_db_path() -> String {
    "~/.config/dam-hopper/sessions.db".to_string()
}

fn default_session_buffer_ttl_hours() -> u64 {
    24
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    /// Database file path (default: ~/.config/dam-hopper/sessions.db)
    #[serde(default = "default_session_db_path")]
    pub session_db_path: String,

    /// TTL for dead session buffers in hours (default: 24)
    #[serde(default = "default_session_buffer_ttl_hours")]
    pub session_buffer_ttl_hours: u64,
}

impl Default for ServerConfig {
    fn default() -> Self {
        ServerConfig {
            session_db_path: default_session_db_path(),
            session_buffer_ttl_hours: default_session_buffer_ttl_hours(),
        }
    }
}

// ──────────────────────────────────────────────
// Top-level workspace config (on-disk)
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct DamHopperConfigRaw {
    pub workspace: WorkspaceInfo,
    pub agent_store: Option<AgentStoreConfig>,
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub projects: Vec<ProjectConfigRaw>,
    #[serde(default)]
    pub features: FeaturesConfig,
}

// ──────────────────────────────────────────────
// Top-level workspace config (resolved)
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct DamHopperConfig {
    pub workspace: WorkspaceInfo,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_store: Option<AgentStoreConfig>,
    pub server: ServerConfig,
    pub projects: Vec<ProjectConfig>,
    pub features: FeaturesConfig,
    /// Absolute path of the config file that was loaded (internal use only).
    #[serde(skip)]
    pub config_path: PathBuf,
}

// ──────────────────────────────────────────────
// Global config
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GlobalDefaults {
    pub workspace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct KnownWorkspace {
    pub name: String,
    pub path: String,
}

fn default_system_font_size() -> u16 { 14 }
fn default_editor_font_size() -> u16 { 14 }
fn default_editor_zoom_wheel_enabled() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    #[serde(default = "default_system_font_size")]
    pub system_font_size: u16,
    #[serde(default = "default_editor_font_size")]
    pub editor_font_size: u16,
    #[serde(default = "default_editor_zoom_wheel_enabled")]
    pub editor_zoom_wheel_enabled: bool,
}

impl Default for UiConfig {
    fn default() -> Self {
        UiConfig {
            system_font_size: default_system_font_size(),
            editor_font_size: default_editor_font_size(),
            editor_zoom_wheel_enabled: default_editor_zoom_wheel_enabled(),
        }
    }
}

impl UiConfig {
    /// Validates that both font sizes are in the allowed range [10, 32].
    pub fn validate_font_sizes(&self) -> Result<(), String> {
        Self::validate_font_size(self.system_font_size)?;
        Self::validate_font_size(self.editor_font_size)
    }

    pub fn validate_font_size(size: u16) -> Result<(), String> {
        if !(10..=32).contains(&size) {
            return Err(format!("Font size {size} out of range [10, 32]"));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GlobalConfig {
    pub defaults: Option<GlobalDefaults>,
    pub workspaces: Option<Vec<KnownWorkspace>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui: Option<UiConfig>,
    #[serde(default)]
    pub server: ServerConfig,
}
