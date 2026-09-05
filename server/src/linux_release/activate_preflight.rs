//! Preflight validation and health target construction for release activation.

use super::account::verify_web_sysuser_account;
use super::constants::{
    API_SERVICE_HEALTH_PATH, API_SERVICE_PORT, API_SERVICE_UNIT, RECOVERY_SERVICE_UNIT,
    WEB_SERVICE_HEALTH_PATH, WEB_SERVICE_IDENTITY, WEB_SERVICE_PORT, WEB_SERVICE_UNIT,
};
use super::error::ReleaseError;
use super::health::HealthProbeTarget;
use super::host_config::load_host_public_config;
use super::layout::Layout;
use super::manifest::ReleaseManifest;
use super::ownership::{verify_path_permissions, verify_release_ownership};
use super::process::{is_port_listening, verify_no_foreign_sqlite_holders};
use super::state_record::PendingCandidateRecord;
use super::unit_parser::ParsedUnit;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

const MAX_RUNTIME_CONFIG_BYTES: usize = 64 * 1024;

/// Resolve all potential SQLite database paths configured in `dam-hopper.toml` or defaults.
pub fn resolve_configured_sqlite_paths(layout: &Layout) -> Result<Vec<PathBuf>, ReleaseError> {
    let mut candidates = Vec::new();
    let config_path = layout.etc_dir.join("dam-hopper.toml");
    let default_session_path = "~/.config/dam-hopper/sessions.db";
    let raw_path = match fs::symlink_metadata(&config_path) {
        Ok(metadata) if metadata.file_type().is_file() => {
            let mut file = fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&config_path)
                .map_err(|error| ReleaseError::Io {
                    action: "open API configuration with no-follow",
                    details: error.to_string(),
                })?;
            let mut bytes = Vec::new();
            file.by_ref()
                .take(MAX_RUNTIME_CONFIG_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| ReleaseError::Io {
                    action: "read API configuration",
                    details: error.to_string(),
                })?;
            if bytes.len() > MAX_RUNTIME_CONFIG_BYTES {
                return Err(ReleaseError::Config(format!(
                    "API configuration exceeds maximum size of {MAX_RUNTIME_CONFIG_BYTES} bytes"
                )));
            }
            let content = String::from_utf8(bytes).map_err(|error| {
                ReleaseError::Config(format!("API configuration is not valid UTF-8: {error}"))
            })?;
            let toml_val = toml::from_str::<toml::Value>(&content).map_err(|error| {
                ReleaseError::Config(format!(
                    "failed to parse API configuration at '{}': {error}",
                    config_path.display()
                ))
            })?;
            toml_val
                .get("server")
                .and_then(|server| server.get("session_db_path"))
                .and_then(|path| path.as_str())
                .unwrap_or(default_session_path)
                .to_string()
        }
        Ok(_) => {
            return Err(ReleaseError::OwnershipViolation {
                path: config_path.display().to_string(),
                expected: "regular API configuration file".into(),
                got: "symbolic link or non-regular file".into(),
            });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            default_session_path.to_string()
        }
        Err(error) => {
            return Err(ReleaseError::Io {
                action: "inspect API configuration",
                details: error.to_string(),
            });
        }
    };

    if let Some(suffix) = raw_path.strip_prefix("~/") {
        candidates.push(PathBuf::from("/root").join(suffix));
        if let Some(home) = dirs::home_dir() {
            candidates.push(home.join(suffix));
        }
    } else if raw_path == "~" {
        candidates.push(PathBuf::from("/root"));
        if let Some(home) = dirs::home_dir() {
            candidates.push(home);
        }
    } else {
        candidates.push(PathBuf::from(raw_path));
    }

    candidates.push(layout.etc_dir.join("sessions.db"));
    Ok(candidates)
}

/// Validate a staged candidate before any service switch.
pub fn validate_candidate_preflight(
    layout: &Layout,
    candidate: &PendingCandidateRecord,
    allowed_sqlite_pids: &[u32],
) -> Result<ReleaseManifest, ReleaseError> {
    let units_path = PathBuf::from(candidate.pending_units_path.as_deref().ok_or_else(|| {
        ReleaseError::Config("pending candidate has no rendered unit directory".to_string())
    })?);
    let host_config_path = PathBuf::from(
        candidate
            .pending_host_config_path
            .as_deref()
            .ok_or_else(|| {
                ReleaseError::Config(
                    "pending candidate has no public host configuration".to_string(),
                )
            })?,
    );
    validate_preflight(
        layout,
        candidate,
        allowed_sqlite_pids,
        &units_path,
        &host_config_path,
        true,
    )
}

/// Validate the committed active release before ordinary startup.
pub fn validate_active_preflight(
    layout: &Layout,
    candidate: &PendingCandidateRecord,
    allowed_sqlite_pids: &[u32],
) -> Result<ReleaseManifest, ReleaseError> {
    validate_preflight(
        layout,
        candidate,
        allowed_sqlite_pids,
        &layout.systemd_unit_dir,
        &layout.host_config_json_path(),
        false,
    )
}

