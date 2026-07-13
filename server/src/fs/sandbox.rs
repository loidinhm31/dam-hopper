use std::collections::HashMap;
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

/// Validates proposed file paths against the configured root for a named project.
#[derive(Clone)]
pub struct ProjectSandbox {
    roots: HashMap<String, PathBuf>, // dunce-canonicalized project roots
}

impl ProjectSandbox {
    /// Canonicalize project roots synchronously. Called at startup and workspace switch.
    pub fn new(projects: Vec<(String, PathBuf)>) -> Result<Self, FsError> {
        let mut roots = HashMap::with_capacity(projects.len());
        for (name, root) in projects {
            let canonical = canonicalize_existing(root)?;
            roots.insert(name, canonical);
        }
        Ok(Self { roots })
    }

    pub fn project_root(&self, project: &str) -> Option<PathBuf> {
        self.roots.get(project).cloned()
    }

    /// Validates `proposed` (an absolute path formed by joining a project root
    /// with a user-supplied relative path) against the selected project root.
    pub async fn validate(&self, project: &str, proposed: PathBuf) -> Result<PathBuf, FsError> {
        // Reject obvious traversal before probing the filesystem; canonicalize
        // afterwards so symlink targets are checked against the project root.
        if proposed.components().any(|c| c == Component::ParentDir) {
            return Err(FsError::PathEscape);
        }

        let root = self.project_root(project).ok_or(FsError::NotFound)?;
        let canonical = canonicalize_existing_blocking(proposed).await?;

        if !canonical.starts_with(&root) {
            return Err(FsError::PathEscape);
        }

        Ok(canonical)
    }

    /// Validate a not-yet-existing path by canonicalizing its parent directory.
    pub async fn validate_new_path(
        &self,
        project: &str,
        parent: PathBuf,
        name: &str,
    ) -> Result<PathBuf, FsError> {
        validate_new_name(name)?;

        if parent.components().any(|c| c == Component::ParentDir) {
            return Err(FsError::PathEscape);
        }

        let root = self.project_root(project).ok_or(FsError::NotFound)?;
        let canonical_parent = canonicalize_existing_blocking(parent).await?;

        if !canonical_parent.starts_with(&root) {
            return Err(FsError::PathEscape);
        }

        Ok(canonical_parent.join(name))
    }
}

impl WorkspaceSandbox {
    /// Canonicalize `root` synchronously. Called at startup — not a hot path.
    pub fn new(root: PathBuf) -> Result<Self, FsError> {
        let canonical = canonicalize_existing(root)?;
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
        let canonical = canonicalize_existing_blocking(proposed).await?;

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
        validate_new_name(name)?;

        if parent.components().any(|c| c == Component::ParentDir) {
            return Err(FsError::PathEscape);
        }

        let root = self.root.clone();
        let canonical_parent = canonicalize_existing_blocking(parent).await?;

        if !canonical_parent.starts_with(&root) {
            return Err(FsError::PathEscape);
        }

        Ok(canonical_parent.join(name))
    }
}

fn canonicalize_existing(path: PathBuf) -> Result<PathBuf, FsError> {
    dunce::canonicalize(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            FsError::NotFound
        } else {
            FsError::Io(e)
        }
    })
}

async fn canonicalize_existing_blocking(path: PathBuf) -> Result<PathBuf, FsError> {
    task::spawn_blocking(move || canonicalize_existing(path))
        .await
        .map_err(|e| FsError::Io(std::io::Error::other(e)))?
}

fn validate_new_name(name: &str) -> Result<(), FsError> {
    if name.is_empty() {
        return Err(FsError::InvalidName("filename is empty".into()));
    }
    if name.contains('/') || name.contains('\\') || name == ".." || name == "." {
        return Err(FsError::InvalidName(format!(
            "filename contains invalid characters: {name:?}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::ProjectSandbox;
    use crate::fs::FsError;

    #[tokio::test]
    async fn validates_each_project_against_its_own_root() {
        let tmp = tempfile::tempdir().unwrap();
        let alpha = tmp.path().join("alpha");
        let beta = tmp.path().join("beta");
        std::fs::create_dir_all(&alpha).unwrap();
        std::fs::create_dir_all(&beta).unwrap();
        std::fs::write(alpha.join("owned.txt"), "alpha").unwrap();
        std::fs::write(beta.join("owned.txt"), "beta").unwrap();

        let sandbox = ProjectSandbox::new(vec![
            ("alpha".into(), alpha.clone()),
            ("beta".into(), beta.clone()),
        ])
        .unwrap();

        let alpha_file = sandbox
            .validate("alpha", alpha.join("owned.txt"))
            .await
            .unwrap();
        assert!(alpha_file.starts_with(sandbox.project_root("alpha").unwrap()));

        let beta_from_alpha = sandbox.validate("alpha", beta.join("owned.txt")).await;
        assert!(matches!(beta_from_alpha, Err(FsError::PathEscape)));
    }

    #[tokio::test]
    async fn rejects_unknown_project_before_path_access() {
        let tmp = tempfile::tempdir().unwrap();
        let alpha = tmp.path().join("alpha");
        std::fs::create_dir_all(&alpha).unwrap();

        let sandbox = ProjectSandbox::new(vec![("alpha".into(), alpha.clone())]).unwrap();
        let err = sandbox
            .validate("missing", alpha.join("owned.txt"))
            .await
            .unwrap_err();

        assert!(matches!(err, FsError::NotFound));
    }

    #[tokio::test]
    async fn rejects_symlink_escape() {
        let tmp = tempfile::tempdir().unwrap();
        let alpha = tmp.path().join("alpha");
        let outside = tmp.path().join("outside");
        std::fs::create_dir_all(&alpha).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), "secret").unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.join("secret.txt"), alpha.join("link.txt")).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(outside.join("secret.txt"), alpha.join("link.txt"))
            .unwrap();

        let sandbox = ProjectSandbox::new(vec![("alpha".into(), alpha.clone())]).unwrap();
        let err = sandbox
            .validate("alpha", alpha.join("link.txt"))
            .await
            .unwrap_err();

        assert!(matches!(err, FsError::PathEscape));
    }

    #[tokio::test]
    async fn validates_new_paths_inside_selected_project() {
        let tmp = tempfile::tempdir().unwrap();
        let alpha = tmp.path().join("alpha");
        let beta = tmp.path().join("beta");
        std::fs::create_dir_all(alpha.join("dir")).unwrap();
        std::fs::create_dir_all(&beta).unwrap();

        let sandbox = ProjectSandbox::new(vec![
            ("alpha".into(), alpha.clone()),
            ("beta".into(), beta.clone()),
        ])
        .unwrap();

        let new_path = sandbox
            .validate_new_path("alpha", alpha.join("dir"), "new.txt")
            .await
            .unwrap();
        assert_eq!(new_path, sandbox.project_root("alpha").unwrap().join("dir/new.txt"));

        let sibling_project = sandbox
            .validate_new_path("alpha", beta.clone(), "new.txt")
            .await;
        assert!(matches!(sibling_project, Err(FsError::PathEscape)));

        let invalid_name = sandbox
            .validate_new_path("alpha", alpha.join("dir"), "../bad.txt")
            .await;
        assert!(matches!(invalid_name, Err(FsError::InvalidName(_))));
    }
}
