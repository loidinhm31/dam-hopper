//! Preflight validation and health target construction for release activation.

use super::account::get_user_by_name;
use super::constants::{
    API_SERVICE_HEALTH_PATH, API_SERVICE_PORT, WEB_SERVICE_HEALTH_PATH, WEB_SERVICE_IDENTITY,
    WEB_SERVICE_PORT,
};
use super::error::ReleaseError;
use super::health::HealthProbeTarget;
use super::layout::Layout;
use super::manifest::ReleaseManifest;
use super::process::{is_port_listening, verify_no_foreign_sqlite_holders};
use super::state_record::PendingCandidateRecord;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

/// Resolve all potential SQLite database paths configured in `dam-hopper.toml` or defaults.
pub fn resolve_configured_sqlite_paths(layout: &Layout) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let config_path = layout.etc_dir.join("dam-hopper.toml");

    let raw_paths = if config_path.exists() {
        if let Ok(content) = fs::read_to_string(&config_path) {
            if let Ok(toml_val) = toml::from_str::<toml::Value>(&content) {
                let session_path = toml_val
                    .get("server")
                    .and_then(|s| s.get("session_db_path"))
                    .and_then(|p| p.as_str())
                    .unwrap_or("~/.config/dam-hopper/sessions.db");
                vec![session_path.to_string()]
            } else {
                vec!["~/.config/dam-hopper/sessions.db".to_string()]
            }
        } else {
            vec!["~/.config/dam-hopper/sessions.db".to_string()]
        }
    } else {
        vec!["~/.config/dam-hopper/sessions.db".to_string()]
    };

    for raw in raw_paths {
        if let Some(suffix) = raw.strip_prefix("~/") {
            candidates.push(PathBuf::from("/root").join(suffix));
            if let Some(home) = dirs::home_dir() {
                candidates.push(home.join(suffix));
            }
        } else if raw == "~" {
            candidates.push(PathBuf::from("/root"));
            if let Some(home) = dirs::home_dir() {
                candidates.push(home);
            }
        } else {
            candidates.push(PathBuf::from(&raw));
        }
    }

    candidates.push(layout.etc_dir.join("sessions.db"));
    candidates
}

/// Validate candidate artifacts, ports, and data holders before starting switch.
pub fn validate_candidate_preflight(
    layout: &Layout,
    candidate: &PendingCandidateRecord,
    allowed_sqlite_pids: &[u32],
) -> Result<ReleaseManifest, ReleaseError> {
    let release_dir = Path::new(&candidate.release_path);
    if !release_dir.exists() {
        return Err(ReleaseError::InvalidBundle {
            path: candidate.release_path.clone(),
            reason: "candidate release directory does not exist".into(),
        });
    }

    let manifest_path = release_dir.join("release-manifest.json");
    if !manifest_path.exists() {
        return Err(ReleaseError::InvalidBundle {
            path: manifest_path.display().to_string(),
            reason: "candidate release-manifest.json missing".into(),
        });
    }

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

    if is_port_listening(4800)? {
        return Err(ReleaseError::ProcessInspectionFailed {
            reason: "forbidden legacy port 4800 is listening".into(),
        });
    }

    for db_path in resolve_configured_sqlite_paths(layout) {
        verify_no_foreign_sqlite_holders(&db_path, allowed_sqlite_pids)?;
    }

    Ok(manifest)
}

/// Construct health probe targets for the candidate release role.
pub fn build_candidate_health_targets(
    candidate: &PendingCandidateRecord,
) -> Result<Vec<HealthProbeTarget>, ReleaseError> {
    let release_root = PathBuf::from(&candidate.release_path);
    let mut targets = Vec::new();

    if candidate.role.includes_server() {
        targets.push(HealthProbeTarget {
            unit_name: "dam-hopper-api.service".into(),
            role: "api".into(),
            port: API_SERVICE_PORT,
            path: API_SERVICE_HEALTH_PATH.into(),
            expected_version: candidate.tag.trim_start_matches('v').into(),
            expected_uid: 0,
            expected_exe_prefix: release_root.join("bin/dam-hopper-server"),
        });
    }

    if candidate.role.includes_web() {
        let web_user = get_user_by_name(WEB_SERVICE_IDENTITY)
            .ok_or_else(|| ReleaseError::Config(format!("user '{WEB_SERVICE_IDENTITY}' not found")))?;
        targets.push(HealthProbeTarget {
            unit_name: "dam-hopper-web.service".into(),
            role: "web".into(),
            port: WEB_SERVICE_PORT,
            path: WEB_SERVICE_HEALTH_PATH.into(),
            expected_version: candidate.tag.trim_start_matches('v').into(),
            expected_uid: web_user.uid,
            expected_exe_prefix: release_root.join("bin/dam-hopper-web"),
        });
    }

    Ok(targets)
}
