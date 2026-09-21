use std::fs;
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, PermissionsExt};

use super::error::PluginError;

/// Injectable physical state layout for runner-owned package registry.
#[derive(Debug, Clone)]
pub struct PluginRegistryLayout {
    pub root: PathBuf,
}

impl PluginRegistryLayout {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn registry_file(&self) -> PathBuf {
        self.root.join("registry-v1.json")
    }

    pub fn journal_dir(&self) -> PathBuf {
        self.root.join("journal")
    }

    pub fn journal_file(&self, transaction_id: &str) -> PathBuf {
        self.journal_dir().join(format!("{transaction_id}.json"))
    }

    pub fn staging_dir(&self) -> PathBuf {
        self.root.join("staging")
    }

    pub fn stage_dir(&self, stage_id: &str) -> PathBuf {
        self.staging_dir().join(stage_id)
    }

    pub fn stage_package_file(&self, stage_id: &str) -> PathBuf {
        self.stage_dir(stage_id).join("package.tar.gz")
    }

    pub fn stage_manifest_file(&self, stage_id: &str) -> PathBuf {
        self.stage_dir(stage_id).join("manifest.json")
    }

    pub fn stage_review_file(&self, stage_id: &str) -> PathBuf {
        self.stage_dir(stage_id).join("review.json")
    }

    pub fn packages_dir(&self) -> PathBuf {
        self.root.join("packages")
    }

    pub fn package_dir(&self, plugin_id: &str, version: &str, sha256: &str) -> PathBuf {
        self.packages_dir().join(plugin_id).join(version).join(sha256)
    }

    /// Ensure required root directories exist with restricted permissions.
    pub fn ensure_layout(&self) -> Result<(), PluginError> {
        self.ensure_secure_dir(&self.root)?;
        self.ensure_secure_dir(&self.journal_dir())?;
        self.ensure_secure_dir(&self.staging_dir())?;
        self.ensure_secure_dir(&self.packages_dir())?;
        Ok(())
    }

    fn ensure_secure_dir(&self, dir: &Path) -> Result<(), PluginError> {
        if !dir.exists() {
            fs::create_dir_all(dir).map_err(|e| {
                PluginError::runner_unavailable(format!(
                    "Failed to create registry directory '{}': {}",
                    dir.display(),
                    e
                ))
            })?;
        }
        #[cfg(unix)]
        {
            let perm = fs::Permissions::from_mode(0o700);
            let _ = fs::set_permissions(dir, perm);
        }
        self.verify_path_security(dir, None)
    }

    /// Verify owner, mode, type and no-link ancestry for a path.
    pub fn verify_path_security(
        &self,
        path: &Path,
        expected_uid: Option<u32>,
    ) -> Result<(), PluginError> {
        let mut cur = path.to_path_buf();
        loop {
            let meta = fs::symlink_metadata(&cur).map_err(|e| {
                PluginError::runner_unavailable(format!(
                    "Failed to stat path '{}': {}",
                    cur.display(),
                    e
                ))
            })?;

            if meta.file_type().is_symlink() {
                return Err(PluginError::forbidden(format!(
                    "Symlink detected in registry hierarchy at '{}'",
                    cur.display()
                )));
            }

            #[cfg(unix)]
            {
                let mode = meta.mode();
                if mode & 0o002 != 0 {
                    return Err(PluginError::forbidden(format!(
                        "Insecure world-writable permissions ({:#o}) at '{}'",
                        mode,
                        cur.display()
                    )));
                }

                if let Some(uid) = expected_uid {
                    if meta.uid() != uid {
                        return Err(PluginError::forbidden(format!(
                            "Owner UID mismatch at '{}': expected {}, found {}",
                            cur.display(),
                            uid,
                            meta.uid()
                        )));
                    }
                }
            }

            if cur == self.root {
                break;
            }
            if let Some(parent) = cur.parent() {
                if parent == cur {
                    break;
                }
                cur = parent.to_path_buf();
            } else {
                break;
            }
        }

        Ok(())
    }
}
