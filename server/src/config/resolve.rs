use std::path::{Path, PathBuf};

use crate::error::AppError;

use super::{
    finder::{load_workspace_config, CONFIG_FILENAME},
    global::global_registry_path,
    parser::read_config,
    schema::{DamHopperConfig, FeaturesConfig, ServerConfig, WorkspaceInfo},
};

// Startup config resolution priority:
// 1. --config / DAM_HOPPER_CONFIG
// 2. --workspace / DAM_HOPPER_WORKSPACE
// 3. ~/.config/dam-hopper/dam-hopper.toml
// 4. global_config.defaults.workspace
// 5. current directory legacy discovery
// 6. empty fallback

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigSource {
    ExplicitConfig,
    Workspace,
    GlobalRegistry,
    GlobalDefaultWorkspace,
    CurrentDirectory,
    EmptyFallback,
}

impl ConfigSource {
    pub fn as_str(self) -> &'static str {
        match self {
            ConfigSource::ExplicitConfig => "explicit-config",
            ConfigSource::Workspace => "workspace",
            ConfigSource::GlobalRegistry => "global-registry",
            ConfigSource::GlobalDefaultWorkspace => "global-default-workspace",
            ConfigSource::CurrentDirectory => "current-directory",
            ConfigSource::EmptyFallback => "empty-fallback",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConfigResolutionInput {
    pub explicit_config: Option<PathBuf>,
    pub workspace_dir: Option<PathBuf>,
    pub global_default_workspace: Option<PathBuf>,
    pub current_dir: PathBuf,
    pub registry_path: PathBuf,
}

impl ConfigResolutionInput {
    pub fn new(current_dir: PathBuf) -> Self {
        Self {
            explicit_config: None,
            workspace_dir: None,
            global_default_workspace: None,
            current_dir,
            registry_path: global_registry_path(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConfigResolution {
    pub config: DamHopperConfig,
    pub workspace_dir: PathBuf,
    pub source: ConfigSource,
}

pub fn resolve_startup_config(input: ConfigResolutionInput) -> Result<ConfigResolution, AppError> {
    if let Some(path) = input.explicit_config {
        return load_config_at(&path, ConfigSource::ExplicitConfig);
    }

    if let Some(workspace_dir) = input.workspace_dir {
        return match load_workspace_config(&workspace_dir) {
            Ok(config) => Ok(build_resolution(
                config,
                ConfigSource::Workspace,
                &workspace_dir,
            )),
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    workspace = %workspace_dir.display(),
                    "Could not load workspace config — server will start without workspace"
                );
                Ok(empty_resolution(workspace_dir))
            }
        };
    }

    if input.registry_path.exists() {
        return load_config_at(&input.registry_path, ConfigSource::GlobalRegistry);
    }

    if let Some(workspace_dir) = input.global_default_workspace {
        if let Some(resolution) =
            try_workspace_candidate(&workspace_dir, ConfigSource::GlobalDefaultWorkspace)
        {
            return resolution;
        }
    }

    if let Some(resolution) =
        try_workspace_candidate(&input.current_dir, ConfigSource::CurrentDirectory)
    {
        return resolution;
    }

    Ok(empty_resolution(input.current_dir))
}

fn try_workspace_candidate(
    workspace_dir: &Path,
    source: ConfigSource,
) -> Option<Result<ConfigResolution, AppError>> {
    match load_workspace_config(workspace_dir) {
        Ok(config) => Some(Ok(build_resolution(config, source, workspace_dir))),
        Err(AppError::ConfigNotFound(_)) => None,
        Err(error) => {
            tracing::warn!(
                error = %error,
                workspace = %workspace_dir.display(),
                source = source.as_str(),
                "Could not load workspace config candidate — skipping"
            );
            None
        }
    }
}

fn load_config_at(path: &Path, source: ConfigSource) -> Result<ConfigResolution, AppError> {
    let config = read_config(path)?;
    Ok(build_resolution(config, source, path))
}

fn build_resolution(
    config: DamHopperConfig,
    source: ConfigSource,
    fallback_root: &Path,
) -> ConfigResolution {
    // fallback_root can be either a config file path or a workspace directory,
    // depending on which resolution branch loaded the config.
    let workspace_dir = config_parent(&config, fallback_root);
    ConfigResolution {
        config,
        workspace_dir,
        source,
    }
}

fn config_parent(config: &DamHopperConfig, fallback_root: &Path) -> PathBuf {
    config
        .config_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| {
            fallback_root
                .parent()
                .unwrap_or(fallback_root)
                .to_path_buf()
        })
}

fn empty_resolution(workspace_dir: PathBuf) -> ConfigResolution {
    ConfigResolution {
        config: DamHopperConfig {
            workspace: WorkspaceInfo {
                name: "unknown".into(),
                root: ".".into(),
            },
            agent_store: None,
            server: ServerConfig::default(),
            projects: vec![],
            features: FeaturesConfig::default(),
            config_path: workspace_dir.join(CONFIG_FILENAME),
        },
        workspace_dir,
        source: ConfigSource::EmptyFallback,
    }
}