fn validate_preflight(
    layout: &Layout,
    candidate: &PendingCandidateRecord,
    allowed_sqlite_pids: &[u32],
    units_path: &Path,
    host_config_path: &Path,
    pending_artifacts: bool,
) -> Result<ReleaseManifest, ReleaseError> {
    let release_dir = Path::new(&candidate.release_path);
    let expected_suffix = PathBuf::from("releases")
        .join(&candidate.tag)
        .join(candidate.role.as_str());
    let managed_release = release_dir.starts_with(layout.releases_dir())
        || is_migration_release_path(layout, release_dir);
    if !managed_release || !release_dir.ends_with(&expected_suffix) {
        return Err(ReleaseError::InvalidBundle {
            path: candidate.release_path.clone(),
            reason: "candidate release path is outside the managed release root".into(),
        });
    }
    verify_release_ownership(release_dir, true)?;

    let manifest_path = release_dir.join("release-manifest.json");
    verify_path_permissions(&manifest_path, 0o644, true)?;
    let manifest_bytes = fs::read(&manifest_path).map_err(|e| ReleaseError::Io {
        action: "read candidate release-manifest.json",
        details: e.to_string(),
    })?;

    let digest = format!("{:x}", Sha256::digest(&manifest_bytes));
    if digest != candidate.manifest_sha256 {
        return Err(ReleaseError::ArchiveDigestMismatch {
            path: manifest_path.display().to_string(),
            expected: candidate.manifest_sha256.clone(),
            got: digest,
        });
    }

    let manifest = ReleaseManifest::parse_and_validate(&manifest_bytes)?;
    if manifest.release.tag != candidate.tag {
        return Err(ReleaseError::Config(
            "candidate tag does not match its release manifest".into(),
        ));
    }
    if manifest.archive.sha256 != candidate.archive_sha256 {
        return Err(ReleaseError::ArchiveDigestMismatch {
            path: manifest.archive.name.clone(),
            expected: candidate.archive_sha256.clone(),
            got: manifest.archive.sha256.clone(),
        });
    }

    let pending_transaction_id = if pending_artifacts {
        let matches_root = units_path.parent() == Some(layout.var_lib_dir.as_path());
        let transaction_id = units_path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix("pending-units-"))
            .filter(|id| !id.is_empty())
            .map(str::to_owned);
        if !matches_root || transaction_id.is_none() {
            return Err(ReleaseError::InvalidBundle {
                path: units_path.display().to_string(),
                reason: "pending unit directory is outside the managed state root".to_string(),
            });
        }
        verify_path_permissions(units_path, 0o700, true)?;
        transaction_id
    } else {
        verify_path_permissions(units_path, 0o755, true)?;
        None
    };

    verify_candidate_file(&units_path.join(RECOVERY_SERVICE_UNIT), 0o644, None)?;
    let recovery_content =
        fs::read_to_string(units_path.join(RECOVERY_SERVICE_UNIT)).map_err(|e| {
            ReleaseError::Io {
                action: "read candidate recovery unit",
                details: e.to_string(),
            }
        })?;
    let parsed_recovery = ParsedUnit::parse(&recovery_content)?;
    let expected_recovery_exec = format!(
        "{}/bin/dam-hopper-manager recover --boot",
        candidate.release_path
    );
    let actual_recovery_exec = parsed_recovery
        .get_value("Service", "ExecStart")
        .ok_or_else(|| ReleaseError::UnitPolicyViolation {
            unit: RECOVERY_SERVICE_UNIT.into(),
            reason: "missing ExecStart in recovery unit".into(),
        })?;
    if actual_recovery_exec != expected_recovery_exec {
        return Err(ReleaseError::UnitPolicyViolation {
            unit: RECOVERY_SERVICE_UNIT.into(),
            reason: format!(
                "ExecStart mismatch: expected '{expected_recovery_exec}', got '{actual_recovery_exec}'"
            ),
        });
    }
    if candidate.role.includes_server() {
        verify_candidate_file(&units_path.join(API_SERVICE_UNIT), 0o644, None)?;
    }
    if candidate.role.includes_web() {
        verify_candidate_file(&units_path.join(WEB_SERVICE_UNIT), 0o644, None)?;
        if pending_artifacts {
            verify_candidate_file(&units_path.join("dam-hopper-web.conf"), 0o644, None)?;
        } else {
            verify_candidate_file(&layout.sysusers_conf_path(), 0o644, None)?;
        }
    }

    if pending_artifacts {
        let config_transaction_id = host_config_path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix("pending-host-config-"))
            .and_then(|name| name.strip_suffix(".json"))
            .filter(|id| !id.is_empty());
        if host_config_path.parent() != Some(layout.var_lib_dir.as_path())
            || config_transaction_id != pending_transaction_id.as_deref()
        {
            return Err(ReleaseError::InvalidBundle {
                path: host_config_path.display().to_string(),
                reason: "pending host configuration path is not transaction-scoped and canonical"
                    .into(),
            });
        }
    }
    verify_candidate_file(host_config_path, 0o644, None)?;
    let public_config = load_host_public_config(host_config_path)?
        .ok_or_else(|| ReleaseError::Config("public host configuration is missing".to_string()))?;
    if public_config.role != candidate.role {
        return Err(ReleaseError::Config(
            "public host configuration role does not match candidate".to_string(),
        ));
    }

    if is_port_listening(4800)? {
        return Err(ReleaseError::ProcessInspectionFailed {
            reason: "forbidden legacy port 4800 is listening".into(),
        });
    }

    for db_path in resolve_configured_sqlite_paths(layout)? {
        verify_no_foreign_sqlite_holders(&db_path, allowed_sqlite_pids)?;
    }

    Ok(manifest)
}

