//! Project-relative semantic path mapping.

use std::path::{Path, PathBuf};

use url::Url;

use crate::fs::{FsError, ProjectSandbox};

use super::protocol::{SemanticLanguage, SemanticUri};

#[derive(Clone)]
pub struct SemanticPathMapper {
    sandbox: ProjectSandbox,
}

impl SemanticPathMapper {
    pub fn new(sandbox: ProjectSandbox) -> Self {
        Self { sandbox }
    }

    pub fn project_root(&self, project_id: &str) -> Result<PathBuf, SemanticPathError> {
        self.sandbox
            .project_root(project_id)
            .ok_or(SemanticPathError::UnknownProject)
    }

    /// Resolve a browser identity without exposing or trusting host paths.
    pub async fn resolve_uri(&self, uri: &SemanticUri) -> Result<PathBuf, SemanticPathError> {
        uri.validate()?;
        let root = self.project_root(&uri.project_id)?;
        let candidate = root.join(Path::new(&uri.path));
        match self
            .sandbox
            .validate(&uri.project_id, candidate.clone())
            .await
        {
            Ok(path) => {
                let metadata = tokio::fs::metadata(&path)
                    .await
                    .map_err(|_| SemanticPathError::NotFound)?;
                if !metadata.is_file() {
                    return Err(SemanticPathError::InvalidPath);
                }
                Ok(path)
            }
            Err(FsError::NotFound) => {
                if let Ok(metadata) = tokio::fs::symlink_metadata(&candidate).await {
                    if metadata.file_type().is_symlink() {
                        return Err(SemanticPathError::InvalidPath);
                    }
                    return Err(SemanticPathError::NotFound);
                }
                let parent = candidate.parent().ok_or(SemanticPathError::NotFound)?;
                let name = candidate
                    .file_name()
                    .and_then(|value| value.to_str())
                    .ok_or(SemanticPathError::InvalidPath)?;
                self.sandbox
                    .validate_new_path(&uri.project_id, parent.to_path_buf(), name)
                    .await
                    .map_err(map_fs_error)
            }
            Err(error) => Err(map_fs_error(error)),
        }
    }

    pub fn lsp_uri_for_path(&self, path: &Path) -> Result<String, SemanticPathError> {
        Url::from_file_path(path)
            .map(|value| value.to_string())
            .map_err(|_| SemanticPathError::InvalidUri)
    }

    /// Map an LSP `file:` URI back to a same-project browser identity.
    pub async fn map_lsp_uri(
        &self,
        profile_id: &str,
        project_id: &str,
        language: SemanticLanguage,
        raw_uri: &str,
    ) -> Result<SemanticUri, SemanticPathError> {
        let parsed = Url::parse(raw_uri).map_err(|_| SemanticPathError::InvalidUri)?;
        if parsed.scheme() != "file"
            || parsed
                .host_str()
                .is_some_and(|host| !host.is_empty() && host != "localhost")
        {
            return Err(SemanticPathError::InvalidUri);
        }
        let path = parsed
            .to_file_path()
            .map_err(|_| SemanticPathError::InvalidUri)?;
        let canonical = self
            .sandbox
            .validate(project_id, path)
            .await
            .map_err(map_fs_error)?;
        let metadata = tokio::fs::metadata(&canonical)
            .await
            .map_err(|_| SemanticPathError::NotFound)?;
        if !metadata.is_file() {
            return Err(SemanticPathError::InvalidPath);
        }
        let root = self.project_root(project_id)?;
        let relative = canonical
            .strip_prefix(root)
            .map_err(|_| SemanticPathError::PathEscape)?
            .to_string_lossy()
            .replace('\\', "/");
        let uri = SemanticUri {
            profile_id: profile_id.to_owned(),
            project_id: project_id.to_owned(),
            path: relative,
            language,
        };
        uri.validate()?;
        Ok(uri)
    }
}

