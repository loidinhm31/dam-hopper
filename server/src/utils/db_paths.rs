use std::path::{Path, PathBuf};

/// Ensures two database paths point to distinct underlying files.
///
/// Returns `Err` if both paths resolve to the same canonical path or share
/// the same filesystem identity (via inode on Unix or file index on Windows).
pub fn ensure_distinct_database_paths(left: &Path, right: &Path) -> Result<(), String> {
    let normalized_left = normalized_database_path(left)?;
    let normalized_right = normalized_database_path(right)?;
    if normalized_left == normalized_right || same_file_identity(&normalized_left, &normalized_right)? {
        return Err("databases must use different files".to_string());
    }
    Ok(())
}

pub fn normalized_database_path(path: &Path) -> Result<PathBuf, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|_| "unable to resolve database path".to_string())?
            .join(path)
    };
    if let Ok(canonical) = std::fs::canonicalize(&absolute) {
        return Ok(canonical);
    }
    let parent = absolute
        .parent()
        .ok_or_else(|| "unable to resolve database path".to_string())?;
    let file_name = absolute
        .file_name()
        .ok_or_else(|| "unable to resolve database path".to_string())?;
    let canonical_parent = std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    Ok(canonical_parent.join(file_name))
}

pub fn same_file_identity(left: &Path, right: &Path) -> Result<bool, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;

        let left_metadata = match std::fs::metadata(left) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err("unable to inspect database path".to_string()),
        };
        let right_metadata = match std::fs::metadata(right) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err("unable to inspect database path".to_string()),
        };
        return Ok(left_metadata.dev() == right_metadata.dev()
            && left_metadata.ino() == right_metadata.ino());
    }
    #[cfg(windows)]
    {
        let left_identity = match crate::utils::fs::windows_file_identity(left) {
            Ok(identity) => identity,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err("unable to inspect database path".to_string()),
        };
        let right_identity = match crate::utils::fs::windows_file_identity(right) {
            Ok(identity) => identity,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err("unable to inspect database path".to_string()),
        };
        return Ok(left_identity == right_identity);
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (left, right);
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_distinct_database_paths_accepts_distinct_paths() {
        let temp = tempfile::tempdir().unwrap();
        assert!(ensure_distinct_database_paths(
            &temp.path().join("sessions.db"),
            &temp.path().join("other.db"),
        )
        .is_ok());
    }

    #[test]
    fn ensure_distinct_database_paths_rejects_matching_paths() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("shared.db");
        assert!(ensure_distinct_database_paths(&path, &path).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn ensure_distinct_database_paths_rejects_symlinked_paths() {
        let temp = tempfile::tempdir().unwrap();
        let session = temp.path().join("sessions.db");
        let other = temp.path().join("other.db");
        std::fs::write(&session, b"session").unwrap();
        std::os::unix::fs::symlink(&session, &other).unwrap();

        assert!(ensure_distinct_database_paths(&session, &other).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn ensure_distinct_database_paths_rejects_hardlinked_paths() {
        let temp = tempfile::tempdir().unwrap();
        let session = temp.path().join("sessions.db");
        let other = temp.path().join("other.db");
        std::fs::write(&session, b"session").unwrap();
        std::fs::hard_link(&session, &other).unwrap();

        assert!(ensure_distinct_database_paths(&session, &other).is_err());
    }
}
