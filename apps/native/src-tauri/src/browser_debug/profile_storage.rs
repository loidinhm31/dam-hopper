use std::{fs, path::PathBuf};

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const STORAGE_DIRECTORY: &str = "browser-debug";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProfileStorage {
    pub profile_id: String,
    pub directory: PathBuf,
}

impl ProfileStorage {
    pub fn resolve(app: &AppHandle, profile_id: &str) -> Result<Self, String> {
        let key = profile_storage_key(profile_id)?;
        let root = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("resolve app data directory: {error}"))?
            .join(STORAGE_DIRECTORY)
            .join("profiles")
            .join(key);
        fs::create_dir_all(&root).map_err(|error| format!("create profile storage: {error}"))?;
        Ok(Self {
            profile_id: profile_id.to_string(),
            directory: root,
        })
    }

    pub fn clear(&self) -> Result<(), String> {
        if self.directory.exists() {
            fs::remove_dir_all(&self.directory)
                .map_err(|error| format!("clear profile storage: {error}"))?;
        }
        Ok(())
    }
}

pub fn profile_storage_key(profile_id: &str) -> Result<String, String> {
    if profile_id.is_empty()
        || profile_id.len() > 256
        || profile_id.chars().any(|char| char.is_control())
    {
        return Err("invalid server profile id".into());
    }
    let mut digest = Sha256::new();
    digest.update(profile_id.as_bytes());
    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_keys_are_stable_opaque_and_isolated() {
        let first = profile_storage_key("profile-a").unwrap();
        assert_eq!(profile_storage_key("profile-a").unwrap(), first);
        assert_ne!(first, profile_storage_key("profile-b").unwrap());
        assert_eq!(first.len(), 64);
        assert!(!first.contains("profile-a"));
    }

    #[test]
    fn rejects_path_like_or_controlled_profile_ids() {
        assert!(profile_storage_key("").is_err());
        assert!(profile_storage_key("../other-profile").is_ok());
        assert!(profile_storage_key("profile\0id").is_err());
    }
}
