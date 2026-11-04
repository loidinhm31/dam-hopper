use std::path::PathBuf;

use crate::error::AppError;

use super::{
    global::global_config_path,
    parser::read_config,
    schema::{DamHopperConfig, FeaturesConfig, ServerConfig, WorkspaceInfo},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigSource {
    ExplicitConfig,
    DefaultConfig,
    EmptyFallback,
}

impl ConfigSource {
    pub fn as_str(self) -> &'static str {
        match self {
            ConfigSource::ExplicitConfig => "explicit-config",
            ConfigSource::DefaultConfig => "default-config",
            ConfigSource::EmptyFallback => "empty-fallback",
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ConfigResolutionInput {
    pub explicit_config: Option<PathBuf>,
}

impl ConfigResolutionInput {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_explicit(explicit_config: Option<PathBuf>) -> Self {
        Self { explicit_config }
    }
}

#[derive(Debug, Clone)]
pub struct ConfigResolution {
    pub config: DamHopperConfig,
    pub workspace_dir: PathBuf,
    pub source: ConfigSource,
}

pub fn resolve_startup_config(input: ConfigResolutionInput) -> Result<ConfigResolution, AppError> {
    let (config_path, source) = match input.explicit_config {
        Some(path) => (path, ConfigSource::ExplicitConfig),
        None => (global_config_path(), ConfigSource::DefaultConfig),
    };

    if !config_path.exists() {
        tracing::info!(
            path = %config_path.display(),
            source = source.as_str(),
            "Authoritative config file does not exist — starting with clean configuration"
        );
        let unconfigured = PathBuf::new();
        return Ok(ConfigResolution {
            config: DamHopperConfig {
                workspace: WorkspaceInfo {
                    name: "workspace".into(),
                    root: String::new(),
                },
                agent_store: None,
                server: ServerConfig::default(),
                projects: vec![],
                features: FeaturesConfig::default(),
                ui: None,
                workspaces: None,
                config_path: config_path.clone(),
            },
            workspace_dir: unconfigured,
            source: ConfigSource::EmptyFallback,
        });
    }

    // Authoritative file exists: parse and validate. Malformed file fails closed!
    let config = read_config(&config_path)?;
    let workspace_dir = match config.resolve_workspace_root() {
        Ok(dir) => dir,
        Err(e) => {
            tracing::warn!(
                path = %config_path.display(),
                error = %e,
                "Workspace root unconfigured or invalid; workspace browsing disabled"
            );
            PathBuf::new()
        }
    };

    Ok(ConfigResolution {
        config,
        workspace_dir,
        source,
    })
}
