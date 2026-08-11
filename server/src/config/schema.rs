use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::IpAddr;
use std::path::PathBuf;

use crate::system::config::HostResourceMonitorConfig;

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
#[serde(rename_all(serialize = "camelCase"))]
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
#[serde(deny_unknown_fields)]
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
#[serde(deny_unknown_fields)]
pub struct FeaturesConfig {}

// ──────────────────────────────────────────────
// Server config
// ──────────────────────────────────────────────

fn default_session_db_path() -> String {
    "~/.config/dam-hopper/sessions.db".to_string()
}

fn default_session_buffer_ttl_hours() -> u64 {
    24
}

fn default_telemetry_db_path() -> String {
    "~/.config/dam-hopper/telemetry.db".to_string()
}
fn default_telemetry_detail_retention_days() -> u16 {
    90
}
fn default_telemetry_collector_host() -> String {
    "127.0.0.1".to_string()
}
fn default_telemetry_collector_port() -> u16 {
    4811
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticNavigationConfig {
    /// Phase 02 only controls backend readiness. Transport exposure is added
    /// by the later semantic WebSocket phase.
    #[serde(default)]
    pub enabled: bool,
}

impl Default for SemanticNavigationConfig {
    fn default() -> Self {
        Self { enabled: false }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryCollectorConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_telemetry_collector_host", alias = "host")]
    pub host: String,
    #[serde(default = "default_telemetry_collector_port", alias = "port")]
    pub port: u16,
}

impl Default for TelemetryCollectorConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            host: default_telemetry_collector_host(),
            port: default_telemetry_collector_port(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryConfig {
    #[serde(default)]
    pub enabled: bool,
    /// Stops new capture while preserving existing aggregate history.
    #[serde(default)]
    pub paused: bool,
    #[serde(default = "default_telemetry_db_path", alias = "db_path")]
    pub db_path: String,
    #[serde(
        default = "default_telemetry_detail_retention_days",
        alias = "detail_retention_days"
    )]
    pub detail_retention_days: u16,
    #[serde(default, alias = "aggregate_retention_days")]
    pub aggregate_retention_days: Option<u32>,
    #[serde(default)]
    pub collector: TelemetryCollectorConfig,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            paused: false,
            db_path: default_telemetry_db_path(),
            detail_retention_days: default_telemetry_detail_retention_days(),
            aggregate_retention_days: None,
            collector: TelemetryCollectorConfig::default(),
        }
    }
}

impl TelemetryConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.db_path.trim().is_empty() {
            return Err("server.telemetry.db_path must not be empty".to_string());
        }
        if !(1..=3650).contains(&self.detail_retention_days) {
            return Err(
                "server.telemetry.detail_retention_days must be between 1 and 3650".to_string(),
            );
        }
        if self.aggregate_retention_days == Some(0) {
            return Err(
                "server.telemetry.aggregate_retention_days must be positive when set".to_string(),
            );
        }
        if self.collector.port == 0 {
            return Err("server.telemetry.collector.port must be non-zero".to_string());
        }
        let host = self.collector.host.parse::<IpAddr>().map_err(|_| {
            "server.telemetry.collector.host must be a loopback IP address".to_string()
        })?;
        if !host.is_loopback() {
            return Err(
                "server.telemetry.collector.host must be a loopback IP address".to_string(),
            );
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerConfig {
    /// Database file path (default: ~/.config/dam-hopper/sessions.db)
    #[serde(default = "default_session_db_path", alias = "session_db_path")]
    pub session_db_path: String,

    /// TTL for dead session buffers in hours (default: 24)
    #[serde(
        default = "default_session_buffer_ttl_hours",
        alias = "session_buffer_ttl_hours"
    )]
    pub session_buffer_ttl_hours: u64,

    #[serde(default)]
    pub telemetry: TelemetryConfig,
    #[serde(default)]
    pub semantic: SemanticNavigationConfig,
    #[serde(default, alias = "host_resources")]
    pub host_resources: HostResourceMonitorConfig,
}

