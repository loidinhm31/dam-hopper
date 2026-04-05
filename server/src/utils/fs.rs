use std::path::Path;

use crate::error::AppError;

/// Write `content` to `target` atomically (temp → rename, same filesystem).
/// On Unix, the temp file is created with mode 0o600.
pub fn atomic_write(target: &Path, content: &str) -> Result<(), AppError> {
    let dir = target.parent().unwrap_or(Path::new("/"));
    std::fs::create_dir_all(dir).map_err(|e| {
        AppError::Config(format!("Cannot create dir {}: {}", dir.display(), e))
    })?;

    let tmp = dir.join(format!(".dev-hub-tmp-{}.tmp", uuid::Uuid::new_v4().simple()));

    write_with_mode(&tmp, content)?;

    std::fs::rename(&tmp, target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        AppError::Config(format!(
            "Cannot rename {} → {}: {}",
            tmp.display(),
            target.display(),
            e
        ))
    })?;

    Ok(())
}

#[cfg(unix)]
fn write_with_mode(path: &Path, content: &str) -> Result<(), AppError> {
    use std::os::unix::fs::OpenOptionsExt;
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| AppError::Config(format!("Cannot open {}: {}", path.display(), e)))?;
    file.write_all(content.as_bytes())
        .map_err(|e| AppError::Config(format!("Cannot write {}: {}", path.display(), e)))
}

#[cfg(not(unix))]
fn write_with_mode(path: &Path, content: &str) -> Result<(), AppError> {
    std::fs::write(path, content)
        .map_err(|e| AppError::Config(format!("Cannot write {}: {}", path.display(), e)))
}
