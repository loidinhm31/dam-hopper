//! Path resolution, symlink rejection, and SPA fallback classification.

use std::path::{Component, Path, PathBuf};

/// Safely resolve a URI path against an immutable root directory.
///
/// Returns:
/// - `Ok(Some(path))` if the path resolves to an existing regular file without symlinks.
/// - `Ok(None)` if the path does not exist.
/// - `Err(_)` if the path contains illegal traversal, null bytes, symlinks, or directory access.
pub fn resolve_static_file(root: &Path, uri_path: &str) -> Result<Option<PathBuf>, &'static str> {
    let lower = uri_path.to_ascii_lowercase();
    if lower.contains('\0')
        || lower.contains('\\')
        || lower.contains("%00")
        || lower.contains("%2f")
        || lower.contains("%5c")
        || lower.contains("%2e%2e")
        || lower.contains("..")
    {
        return Err("illegal character or traversal in path");
    }

    let decoded = uri_path.trim_start_matches('/');
    if decoded.is_empty() {
        let index = root.join("index.html");
        return check_regular_file(&index);
    }

    let mut target = root.to_path_buf();
    for seg in Path::new(decoded).components() {
        match seg {
            Component::Normal(c) => {
                target.push(c);
                match std::fs::symlink_metadata(&target) {
                    Ok(meta) => {
                        if meta.file_type().is_symlink() {
                            return Err("symlink rejected");
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                        return Ok(None);
                    }
                    Err(_) => return Err("io error reading metadata"),
                }
            }
            _ => return Err("illegal path component"),
        }
    }

    check_regular_file(&target)
}

/// Verifies that a resolved path is an existing regular file and not a symlink or directory.
fn check_regular_file(path: &Path) -> Result<Option<PathBuf>, &'static str> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                Err("symlink rejected")
            } else if meta.is_file() {
                Ok(Some(path.to_path_buf()))
            } else if meta.is_dir() {
                // Reject directory requests directly so they do not fall back to SPA index.html
                Err("directory access rejected")
            } else {
                Ok(None)
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("io error reading metadata"),
    }
}

/// Evaluates whether an unmapped path qualifies for SPA fallback to `index.html`.
///
/// Returns true only if:
/// 1. Path is clean and contains no illegal traversal, null bytes, or encoded separators.
/// 2. Path is not under reserved prefixes (`/__dam-hopper/` or `/api/`).
/// 3. Final path segment has no file extension (not asset-like).
/// 4. `Accept` header permits HTML (contains `text/html` or `*/*`, or is absent).
pub fn should_spa_fallback(uri_path: &str, accept_header: Option<&str>) -> bool {
    let lower = uri_path.to_ascii_lowercase();
    if lower.contains('\0')
        || lower.contains('\\')
        || lower.contains("%00")
        || lower.contains("%2f")
        || lower.contains("%5c")
        || lower.contains("%2e%2e")
        || lower.contains("..")
    {
        return false;
    }

    let clean = uri_path.trim_start_matches('/');
    if clean.starts_with("__dam-hopper") || clean.starts_with("api") {
        return false;
    }

    let final_segment = clean.rsplit('/').next().unwrap_or(clean);
    if final_segment.is_empty() {
        return true;
    }

    // Paths with an extension (e.g. .js, .css, .ico, .png, .env) fail closed
    if final_segment.contains('.') {
        return false;
    }

    match accept_header {
        Some(accept) => accept.contains("text/html") || accept.contains("*/*"),
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rejects_null_and_backslash() {
        let root = Path::new("/tmp");
        assert!(resolve_static_file(root, "/test\0file").is_err());
        assert!(resolve_static_file(root, "/test\\file").is_err());
        assert!(resolve_static_file(root, "/test%00file").is_err());
    }

    #[test]
    fn test_rejects_traversal_and_encoded_separators() {
        let root = Path::new("/tmp");
        assert!(resolve_static_file(root, "/../etc/passwd").is_err());
        assert!(resolve_static_file(root, "/%2e%2e/etc/passwd").is_err());
        assert!(resolve_static_file(root, "/foo%2fbar").is_err());
        assert!(resolve_static_file(root, "/foo%5cbar").is_err());
        assert!(!should_spa_fallback("/%2e%2e/dashboard", Some("text/html")));
        assert!(!should_spa_fallback("/foo%2fbar", Some("text/html")));
    }

    #[test]
    fn test_spa_fallback_criteria() {
        // Valid SPA routes
        assert!(should_spa_fallback("/dashboard", Some("text/html,application/xhtml+xml")));
        assert!(should_spa_fallback("/projects/new", Some("*/*")));
        assert!(should_spa_fallback("/settings", None));
        assert!(should_spa_fallback("/", Some("text/html")));

        // Reject missing asset paths
        assert!(!should_spa_fallback("/assets/missing.js", Some("*/*")));
        assert!(!should_spa_fallback("/favicon.ico", Some("image/x-icon")));
        assert!(!should_spa_fallback("/styles.css", Some("text/css")));
        assert!(!should_spa_fallback("/.env", Some("*/*")));

        // Reject reserved paths
        assert!(!should_spa_fallback("/__dam-hopper/health", Some("text/html")));
        assert!(!should_spa_fallback("/__dam-hopper/unknown", Some("text/html")));
        assert!(!should_spa_fallback("/api/status", Some("text/html")));

        // Reject non-HTML accept headers
        assert!(!should_spa_fallback("/projects", Some("application/json")));
        assert!(!should_spa_fallback("/projects", Some("image/webp")));
    }
}
