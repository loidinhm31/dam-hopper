#[cfg(test)]
mod tests;

pub mod discovery;
pub mod finder;
pub mod global;
pub mod parser;
pub mod presets;
pub mod schema;

pub use finder::{find_config_file, load_workspace_config, CONFIG_FILENAME};
pub use global::{
    add_known_workspace, add_known_workspace_at, global_config_path, list_known_workspaces,
    list_known_workspaces_at, read_global_config, read_global_config_at, remove_known_workspace,
    remove_known_workspace_at, write_global_config, write_global_config_at,
};
pub use parser::{read_config, write_config};
pub use presets::{get_effective_command, get_preset, get_project_services};
pub use schema::{
    AgentAssignment, AgentStoreConfig, CommandKind, DamHopperConfig, FeaturesConfig, GlobalConfig,
    KnownWorkspace, ProjectAgents, ProjectConfig, ProjectType, RestartPolicy, ServerConfig,
    ServiceConfig, TerminalProfile, WorkspaceInfo, DEFAULT_RESTART_MAX_RETRIES,
};
