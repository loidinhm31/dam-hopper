use std::path::{Path, PathBuf};
use crate::advisor::types::AdvisorStatusDto;

/// Inspects the candidate history root directory (`$HOME/.evcrate/advisor-history`)
/// using `symlink_metadata` to enforce that it is a real directory and not a symlink.
pub fn inspect_history_root(enabled: bool, home_override: Option<&Path>) -> AdvisorStatusDto {
    let home_path = match home_override {
        Some(h) => h.to_path_buf(),
        None => match std::env::var("HOME") {
            Ok(val) if !val.trim().is_empty() => PathBuf::from(val),
            _ => {
                return AdvisorStatusDto {
                    enabled,
                    available: false,
                    path: None,
                    source_error: Some("HOME environment variable is not set".to_string()),
                };
            }
        },
    };

    let candidate = home_path.join(".evcrate").join("advisor-history");
    let candidate_str = candidate.to_string_lossy().to_string();

    let metadata = match std::fs::symlink_metadata(&candidate) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return AdvisorStatusDto {
                enabled,
                available: false,
                path: None,
                source_error: None,
            };
        }
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return AdvisorStatusDto {
                enabled,
                available: false,
                path: Some(candidate_str),
                source_error: Some("Permission denied".to_string()),
            };
        }
        Err(e) => {
            return AdvisorStatusDto {
                enabled,
                available: false,
                path: Some(candidate_str),
                source_error: Some(e.to_string()),
            };
        }
    };

    if metadata.file_type().is_symlink() {
        return AdvisorStatusDto {
            enabled,
            available: false,
            path: Some(candidate_str),
            source_error: Some(
                "History root must be a real directory; symlink rejected".to_string(),
            ),
        };
    }

    if !metadata.is_dir() {
        return AdvisorStatusDto {
            enabled,
            available: false,
            path: Some(candidate_str),
            source_error: Some("History root is not a directory".to_string()),
        };
    }

    match std::fs::read_dir(&candidate) {
        Ok(_) => AdvisorStatusDto {
            enabled,
            available: true,
            path: Some(candidate_str),
            source_error: None,
        },
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => AdvisorStatusDto {
            enabled,
            available: false,
            path: Some(candidate_str),
            source_error: Some("Permission denied".to_string()),
        },
        Err(e) => AdvisorStatusDto {
            enabled,
            available: false,
            path: Some(candidate_str),
            source_error: Some(e.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_status_missing_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let status = inspect_history_root(false, Some(tmp.path()));
        assert!(!status.enabled);
        assert!(!status.available);
        assert_eq!(status.path, None);
        assert_eq!(status.source_error, None);
    }

    #[test]
    fn test_status_real_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let history_dir = tmp.path().join(".evcrate").join("advisor-history");
        std::fs::create_dir_all(&history_dir).unwrap();

        let status = inspect_history_root(true, Some(tmp.path()));
        assert!(status.enabled);
        assert!(status.available);
        assert_eq!(status.path, Some(history_dir.to_string_lossy().to_string()));
        assert_eq!(status.source_error, None);
    }

    #[test]
    fn test_status_symlink_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let real_dir = tmp.path().join("real-history");
        std::fs::create_dir_all(&real_dir).unwrap();

        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        let symlink_path = dot_evcrate.join("advisor-history");

        #[cfg(unix)]
        std::os::unix::fs::symlink(&real_dir, &symlink_path).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&real_dir, &symlink_path).unwrap();

        let status = inspect_history_root(false, Some(tmp.path()));
        assert!(!status.available);
        assert_eq!(
            status.source_error,
            Some("History root must be a real directory; symlink rejected".to_string())
        );
    }

    #[test]
    fn test_status_not_a_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let dot_evcrate = tmp.path().join(".evcrate");
        std::fs::create_dir_all(&dot_evcrate).unwrap();
        let file_path = dot_evcrate.join("advisor-history");
        std::fs::write(&file_path, "not a dir").unwrap();

        let status = inspect_history_root(false, Some(tmp.path()));
        assert!(!status.available);
        assert_eq!(
            status.source_error,
            Some("History root is not a directory".to_string())
        );
    }

    #[test]
    fn test_status_serialization_invariants() {
        let status = AdvisorStatusDto {
            enabled: false,
            available: true,
            path: Some("/home/user/.evcrate/advisor-history".to_string()),
            source_error: None,
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(!json.contains("pathSha256"));
        assert!(!json.contains("rootIdentity"));
        assert!(!json.contains("sourceRootIdentity"));
        assert!(json.contains("\"enabled\":false"));
        assert!(json.contains("\"available\":true"));
    }
}