fn map_fs_error(error: FsError) -> SemanticPathError {
    match error {
        FsError::NotFound => SemanticPathError::NotFound,
        FsError::PathEscape => SemanticPathError::PathEscape,
        FsError::InvalidName(_) | FsError::MutationRefused(_) => SemanticPathError::InvalidPath,
        FsError::Unavailable => SemanticPathError::Unavailable,
        FsError::PermissionDenied => SemanticPathError::PermissionDenied,
        FsError::TooLarge(_) => SemanticPathError::Unavailable,
        FsError::Conflict => SemanticPathError::Unavailable,
        FsError::Io(_) => SemanticPathError::Unavailable,
    }
}

#[derive(Debug, thiserror::Error, Eq, PartialEq)]
pub enum SemanticPathError {
    #[error("semantic project is unknown")]
    UnknownProject,
    #[error("semantic path is invalid")]
    InvalidPath,
    #[error("semantic path is outside the project")]
    PathEscape,
    #[error("semantic path was not found")]
    NotFound,
    #[error("semantic URI is invalid")]
    InvalidUri,
    #[error("semantic filesystem is unavailable")]
    Unavailable,
    #[error("semantic path permission denied")]
    PermissionDenied,
}

impl From<super::protocol::ProtocolError> for SemanticPathError {
    fn from(_: super::protocol::ProtocolError) -> Self {
        Self::InvalidPath
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[tokio::test]
    async fn maps_only_same_project_relative_files() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir_all(project.join("src")).unwrap();
        fs::write(project.join("src/main.rs"), "fn main() {}").unwrap();
        let mapper = SemanticPathMapper::new(
            ProjectSandbox::new(vec![("project".into(), project.clone())]).unwrap(),
        );
        let uri = SemanticUri {
            profile_id: "profile".into(),
            project_id: "project".into(),
            path: "src/main.rs".into(),
            language: SemanticLanguage::Rust,
        };
        let path = mapper.resolve_uri(&uri).await.unwrap();
        assert!(path.ends_with("src/main.rs"));
        let lsp_uri = Url::from_file_path(path).unwrap();
        let mapped = mapper
            .map_lsp_uri(
                "profile",
                "project",
                SemanticLanguage::Rust,
                lsp_uri.as_str(),
            )
            .await
            .unwrap();
        assert_eq!(mapped.path, "src/main.rs");
    }

    #[tokio::test]
    async fn rejects_directories_and_dangling_symlinks() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        std::fs::create_dir_all(project.join("src")).unwrap();
        let mapper = SemanticPathMapper::new(
            ProjectSandbox::new(vec![("project".into(), project.clone())]).unwrap(),
        );
        let directory = SemanticUri {
            profile_id: "profile".into(),
            project_id: "project".into(),
            path: "src".into(),
            language: SemanticLanguage::Rust,
        };
        assert!(matches!(
            mapper.resolve_uri(&directory).await,
            Err(SemanticPathError::InvalidPath)
        ));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("missing.rs", project.join("dangling.rs")).unwrap();
            let dangling = SemanticUri {
                path: "dangling.rs".into(),
                ..directory
            };
            assert!(matches!(
                mapper.resolve_uri(&dangling).await,
                Err(SemanticPathError::InvalidPath)
            ));
        }
    }

    #[tokio::test]
    async fn rejects_external_and_traversal_paths() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        let mapper = SemanticPathMapper::new(
            ProjectSandbox::new(vec![("project".into(), project)]).unwrap(),
        );
        let uri = SemanticUri {
            profile_id: "profile".into(),
            project_id: "project".into(),
            path: "../secret.rs".into(),
            language: SemanticLanguage::Rust,
        };
        assert!(matches!(
            mapper.resolve_uri(&uri).await,
            Err(SemanticPathError::InvalidPath)
        ));
        assert!(matches!(
            mapper
                .map_lsp_uri(
                    "profile",
                    "project",
                    SemanticLanguage::Rust,
                    "file:///etc/passwd"
                )
                .await,
            Err(SemanticPathError::PathEscape | SemanticPathError::NotFound)
        ));
    }
}
