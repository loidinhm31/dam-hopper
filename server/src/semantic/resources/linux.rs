//! Linux child-tree resource controls and portable-only fallback adapter.
//!
//! Enforces:
//! - Optional hard cgroup v2 resource limits applied strictly to the child semantic tree.
//! - Attachment in pre-exec via `cgroup.procs` to ensure zero-race containment before TSLS
//!   can spawn descendant processes.
//! - Never modifies or applies limits to the API daemon's own ancestor cgroup.
//! - If cgroup v2 delegation or write permissions are absent, or any required controller
//!   (`memory.max`, `cpu.max`, `pids.max`) is missing, cleanly removes any partial setup
//!   and degrades honestly to `ResourceMode::PortableOnly` with detailed capability facts.

use super::{
    LINUX_CGROUP_CPU_PERIOD_US, LINUX_CGROUP_CPU_QUOTA_US, LINUX_CGROUP_MEMORY_MAX_BYTES,
    LINUX_CGROUP_PIDS_MAX, MAX_PROCESSES_PER_TREE, V8_MAX_OLD_SPACE_MB,
};
use crate::semantic::launch::BundledLaunchSpec;
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LinuxResourceError {
    #[error("cgroups v2 unified hierarchy not available at /sys/fs/cgroup")]
    CgroupV2Unavailable,

    #[error("Invalid session ID '{0}' (must be alphanumeric or dashes/underscores)")]
    InvalidSessionId(String),

    #[error("Failed to determine current process cgroup from /proc/self/cgroup: {0}")]
    ProcessCgroupUndetermined(String),

    #[error("Required cgroup v2 controller file missing: {0}")]
    ControllerMissing(String),

    #[error("IO failure while configuring cgroup at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },

    #[error("Permission denied creating or writing to child cgroup at {0} (delegation disabled)")]
    PermissionDenied(PathBuf),
}

/// Operational resource mode actively governing a semantic child tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum ResourceMode {
    /// Kernel-enforced cgroup v2 controls applied strictly to the child process tree.
    Hard {
        #[serde(skip)]
        cgroup_path: PathBuf,
        memory_max_bytes: u64,
        cpu_quota_us: u64,
        cpu_period_us: u64,
        tasks_max: u64,
    },
    /// Application-level portable limits with advisory V8 hints and sampled tree monitoring.
    PortableOnly {
        reason: String,
        degraded: bool,
        v8_heap_hint_mb: usize,
        monitored_tree_limit: usize,
    },
}

impl ResourceMode {
    pub fn is_hard(&self) -> bool {
        matches!(self, Self::Hard { .. })
    }

    pub fn is_degraded(&self) -> bool {
        match self {
            Self::Hard { .. } => false,
            Self::PortableOnly { degraded, .. } => *degraded,
        }
    }
}

/// Active scoped cgroup handle for an isolated semantic child tree.
///
/// Cleans up the child cgroup directory on drop or explicit cleanup.
#[derive(Debug)]
pub struct ChildCgroupScope {
    cgroup_path: PathBuf,
    active: bool,
}

impl ChildCgroupScope {
    pub fn cgroup_path(&self) -> &Path {
        &self.cgroup_path
    }

    #[doc(hidden)]
    pub fn new_for_test(cgroup_path: PathBuf) -> Self {
        Self {
            cgroup_path,
            active: false,
        }
    }

    /// Configure a `BundledLaunchSpec` to attach the child process in pre-exec.
    pub fn attach_to_launch_spec(&self, spec: &mut BundledLaunchSpec) {
        let procs_path = self.cgroup_path.join("cgroup.procs");
        spec.cgroup_procs_path = Some(procs_path);
    }

    /// Explicitly attach an existing PID to this child cgroup.
    pub fn attach_pid(&self, pid: u32) -> Result<(), LinuxResourceError> {
        let procs_path = self.cgroup_path.join("cgroup.procs");
        let mut file = OpenOptions::new()
            .write(true)
            .open(&procs_path)
            .map_err(|e| {
                if e.kind() == io::ErrorKind::PermissionDenied {
                    LinuxResourceError::PermissionDenied(procs_path.clone())
                } else {
                    LinuxResourceError::Io {
                        path: procs_path.clone(),
                        source: e,
                    }
                }
            })?;

        file.write_all(format!("{pid}\n").as_bytes())
            .map_err(|e| LinuxResourceError::Io {
                path: procs_path,
                source: e,
            })?;

        Ok(())
    }

