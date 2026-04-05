use std::path::{Path, PathBuf};

use crate::error::AppError;

use super::parser::read_config;
use super::schema::DevHubConfig;

pub const CONFIG_FILENAME: &str = "dev-hub.toml";

/// Walk up directory tree from `start_dir` looking for `dev-hub.toml`.
/// Stops at the user's home directory or filesystem root.
/// Returns `None` if not found.
pub fn find_config_file(start_dir: &Path) -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let mut current = start_dir.to_path_buf();

    loop {
        let candidate = current.join(CONFIG_FILENAME);
        if candidate.exists() {
            return Some(candidate);
        }

        let parent = match current.parent() {
            Some(p) if p != current => p.to_path_buf(),
            _ => return None, // filesystem root
        };

        if current == home {
            return None;
        }

        current = parent;
    }
}

pub fn load_workspace_config(start_dir: &Path) -> Result<DevHubConfig, AppError> {
    let config_path = find_config_file(start_dir).ok_or_else(|| {
        AppError::ConfigNotFound(format!(
            "No {} found starting from: {}",
            CONFIG_FILENAME,
            start_dir.display()
        ))
    })?;
    read_config(&config_path)
}
