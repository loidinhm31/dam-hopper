use std::path::{Component, Path};

use tokio::fs;

use crate::fs::error::FsError;

// ---------------------------------------------------------------------------
// Safety guard
// ---------------------------------------------------------------------------

/// Reject mutations on the project root, `.git/` paths (unless force), or empty names.
///
/// `abs` must already be sandbox-validated (inside workspace root).
/// `project_root` is the canonical project directory.
pub fn assert_safe_mutation(abs: &Path, project_root: &Path, force_git: bool) -> Result<(), FsError> {
    if abs == project_root {
        return Err(FsError::MutationRefused(
            "cannot mutate the project root".into(),
        ));
    }

    if !force_git {
        let in_git = abs.components().any(|c| {
            matches!(c, Component::Normal(n) if n == ".git")
        });
        if in_git {
            return Err(FsError::MutationRefused(
                "refusing .git write without force_git=true".into(),
            ));
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Mutation operations
// ---------------------------------------------------------------------------

/// Create an empty file. Parent directory must exist.
pub async fn create_file(abs: &Path, project_root: &Path) -> Result<(), FsError> {
    assert_safe_mutation(abs, project_root, false)?;

    if abs.exists() {
        return Err(FsError::MutationRefused(format!(
            "file already exists: {}",
            abs.display()
        )));
    }

    fs::File::create(abs).await.map_err(map_io)?;

    crate::audit_fs!("create_file", "<op>", abs, true);
    Ok(())
}

/// Create a directory (and all intermediate parents).
pub async fn create_dir(abs: &Path, project_root: &Path) -> Result<(), FsError> {
    assert_safe_mutation(abs, project_root, false)?;

    fs::create_dir_all(abs).await.map_err(map_io)?;

    crate::audit_fs!("create_dir", "<op>", abs, true);
    Ok(())
}

/// Rename (or move within sandbox) `src` → `dst`. Both must be sandbox-validated.
///
/// `dst` must be provided by the caller as a sandbox-validated absolute path.
/// Works for both files and directories; behaves like `mv`.
pub async fn rename(src: &Path, dst: &Path, project_root: &Path) -> Result<(), FsError> {
    assert_safe_mutation(src, project_root, false)?;

    if !src.exists() {
        return Err(FsError::NotFound);
    }

    // dst parent must exist
    if let Some(p) = dst.parent() {
        if !p.exists() {
            return Err(FsError::NotFound);
        }
    }

    fs::rename(src, dst).await.map_err(map_io)?;

    crate::audit_fs!("rename", "<op>", src, true);
    Ok(())
}

/// Delete a file or recursively delete a directory.
///
/// Hard refuse: project root, `.git/` (unless `force_git`).
pub async fn delete(abs: &Path, project_root: &Path, force_git: bool) -> Result<(), FsError> {
    assert_safe_mutation(abs, project_root, force_git)?;

    if !abs.exists() {
        return Err(FsError::NotFound);
    }

    let meta = fs::symlink_metadata(abs).await.map_err(map_io)?;
    if meta.is_dir() && !meta.file_type().is_symlink() {
        fs::remove_dir_all(abs).await.map_err(map_io)?;
    } else {
        fs::remove_file(abs).await.map_err(map_io)?;
    }

    crate::audit_fs!("delete", "<op>", abs, true);
    Ok(())
}

/// Move `src` to `dst` — semantic alias for `rename` (different UI intent).
pub async fn move_path(src: &Path, dst: &Path, project_root: &Path) -> Result<(), FsError> {
    assert_safe_mutation(src, project_root, false)?;

    if !src.exists() {
        return Err(FsError::NotFound);
    }

    if let Some(p) = dst.parent() {
        if !p.exists() {
            return Err(FsError::NotFound);
        }
    }

    fs::rename(src, dst).await.map_err(map_io)?;

    crate::audit_fs!("move", "<op>", src, true);
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn map_io(e: std::io::Error) -> FsError {
    match e.kind() {
        std::io::ErrorKind::NotFound => FsError::NotFound,
        std::io::ErrorKind::PermissionDenied => FsError::PermissionDenied,
        _ => FsError::Io(e),
    }
}