    /// Best-effort directory cleanup after all processes in the group have exited.
    pub fn cleanup(&mut self) -> Result<(), LinuxResourceError> {
        if !self.active {
            return Ok(());
        }
        self.active = false;

        if self.cgroup_path.exists() {
            // If cgroup.kill is available, use it to ensure all lingering processes are terminated
            let kill_path = self.cgroup_path.join("cgroup.kill");
            if kill_path.exists() {
                let _ = fs::write(&kill_path, b"1\n");
            }

            fs::remove_dir(&self.cgroup_path).map_err(|e| LinuxResourceError::Io {
                path: self.cgroup_path.clone(),
                source: e,
            })?;
        }
        Ok(())
    }
}

impl Drop for ChildCgroupScope {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

/// Linux resource controller capable of establishing child-only cgroups or degrading safely.
pub struct LinuxResourceController {
    cgroup_base: PathBuf,
}

impl Default for LinuxResourceController {
    fn default() -> Self {
        Self::new(PathBuf::from("/sys/fs/cgroup"))
    }
}

impl LinuxResourceController {
    pub fn new(cgroup_base: impl AsRef<Path>) -> Self {
        Self {
            cgroup_base: cgroup_base.as_ref().to_path_buf(),
        }
    }

    /// Attempt to prepare a child-only cgroup v2 scope for a new semantic session.
    ///
    /// If cgroup v2 is not available or permissions fail:
    /// - Cleans up any partially created directory.
    /// - Returns `(ResourceMode::PortableOnly, None)` with an informative degradation reason.
    /// - Never fails fatal, never leaks partial directories, and never modifies the daemon's cgroup.
    pub fn prepare_child_scope(
        &self,
        session_id: &str,
    ) -> (ResourceMode, Option<ChildCgroupScope>) {
        match self.try_setup_cgroup(session_id) {
            Ok((mode, scope)) => (mode, Some(scope)),
            Err(err) => {
                let details = match err {
                    LinuxResourceError::CgroupV2Unavailable => {
                        "cgroups v2 unified hierarchy not available".to_string()
                    }
                    LinuxResourceError::PermissionDenied(_) => {
                        "cgroup delegation disabled (permission denied)".to_string()
                    }
                    LinuxResourceError::ControllerMissing(ctrl) => {
                        format!("cgroup controller '{ctrl}' not enabled in parent subtree_control")
                    }
                    LinuxResourceError::InvalidSessionId(id) => {
                        format!("invalid session id '{id}'")
                    }
                    _ => "cgroups v2 child configuration failed".to_string(),
                };
                let reason = format!("Hard controls unavailable: {details}");
                (
                    ResourceMode::PortableOnly {
                        reason,
                        degraded: true,
                        v8_heap_hint_mb: V8_MAX_OLD_SPACE_MB,
                        monitored_tree_limit: MAX_PROCESSES_PER_TREE,
                    },
                    None,
                )
            }
        }
    }

    fn try_setup_cgroup(
        &self,
        session_id: &str,
    ) -> Result<(ResourceMode, ChildCgroupScope), LinuxResourceError> {
        // Validate session ID to prevent path traversal
        if session_id.is_empty()
            || !session_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(LinuxResourceError::InvalidSessionId(session_id.to_string()));
        }

        // 1. Verify cgroup v2 unified hierarchy
        let controllers_file = self.cgroup_base.join("cgroup.controllers");
        if !controllers_file.exists() {
            return Err(LinuxResourceError::CgroupV2Unavailable);
        }

        // 2. Discover parent cgroup of current process
        let parent_subpath = discover_current_process_cgroup_subpath()?;
        let parent_dir = self
            .cgroup_base
            .join(parent_subpath.trim_start_matches('/'));

        if !parent_dir.exists() {
            return Err(LinuxResourceError::ProcessCgroupUndetermined(format!(
                "Parent cgroup path does not exist: {}",
                parent_dir.display()
            )));
        }

