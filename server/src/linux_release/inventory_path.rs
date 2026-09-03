//! Path normalization and safety checks for release inventory entries.

use super::constants::MAX_PATH_LENGTH;
use super::error::ReleaseError;

/// Validate that a path string is strictly normalized:
/// - UTF-8 forward-slash relative path
/// - No empty, '.' or '..' components
/// - No leading or trailing slashes, no repeated slashes, no backslashes, no NUL bytes
/// - Maximum 255 bytes
pub fn normalize_inventory_path(raw: &str) -> Result<(), ReleaseError> {
    if raw.is_empty() || raw.len() > MAX_PATH_LENGTH {
        return Err(ReleaseError::InvalidInventoryPath(raw.to_string()));
    }
    if raw.contains('\0') || raw.contains('\\') || raw.starts_with('/') || raw.ends_with('/') {
        return Err(ReleaseError::InvalidInventoryPath(raw.to_string()));
    }
    for component in raw.split('/') {
        if component.is_empty() || component == "." || component == ".." {
            return Err(ReleaseError::InvalidInventoryPath(raw.to_string()));
        }
    }
    Ok(())
}

/// Disallow runtime configuration, database, token, or secret files from being packaged in releases.
pub fn check_disallowed_files(path: &str) -> Result<(), ReleaseError> {
    let lower = path.to_lowercase();
    let file_name = path.rsplit('/').next().unwrap_or(path).to_lowercase();

    let is_disallowed = file_name == ".env"
        || file_name.starts_with(".env.")
        || file_name == "server.env"
        || file_name == "server-safety.env"
        || file_name == "dam-hopper.toml"
        || file_name == "config.toml"
        || file_name == "server-token"
        || lower.ends_with(".sqlite")
        || lower.ends_with(".sqlite-wal")
        || lower.ends_with(".sqlite-shm")
        || lower.ends_with(".db");

    if is_disallowed {
        return Err(ReleaseError::DisallowedRuntimeFile {
            path: path.to_string(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_paths() {
        assert!(normalize_inventory_path("bin/dam-hopper-server").is_ok());
        assert!(normalize_inventory_path("web/index.html").is_ok());
        assert!(normalize_inventory_path("LICENSE").is_ok());
    }

    #[test]
    fn test_invalid_paths() {
        assert!(normalize_inventory_path("").is_err());
        assert!(normalize_inventory_path("/absolute").is_err());
        assert!(normalize_inventory_path("trailing/").is_err());
        assert!(normalize_inventory_path("double//slash").is_err());
        assert!(normalize_inventory_path("dot/./slash").is_err());
        assert!(normalize_inventory_path("dotdot/../traversal").is_err());
        assert!(normalize_inventory_path("windows\\path").is_err());
    }

    #[test]
    fn test_disallowed_runtime_files() {
        assert!(check_disallowed_files(".env").is_err());
        assert!(check_disallowed_files("config/.env.local").is_err());
        assert!(check_disallowed_files("server.env").is_err());
        assert!(check_disallowed_files("server-safety.env").is_err());
        assert!(check_disallowed_files("dam-hopper.toml").is_err());
        assert!(check_disallowed_files("state/data.sqlite").is_err());
        assert!(check_disallowed_files("db/test.db").is_err());
        assert!(check_disallowed_files("bin/safe-file").is_ok());
    }
}
