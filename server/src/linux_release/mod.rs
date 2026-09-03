//! Linux release distribution contract for the Fedora 44 systemd profile.
//!
//! This module implements release-manifest schema v1 parsing, version and
//! inventory invariants, role projections, bounded diagnostics, CLI grammar,
//! release acquisition, and safe staging for Fedora 44.

pub mod account;
pub mod acquire;
pub mod acquire_client;
pub mod activate;
pub mod activate_preflight;
pub mod archive;
pub mod archive_extract;
pub mod attestation;
pub mod cli;
pub mod constants;
pub mod durable_fs;
pub mod error;
pub mod health;
pub mod host_config;
pub mod inventory;
mod inventory_path;
mod inventory_validation;
pub mod journal;
pub mod legacy_format2;
pub mod legacy_format2_inspect;
pub mod legacy_format2_manifest;
pub mod legacy_format2_root;
pub mod legacy_format2_unit;
pub mod migration;
pub mod layout;
pub mod lock;
pub mod manifest;
mod manifest_validation;
pub mod origin;
pub mod ownership;
pub mod platform;
pub mod privilege;
pub mod process;
pub mod process_holders;
pub mod recovery;
pub mod retention;
pub mod rollback;
pub mod stage;
pub mod stage_transaction;
pub mod stage_units;
pub mod state;
pub mod state_record;
pub mod systemd;
pub mod systemd_backup;
pub mod transaction;
pub mod unit;
pub mod unit_parser;
pub mod unit_policy;
pub mod version;
pub use account::{get_user_by_name, verify_web_sysuser_account, UserInfo};
pub use acquire::{acquire_release, AcquisitionRecord};
pub use archive::inspect_and_validate_archive;
pub use archive_extract::extract_role_projection;
pub use attestation::verify_file_attestation;
pub use cli::{Cli, Commands, FetchArgs, InstallArgs, RoleCommands, RoleSetArgs, ValidateArgs};
pub use constants::*;
pub use error::ReleaseError;
pub use host_config::{
    load_host_config, load_host_public_config, save_host_config, save_host_public_config,
    HostConfig, HostPublicConfig,
};
pub use inventory::{
    check_disallowed_files, normalize_inventory_path, validate_inventory, EntryKind,
    InventoryEntry, ReleaseRole, TargetRole,
};
pub use layout::Layout;
pub use lock::DeploymentLock;
pub use manifest::{
    validate_manifest_and_archive, ArchiveMeta, ComponentVersion, ComponentsMeta, ProfileMeta,
    ReleaseManifest, ReleaseMeta, RollbackMeta, ServiceContract, ServicesMeta,
};
pub use ownership::{
    verify_manager_state_permissions, verify_path_permissions, verify_release_ownership,
};
pub use origin::{validate_web_origin, validate_web_origins};
pub use platform::{
    get_runtime_glibc_version, get_runtime_systemd_version, is_systemd_booted, parse_os_release,
    parse_systemd_version, verify_arch, verify_glibc_version, verify_host_platform,
    verify_os_release, verify_systemd_version, OsRelease,
};
pub use process::{
    check_ports_free, inspect_service_process, is_port_listening, parse_proc_net_listening,
    verify_no_foreign_sqlite_holders, verify_service_identity_and_exe, ServiceProcessEvidence,
};
pub use privilege::{current_euid, verify_privileges};
pub use stage::{load_pending_state, resolve_host_role, PendingState};
pub use stage_transaction::stage_release_bundle;
pub use stage_units::stage_candidate_units;
pub use systemd::{
    systemctl_daemon_reload, systemctl_disable, systemctl_enable, systemctl_is_active,
    systemctl_is_enabled, systemctl_restart, systemctl_show_property, systemctl_start,
    systemctl_stop, systemd_analyze_verify, systemd_sysusers,
};
pub use unit::{
    render_api_unit, render_unit, render_web_unit, UnitRenderContext, TOKEN_API_ORIGINS,
    TOKEN_PUBLIC_CONFIG, TOKEN_RELEASE_ROOT, TOKEN_RELEASE_VERSION,
};
pub use unit_parser::ParsedUnit;
pub use version::{
    validate_commit_sha, validate_release_tag, validate_sha256_hex, validate_version,
};
pub use activate::{execute_activation, execute_activation_locked};
pub use durable_fs::{
    atomic_symlink, atomic_write_file, atomic_write_json, copy_file_durable, sync_dir,
};
pub use health::{
    wait_for_health_stability, HealthProbeTarget, DEFAULT_PROBE_INTERVAL,
    DEFAULT_REQUIRED_CONSECUTIVE, DEFAULT_STARTUP_DEADLINE,
};
pub use journal::{classify_recovery, validate_transition, DeploymentState, RecoveryAction};
pub use recovery::execute_recovery;
pub use retention::apply_retention;
pub use rollback::{execute_manual_rollback, rollback_activation_failure};
pub use state::{
    backup_state_file, load_or_init_manager_state, save_manager_state, ManagerState,
};
pub use state_record::{
    FailureRecord, PendingCandidateRecord, ReleaseRecord, TransactionPhase, TransactionRecord,
};
pub use systemd_backup::{
    backup_unit_files, install_unit_file, remove_unit_file, restore_unit_files,
};
pub use transaction::ActivationTransaction;
pub use legacy_format2::{
    import_legacy_format2_release, inspect_format2_installation, inspect_format2_root,
    is_legacy_format2_root, validate_format2_unit, LegacyFormat2Evidence, LegacyFormat2Manifest,
    LEGACY_FORMAT2_PORT, LEGACY_FORMAT2_TAG, LEGACY_FORMAT2_UNIT, LEGACY_FORMAT2_USER,
};
pub use unit::render_recovery_unit;
