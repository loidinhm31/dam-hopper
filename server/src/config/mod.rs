#[cfg(test)]
mod tests;

pub mod discovery;
pub mod finder;
pub mod global;
pub mod parser;
pub mod presets;
pub mod replacement;
pub mod resolve;
pub mod schema;

pub use finder::{find_config_file, load_workspace_config, CONFIG_FILENAME};
pub use global::{
    add_known_workspace, add_known_workspace_at, dam_hopper_config_dir, global_config_path,
    global_env_path, global_registry_path, list_known_workspaces, list_known_workspaces_at,
    read_global_config, read_global_config_at, remove_known_workspace, remove_known_workspace_at,
    write_global_config, write_global_config_at,
};
pub use parser::{parse_config_str_at_path, read_config, write_config};
pub use replacement::validate_protected_config_replacement;
pub use presets::{get_effective_command, get_preset, get_project_services};
pub use resolve::{resolve_startup_config, ConfigResolution, ConfigResolutionInput, ConfigSource};
pub use schema::{
    default_idle_suspend_agent_executables, default_idle_suspend_automatic_policy,
    is_generic_interpreter, validate_agent_executable_entry, validate_agent_executables,
    AgentAssignment, AgentStoreConfig, CommandKind, DamHopperConfig, FeaturesConfig, GlobalConfig,
    IdleSuspendAutomaticPolicy, IdleSuspendCapabilitySelection, IdleSuspendConfig, KnownWorkspace,
    ProjectAgents, ProjectConfig, ProjectType, RestartPolicy, ServerConfig, ServiceConfig,
    TelemetryCollectorConfig, TelemetryConfig, TerminalProfile, WorkspaceInfo,
    DEFAULT_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, DEFAULT_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
    DEFAULT_RESTART_MAX_RETRIES, MAX_IDLE_SUSPEND_AGENT_EXECUTABLES,
    MAX_IDLE_SUSPEND_AGENT_EXECUTABLE_BYTES, MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
    MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS, MIN_IDLE_SUSPEND_AGENT_EXECUTABLES,
    MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
};
pub use crate::system::config::HostResourceMonitorConfig;
