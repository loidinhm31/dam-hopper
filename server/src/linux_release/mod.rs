//! Linux release distribution contract for the Fedora 44 systemd profile.
//!
//! This module implements release-manifest schema v1 parsing, version and
//! inventory invariants, role projections, and bounded diagnostics. It is the
//! runtime validation authority for the publisher schema at
//! `deploy/release/release-manifest.schema.json`; installer behavior is owned
//! by later release phases. See `docs/linux-release-manifest.md` for the
//! contract.

pub mod constants;
pub mod error;
pub mod inventory;
mod inventory_path;
mod inventory_validation;
pub mod manifest;
mod manifest_validation;
pub mod version;

pub use constants::*;
pub use error::ReleaseError;
pub use inventory::{
    check_disallowed_files, normalize_inventory_path, validate_inventory, EntryKind,
    InventoryEntry, ReleaseRole, TargetRole,
};
pub use manifest::{
    ArchiveMeta, ComponentVersion, ComponentsMeta, ProfileMeta, ReleaseManifest, ReleaseMeta,
    RollbackMeta, ServiceContract, ServicesMeta,
};
pub use version::{
    validate_commit_sha, validate_release_tag, validate_sha256_hex, validate_version,
};