impl Default for ServerConfig {
    fn default() -> Self {
        ServerConfig {
            session_db_path: default_session_db_path(),
            session_buffer_ttl_hours: default_session_buffer_ttl_hours(),
            telemetry: TelemetryConfig::default(),
            semantic: SemanticNavigationConfig::default(),
            host_resources: HostResourceMonitorConfig::default(),
        }
    }
}

// ──────────────────────────────────────────────
// Top-level workspace config (on-disk)
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
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
#[serde(rename_all = "camelCase")]
pub struct GlobalDefaults {
    pub workspace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KnownWorkspace {
    pub name: String,
    pub path: String,
}

fn default_system_font_size() -> u16 {
    14
}
fn default_editor_font_size() -> u16 {
    14
}
fn default_editor_zoom_wheel_enabled() -> bool {
    true
}
fn default_search_text_shortcut() -> String {
    "Mod+Shift+KeyF".to_string()
}
fn default_search_filename_shortcut() -> String {
    "DoubleShift".to_string()
}
fn default_terminal_workspace_shortcut() -> String {
    "Mod+Shift+Backquote".to_string()
}
fn default_terminal_file_panel_shortcut() -> String {
    "Mod+Shift+KeyE".to_string()
}
fn default_reveal_active_file_shortcut() -> String {
    "Alt+F1".to_string()
}
fn default_git_panel_shortcut() -> String {
    "Mod+Shift+KeyG".to_string()
}
fn default_ports_panel_shortcut() -> String {
    "Mod+Shift+KeyP".to_string()
}
fn default_fleet_terminal_shortcut() -> String {
    "Mod+Shift+KeyM".to_string()
}
fn default_mobile_custom_keyboard_font_size() -> u16 {
    11
}
fn default_mobile_custom_keyboard_padding() -> u16 {
    6
}
fn default_mobile_custom_keyboard_row_gap() -> u16 {
    4
}
fn default_terminal_codex_notification_sound_volume() -> u8 {
    100
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TerminalCodexNotificationSoundPattern {
    #[default]
    Default,
    Soft,
    TwoTone,
    Urgent,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ExplorerLanguageFilter {
    #[default]
    All,
    Rust,
    JavascriptTypescript,
    Java,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiConfig {
    #[serde(default = "default_system_font_size", alias = "system_font_size")]
    pub system_font_size: u16,
    #[serde(default = "default_editor_font_size", alias = "editor_font_size")]
    pub editor_font_size: u16,
    #[serde(
        default = "default_editor_zoom_wheel_enabled",
        alias = "editor_zoom_wheel_enabled"
    )]
    pub editor_zoom_wheel_enabled: bool,
    #[serde(
        default = "default_search_text_shortcut",
        alias = "search_text_shortcut"
    )]
    pub search_text_shortcut: String,
    #[serde(
        default = "default_search_filename_shortcut",
        alias = "search_filename_shortcut"
    )]
    pub search_filename_shortcut: String,
    #[serde(
        default = "default_terminal_workspace_shortcut",
        alias = "terminal_workspace_shortcut"
    )]
    pub terminal_workspace_shortcut: String,
    #[serde(
        default = "default_terminal_file_panel_shortcut",
        alias = "terminal_file_panel_shortcut"
    )]
    pub terminal_file_panel_shortcut: String,
    #[serde(
        default = "default_reveal_active_file_shortcut",
        alias = "reveal_active_file_shortcut"
    )]
    pub reveal_active_file_shortcut: String,
    #[serde(default = "default_git_panel_shortcut", alias = "git_panel_shortcut")]
    pub git_panel_shortcut: String,
    #[serde(
        default = "default_ports_panel_shortcut",
        alias = "ports_panel_shortcut"
    )]
    pub ports_panel_shortcut: String,
    #[serde(
        default = "default_fleet_terminal_shortcut",
        alias = "fleet_terminal_shortcut"
    )]
    pub fleet_terminal_shortcut: String,
    #[serde(default = "default_true", alias = "terminal_suggestions_enabled")]
    pub terminal_suggestions_enabled: bool,
    #[serde(
        default = "default_true",
        alias = "terminal_auto_switch_project_enabled",
        alias = "terminalAutoSwitchProjectEnabled"
    )]
    pub terminal_auto_switch_project_enabled: bool,
    #[serde(
        default,
        alias = "terminal_codex_notifications_enabled",
        alias = "terminalCodexNotificationsEnabled",
        alias = "terminal_agent_notifications_enabled",
        alias = "terminalAgentNotificationsEnabled"
    )]
    pub terminal_codex_notifications_enabled: bool,
    #[serde(
        default = "default_true",
        alias = "terminal_codex_notification_toast_enabled",
        alias = "terminalCodexNotificationToastEnabled"
    )]
    pub terminal_codex_notification_toast_enabled: bool,
    #[serde(
        default = "default_true",
        alias = "terminal_codex_browser_notifications_enabled",
        alias = "terminalCodexBrowserNotificationsEnabled"
    )]
    pub terminal_codex_browser_notifications_enabled: bool,
    #[serde(
        default = "default_true",
        alias = "terminal_codex_notification_sound_enabled",
        alias = "terminalCodexNotificationSoundEnabled"
    )]
    pub terminal_codex_notification_sound_enabled: bool,
    #[serde(
        default = "default_terminal_codex_notification_sound_volume",
        alias = "terminal_codex_notification_sound_volume",
        alias = "terminalCodexNotificationSoundVolume"
    )]
    pub terminal_codex_notification_sound_volume: u8,
    #[serde(
        default,
        alias = "terminal_codex_notification_sound_pattern",
        alias = "terminalCodexNotificationSoundPattern"
    )]
    pub terminal_codex_notification_sound_pattern: TerminalCodexNotificationSoundPattern,
    #[serde(default, alias = "explorer_show_hidden", alias = "explorerShowHidden")]
    pub explorer_show_hidden: bool,
    #[serde(
        default,
        alias = "explorer_language_filter",
        alias = "explorerLanguageFilter"
    )]
    pub explorer_language_filter: ExplorerLanguageFilter,
    #[serde(
        default = "default_true",
        alias = "mobile_custom_keyboard_enabled",
        alias = "mobileCustomKeyboardEnabled"
    )]
    pub mobile_custom_keyboard_enabled: bool,
    #[serde(
        default = "default_mobile_custom_keyboard_font_size",
        alias = "mobile_custom_keyboard_font_size",
        alias = "mobileCustomKeyboardFontSize"
    )]
    pub mobile_custom_keyboard_font_size: u16,
    #[serde(
        default = "default_mobile_custom_keyboard_padding",
        alias = "mobile_custom_keyboard_padding",
        alias = "mobileCustomKeyboardPadding"
    )]
    pub mobile_custom_keyboard_padding: u16,
    #[serde(
        default = "default_mobile_custom_keyboard_row_gap",
        alias = "mobile_custom_keyboard_row_gap",
        alias = "mobileCustomKeyboardRowGap"
    )]
    pub mobile_custom_keyboard_row_gap: u16,
    #[serde(default, alias = "terminal_order")]
    pub terminal_order: Vec<String>,
    #[serde(default, alias = "project_order")]
    pub project_order: Vec<String>,
    #[serde(default, alias = "project_command_order")]
    pub project_command_order: std::collections::HashMap<String, Vec<String>>,
    #[serde(default, alias = "runtime_group_order")]
    pub runtime_group_order: Vec<String>,
    #[serde(default, alias = "runtime_item_order")]
    pub runtime_item_order: std::collections::HashMap<String, Vec<String>>,
    #[serde(
        default,
        alias = "terminal_scroll_buttons_enabled",
        alias = "terminalScrollButtonsEnabled"
    )]
    pub terminal_scroll_buttons_enabled: bool,
    #[serde(
        default,
        alias = "terminal_commit_status_enabled",
        alias = "terminalCommitStatusEnabled"
    )]
    pub terminal_commit_status_enabled: bool,
    #[serde(
        default = "default_terminal_scroll_step",
        alias = "terminal_scroll_step",
        alias = "terminalScrollStep"
    )]
    pub terminal_scroll_step: u16,
}

