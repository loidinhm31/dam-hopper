//! Live process, service, listener, and health inspection for format-2 installations.

use super::constants::API_SERVICE_HEALTH_PATH;
use super::error::ReleaseError;
use super::layout::Layout;
use super::legacy_format2_manifest::LegacyFormat2Manifest;
use super::legacy_format2_root::inspect_format2_root;
use super::legacy_format2_unit::validate_format2_unit;
use super::process::{check_ports_free, inspect_service_process, is_port_listening_wildcard};
use super::systemd::systemctl_is_active;
use reqwest::Client;
use serde::Deserialize;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::PathBuf;
use std::time::Duration;

pub const LEGACY_FORMAT2_USER: &str = "loidinh";
pub const LEGACY_FORMAT2_PORT: u16 = 4801;
pub const LEGACY_FORMAT2_UNIT: &str = "dam-hopper.service";
pub const LEGACY_FORMAT2_TAG: &str = "imported-format-2";

/// Complete verified evidence gathered from a live format-2 installation.
#[derive(Debug, Clone)]
pub struct LegacyFormat2Evidence {
    pub root_path: PathBuf,
    pub manifest: LegacyFormat2Manifest,
    pub binary_path: PathBuf,
    pub binary_sha256: String,
    pub unit_path: PathBuf,
    pub unit_sha256: String,
    pub unit_content: String,
    pub wants_link_path: PathBuf,
    pub pid: u32,
    pub uid: u32,
    pub gid: u32,
    pub api_version: String,
    pub device_id: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyHealthResponse {
    pub status: String,
    pub version: Option<String>,
}

/// Inspect a format-2 installation with full filesystem, unit, and optional live process checks.
pub async fn inspect_format2_installation(
    layout: &Layout,
    require_root: bool,
    check_live_process: bool,
) -> Result<LegacyFormat2Evidence, ReleaseError> {
    let manifest = inspect_format2_root(&layout.opt_dir, require_root)?;

    let unit_path = layout.systemd_unit_dir.join(LEGACY_FORMAT2_UNIT);
    let unit_content = validate_format2_unit(&unit_path, &manifest.unit_sha256, require_root)?;

    let wants_dir = layout.systemd_unit_dir.join("multi-user.target.wants");
    let wants_link_path = wants_dir.join(LEGACY_FORMAT2_UNIT);
    let wants_meta = fs::symlink_metadata(&wants_link_path).map_err(|e| ReleaseError::Io {
        action: "stat format-2 wants link",
        details: e.to_string(),
    })?;
    if !wants_meta.file_type().is_symlink() {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "format-2 wants entry must be a symbolic link".into(),
        });
    }
    let wants_target = fs::read_link(&wants_link_path).map_err(|e| ReleaseError::Io {
        action: "read format-2 wants link target",
        details: e.to_string(),
    })?;
    if !wants_target.to_string_lossy().ends_with(LEGACY_FORMAT2_UNIT) {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("format-2 wants link does not target {LEGACY_FORMAT2_UNIT}"),
        });
    }

    let root_meta = fs::metadata(&layout.opt_dir).map_err(|e| ReleaseError::Io {
        action: "stat device for format-2 root",
        details: e.to_string(),
    })?;
    let device_id = root_meta.dev();

    let mut pid = 0;
    let mut uid = 0;
    let mut gid = 0;
    let mut api_version = "format-2-imported".to_string();

    if check_live_process {
        if !systemctl_is_active(LEGACY_FORMAT2_UNIT)? {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!("{LEGACY_FORMAT2_UNIT} is not active").into(),
            });
        }

        let proc_opt = inspect_service_process(LEGACY_FORMAT2_UNIT)?;
        let proc = proc_opt.ok_or_else(|| ReleaseError::LegacyMigrationRejected {
            reason: format!("{LEGACY_FORMAT2_UNIT} has no active main process").into(),
        })?;
        pid = proc.pid;
        uid = proc.uid;
        gid = proc.gid;

        if require_root {
            if let Some(user) = super::account::get_user_by_name(LEGACY_FORMAT2_USER) {
                if proc.uid != user.uid {
                    return Err(ReleaseError::LegacyMigrationRejected {
                        reason: format!(
                            "process UID {} does not match user {} ({})",
                            proc.uid, LEGACY_FORMAT2_USER, user.uid
                        ),
                    });
                }
            }
        }
        if let Some(ref exe) = proc.exe_path {
            if !exe.ends_with("dam-hopper-server") {
                return Err(ReleaseError::LegacyMigrationRejected {
                    reason: format!("process executable '{:?}' does not match dam-hopper-server", exe),
                });
            }
        }

        if !is_port_listening_wildcard(LEGACY_FORMAT2_PORT)? {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!("port {LEGACY_FORMAT2_PORT} is not listening on wildcard 0.0.0.0"),
            });
        }
        check_ports_free(&[4800, 4802])?;

        let probe_url = format!("http://127.0.0.1:{LEGACY_FORMAT2_PORT}{API_SERVICE_HEALTH_PATH}");
        let client = Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(|e| ReleaseError::Config(format!("failed to build HTTP client: {e}")))?;
        let resp = client
            .get(&probe_url)
            .send()
            .await
            .map_err(|e| ReleaseError::LegacyMigrationRejected {
                reason: format!("health probe failed at {probe_url}: {e}"),
            })?;
        if !resp.status().is_success() {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!("health probe returned status {}", resp.status()),
            });
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| ReleaseError::LegacyMigrationRejected {
                reason: format!("failed to read health response body: {e}"),
            })?;
        let health_json: LegacyHealthResponse = serde_json::from_slice(&bytes)
            .map_err(|e| ReleaseError::LegacyMigrationRejected {
                reason: format!("health response is invalid JSON: {e}"),
            })?;
        if health_json.status != "ok" {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!("health status is not 'ok': '{}'", health_json.status),
            });
        }
        if let Some(v) = health_json.version {
            api_version = v;
        }
    }

    Ok(LegacyFormat2Evidence {
        root_path: layout.opt_dir.clone(),
        binary_path: layout.opt_dir.join("bin").join("dam-hopper-server"),
        binary_sha256: manifest.binary_sha256.clone(),
        unit_path,
        unit_sha256: manifest.unit_sha256.clone(),
        unit_content,
        wants_link_path,
        manifest,
        pid,
        uid,
        gid,
        api_version,
        device_id,
    })
}
