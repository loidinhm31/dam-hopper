//! Reference-safe bounded retention and garbage collection.
//!
//! Enforces:
//! - Retain active + one previous known-good + pending or latest failed candidate
//! - Set-based reference calculation; fail closed on any uncertainty
//! - Verify manifest validity and ownership on every unreferenced candidate before deletion
//! - Two-pass design: abort entire GC on any unverifiable entry before deleting anything

use super::error::ReleaseError;
use super::layout::Layout;
use super::manifest::ReleaseManifest;
use super::ownership::verify_release_ownership;
use super::version::validate_tag_format;
use super::state::ManagerState;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

/// Apply reference-safe retention policy, deleting only verified unreferenced releases.
pub fn apply_retention(layout: &Layout, state: &ManagerState) -> Result<usize, ReleaseError> {
    let mut referenced_tags = HashSet::new();

    if let Some(ref a) = state.active {
        referenced_tags.insert(a.tag.as_str());
    }
    if let Some(ref p) = state.previous {
        referenced_tags.insert(p.tag.as_str());
    }
    if let Some(ref c) = state.pending {
        referenced_tags.insert(c.tag.as_str());
    } else if let Some(ref f) = state.latest_failure {
        if let Some(ref tag) = f.target_tag {
            referenced_tags.insert(tag.as_str());
        }
    }
    if let Some(ref tx) = state.transaction {
        referenced_tags.insert(tx.target_tag.as_str());
        if let Some(ref prev) = tx.previous_tag {
            referenced_tags.insert(prev.as_str());
        }
    }

    let releases_dir = layout.releases_dir();
    if !releases_dir.exists() {
        return Ok(0);
    }
    let canonical_releases_dir = releases_dir.canonicalize().map_err(|e| ReleaseError::Io {
        action: "canonicalize releases directory",
        details: e.to_string(),
    })?;

    let canonical_current = if layout.current_link().exists() {
        Some(layout.current_link().canonicalize().map_err(|e| ReleaseError::Io {
            action: "canonicalize current symlink",
            details: e.to_string(),
        })?)
    } else {
        None
    };

    let entries = fs::read_dir(&releases_dir).map_err(|e| ReleaseError::Io {
        action: "read releases directory for retention",
        details: e.to_string(),
    })?;

    // Pass 1: Gather and verify unreferenced candidates
    let mut candidates_to_delete: Vec<PathBuf> = Vec::new();
    for entry_res in entries {
        let entry = entry_res.map_err(|e| ReleaseError::Io {
            action: "iterate releases directory entry",
            details: e.to_string(),
        })?;

        let file_type = entry.file_type().map_err(|e| ReleaseError::Io {
            action: "inspect file type in releases dir",
            details: e.to_string(),
        })?;
        if !file_type.is_dir() {
            continue;
        }

        let name = entry.file_name();
        let tag_str = name.to_string_lossy();
        if tag_str != "imported-format-2" {
            validate_tag_format(&tag_str).map_err(|e| {
                ReleaseError::Config(format!(
                    "invalid directory name in releases dir '{}': {e}",
                    entry.path().display()
                ))
            })?;
        }

        if !referenced_tags.contains(tag_str.as_ref()) {
            let path = entry.path();
            let canonical_path = path.canonicalize().map_err(|e| ReleaseError::Io {
                action: "canonicalize candidate release directory",
                details: format!("{}: {e}", path.display()),
            })?;

            if !canonical_path.starts_with(&canonical_releases_dir) {
                return Err(ReleaseError::Config(format!(
                    "candidate path escapes releases directory: {}", path.display()
                )));
            }

            if let Some(ref cur) = canonical_current {
                if cur == &canonical_path || cur.starts_with(&canonical_path) {
                    continue;
                }
            }

            // Verify manifest and ownership before adding to delete list
            verify_candidate_integrity(&canonical_path)?;
            candidates_to_delete.push(path);
        }
    }

    // Pass 2: Delete only after ALL candidates passed verification
    let mut pruned_count = 0;
    for path in candidates_to_delete {
        fs::remove_dir_all(&path).map_err(|e| ReleaseError::Io {
            action: "remove unreferenced release tree",
            details: format!("{}: {e}", path.display()),
        })?;
        pruned_count += 1;
    }

    // Clean up completed staging directories, propagating errors
    let staging_dir = layout.staging_dir();
    if staging_dir.exists() {
        let current_tx_id = state.transaction.as_ref().map(|t| t.tx_id.as_str());
        let staged_entries = fs::read_dir(&staging_dir).map_err(|e| ReleaseError::Io {
            action: "read staging directory",
            details: e.to_string(),
        })?;
        for entry in staged_entries.flatten() {
            let name = entry.file_name();
            let tx_str = name.to_string_lossy();
            if current_tx_id != Some(tx_str.as_ref()) {
                fs::remove_dir_all(entry.path()).map_err(|e| ReleaseError::Io {
                    action: "clean staging entry",
                    details: format!("{}: {e}", entry.path().display()),
                })?;
            }
        }
    }

    Ok(pruned_count)
}

fn verify_candidate_integrity(path: &Path) -> Result<(), ReleaseError> {
    if path.file_name() == Some(std::ffi::OsStr::new("imported-format-2")) {
        let bin = path.join("server").join("bin").join("dam-hopper-server");
        let unit = path.join("server").join("systemd").join("dam-hopper.service");
        if !bin.is_file() || !unit.is_file() {
            return Err(ReleaseError::InvalidBundle {
                path: path.display().to_string(),
                reason: "imported legacy release missing expected server binary or unit".into(),
            });
        }
        verify_release_ownership(path, false)?;
        return Ok(());
    }

    // Find release-manifest.json in the release tree
    let manifest_path = if path.join("release-manifest.json").exists() {
        path.join("release-manifest.json")
    } else {
        // If role projected (e.g. releases/<tag>/<role>/release-manifest.json)
        let mut found = None;
        if let Ok(entries) = fs::read_dir(path) {
            for sub in entries.flatten() {
                let sub_m = sub.path().join("release-manifest.json");
                if sub_m.exists() {
                    found = Some(sub_m);
                    break;
                }
            }
        }
        found.ok_or_else(|| ReleaseError::InvalidBundle {
            path: path.display().to_string(),
            reason: "unreferenced release tree missing release-manifest.json".into(),
        })?
    };

    let bytes = fs::read(&manifest_path).map_err(|e| ReleaseError::Io {
        action: "read candidate manifest for retention",
        details: e.to_string(),
    })?;
    ReleaseManifest::parse_and_validate(&bytes)?;
    verify_release_ownership(path, false)?;
    Ok(())
}