fn default_terminal_scroll_step() -> u16 {
    3
}

fn default_true() -> bool {
    true
}

impl Default for UiConfig {
    fn default() -> Self {
        UiConfig {
            system_font_size: default_system_font_size(),
            editor_font_size: default_editor_font_size(),
            editor_zoom_wheel_enabled: default_editor_zoom_wheel_enabled(),
            search_text_shortcut: default_search_text_shortcut(),
            search_filename_shortcut: default_search_filename_shortcut(),
            terminal_workspace_shortcut: default_terminal_workspace_shortcut(),
            terminal_file_panel_shortcut: default_terminal_file_panel_shortcut(),
            reveal_active_file_shortcut: default_reveal_active_file_shortcut(),
            git_panel_shortcut: default_git_panel_shortcut(),
            ports_panel_shortcut: default_ports_panel_shortcut(),
            fleet_terminal_shortcut: default_fleet_terminal_shortcut(),
            terminal_suggestions_enabled: true,
            terminal_auto_switch_project_enabled: true,
            terminal_codex_notifications_enabled: false,
            terminal_codex_notification_toast_enabled: true,
            terminal_codex_browser_notifications_enabled: true,
            terminal_codex_notification_sound_enabled: true,
            terminal_codex_notification_sound_volume:
                default_terminal_codex_notification_sound_volume(),
            terminal_codex_notification_sound_pattern:
                TerminalCodexNotificationSoundPattern::default(),
            explorer_show_hidden: false,
            explorer_language_filter: ExplorerLanguageFilter::default(),
            mobile_custom_keyboard_enabled: true,
            mobile_custom_keyboard_font_size: default_mobile_custom_keyboard_font_size(),
            mobile_custom_keyboard_padding: default_mobile_custom_keyboard_padding(),
            mobile_custom_keyboard_row_gap: default_mobile_custom_keyboard_row_gap(),
            terminal_order: vec![],
            project_order: vec![],
            project_command_order: std::collections::HashMap::new(),
            runtime_group_order: vec![],
            runtime_item_order: std::collections::HashMap::new(),
            terminal_scroll_buttons_enabled: false,
            terminal_commit_status_enabled: false,
            terminal_scroll_step: default_terminal_scroll_step(),
        }
    }
}

