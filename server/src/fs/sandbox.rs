use std::path::{Component, Path, PathBuf};
use tokio::task;

use crate::fs::error::FsError;

/// Validates that a proposed path resolves within a workspace root.
///
/// Canonicalization uses `dunce::canonicalize` which strips Windows `\\?\`
/// verbatim prefixes so that `starts_with` checks work cross-platform.
#[derive(Clone)]
pub struct WorkspaceSandbox {
    root: PathBuf, // dunce-canonicalized workspace root
}

impl WorkspaceSandbox {
    /// Canonicalize `root` synchronously. Called at startup — not a hot path.
    pub fn new(root: PathBuf) -> Result<Self, FsError> {
        let canonical = dunce::canonicalize(&root).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                FsError::NotFound
            } else {
                FsError::Io(e)
            }
        })?;
        Ok(Self { root: canonical })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Validates `proposed` (an absolute path formed by joining a project root
    /// with a user-supplied relative path) against the workspace root.
    ///
    /// Fast-path lexical rejection: if the path contains any `..` component,
    /// return `PathEscape` immediately without hitting the filesystem.
    /// Otherwise canonicalize on a blocking thread and verify the result is
    /// still inside the workspace root.
    pub async fn validate(&self, proposed: PathBuf) -> Result<PathBuf, FsError> {
        if proposed.components().any(|c| c == Component::ParentDir) {
            return Err(FsError::PathEscape);
        }

        let root = self.root.clone();
        let canonical = task::spawn_blocking(move || dunce::canonicalize(&proposed))
            .await
            .map_err(|e| FsError::Io(std::io::Error::other(e)))?
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    FsError::NotFound
                } else {
                    FsError::Io(e)
                }
            })?;

        if !canonical.starts_with(&root) {
            return Err(FsError::PathEscape);
        }

        Ok(canonical)
    }

    /// Validate a not-yet-existing path by canonicalizing its parent directory.
    ///
    /// `name` must not contain path separators or `..`. The parent directory
    /// must already exist and must resolve within the workspace root.
    /// Returns the full absolute path of the would-be new entry.
    pub async fn validate_new_path(&self, parent: PathBuf, name: &str) -> Result<PathBuf, FsError> {
        if name.is_empty() {
            return Err(FsError::InvalidName("filename is empty".into()));
        }
        if name.contains('/') || name.contains('\\') || name == ".." || name == "." {
            return Err(FsError::InvalidName(format!(
                "filename contains invalid characters: {name:?}"
            )));
        }

        if parent.components().any(|c| c == Component::ParentDir) {
            return Err(FsError::PathEscape);
        }

        let root = self.root.clone();
        let canonical_parent = task::spawn_blocking(move || dunce::canonicalize(&parent))
            .await
            .map_err(|e| FsError::Io(std::io::Error::other(e)))?
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    FsError::NotFound
                } else {
                    FsError::Io(e)
                }
            })?;

        if !canonical_parent.starts_with(&root) {
            return Err(FsError::PathEscape);
        }

        Ok(canonical_parent.join(name))
    }
}