fn is_migration_release_path(layout: &Layout, release_dir: &Path) -> bool {
    let Some(parent) = layout.opt_dir.parent() else {
        return false;
    };
    let Ok(relative) = release_dir.strip_prefix(parent) else {
        return false;
    };
    let Some(migration_root) = relative.components().next() else {
        return false;
    };
    let migration_root = parent.join(migration_root.as_os_str());
    migration_root
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(".dam-hopper-migration."))
        && fs::symlink_metadata(migration_root.join(".migration-transaction"))
            .is_ok_and(|metadata| metadata.file_type().is_file())
}

fn verify_candidate_file(
    path: &Path,
    expected_mode: u32,
    expected_hash: Option<&String>,
) -> Result<(), ReleaseError> {
    verify_path_permissions(path, expected_mode, true)?;
    if let Some(expected_hash) = expected_hash {
        let bytes = fs::read(path).map_err(|e| ReleaseError::Io {
            action: "read candidate file for digest",
            details: e.to_string(),
        })?;
        let got = format!("{:x}", Sha256::digest(bytes));
        if got != *expected_hash {
            return Err(ReleaseError::ArchiveDigestMismatch {
                path: path.display().to_string(),
                expected: expected_hash.clone(),
                got,
            });
        }
    }
    Ok(())
}

/// Construct health probe targets for the candidate release role.
pub fn build_candidate_health_targets(
    candidate: &PendingCandidateRecord,
) -> Result<Vec<HealthProbeTarget>, ReleaseError> {
    let release_root = PathBuf::from(&candidate.release_path);
    let mut targets = Vec::new();

    if candidate.role.includes_server() {
        let (api_uid, api_gid) = resolve_api_service_uid_gid(candidate);
        targets.push(HealthProbeTarget {
            unit_name: API_SERVICE_UNIT.into(),
            role: "api".into(),
            port: API_SERVICE_PORT,
            path: API_SERVICE_HEALTH_PATH.into(),
            expected_version: candidate.tag.trim_start_matches('v').into(),
            expected_uid: api_uid,
            expected_gid: api_gid,
            expected_exe_prefix: release_root.join("bin/dam-hopper-server"),
        });
    }

    if candidate.role.includes_web() {
        let web_user = verify_web_sysuser_account(WEB_SERVICE_IDENTITY)?;
        targets.push(HealthProbeTarget {
            unit_name: WEB_SERVICE_UNIT.into(),
            role: "web".into(),
            port: WEB_SERVICE_PORT,
            path: WEB_SERVICE_HEALTH_PATH.into(),
            expected_version: candidate.tag.trim_start_matches('v').into(),
            expected_uid: web_user.uid,
            expected_gid: web_user.gid,
            expected_exe_prefix: release_root.join("bin/dam-hopper-web"),
        });
    }

    Ok(targets)
}

fn resolve_api_service_uid_gid(candidate: &PendingCandidateRecord) -> (u32, u32) {
    if let Some(ref units_path_str) = candidate.pending_units_path {
        let api_unit = Path::new(units_path_str).join(API_SERVICE_UNIT);
        if let Ok(content) = fs::read_to_string(&api_unit) {
            if let Some(uid_gid) = parse_user_gid_from_unit(&content) {
                return uid_gid;
            }
        }
    }

    let installed_unit = Layout::new().systemd_unit_dir.join(API_SERVICE_UNIT);
    if let Ok(content) = fs::read_to_string(&installed_unit) {
        if let Some(uid_gid) = parse_user_gid_from_unit(&content) {
            return uid_gid;
        }
    }

    if let Ok(Some(cfg)) = super::host_config::load_host_config(&Layout::new().host_config_path()) {
        if let Some(user_name) = cfg.service_user {
            if let Some(user) = super::account::get_user_by_name(&user_name) {
                return (user.uid, user.gid);
            }
        }
    }

    if let Ok(su) = std::env::var("SUDO_USER") {
        if let Some(user) = super::account::get_user_by_name(su.trim()) {
            if user.uid != 0 {
                return (user.uid, user.gid);
            }
        }
    }

    if let Some(user) = super::account::get_user_by_name("dam-hopper") {
        return (user.uid, user.gid);
    }

    (0, 0)
}

fn parse_user_gid_from_unit(content: &str) -> Option<(u32, u32)> {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(user_name) = trimmed.strip_prefix("User=") {
            let user_clean = user_name.trim();
            if !user_clean.starts_with('@') {
                if let Some(user) = super::account::get_user_by_name(user_clean) {
                    return Some((user.uid, user.gid));
                }
            }
        }
    }
    None
}