impl UiConfig {
    /// Validates that both font sizes are in the allowed range [10, 32].
    pub fn validate_font_sizes(&self) -> Result<(), String> {
        Self::validate_font_size(self.system_font_size)?;
        Self::validate_font_size(self.editor_font_size)
    }

    pub fn validate_mobile_keyboard_sizes(&self) -> Result<(), String> {
        Self::validate_mobile_keyboard_font_size(self.mobile_custom_keyboard_font_size)?;
        Self::validate_mobile_keyboard_padding(self.mobile_custom_keyboard_padding)?;
        Self::validate_mobile_keyboard_row_gap(self.mobile_custom_keyboard_row_gap)
    }

    pub fn validate_terminal_notification_sound_volume(&self) -> Result<(), String> {
        if self.terminal_codex_notification_sound_volume <= 100 {
            Ok(())
        } else {
            Err("Terminal notification sound volume must be between 0 and 100".to_string())
        }
    }

    pub fn validate_font_size(size: u16) -> Result<(), String> {
        if !(10..=32).contains(&size) {
            return Err(format!("Font size {size} out of range [10, 32]"));
        }
        Ok(())
    }

    pub fn validate_mobile_keyboard_font_size(size: u16) -> Result<(), String> {
        if !(9..=18).contains(&size) {
            return Err(format!(
                "Mobile keyboard font size {size} out of range [9, 18]"
            ));
        }
        Ok(())
    }

    pub fn validate_mobile_keyboard_padding(size: u16) -> Result<(), String> {
        if !(2..=14).contains(&size) {
            return Err(format!(
                "Mobile keyboard padding {size} out of range [2, 14]"
            ));
        }
        Ok(())
    }

    pub fn validate_mobile_keyboard_row_gap(size: u16) -> Result<(), String> {
        if !(2..=12).contains(&size) {
            return Err(format!(
                "Mobile keyboard row gap {size} out of range [2, 12]"
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GlobalConfig {
    pub defaults: Option<GlobalDefaults>,
    pub workspaces: Option<Vec<KnownWorkspace>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui: Option<UiConfig>,
    #[serde(default)]
    pub server: ServerConfig,
}
