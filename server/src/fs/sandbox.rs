use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use tokio::task;

use crate::fs::error::FsError;
use crate::workspace_target::{target_path_identity, target_path_is_within, ResolvedProjectTarget};

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
    ///
    /// Invalid roots are skipped so a stale or missing project path cannot disable
    /// filesystem access for every other project in the workspace.
    pub fn new(projects: Vec<(String, PathBuf)>) -> Result<Self, FsError> {
        let mut roots = HashMap::with_capacity(projects.len());
        for (name, root) in projects {
            match canonicalize_existing(root.clone()) {
                Ok(canonical) => {
                    roots.insert(name, canonical);
                }
                Err(error) => {
                    tracing::warn!(
                        project = %name,
                        root = %root.display(),
                        error = %error,
                        "Skipping unavailable project root"
                    );
                }
            }
        }
        Ok(Self { roots })
    }

    pub fn project_root(&self, project: &str) -> Option<PathBuf> {
        self.roots.get(project).cloned()
    }

    /// Validates `proposed` (an absolute path formed by joining a project root
    /// with a user-supplied relative path) against the selected project root.
    pub async fn validate(&self, project: &str, proposed: PathBuf) -> Result<PathBuf, FsError> {
        let root = self.project_root(project).ok_or(FsError::NotFound)?;
        validate_existing_under_root(&root, proposed).await
    }

    /// Validate a path beneath a server-resolved project target.
    ///
    /// Worktrees may live outside the configured project root, so target
    /// authorization comes from `WorkspaceTargetResolver`. This method still
    /// verifies that the descriptor belongs to the configured project before
    /// applying the existing canonical containment checks beneath its target.
    pub async fn validate_target(
        &self,
        target: &ResolvedProjectTarget,
        proposed: PathBuf,
    ) -> Result<PathBuf, FsError> {
        let root = self.target_root(target)?;
        validate_existing_under_root(&root, proposed).await
    }

    /// Validate a not-yet-existing path by canonicalizing its parent directory.
    pub async fn validate_new_path(
        &self,
        project: &str,
        parent: PathBuf,
        name: &str,
    ) -> Result<PathBuf, FsError> {
        let root = self.project_root(project).ok_or(FsError::NotFound)?;
        validate_new_under_root(&root, parent, name).await
    }

    /// Validate a not-yet-existing path beneath a server-resolved target.
    pub async fn validate_new_target_path(
        &self,
        target: &ResolvedProjectTarget,
        parent: PathBuf,
        name: &str,
    ) -> Result<PathBuf, FsError> {
        let root = self.target_root(target)?;
        validate_new_under_root(&root, parent, name).await
    }

    fn target_root(&self, target: &ResolvedProjectTarget) -> Result<PathBuf, FsError> {
        let configured_root = self
            .project_root(target.project())
            .ok_or(FsError::NotFound)?;
        if target_path_identity(&configured_root) != target_path_identity(target.configured_root())
            || !target.available()
        {
            return Err(FsError::PathEscape);
        }
        Ok(target.target_path().to_path_buf())
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

        if !target_path_is_within(&canonical, &root) {
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

        if !target_path_is_within(&canonical_parent, &root) {
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

async fn validate_existing_under_root(root: &Path, proposed: PathBuf) -> Result<PathBuf, FsError> {
    if proposed.components().any(|c| c == Component::ParentDir) {
        return Err(FsError::PathEscape);
    }
    let canonical = canonicalize_existing_blocking(proposed).await?;
    if !target_path_is_within(&canonical, root) {
        return Err(FsError::PathEscape);
    }
    Ok(canonical)
}

async fn validate_new_under_root(
    root: &Path,
    parent: PathBuf,
    name: &str,
) -> Result<PathBuf, FsError> {
    validate_new_name(name)?;
    if parent.components().any(|c| c == Component::ParentDir) {
        return Err(FsError::PathEscape);
    }
    let canonical_parent = canonicalize_existing_blocking(parent).await?;
    if !target_path_is_within(&canonical_parent, root) {
        return Err(FsError::PathEscape);
    }
    Ok(canonical_parent.join(name))
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
    use crate::workspace_target::ResolvedProjectTarget;

    fn resolved_target(
        project: &str,
        configured_root: std::path::PathBuf,
        target_path: std::path::PathBuf,
    ) -> ResolvedProjectTarget {
        let is_root = configured_root == target_path;
        ResolvedProjectTarget::from_parts(
            project.into(),
            configured_root,
            target_path,
            if is_root {
                "root".into()
            } else {
                "worktree".into()
            },
            is_root,
            true,
            None,
        )
    }

    #[tokio::test]
    async fn isolates_identical_paths_by_resolved_target() {
        let tmp = tempfile::tempdir().unwrap();
        let configured_root = tmp.path().join("configured");
        let worktree = tmp.path().join("worktree");
        std::fs::create_dir_all(&configured_root).unwrap();
        std::fs::create_dir_all(&worktree).unwrap();
        std::fs::write(configured_root.join("same.txt"), "root").unwrap();
        std::fs::write(worktree.join("same.txt"), "worktree").unwrap();

        let sandbox =
            ProjectSandbox::new(vec![("project".into(), configured_root.clone())]).unwrap();
        let root_target = resolved_target(
            "project",
            dunce::canonicalize(&configured_root).unwrap(),
            dunce::canonicalize(&configured_root).unwrap(),
        );
        let worktree_target = resolved_target(
            "project",
            dunce::canonicalize(&configured_root).unwrap(),
            dunce::canonicalize(&worktree).unwrap(),
        );

        let root_file = sandbox
            .validate_target(&root_target, configured_root.join("same.txt"))
            .await
            .unwrap();
        let worktree_file = sandbox
            .validate_target(&worktree_target, worktree.join("same.txt"))
            .await
            .unwrap();

        assert_eq!(std::fs::read_to_string(root_file).unwrap(), "root");
        assert_eq!(std::fs::read_to_string(worktree_file).unwrap(), "worktree");
    }

    #[tokio::test]
    async fn rejects_descriptor_for_another_configured_root() {
        let tmp = tempfile::tempdir().unwrap();
        let configured_root = tmp.path().join("configured");
        let foreign_root = tmp.path().join("foreign");
        std::fs::create_dir_all(&configured_root).unwrap();
        std::fs::create_dir_all(&foreign_root).unwrap();
        std::fs::write(foreign_root.join("secret.txt"), "secret").unwrap();
        let sandbox = ProjectSandbox::new(vec![("project".into(), configured_root)]).unwrap();
        let forged = resolved_target(
            "project",
            dunce::canonicalize(&foreign_root).unwrap(),
            dunce::canonicalize(&foreign_root).unwrap(),
        );

        let result = sandbox
            .validate_target(&forged, foreign_root.join("secret.txt"))
            .await;

        assert!(matches!(result, Err(FsError::PathEscape)));
    }

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
    async fn skips_missing_project_roots_without_disabling_valid_projects() {
        let tmp = tempfile::tempdir().unwrap();
        let valid = tmp.path().join("valid");
        std::fs::create_dir_all(&valid).unwrap();
        std::fs::write(valid.join("owned.txt"), "valid").unwrap();

        let sandbox = ProjectSandbox::new(vec![
            ("valid".into(), valid.clone()),
            ("missing".into(), tmp.path().join("missing")),
        ])
        .unwrap();

        assert!(sandbox.project_root("valid").is_some());
        assert!(sandbox.project_root("missing").is_none());

        let valid_file = sandbox
            .validate("valid", valid.join("owned.txt"))
            .await
            .unwrap();
        assert!(valid_file.ends_with("owned.txt"));

        let missing_project = sandbox.validate("missing", valid.join("owned.txt")).await;
        assert!(matches!(missing_project, Err(FsError::NotFound)));
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
        assert_eq!(
            new_path,
            sandbox.project_root("alpha").unwrap().join("dir/new.txt")
        );

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
