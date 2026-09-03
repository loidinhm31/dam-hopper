//! Linux release distribution contract for the Fedora 44 systemd profile.
//!
//! This module implements release-manifest schema v1 parsing, version and
//! inventory invariants, role projections, bounded diagnostics, CLI grammar,
//! release acquisition, and safe staging for Fedora 44.

pub mod acquire;
pub mod acquire_client;
pub mod archive;
pub mod archive_extract;
pub mod attestation;
pub mod cli;
pub mod constants;
pub mod error;
pub mod host_config;
pub mod inventory;
mod inventory_path;
mod inventory_validation;
pub mod layout;
pub mod lock;
pub mod manifest;
mod manifest_validation;
pub mod origin;
pub mod platform;
pub mod privilege;
pub mod stage;
pub mod stage_transaction;
pub mod version;

pub use acquire::{acquire_release, AcquisitionRecord};
pub use archive::inspect_and_validate_archive;
pub use archive_extract::extract_role_projection;
pub use attestation::verify_file_attestation;
pub use cli::{Cli, Commands, FetchArgs, InstallArgs, RoleCommands, RoleSetArgs};
pub use constants::*;
pub use error::ReleaseError;
pub use host_config::{load_host_config, save_host_config, HostConfig};
pub use inventory::{
    check_disallowed_files, normalize_inventory_path, validate_inventory, EntryKind,
    InventoryEntry, ReleaseRole, TargetRole,
};
pub use layout::Layout;
pub use lock::DeploymentLock;
pub use manifest::{
    ArchiveMeta, ComponentVersion, ComponentsMeta, ProfileMeta, ReleaseManifest, ReleaseMeta,
    RollbackMeta, ServiceContract, ServicesMeta,
};
pub use origin::{validate_web_origin, validate_web_origins};
pub use platform::{
    get_runtime_glibc_version, get_runtime_systemd_version, is_systemd_booted, parse_os_release,
    parse_systemd_version, verify_arch, verify_glibc_version, verify_host_platform,
    verify_os_release, verify_systemd_version, OsRelease,
};
pub use privilege::{current_euid, verify_privileges};
pub use stage::{load_pending_state, resolve_host_role, save_pending_state, PendingState};
pub use stage_transaction::stage_release_bundle;
pub use version::{
    validate_commit_sha, validate_release_tag, validate_sha256_hex, validate_version,
};
