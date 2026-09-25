use std::collections::HashSet;

use super::error::PluginError;
use super::limits::{MAX_ENTRY_NAME_LENGTH, MAX_PATH_LENGTH};

/// Normalizes a package inventory path according to strict security rules.
/// Rejects absolute paths, traversal (..), empty segments, backslashes, URL-encoded separators,
/// and invalid component characters.
pub fn normalize_package_path(raw: &str) -> Result<String, PluginError> {
    if raw.is_empty() {
        return Err(PluginError::invalid_input("Path cannot be empty"));
    }
    if raw.len() > MAX_PATH_LENGTH {
        return Err(PluginError::invalid_input(format!(
            "Path length ({}) exceeds maximum limit ({MAX_PATH_LENGTH})",
            raw.len()
        )));
    }

    if raw.contains('\\') {
        return Err(PluginError::invalid_input(
            "Path cannot contain backslashes ('\\')",
        ));
    }
    let raw_lower = raw.to_lowercase();
    if raw_lower.contains("%2f") || raw_lower.contains("%5c") {
        return Err(PluginError::invalid_input(
            "Path cannot contain encoded path separators ('%2f' or '%5c')",
        ));
    }

    if raw.starts_with('/') {
        return Err(PluginError::invalid_input(
            "Absolute paths starting with '/' are not permitted",
        ));
    }

    let trimmed = raw.trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(PluginError::invalid_input(
            "Root directory cannot be an entry path",
        ));
    }

    let mut segments = Vec::new();
    for segment in trimmed.split('/') {
        if segment.is_empty() {
            return Err(PluginError::invalid_input(
                "Path contains empty segment or consecutive slashes",
            ));
        }
        if segment == "." || segment == ".." {
            return Err(PluginError::invalid_input(
                "Path cannot contain '.' or '..' segments",
            ));
        }
        if segment.len() > MAX_ENTRY_NAME_LENGTH {
            return Err(PluginError::invalid_input(format!(
                "Path segment '{}' length ({}) exceeds maximum limit ({MAX_ENTRY_NAME_LENGTH})",
                segment,
                segment.len()
            )));
        }
        if segment.starts_with(' ') || segment.ends_with(' ') {
            return Err(PluginError::invalid_input(format!(
                "Path segment '{}' cannot have leading or trailing whitespace",
                segment
            )));
        }
        if segment.contains('\0') || segment.contains(':') {
            return Err(PluginError::invalid_input(format!(
                "Path segment '{}' contains forbidden characters",
                segment
            )));
        }
        segments.push(segment);
    }

    Ok(segments.join("/"))
}

/// Tracks seen paths to detect duplicates and case-fold collisions across platforms.
#[derive(Default)]
pub struct PathCollisionTracker {
    exact_paths: HashSet<String>,
    case_fold_paths: HashSet<String>,
}

impl PathCollisionTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn check_and_insert(&mut self, normalized_path: &str) -> Result<(), PluginError> {
        if self.exact_paths.contains(normalized_path) {
            return Err(PluginError::invalid_input(format!(
                "Duplicate archive entry path: '{normalized_path}'"
            )));
        }

        let folded = normalized_path.to_lowercase();
        if self.case_fold_paths.contains(&folded) {
            return Err(PluginError::invalid_input(format!(
                "Case-fold path collision detected for entry: '{normalized_path}'"
            )));
        }

        self.exact_paths.insert(normalized_path.to_string());
        self.case_fold_paths.insert(folded);
        Ok(())
    }
}
