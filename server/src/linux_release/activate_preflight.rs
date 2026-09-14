//! Preflight validation and health target construction for release activation.

use super::account::{resolve_api_runtime_identity, verify_web_sysuser_account};
use super::constants::{
    API_SERVICE_HEALTH_PATH, API_SERVICE_PORT, API_SERVICE_UNIT, HELPER_SERVICE_UNIT,
    RECOVERY_SERVICE_UNIT, WEB_SERVICE_HEALTH_PATH, WEB_SERVICE_IDENTITY, WEB_SERVICE_PORT,
    WEB_SERVICE_UNIT,
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
const DEFAULT_SESSION_DB_PATH: &str = "~/.config/dam-hopper/sessions.db";

fn inspect_config_session_path(config_path: &Path) -> Result<Option<String>, ReleaseError> {
    let metadata = match fs::symlink_metadata(config_path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(ReleaseError::Io {
                action: "inspect API configuration metadata",
                details: e.to_string(),
            });
        }
    };

    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(ReleaseError::OwnershipViolation {
            path: config_path.display().to_string(),
            expected: "regular API configuration file".into(),
            got: if metadata.file_type().is_symlink() {
                "symbolic link".into()
            } else {
                "non-regular file".into()
            },
        });
    }

    let mut file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(config_path)
        .map_err(|error| {
            if error.raw_os_error() == Some(libc::ELOOP) {
                ReleaseError::OwnershipViolation {
                    path: config_path.display().to_string(),
                    expected: "regular API configuration file".into(),
                    got: "symbolic link".into(),
                }
            } else {
                ReleaseError::Io {
                    action: "open API configuration with no-follow",
                    details: error.to_string(),
                }
            }
        })?;

    let fd_metadata = file.metadata().map_err(|error| ReleaseError::Io {
        action: "verify API configuration file descriptor",
        details: error.to_string(),
    })?;
    if !fd_metadata.file_type().is_file() {
        return Err(ReleaseError::OwnershipViolation {
            path: config_path.display().to_string(),
            expected: "regular API configuration file".into(),
            got: "non-regular file descriptor".into(),
        });
    }

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
            "API configuration at '{}' exceeds maximum size of {MAX_RUNTIME_CONFIG_BYTES} bytes",
            config_path.display()
        )));
    }

    let content = String::from_utf8(bytes).map_err(|error| {
        ReleaseError::Config(format!(
            "API configuration at '{}' is not valid UTF-8: {error}",
            config_path.display()
        ))
    })?;

    let toml_val = toml::from_str::<toml::Value>(&content).map_err(|error| {
        ReleaseError::Config(format!(
            "failed to parse API configuration at '{}': {error}",
            config_path.display()
        ))
    })?;

    let session_path = if let Some(server) = toml_val.get("server") {
        if let Some(val) = server.get("session_db_path") {
            val.as_str()
                .ok_or_else(|| {
                    ReleaseError::Config(format!(
                        "API configuration at '{}' field server.session_db_path must be a string",
                        config_path.display()
                    ))
                })?
                .to_string()
        } else {
            DEFAULT_SESSION_DB_PATH.to_string()
        }
    } else {
        DEFAULT_SESSION_DB_PATH.to_string()
    };

    Ok(Some(session_path))
}

fn resolve_sqlite_candidate_path(
    api_home: &Path,
    raw_path: &str,
) -> Result<PathBuf, ReleaseError> {
    if let Some(suffix) = raw_path.strip_prefix("~/") {
        Ok(api_home.join(suffix))
    } else if raw_path == "~" {
        Ok(api_home.to_path_buf())
    } else if raw_path.starts_with('~') {
        Err(ReleaseError::Config(format!(
            "unsupported tilde path '{raw_path}' in API configuration; ~user expansion is not supported"
        )))
    } else if Path::new(raw_path).is_absolute() {
        Ok(PathBuf::from(raw_path))
    } else {
        Ok(api_home.join(raw_path))
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut components = Vec::new();
    for comp in path.components() {
        match comp {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if let Some(std::path::Component::Normal(_)) = components.last() {
                    components.pop();
                } else if !path.is_absolute() {
                    components.push(comp);
                }
            }
            _ => components.push(comp),
        }
    }
    components.into_iter().collect()
}

