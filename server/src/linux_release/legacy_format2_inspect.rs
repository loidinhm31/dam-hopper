//! Live process, service, listener, and health inspection for format-2 installations.

use super::constants::API_SERVICE_HEALTH_PATH;
use super::error::ReleaseError;
use super::layout::Layout;
use super::legacy_format2_manifest::LegacyFormat2Manifest;
use super::legacy_format2_root::inspect_format2_root;
use super::legacy_format2_unit::validate_format2_unit;
use super::process::{check_ports_free, inspect_service_process, is_port_listening_wildcard};
use super::systemd::systemctl_is_active;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use std::fs;
use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::path::PathBuf;
use std::time::Duration;
use std::os::unix::fs::MetadataExt;

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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyHealthResponse {
    schema_version: u32,
    status: String,
    version: String,
    role: String,
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

        let user = super::account::get_user_by_name(LEGACY_FORMAT2_USER).ok_or_else(|| {
            ReleaseError::LegacyMigrationRejected {
                reason: format!("legacy service user '{LEGACY_FORMAT2_USER}' does not exist"),
            }
        })?;
        if user.uid == 0 || proc.uid != user.uid || proc.gid != user.gid {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!(
                    "legacy process identity mismatch: expected {}:{}, got {}:{}",
                    user.uid, user.gid, proc.uid, proc.gid
                ),
            });
        }
        let expected_binary = layout.opt_dir.join("bin").join("dam-hopper-server");
        if proc.exe_path.as_deref() != Some(expected_binary.as_path()) {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!(
                    "process executable '{:?}' does not match expected {}",
                    proc.exe_path,
                    expected_binary.display()
                ),
            });
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
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| ReleaseError::Config(format!("failed to build HTTP client: {e}")))?;
        let resp = client
            .get(&probe_url)
            .send()
            .await
            .map_err(|e| ReleaseError::LegacyMigrationRejected {
                reason: format!("health probe failed at {probe_url}: {e}"),
            })?;
        if resp.status() != reqwest::StatusCode::OK {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!("health probe returned status {}", resp.status()),
            });
        }
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        if !content_type.contains("application/json") {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!("health probe returned non-JSON Content-Type '{content_type}'"),
            });
        }
        const MAX_BODY_BYTES: usize = 65_536;
        if resp
            .content_length()
            .is_some_and(|length| length > MAX_BODY_BYTES as u64)
        {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: format!("health response exceeds {MAX_BODY_BYTES} bytes"),
            });
        }
        let mut stream = resp.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| ReleaseError::LegacyMigrationRejected {
                reason: format!("failed to read health response body: {e}"),
            })?;
            if bytes.len().saturating_add(chunk.len()) > MAX_BODY_BYTES {
                return Err(ReleaseError::LegacyMigrationRejected {
                    reason: format!("health response exceeds {MAX_BODY_BYTES} bytes"),
                });
            }
            bytes.extend_from_slice(&chunk);
        }
        let health_json: LegacyHealthResponse = serde_json::from_slice(&bytes)
            .map_err(|e| ReleaseError::LegacyMigrationRejected {
                reason: format!("health response is invalid JSON: {e}"),
            })?;
        if health_json.schema_version != 1
            || health_json.status != "ok"
            || health_json.role != "api"
            || health_json.version.is_empty()
        {
            return Err(ReleaseError::LegacyMigrationRejected {
                reason: "health response is not an exact healthy API response".into(),
            });
        }
        api_version = health_json.version;
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

