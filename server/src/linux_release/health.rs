//! Bounded exact JSON HTTP health and process stability probes.
//!
//! Enforces:
//! - Up to 20s startup deadline to reach initial readiness
//! - Then 20 consecutive 500ms probes (10s uninterrupted stability)
//! - Exact MainPID, executable prefix, UID/GID, listener port, JSON schema 1,
//!   status "ok", expected role, and expected version
//! - No redirects, bounded response body (<=64KB), fail immediately on version mismatch

use super::error::ReleaseError;
use super::process::{
    inspect_service_process, is_port_listening_wildcard, verify_service_identity_and_exe,
};
use super::systemd::systemctl_is_active;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use std::path::PathBuf;
use std::time::{Duration, Instant};

pub const DEFAULT_STARTUP_DEADLINE: Duration = Duration::from_secs(20);
pub const DEFAULT_PROBE_INTERVAL: Duration = Duration::from_millis(500);
pub const DEFAULT_REQUIRED_CONSECUTIVE: usize = 20;
const MAX_HEALTH_BODY_BYTES: usize = 65_536;

#[derive(Debug, Clone)]
pub struct HealthProbeTarget {
    pub unit_name: String,
    pub role: String,
    pub port: u16,
    pub path: String,
    pub expected_version: String,
    pub expected_uid: u32,
    pub expected_gid: u32,
    pub expected_exe_prefix: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HealthPayload {
    pub schema_version: u32,
    pub status: String,
    pub version: String,
    pub role: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HttpProbeOutcome {
    Success,
    Transient(String),
    Fatal(String),
}

pub use HttpProbeOutcome as ProbeOutcome;

async fn probe_target(client: &Client, target: &HealthProbeTarget) -> ProbeOutcome {
    match systemctl_is_active(&target.unit_name) {
        Ok(true) => {}
        Ok(false) => {
            let diag = query_unit_failure_log(&target.unit_name);
            let msg = if let Some(d) = diag {
                format!("unit is not active ({d})")
            } else {
                "unit is not active".into()
            };
            return ProbeOutcome::Transient(msg);
        }
        Err(e) => return ProbeOutcome::Fatal(format!("systemctl is-active failed: {e}")),
    }

    let evidence = match inspect_service_process(&target.unit_name) {
        Ok(Some(evidence)) => evidence,
        Ok(None) => return ProbeOutcome::Transient("main pid is zero or absent".into()),
        Err(e) => return ProbeOutcome::Fatal(format!("inspect process failed: {e}")),
    };

    if let Err(e) =
        verify_service_identity_and_exe(&evidence, target.expected_uid, &target.expected_exe_prefix)
    {
        return ProbeOutcome::Fatal(format!("process identity check failed: {e}"));
    }
    if evidence.gid != target.expected_gid {
        return ProbeOutcome::Fatal(format!(
            "service '{}' effective GID mismatch: expected {}, got {}",
            target.unit_name, target.expected_gid, evidence.gid
        ));
    }

    match is_port_listening_wildcard(target.port) {
        Ok(true) => {}
        Ok(false) => {
            return ProbeOutcome::Transient(format!(
                "port {} not listening on wildcard",
                target.port
            ));
        }
        Err(e) => return ProbeOutcome::Fatal(format!("port check error: {e}")),
    }

    let url = format!("http://127.0.0.1:{}{}", target.port, target.path);
    probe_http_endpoint(client, &url, &target.role, &target.expected_version).await
}

/// Probe an HTTP health endpoint directly and validate its JSON payload and contract invariants.
pub async fn probe_http_endpoint(
    client: &Client,
    url: &str,
    expected_role: &str,
    expected_version: &str,
) -> HttpProbeOutcome {
    let resp = match client.get(url).send().await {
        Ok(r) => r,
        Err(e) => return HttpProbeOutcome::Transient(format!("HTTP request error: {e}")),
    };

    if !resp.status().is_success() {
        return HttpProbeOutcome::Transient(format!("HTTP status: {}", resp.status()));
    }

    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if !ctype.contains("application/json") {
        return HttpProbeOutcome::Fatal(format!(
            "unexpected Content-Type '{ctype}', expected JSON"
        ));
    }

    if resp
        .content_length()
        .is_some_and(|length| length > MAX_HEALTH_BODY_BYTES as u64)
    {
        return HttpProbeOutcome::Fatal(format!(
            "health body exceeds {MAX_HEALTH_BODY_BYTES} bytes"
        ));
    }

    let mut stream = resp.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                return HttpProbeOutcome::Transient(format!(
                    "failed to read response bytes: {error}"
                ));
            }
        };
        if bytes.len().saturating_add(chunk.len()) > MAX_HEALTH_BODY_BYTES {
            return HttpProbeOutcome::Fatal(format!(
                "health body exceeds {MAX_HEALTH_BODY_BYTES} bytes"
            ));
        }
        bytes.extend_from_slice(&chunk);
    }

    let body: HealthPayload = match serde_json::from_slice(&bytes) {
        Ok(b) => b,
        Err(e) => return HttpProbeOutcome::Fatal(format!("failed to parse health JSON: {e}")),
    };

    if body.schema_version != 1 {
        return HttpProbeOutcome::Fatal(format!(
            "schemaVersion {}, expected 1",
            body.schema_version
        ));
    }
    if body.status != "ok" {
        return HttpProbeOutcome::Fatal(format!("status '{}', expected 'ok'", body.status));
    }
    if body.role != expected_role {
        return HttpProbeOutcome::Fatal(format!(
            "role '{}', expected '{}'",
            body.role, expected_role
        ));
    }
    if body.version != expected_version {
        return HttpProbeOutcome::Fatal(format!(
            "version '{}', expected '{}'",
            body.version, expected_version
        ));
    }

    HttpProbeOutcome::Success
}