/// Resolve all potential SQLite database paths configured in `dam-hopper.toml` or defaults.
pub fn resolve_configured_sqlite_paths(layout: &Layout) -> Result<Vec<PathBuf>, ReleaseError> {
    let mut candidates = Vec::new();
    let api_home = layout.api_state_dir();

    let canonical_path = layout.api_daemon_config_path();
    let legacy_path = layout.legacy_api_daemon_config_path();

    let canonical_session = inspect_config_session_path(&canonical_path)?;
    let legacy_session = inspect_config_session_path(&legacy_path)?;

    let mut any_config_found = false;

    if let Some(raw) = canonical_session {
        any_config_found = true;
        candidates.push(resolve_sqlite_candidate_path(&api_home, &raw)?);
    }

    if let Some(raw) = legacy_session {
        any_config_found = true;
        candidates.push(resolve_sqlite_candidate_path(&api_home, &raw)?);
    }

    if !any_config_found {
        candidates.push(layout.api_config_dir().join("sessions.db"));
    }

    // Retain legacy /etc/dam-hopper/sessions.db fallback during migration window
    candidates.push(layout.api_etc_dir().join("sessions.db"));

    let mut deduped = Vec::new();
    for candidate in candidates {
        let normalized = normalize_path(&candidate);
        if !deduped.contains(&normalized) {
            deduped.push(normalized);
        }
    }

    Ok(deduped)
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
        let expected_api_hash = candidate.api_unit_sha256.as_ref().ok_or_else(|| {
            ReleaseError::Config("server candidate is missing the finalized API unit digest".into())
        })?;
        verify_candidate_file(
            &units_path.join(API_SERVICE_UNIT),
            0o644,
            Some(expected_api_hash),
        )?;
        let expected_helper_hash = candidate.helper_unit_sha256.as_ref().ok_or_else(|| {
            ReleaseError::Config(
                "server candidate is missing the finalized helper unit digest".into(),
            )
        })?;
        verify_candidate_file(
            &units_path.join(HELPER_SERVICE_UNIT),
            0o644,
            Some(expected_helper_hash),
        )?;
    }
    if candidate.role.includes_web() {
        let expected_web_hash = candidate.web_unit_sha256.as_ref().ok_or_else(|| {
            ReleaseError::Config("web candidate is missing the finalized Web unit digest".into())
        })?;
        verify_candidate_file(
            &units_path.join(WEB_SERVICE_UNIT),
            0o644,
            Some(expected_web_hash),
        )?;
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
    let expected_host_config_hash = candidate.host_config_sha256.as_ref().ok_or_else(|| {
        ReleaseError::Config(
            "candidate is missing the finalized public host configuration digest".into(),
        )
    })?;
    verify_candidate_file(host_config_path, 0o644, Some(expected_host_config_hash))?;
    let public_config = load_host_public_config(host_config_path)?
        .ok_or_else(|| ReleaseError::Config("public host configuration is missing".to_string()))?;
    if public_config.role != candidate.role {
        return Err(ReleaseError::Config(
            "public host configuration role does not match candidate".into(),
        ));
    }

    if is_port_listening(4800)? {
        return Err(ReleaseError::ProcessInspectionFailed {
            reason: "forbidden legacy port 4800 is listening".into(),
        });
    }
    if candidate.role.includes_server() {
        for db_path in resolve_configured_sqlite_paths(layout)? {
            verify_no_foreign_sqlite_holders(&db_path, allowed_sqlite_pids)?;
        }
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

/// Construct health probe targets from the applicable finalized unit under `layout`.
pub fn build_candidate_health_targets(
    layout: &Layout,
    candidate: &PendingCandidateRecord,
) -> Result<Vec<HealthProbeTarget>, ReleaseError> {
    let release_root = PathBuf::from(&candidate.release_path);
    let mut targets = Vec::new();

    if candidate.role.includes_server() {
        let units_dir = candidate
            .pending_units_path
            .as_deref()
            .map(Path::new)
            .unwrap_or(&layout.systemd_unit_dir);
        let api_path = units_dir.join(API_SERVICE_UNIT);
        let content = fs::read_to_string(&api_path).map_err(|e| ReleaseError::Io {
            action: "read finalized API unit for health identity",
            details: e.to_string(),
        })?;
        let parsed = ParsedUnit::parse(&content)?;
        let identity = resolve_api_runtime_identity(&parsed)?;
        targets.push(HealthProbeTarget {
            unit_name: API_SERVICE_UNIT.into(),
            role: "api".into(),
            port: API_SERVICE_PORT,
            path: API_SERVICE_HEALTH_PATH.into(),
            expected_version: candidate.tag.trim_start_matches('v').into(),
            expected_uid: identity.uid,
            expected_gid: identity.gid,
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
