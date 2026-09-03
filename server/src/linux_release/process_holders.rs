//! Process, socket, and file descriptor holder verification.
//!
//! Enforces fail-closed validation for:
//! - Listening ports via `/proc/net/tcp` and `/proc/net/tcp6`.
//! - Active cgroup processes via `/sys/fs/cgroup/.../cgroup.procs`.
//! - Open SQLite database (plus `-wal` and `-shm`) file holders via `/proc/<pid>/fd/...`.

use super::error::ReleaseError;
use super::privilege::current_euid;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

/// Parse `/proc/net/tcp` table format to detect if a specific port is in state 0A (LISTEN).
pub fn parse_proc_net_listening(content: &str, target_port: u16) -> bool {
    let hex_port = format!("{target_port:04X}");
    for line in content.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() >= 4 && fields[3] == "0A" {
            if let Some((_, port_part)) = fields[1].split_once(':') {
                if port_part.eq_ignore_ascii_case(&hex_port) {
                    return true;
                }
            }
        }
    }
    false
}

/// Parse `/proc/net/tcp` to detect if a specific port is in state 0A (LISTEN) on wildcard 0.0.0.0.
pub fn parse_proc_net_wildcard_listening(content: &str, target_port: u16) -> bool {
    let hex_port = format!("{target_port:04X}");
    for line in content.lines().skip(1) {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() >= 4 && fields[3] == "0A" {
            if let Some((ip_part, port_part)) = fields[1].split_once(':') {
                if port_part.eq_ignore_ascii_case(&hex_port) && ip_part.chars().all(|c| c == '0') {
                    return true;
                }
            }
        }
    }
    false
}

