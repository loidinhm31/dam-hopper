use std::fs::{File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use crate::linux_release::layout::{resolve_user_diagnostics_dir, Layout};

/// Errors occurring during diagnostic bundle output operations.
#[derive(Debug, thiserror::Error)]
pub enum OutputError {
    #[error("unable to resolve safe user state directory for non-root diagnostics")]
    UnresolvableUserStateDir,
    #[error("output directory security check failed: {0}")]
    InvalidDirectorySecurity(String),
    #[error("failed to create output directory: {0}")]
    DirectoryCreation(String),
    #[error("failed to create temporary bundle file: {0}")]
    TempFileCreation(String),
    #[error("failed to write bundle data: {0}")]
    WriteFailed(String),
    #[error("failed to sync bundle file: {0}")]
    SyncFailed(String),
    #[error("failed to atomically rename bundle file to final path: {0}")]
    RenameFailed(String),
    #[error("failed to sync output directory: {0}")]
    DirectorySyncFailed(String),
}

/// Verify that the target directory exists, is not a symlink, is owned by `euid`, and has mode 0700.
pub fn verify_or_create_secure_directory(dir: &Path, euid: u32) -> Result<(), OutputError> {
    if !dir.exists() {
        let mut builder = std::fs::DirBuilder::new();
        builder.recursive(true);
        builder.mode(0o700);
        builder.create(dir).map_err(|e| {
            OutputError::DirectoryCreation(format!("cannot create '{}': {e}", dir.display()))
        })?;
    }

    let meta = std::fs::symlink_metadata(dir).map_err(|e| {
        OutputError::InvalidDirectorySecurity(format!("stat '{}' failed: {e}", dir.display()))
    })?;

    if meta.file_type().is_symlink() {
        return Err(OutputError::InvalidDirectorySecurity(format!(
            "output directory '{}' must not be a symlink",
            dir.display()
        )));
    }

    if !meta.is_dir() {
        return Err(OutputError::InvalidDirectorySecurity(format!(
            "output path '{}' is not a directory",
            dir.display()
        )));
    }

    if meta.uid() != euid {
        return Err(OutputError::InvalidDirectorySecurity(format!(
            "output directory '{}' owned by UID {}, expected EUID {}",
            dir.display(),
            meta.uid(),
            euid
        )));
    }

    let mode = meta.permissions().mode() & 0o777;
    if mode != 0o700 {
        return Err(OutputError::InvalidDirectorySecurity(format!(
            "output directory '{}' has mode {:o}, expected 0700",
            dir.display(),
            mode
        )));
    }

    Ok(())
}

/// Write the serialized bundle atomically with exclusive temporary file, mode 0600, sync, rename, and dir sync.
pub fn write_diagnostic_bundle(
    layout: &Layout,
    bundle_id: &str,
    generated_at_ms: u64,
    bundle_bytes: &[u8],
    euid: u32,
) -> Result<PathBuf, OutputError> {
    let dest_dir = if euid == 0 {
        layout.diagnostics_dir()
    } else {
        resolve_user_diagnostics_dir().ok_or(OutputError::UnresolvableUserStateDir)?
    };

    write_diagnostic_bundle_to_dir(&dest_dir, bundle_id, generated_at_ms, bundle_bytes, euid)
}

/// Inner write helper that writes to an explicit directory, allowing custom directories in tests.
pub fn write_diagnostic_bundle_to_dir(
    dest_dir: &Path,
    bundle_id: &str,
    generated_at_ms: u64,
    bundle_bytes: &[u8],
    euid: u32,
) -> Result<PathBuf, OutputError> {
    verify_or_create_secure_directory(dest_dir, euid)?;

    let temp_name = format!(".tmp-dam-hopper-diagnose-{generated_at_ms}-{bundle_id}.json");
    let final_name = format!("dam-hopper-diagnose-{generated_at_ms}-{bundle_id}.json");
    let temp_path = dest_dir.join(&temp_name);
    let final_path = dest_dir.join(&final_name);

    // Create exclusive temporary file: O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW with mode 0600
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .custom_flags(libc::O_NOFOLLOW)
        .mode(0o600)
        .open(&temp_path)
        .map_err(|e| {
            OutputError::TempFileCreation(format!("cannot open '{}': {e}", temp_path.display()))
        })?;

    // Verify temp file metadata before writing
    let meta = file.metadata().map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        OutputError::TempFileCreation(format!("failed to fstat temp file: {e}"))
    })?;

    if meta.uid() != euid || (meta.permissions().mode() & 0o777) != 0o600 {
        let _ = std::fs::remove_file(&temp_path);
        return Err(OutputError::TempFileCreation(
            "temp file created with incorrect owner or permissions".to_string(),
        ));
    }

    if let Err(e) = file.write_all(bundle_bytes) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(OutputError::WriteFailed(format!(
            "failed to write bundle data: {e}"
        )));
    }

    if let Err(e) = file.sync_all() {
        let _ = std::fs::remove_file(&temp_path);
        return Err(OutputError::SyncFailed(format!(
            "failed to sync temp file: {e}"
        )));
    }

    // Drop file descriptor before renaming
    drop(file);

    // Atomically rename temporary file to final target
    if let Err(e) = std::fs::rename(&temp_path, &final_path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(OutputError::RenameFailed(format!(
            "failed to rename '{}' to '{}': {e}",
            temp_path.display(),
            final_path.display()
        )));
    }

    // Sync destination directory so rename is durable
    if let Ok(dir_file) = File::open(dest_dir) {
        let _ = dir_file.sync_all();
    }

    Ok(final_path)
}