/// Verify the live format-2 service synchronously before staging can mutate anything.
///
/// Staging is intentionally synchronous, so this uses a bounded loopback HTTP
/// probe instead of the async probe used by activation.
pub fn verify_format2_live_preflight(layout: &Layout) -> Result<String, ReleaseError> {
    if !systemctl_is_active(LEGACY_FORMAT2_UNIT)? {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("{LEGACY_FORMAT2_UNIT} is not active"),
        });
    }

    let process = inspect_service_process(LEGACY_FORMAT2_UNIT)?.ok_or_else(|| {
        ReleaseError::LegacyMigrationRejected {
            reason: format!("{LEGACY_FORMAT2_UNIT} has no active main process"),
        }
    })?;
    let user = super::account::get_user_by_name(LEGACY_FORMAT2_USER).ok_or_else(|| {
        ReleaseError::LegacyMigrationRejected {
            reason: format!("legacy service user '{LEGACY_FORMAT2_USER}' does not exist"),
        }
    })?;
    if user.uid == 0 || process.uid != user.uid || process.gid != user.gid {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!(
                "legacy process identity mismatch: expected {}:{}, got {}:{}",
                user.uid, user.gid, process.uid, process.gid
            ),
        });
    }
    let expected_binary = layout.opt_dir.join("bin").join("dam-hopper-server");
    if process.exe_path.as_deref() != Some(expected_binary.as_path()) {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!(
                "legacy process executable mismatch: expected {}, got {:?}",
                expected_binary.display(),
                process.exe_path
            ),
        });
    }
    if !is_port_listening_wildcard(LEGACY_FORMAT2_PORT)? {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("port {LEGACY_FORMAT2_PORT} is not listening on wildcard address"),
        });
    }
    check_ports_free(&[4800, 4802])?;

    let address = SocketAddr::from(([127, 0, 0, 1], LEGACY_FORMAT2_PORT));
    let mut stream =
        TcpStream::connect_timeout(&address, Duration::from_secs(3)).map_err(|e| {
            ReleaseError::LegacyMigrationRejected {
                reason: format!("legacy health connection failed: {e}"),
            }
        })?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .and_then(|_| stream.set_write_timeout(Some(Duration::from_secs(3))))
        .map_err(|e| ReleaseError::LegacyMigrationRejected {
            reason: format!("legacy health socket setup failed: {e}"),
        })?;
    let request = format!(
        "GET {API_SERVICE_HEALTH_PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(request.as_bytes())
        .and_then(|_| stream.shutdown(Shutdown::Write))
        .map_err(|e| ReleaseError::LegacyMigrationRejected {
            reason: format!("legacy health request failed: {e}"),
        })?;

    let mut response = Vec::new();
    stream
        .take(65_537)
        .read_to_end(&mut response)
        .map_err(|e| ReleaseError::LegacyMigrationRejected {
            reason: format!("failed to read legacy health response: {e}"),
        })?;
    if response.len() > 65_536 {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "legacy health response exceeds 65536 bytes".into(),
        });
    }
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| ReleaseError::LegacyMigrationRejected {
            reason: "legacy health response has no complete HTTP headers".into(),
        })?;
    let headers = std::str::from_utf8(&response[..header_end]).map_err(|e| {
        ReleaseError::LegacyMigrationRejected {
            reason: format!("legacy health response headers are not UTF-8: {e}"),
        }
    })?;
    let status_code = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok());
    if status_code != Some(200) {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("legacy health probe returned status {status_code:?}"),
        });
    }
    let has_json_content_type = headers.lines().any(|line| {
        let lower = line.to_ascii_lowercase();
        lower.starts_with("content-type:") && lower.contains("application/json")
    });
    if !has_json_content_type {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: "legacy health probe returned a non-JSON Content-Type".into(),
        });
    }

    let body = &response[header_end + 4..];
    let health: LegacyHealthResponse =
        serde_json::from_slice(body).map_err(|e| ReleaseError::LegacyMigrationRejected {
            reason: format!("legacy health response is invalid JSON: {e}"),
        })?;
    if health.schema_version != 1 {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("legacy health schemaVersion is not 1: {}", health.schema_version),
        });
    }
    if health.status != "ok" {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("legacy health status is not 'ok': '{}'", health.status),
        });
    }
    if health.role != "api" {
        return Err(ReleaseError::LegacyMigrationRejected {
            reason: format!("legacy health role is not 'api': '{}'", health.role),
        });
    }
    if health.version.trim().is_empty() {
        Ok("format-2-imported".into())
    } else {
        Ok(health.version)
    }
}
