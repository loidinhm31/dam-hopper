//! Constants defining the release contract and profile invariants for Fedora 44.

/// Supported schema version for release manifests.
pub const SCHEMA_VERSION: u32 = 1;

/// Target profile identifier.
pub const PROFILE_ID: &str = "fedora44-x86_64-systemd";
/// Target Linux distribution identifier.
pub const PROFILE_OS_ID: &str = "fedora";
/// Target Linux distribution release version.
pub const PROFILE_OS_VERSION: &str = "44";
/// Target CPU architecture.
pub const PROFILE_ARCH: &str = "x86_64";
/// Rust compilation target triple.
pub const PROFILE_TARGET: &str = "x86_64-unknown-linux-gnu";
/// Minimum glibc version required on target.
pub const PROFILE_GLIBC_MIN: &str = "2.43";
/// Minimum systemd version required on target.
pub const PROFILE_SYSTEMD_MIN: u32 = 259;

/// Systemd unit name for the API server.
pub const API_SERVICE_UNIT: &str = "dam-hopper-api.service";
/// Systemd Execution user for the API server (per owner direction for MVP).
pub const API_SERVICE_IDENTITY: &str = "root";
/// Default bind host for the API server.
pub const API_SERVICE_BIND_HOST: &str = "0.0.0.0";
/// Dedicated port for the API server.
pub const API_SERVICE_PORT: u16 = 4801;
/// Health check HTTP path for the API server.
pub const API_SERVICE_HEALTH_PATH: &str = "/api/health";

/// Systemd unit name for the dedicated web server.
pub const WEB_SERVICE_UNIT: &str = "dam-hopper-web.service";
/// Systemd execution user for the dedicated web server.
pub const WEB_SERVICE_IDENTITY: &str = "dam-hopper-web";
/// Default bind host for the dedicated web server.
pub const WEB_SERVICE_BIND_HOST: &str = "0.0.0.0";
/// Dedicated port for the web server.
pub const WEB_SERVICE_PORT: u16 = 4802;
/// Health check HTTP path for the web server.
pub const WEB_SERVICE_HEALTH_PATH: &str = "/__dam-hopper/health";

/// Systemd unit name for the boot recovery service.
pub const RECOVERY_SERVICE_UNIT: &str = "dam-hopper-recovery.service";

/// All managed release systemd service unit names.
pub const ALL_SERVICE_UNITS: &[&str] = &[
    API_SERVICE_UNIT,
    WEB_SERVICE_UNIT,
    RECOVERY_SERVICE_UNIT,
];

/// Standard rollback declaration compatibility flag.
pub const ROLLBACK_PREVIOUS_COMPATIBLE: bool = true;
/// Standard rollback state compatibility level.
pub const ROLLBACK_STATE_COMPATIBILITY: &str = "n-1";

/// Maximum allowed manifest payload size in bytes (1 MiB).
pub const MAX_MANIFEST_BYTES: usize = 1024 * 1024;
/// Maximum allowed inventory entries in a single manifest.
pub const MAX_INVENTORY_ENTRIES: usize = 20_000;
/// Maximum length of an inventory path in bytes.
pub const MAX_PATH_LENGTH: usize = 255;

/// Expected archive name template given a version tag (e.g. `v0.2.0`).
pub fn expected_archive_name(tag: &str) -> String {
    format!("dam-hopper-{tag}-{PROFILE_ID}.tar.gz")
}