        // 3. Create child-only subcgroup
        let child_dir = parent_dir.join(format!("dam-hopper-semantic-{}", session_id));
        if let Err(e) = fs::create_dir(&child_dir) {
            if e.kind() == io::ErrorKind::PermissionDenied {
                return Err(LinuxResourceError::PermissionDenied(child_dir));
            } else {
                return Err(LinuxResourceError::Io {
                    path: child_dir,
                    source: e,
                });
            }
        }

        // 4. Configure limits on child cgroup (clean up on ANY failure)
        if let Err(err) = configure_cgroup_limits(&child_dir) {
            let _ = fs::remove_dir(&child_dir);
            return Err(err);
        }

        let mode = ResourceMode::Hard {
            cgroup_path: child_dir.clone(),
            memory_max_bytes: LINUX_CGROUP_MEMORY_MAX_BYTES,
            cpu_quota_us: LINUX_CGROUP_CPU_QUOTA_US,
            cpu_period_us: LINUX_CGROUP_CPU_PERIOD_US,
            tasks_max: LINUX_CGROUP_PIDS_MAX,
        };

        let scope = ChildCgroupScope {
            cgroup_path: child_dir,
            active: true,
        };

        Ok((mode, scope))
    }
}

/// Parse /proc/self/cgroup to extract the cgroup v2 relative subpath.
fn discover_current_process_cgroup_subpath() -> Result<String, LinuxResourceError> {
    let mut file = File::open("/proc/self/cgroup").map_err(|e| {
        LinuxResourceError::ProcessCgroupUndetermined(format!(
            "Failed to open /proc/self/cgroup: {e}"
        ))
    })?;

    let mut content = String::new();
    file.read_to_string(&mut content).map_err(|e| {
        LinuxResourceError::ProcessCgroupUndetermined(format!(
            "Failed to read /proc/self/cgroup: {e}"
        ))
    })?;

    // In cgroup v2, format is '0::<subpath>'
    for line in content.lines() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() == 3 && parts[0] == "0" {
            let sub = parts[2].trim();
            if !sub.is_empty() {
                return Ok(sub.to_string());
            }
        }
    }

    Err(LinuxResourceError::ProcessCgroupUndetermined(
        "No unified cgroup v2 entry found in /proc/self/cgroup".to_string(),
    ))
}

/// Write memory, cpu, and pids ceilings to a newly created child cgroup.
///
/// Requires that ALL THREE controllers exist; returns ControllerMissing if any is absent.
fn configure_cgroup_limits(child_dir: &Path) -> Result<(), LinuxResourceError> {
    // 1. memory.max
    let mem_file = child_dir.join("memory.max");
    if !mem_file.exists() {
        return Err(LinuxResourceError::ControllerMissing(
            "memory.max".to_string(),
        ));
    }
    write_control(&mem_file, &format!("{LINUX_CGROUP_MEMORY_MAX_BYTES}\n"))?;

    // 2. cpu.max ("<quota> <period>")
    let cpu_file = child_dir.join("cpu.max");
    if !cpu_file.exists() {
        return Err(LinuxResourceError::ControllerMissing("cpu.max".to_string()));
    }
    write_control(
        &cpu_file,
        &format!("{LINUX_CGROUP_CPU_QUOTA_US} {LINUX_CGROUP_CPU_PERIOD_US}\n"),
    )?;

    // 3. pids.max
    let pids_file = child_dir.join("pids.max");
    if !pids_file.exists() {
        return Err(LinuxResourceError::ControllerMissing(
            "pids.max".to_string(),
        ));
    }
    write_control(&pids_file, &format!("{LINUX_CGROUP_PIDS_MAX}\n"))?;

    Ok(())
}

fn write_control(path: &Path, value: &str) -> Result<(), LinuxResourceError> {
    let mut file = OpenOptions::new().write(true).open(path).map_err(|e| {
        if e.kind() == io::ErrorKind::PermissionDenied {
            LinuxResourceError::PermissionDenied(path.to_path_buf())
        } else {
            LinuxResourceError::Io {
                path: path.to_path_buf(),
                source: e,
            }
        }
    })?;

    file.write_all(value.as_bytes())
        .map_err(|e| LinuxResourceError::Io {
            path: path.to_path_buf(),
            source: e,
        })?;

    Ok(())
}
