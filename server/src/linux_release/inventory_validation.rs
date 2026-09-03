//! Inventory collection validation and required release asset verification.

use super::constants::MAX_INVENTORY_ENTRIES;
use super::error::ReleaseError;
use super::inventory::{EntryKind, InventoryEntry, ReleaseRole};
use super::inventory_path::{check_disallowed_files, normalize_inventory_path};
use std::collections::HashSet;

/// Validate an inventory collection for size bounds, duplicates, path normalization, and required paths.
pub fn validate_inventory(entries: &[InventoryEntry]) -> Result<(), ReleaseError> {
    if entries.len() > MAX_INVENTORY_ENTRIES {
        return Err(ReleaseError::InventoryTooLarge(entries.len()));
    }

    let mut seen_paths = HashSet::with_capacity(entries.len());
    let mut req = RequiredPathsTracker::default();

    for entry in entries {
        normalize_inventory_path(&entry.path)?;
        check_disallowed_files(&entry.path)?;

        if !seen_paths.insert(&entry.path) {
            return Err(ReleaseError::DuplicateInventoryPath(entry.path.clone()));
        }
        if entry.roles.is_empty() {
            return Err(ReleaseError::EmptyRoles {
                path: entry.path.clone(),
            });
        }
        if entry.mode > 0o7777 {
            return Err(ReleaseError::InvalidMode {
                path: entry.path.clone(),
                mode: entry.mode,
            });
        }

        validate_entry_kind(entry)?;
        req.check_entry(entry)?;
    }

    req.assert_complete()
}

fn validate_entry_kind(entry: &InventoryEntry) -> Result<(), ReleaseError> {
    match entry.kind {
        EntryKind::File => {
            if entry.size.is_none() || entry.sha256.is_none() {
                return Err(ReleaseError::MissingFileMetadata {
                    path: entry.path.clone(),
                });
            }
            let sha = entry.sha256.as_ref().unwrap();
            if sha.len() != 64
                || !sha
                    .chars()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
            {
                return Err(ReleaseError::InvalidFileSha256 {
                    path: entry.path.clone(),
                });
            }
        }
        EntryKind::Dir => {
            if entry.size.is_some() || entry.sha256.is_some() {
                return Err(ReleaseError::UnexpectedDirectoryMetadata {
                    path: entry.path.clone(),
                });
            }
        }
    }
    Ok(())
}

#[derive(Default)]
struct RequiredPathsTracker {
    has_manager: bool,
    has_server: bool,
    has_web: bool,
    has_api_unit: bool,
    has_web_unit: bool,
    has_web_sysusers: bool,
    has_web_payload: bool,
    has_license_or_notices: bool,
}

impl RequiredPathsTracker {
    fn check_entry(&mut self, entry: &InventoryEntry) -> Result<(), ReleaseError> {
        match entry.path.as_str() {
            "bin/dam-hopper-manager" => {
                if entry.kind != EntryKind::File
                    || !entry.roles.contains(&ReleaseRole::Common)
                    || entry.mode & 0o111 == 0
                {
                    return Err(ReleaseError::InvalidRequiredPath {
                        path: "bin/dam-hopper-manager",
                    });
                }
                self.has_manager = true;
            }
            "bin/dam-hopper-server" => {
                if entry.kind != EntryKind::File
                    || !entry.roles.contains(&ReleaseRole::Server)
                    || entry.mode & 0o111 == 0
                {
                    return Err(ReleaseError::InvalidRequiredPath {
                        path: "bin/dam-hopper-server",
                    });
                }
                self.has_server = true;
            }
            "bin/dam-hopper-web" => {
                if entry.kind != EntryKind::File
                    || !entry.roles.contains(&ReleaseRole::Web)
                    || entry.mode & 0o111 == 0
                {
                    return Err(ReleaseError::InvalidRequiredPath {
                        path: "bin/dam-hopper-web",
                    });
                }
                self.has_web = true;
            }
            "systemd/dam-hopper-api.service" => {
                if entry.kind != EntryKind::File || !entry.roles.contains(&ReleaseRole::Server) {
                    return Err(ReleaseError::InvalidRequiredPath {
                        path: "systemd/dam-hopper-api.service",
                    });
                }
                self.has_api_unit = true;
            }
            "systemd/dam-hopper-web.service" => {
                if entry.kind != EntryKind::File || !entry.roles.contains(&ReleaseRole::Web) {
                    return Err(ReleaseError::InvalidRequiredPath {
                        path: "systemd/dam-hopper-web.service",
                    });
                }
                self.has_web_unit = true;
            }
            "sysusers.d/dam-hopper-web.conf" => {
                if entry.kind != EntryKind::File || !entry.roles.contains(&ReleaseRole::Web) {
                    return Err(ReleaseError::InvalidRequiredPath {
                        path: "sysusers.d/dam-hopper-web.conf",
                    });
                }
                self.has_web_sysusers = true;
            }
            "LICENSE" | "NOTICES" => {
                if entry.kind == EntryKind::File && entry.roles.contains(&ReleaseRole::Common) {
                    self.has_license_or_notices = true;
                }
            }
            p if p == "web" || p.starts_with("web/") => {
                if entry.roles.contains(&ReleaseRole::Web) {
                    self.has_web_payload = true;
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn assert_complete(&self) -> Result<(), ReleaseError> {
        let checks = [
            (self.has_manager, "bin/dam-hopper-manager"),
            (self.has_server, "bin/dam-hopper-server"),
            (self.has_web, "bin/dam-hopper-web"),
            (self.has_api_unit, "systemd/dam-hopper-api.service"),
            (self.has_web_unit, "systemd/dam-hopper-web.service"),
            (self.has_web_sysusers, "sysusers.d/dam-hopper-web.conf"),
            (self.has_web_payload, "web"),
            (self.has_license_or_notices, "LICENSE"),
        ];
        for (present, path) in checks {
            if !present {
                return Err(ReleaseError::MissingRequiredPath { path });
            }
        }
        Ok(())
    }
}
