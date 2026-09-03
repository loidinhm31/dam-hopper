//! Process and socket inspection for release services and port conflict detection.

use super::error::ReleaseError;
use super::systemd::systemctl_show_property;
use std::fs;
use std::path::{Path, PathBuf};

/// Evidence collected about a running systemd service process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceProcessEvidence {
    pub unit_name: String,
    pub pid: u32,
    pub uid: u32,
    pub gid: u32,
    pub exe_path: Option<PathBuf>,
    pub cgroup: Option<String>,
}

pub use super::process_holders::{
    check_ports_free, find_file_holders, get_cgroup_pids, is_port_listening,
    is_port_listening_wildcard, parse_proc_net_listening, verify_no_foreign_sqlite_holders,
};

/// Inspect the main process of a systemd service unit via `/proc/<pid>`.
pub fn inspect_service_process(
    unit_name: &str,
) -> Result<Option<ServiceProcessEvidence>, ReleaseError> {
    let pid_str = systemctl_show_property(unit_name, "MainPID")?;
    let pid: u32 = pid_str.parse().unwrap_or(0);
    if pid == 0 {
        return Ok(None);
    }

    let proc_dir = PathBuf::from(format!("/proc/{pid}"));
    if !proc_dir.exists() {
        return Ok(None);
    }

    let (uid, gid) = read_proc_uid_gid(pid)?;
    let exe_path = fs::read_link(proc_dir.join("exe")).ok();
    let cgroup = fs::read_to_string(proc_dir.join("cgroup")).ok();

    Ok(Some(ServiceProcessEvidence {
        unit_name: unit_name.to_string(),
        pid,
        uid,
        gid,
        exe_path,
        cgroup,
    }))
}

/// Read effective UID and GID from `/proc/<pid>/status`.
pub fn read_proc_uid_gid(pid: u32) -> Result<(u32, u32), ReleaseError> {
    let status_path = format!("/proc/{pid}/status");
    let content = fs::read_to_string(&status_path).map_err(|e| ReleaseError::Io {
        action: "read process status",
        details: e.to_string(),
    })?;

    let mut uid = None;
    let mut gid = None;

    for line in content.lines() {
        if line.starts_with("Uid:") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            // Format: Uid: real effective saved fs
            if parts.len() >= 3 {
                uid = parts[2].parse::<u32>().ok();
            }
        } else if line.starts_with("Gid:") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            // Format: Gid: real effective saved fs
            if parts.len() >= 3 {
                gid = parts[2].parse::<u32>().ok();
            }
        }
    }

    match (uid, gid) {
        (Some(u), Some(g)) => Ok((u, g)),
        _ => Err(ReleaseError::ProcessInspectionFailed {
            reason: format!("failed to parse UID/GID from {status_path}"),
        }),
    }
}

/// Verify process evidence against expected identity and executable path.
pub fn verify_service_identity_and_exe(
    evidence: &ServiceProcessEvidence,
    expected_uid: u32,
    expected_exe_prefix: &Path,
) -> Result<(), ReleaseError> {
    if evidence.uid != expected_uid {
        return Err(ReleaseError::ProcessInspectionFailed {
            reason: format!(
                "service '{}' effective UID mismatch: expected {}, got {}",
                evidence.unit_name, expected_uid, evidence.uid
            ),
        });
    }

    if let Some(exe) = &evidence.exe_path {
        if !exe.starts_with(expected_exe_prefix) {
            return Err(ReleaseError::ProcessInspectionFailed {
                reason: format!(
                    "service '{}' executable path mismatch: expected prefix '{}', got '{}'",
                    evidence.unit_name,
                    expected_exe_prefix.display(),
                    exe.display()
                ),
            });
        }
    } else {
        return Err(ReleaseError::ProcessInspectionFailed {
            reason: format!(
                "service '{}' executable link (/proc/{}/exe) could not be resolved",
                evidence.unit_name, evidence.pid
            ),
        });
    }

    Ok(())
}