/// Inspect `/proc/net/tcp` and `/proc/net/tcp6` to see if a port is in wildcard LISTEN state.
pub fn is_port_listening_wildcard(port: u16) -> Result<bool, ReleaseError> {
    for proc_path in ["/proc/net/tcp", "/proc/net/tcp6"] {
        let p = Path::new(proc_path);
        if p.exists() {
            let content = fs::read_to_string(p).map_err(|e| ReleaseError::Io {
                action: "read /proc/net/tcp",
                details: e.to_string(),
            })?;
            if parse_proc_net_wildcard_listening(&content, port) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Inspect `/proc/net/tcp` and `/proc/net/tcp6` to see if a port is in LISTEN state.
pub fn is_port_listening(port: u16) -> Result<bool, ReleaseError> {
    for proc_path in ["/proc/net/tcp", "/proc/net/tcp6"] {
        let p = Path::new(proc_path);
        if p.exists() {
            let content = fs::read_to_string(p).map_err(|e| ReleaseError::Io {
                action: "read /proc/net/tcp",
                details: e.to_string(),
            })?;
            if parse_proc_net_listening(&content, port) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Check that a list of ports are not currently in use.
pub fn check_ports_free(ports: &[u16]) -> Result<(), ReleaseError> {
    for &port in ports {
        if is_port_listening(port)? {
            return Err(ReleaseError::ProcessInspectionFailed {
                reason: format!("port {port} is already in use (listening)"),
            });
        }
    }
    Ok(())
}

/// List all PIDs in a systemd cgroup path, failing closed on unreadable or corrupt procs.
pub fn get_cgroup_pids(cgroup_slice: &str) -> Result<Vec<u32>, ReleaseError> {
    let rel_path = cgroup_slice.trim_start_matches('/');
    let procs_path = Path::new("/sys/fs/cgroup").join(rel_path).join("cgroup.procs");
    if !procs_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&procs_path).map_err(|e| ReleaseError::Io {
        action: "read cgroup.procs",
        details: e.to_string(),
    })?;
    let mut pids = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let pid = trimmed.parse::<u32>().map_err(|_| {
            ReleaseError::ProcessInspectionFailed {
                reason: format!("malformed cgroup PID '{trimmed}' in {}", procs_path.display()),
            }
        })?;
        pids.push(pid);
    }
    Ok(pids)
}

/// Find all process IDs holding an open file descriptor to `target_file`.
pub fn find_file_holders(target_file: &Path) -> Result<Vec<u32>, ReleaseError> {
    find_file_holders_in(Path::new("/proc"), target_file)
}

/// Find all process IDs holding an open file descriptor to `target_file` within `proc_dir`.
pub fn find_file_holders_in(proc_dir: &Path, target_file: &Path) -> Result<Vec<u32>, ReleaseError> {
    if !proc_dir.exists() {
        return Err(ReleaseError::ProcessInspectionFailed {
            reason: format!("proc directory '{}' does not exist", proc_dir.display()),
        });
    }

    let canonical_target = if target_file.exists() {
        target_file.canonicalize().map_err(|e| ReleaseError::Io {
            action: "canonicalize target file",
            details: e.to_string(),
        })?
    } else {
        target_file.to_path_buf()
    };

    let entries = fs::read_dir(proc_dir).map_err(|e| ReleaseError::Io {
        action: "read /proc entries",
        details: e.to_string(),
    })?;

    let is_root = current_euid() == 0;
    let mut holders = Vec::new();

    for entry_res in entries {
        let entry = match entry_res {
            Ok(e) => e,
            Err(e) if e.kind() == ErrorKind::NotFound => continue,
            Err(e) => return Err(ReleaseError::Io {
                action: "iterate /proc entry",
                details: e.to_string(),
            }),
        };

        if let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() {
            let fd_dir = entry.path().join("fd");
            let fd_entries = match fs::read_dir(&fd_dir) {
                Ok(e) => e,
                Err(e) if e.kind() == ErrorKind::NotFound => continue,
                Err(e) if e.kind() == ErrorKind::PermissionDenied && !is_root => continue,
                Err(e) => return Err(ReleaseError::Io {
                    action: "read /proc/<pid>/fd entries",
                    details: format!("pid {pid}: {e}"),
                }),
            };

            for fd_res in fd_entries {
                let fd_entry = match fd_res {
                    Ok(f) => f,
                    Err(e) if e.kind() == ErrorKind::NotFound => continue,
                    Err(e) if e.kind() == ErrorKind::PermissionDenied && !is_root => continue,
                    Err(e) => return Err(ReleaseError::Io {
                        action: "inspect fd entry",
                        details: format!("pid {pid}: {e}"),
                    }),
                };

                if let Ok(link) = fs::read_link(fd_entry.path()) {
                    if link == canonical_target || link == target_file {
                        holders.push(pid);
                        break;
                    }
                }
            }
        }
    }
    Ok(holders)
}

/// Verify no foreign processes hold open SQLite handles to the given database or companions.
pub fn verify_no_foreign_sqlite_holders(
    db_path: &Path,
    allowed_pids: &[u32],
) -> Result<(), ReleaseError> {
    verify_no_foreign_sqlite_holders_in(Path::new("/proc"), db_path, allowed_pids)
}

/// Scoped verification for SQLite handles within a custom proc directory.
pub fn verify_no_foreign_sqlite_holders_in(
    proc_dir: &Path,
    db_path: &Path,
    allowed_pids: &[u32],
) -> Result<(), ReleaseError> {
    let mut targets_to_check = vec![db_path.to_path_buf()];
    targets_to_check.push(PathBuf::from(format!("{}-wal", db_path.display())));
    targets_to_check.push(PathBuf::from(format!("{}-shm", db_path.display())));

    for target in targets_to_check {
        if !target.exists() {
            continue;
        }
        let holders = find_file_holders_in(proc_dir, &target)?;
        for pid in holders {
            if !allowed_pids.contains(&pid) {
                return Err(ReleaseError::ProcessInspectionFailed {
                    reason: format!(
                        "foreign process PID {pid} holds open SQLite file {}",
                        target.display()
                    ),
                });
            }
        }
    }
    Ok(())
}