/// Run health probes: up to `startup_deadline` to reach first readiness,
/// then `required_consecutive` consecutive successes at `interval`.
pub async fn wait_for_health_stability(
    targets: &[HealthProbeTarget],
    startup_deadline: Duration,
    required_consecutive: usize,
    interval: Duration,
) -> Result<(), ReleaseError> {
    if targets.is_empty() {
        return Ok(());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(2))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| ReleaseError::Config(format!("failed to build HTTP client: {e}")))?;

    let start = Instant::now();
    let mut consecutive = 0;
    let mut initial_readiness_achieved = false;
    let mut last_error = String::new();
    let overall_deadline = startup_deadline + interval * required_consecutive as u32;

    loop {
        if start.elapsed() > overall_deadline {
            return Err(ReleaseError::ProcessInspectionFailed {
                reason: format!(
                    "overall health stability deadline exceeded (achieved {consecutive}/{required_consecutive}): {last_error}"
                ),
            });
        }
        if !initial_readiness_achieved && start.elapsed() > startup_deadline {
            return Err(ReleaseError::ProcessInspectionFailed {
                reason: format!("startup deadline exceeded before initial readiness: {last_error}"),
            });
        }

        let mut all_ok = true;
        for target in targets {
            match probe_target(&client, target).await {
                ProbeOutcome::Success => {}
                ProbeOutcome::Transient(reason) => {
                    all_ok = false;
                    last_error = reason;
                    break;
                }
                ProbeOutcome::Fatal(reason) => {
                    return Err(ReleaseError::ProcessInspectionFailed {
                        reason: format!("fatal health mismatch on {}: {reason}", target.unit_name),
                    });
                }
            }
        }

        if all_ok {
            initial_readiness_achieved = true;
            consecutive += 1;
            if consecutive >= required_consecutive {
                return Ok(());
            }
        } else {
            consecutive = 0;
        }

        tokio::time::sleep(interval).await;
    }
}

fn query_unit_failure_log(unit_name: &str) -> Option<String> {
    let output = std::process::Command::new("journalctl")
        .args(["-u", unit_name, "-n", "15", "--no-pager"])
        .output()
        .ok()?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with("-- Boot"))
            .collect();
        if let Some(err_line) = lines.iter().rev().find(|l| {
            l.contains("Error:")
                || l.contains("panicked")
                || l.contains("FATAL")
                || l.contains("Permission denied")
                || l.contains("Address already in use")
        }) {
            return Some((*err_line).to_string());
        }
        if !lines.is_empty() {
            let tail = lines[lines.len().saturating_sub(2)..].join("; ");
            if !tail.is_empty() {
                return Some(tail);
            }
        }
    }
    None
}
