use std::{
    io::{ErrorKind, Read},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use super::HostResourceSnapshotV1;

pub const MAX_FILE_BYTES: u64 = 256 * 1024;
pub const MAX_PIDS_SCANNED: usize = 4_096;
pub const MAX_PROCESSES: usize = 20;
pub const MAX_PSS_PROCESSES: usize = 5;
pub const MAX_PROCESS_STRING_BYTES: usize = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReadTextError {
    TooLarge,
    Io(ErrorKind),
    InvalidUtf8,
}

/// Bounds the actual stream, not metadata: procfs pseudo-files commonly report length zero.
pub fn read_bounded_text(path: &Path) -> Result<String, ReadTextError> {
    let file = std::fs::File::open(path).map_err(|error| ReadTextError::Io(error.kind()))?;
    let capacity = usize::try_from(MAX_FILE_BYTES + 1).expect("bounded file size fits usize");
    let mut bytes = Vec::with_capacity(capacity);
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| ReadTextError::Io(error.kind()))?;
    if u64::try_from(bytes.len()).expect("buffer length fits u64") > MAX_FILE_BYTES {
        return Err(ReadTextError::TooLarge);
    }
    String::from_utf8(bytes).map_err(|_| ReadTextError::InvalidUtf8)
}

/// Read-only, startup-owned roots. Tests may inject temporary roots; requests cannot.
pub trait HostResourceSource: Send + Sync {
    fn proc_root(&self) -> &Path;
    fn sys_root(&self) -> &Path;
    fn cgroup_root(&self) -> &Path;
    /// Maps a mountinfo path in the proc namespace to the injected filesystem root.
    fn cgroup_mount_root(&self, mount_point: &Path) -> PathBuf {
        mount_point.to_path_buf()
    }
    fn now_ms(&self) -> u64;
    fn free_bytes(&self, path: &Path) -> Option<u64> {
        free_bytes(path)
    }
}

fn free_bytes(path: &Path) -> Option<u64> {
    #[cfg(unix)]
    {
        let path = std::ffi::CString::new(path.as_os_str().as_encoded_bytes()).ok()?;
        let mut stat = std::mem::MaybeUninit::<libc::statvfs>::zeroed();
        unsafe {
            (libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) == 0)
                .then(|| {
                    let stat = stat.assume_init();
                    checked_block_bytes(stat.f_bavail, stat.f_frsize)
                })
                .flatten()
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

#[cfg(unix)]
fn checked_block_bytes(blocks: impl TryInto<u64>, block_size: impl TryInto<u64>) -> Option<u64> {
    blocks
        .try_into()
        .ok()?
        .checked_mul(block_size.try_into().ok()?)
}

#[derive(Clone, Debug)]
pub struct SystemHostResourceSource {
    proc_root: PathBuf,
    sys_root: PathBuf,
    cgroup_root: PathBuf,
}

impl Default for SystemHostResourceSource {
    fn default() -> Self {
        Self::new("/proc", "/sys", "/sys/fs/cgroup")
    }
}

impl SystemHostResourceSource {
    pub fn new(
        proc_root: impl Into<PathBuf>,
        sys_root: impl Into<PathBuf>,
        cgroup_root: impl Into<PathBuf>,
    ) -> Self {
        Self {
            proc_root: proc_root.into(),
            sys_root: sys_root.into(),
            cgroup_root: cgroup_root.into(),
        }
    }
}

impl HostResourceSource for SystemHostResourceSource {
    fn proc_root(&self) -> &Path {
        &self.proc_root
    }
    fn sys_root(&self) -> &Path {
        &self.sys_root
    }
    fn cgroup_root(&self) -> &Path {
        &self.cgroup_root
    }

    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX)
    }
}

pub fn collect_host_resource_snapshot(
    source: &(dyn HostResourceSource + '_),
    workspace: &Path,
) -> HostResourceSnapshotV1 {
    #[cfg(target_os = "linux")]
    {
        super::linux::collect(source, workspace)
    }
    #[cfg(not(target_os = "linux"))]
    {
        unsupported_snapshot(source, workspace)
    }
}

pub fn collect_host_resource_snapshot_with_options(
    source: &(dyn HostResourceSource + '_),
    workspace: &Path,
    collect_processes: bool,
    collect_pss: bool,
    process_deadline_millis: u64,
) -> HostResourceSnapshotV1 {
    #[cfg(target_os = "linux")]
    {
        super::linux::collect_with_options(
            source,
            workspace,
            collect_processes,
            collect_pss,
            process_deadline_millis,
        )
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (collect_processes, collect_pss, process_deadline_millis);
        unsupported_snapshot(source, workspace)
    }
}

#[cfg(not(target_os = "linux"))]
fn unsupported_snapshot(
    source: &(dyn HostResourceSource + '_),
    workspace: &Path,
) -> HostResourceSnapshotV1 {
    use super::{Availability, MemorySnapshot, MountContext};
    let sampled_at = source.now_ms();
    let mut snapshot = HostResourceSnapshotV1::new(
        sampled_at,
        MemorySnapshot::empty_at(sampled_at),
        MountContext::for_workspace_at(workspace, sampled_at),
    );
    snapshot.memory.availability = Availability::unsupported(sampled_at);
    snapshot.battery = super::BatterySnapshot::unsupported(sampled_at);
    snapshot.mount_context.availability = Availability::unsupported(sampled_at);
    snapshot.with_deep_sections(
        Availability::unsupported(sampled_at),
        Availability::unsupported(sampled_at),
        Availability::unsupported(sampled_at),
    )
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    struct FixtureSource {
        proc_root: PathBuf,
        sys_root: PathBuf,
        cgroup_root: PathBuf,
    }
    impl HostResourceSource for FixtureSource {
        fn proc_root(&self) -> &Path {
            &self.proc_root
        }
        fn sys_root(&self) -> &Path {
            &self.sys_root
        }
        fn cgroup_root(&self) -> &Path {
            &self.cgroup_root
        }
        fn cgroup_mount_root(&self, _mount_point: &Path) -> PathBuf {
            self.cgroup_root.clone()
        }
        fn now_ms(&self) -> u64 {
            99
        }
    }

    #[test]
    fn collects_a_snapshot_from_injected_read_only_roots() {
        let temp = tempfile::tempdir().unwrap();
        let proc_root = temp.path().join("proc");
        let cgroup_root = temp.path().join("cgroup");
        std::fs::create_dir_all(proc_root.join("pressure")).unwrap();
        std::fs::create_dir_all(proc_root.join("self")).unwrap();
        std::fs::create_dir_all(proc_root.join("12")).unwrap();
        std::fs::create_dir_all(cgroup_root.join("scope")).unwrap();
        std::fs::write(
            proc_root.join("meminfo"),
            "MemTotal: 2 kB\nMemAvailable: 1 kB\n",
        )
        .unwrap();
        std::fs::write(
            proc_root.join("pressure/memory"),
            "some avg10=0 avg60=0 avg300=0 total=0\n",
        )
        .unwrap();
        std::fs::create_dir_all(proc_root.join("sys/kernel/random")).unwrap();
        std::fs::write(
            proc_root.join("sys/kernel/random/boot_id"),
            "123e4567-e89b-12d3-a456-426614174000\n",
        )
        .unwrap();
        std::fs::write(
            proc_root.join("self/mountinfo"),
            "1 0 0:1 / / rw - cgroup2 cgroup rw\n2 0 0:2 / /tmp rw - tmpfs tmpfs rw\n",
        )
        .unwrap();
        std::fs::write(proc_root.join("self/cgroup"), "0::/scope\n").unwrap();
        std::fs::write(
            proc_root.join("12/status"),
            "Name:\tworker\nUid:\t1000\nVmRSS:\t1 kB\n",
        )
        .unwrap();
        std::fs::write(
            proc_root.join("12/stat"),
            "12 (worker) S 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1",
        )
        .unwrap();
        std::fs::write(cgroup_root.join("scope/memory.current"), "1024\n").unwrap();
        std::fs::write(cgroup_root.join("scope/memory.max"), "max\n").unwrap();
        std::fs::write(cgroup_root.join("scope/memory.high"), "max\n").unwrap();
        std::fs::write(
            cgroup_root.join("scope/memory.pressure"),
            "some avg10=1 avg60=2 avg300=3 total=4\n",
        )
        .unwrap();
        let source = FixtureSource {
            proc_root,
            sys_root: temp.path().join("sys"),
            cgroup_root,
        };
        let snapshot = collect_host_resource_snapshot(&source, Path::new("/tmp/workspace"));
        assert_eq!(snapshot.sampled_at, 99);
        assert_eq!(snapshot.memory.total_bytes, Some(2048));
        assert_eq!(
            snapshot.battery.availability.state,
            crate::system::AvailabilityState::Unsupported
        );
        assert_eq!(
            snapshot.host.boot_id.as_deref(),
            Some("123e4567-e89b-12d3-a456-426614174000")
        );
        assert_eq!(snapshot.cgroups[0].current_bytes, Some(1024));
        assert!(snapshot.cgroups[0].max_unlimited);
        assert!(snapshot.cgroups[0].high_unlimited);
        assert_eq!(
            snapshot.cgroups[0]
                .pressure
                .some
                .as_ref()
                .unwrap()
                .total_micros,
            4
        );
        assert_eq!(snapshot.processes.processes[0].pid, 12);
        assert_eq!(
            snapshot
                .mount_context
                .active_mapped_paths_availability
                .state,
            crate::system::AvailabilityState::Unsupported
        );

        std::fs::write(
            source.proc_root().join("sys/kernel/random/boot_id"),
            vec![b'x'; (MAX_FILE_BYTES + 1) as usize],
        )
        .unwrap();
        let oversized_boot_id =
            collect_host_resource_snapshot(&source, Path::new("/tmp/workspace"));
        assert!(oversized_boot_id.host.boot_id.is_none());

        std::fs::remove_file(source.proc_root().join("self/cgroup")).unwrap();
        let degraded = collect_host_resource_snapshot(&source, Path::new("/tmp/workspace"));
        assert_eq!(degraded.cgroups.len(), 1);
        assert_eq!(
            degraded.cgroups[0].availability.detail_code.as_deref(),
            Some("cgroupMembershipUnavailable")
        );
    }

    #[test]
    fn bounded_reader_uses_actual_stream_bytes_and_rejects_invalid_utf8() {
        let temp = tempfile::tempdir().unwrap();
        let large = temp.path().join("large");
        std::fs::write(&large, vec![b'x'; (MAX_FILE_BYTES + 1) as usize]).unwrap();
        assert_eq!(read_bounded_text(&large), Err(ReadTextError::TooLarge));

        let invalid = temp.path().join("invalid");
        std::fs::write(&invalid, [0xff, 0xfe]).unwrap();
        assert_eq!(read_bounded_text(&invalid), Err(ReadTextError::InvalidUtf8));

        let missing = temp.path().join("missing");
        assert_eq!(
            read_bounded_text(&missing),
            Err(ReadTextError::Io(std::io::ErrorKind::NotFound))
        );
    }
}

#[cfg(all(test, not(target_os = "linux")))]
mod non_linux_tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn unsupported_snapshot_serializes_explicit_deep_capability() {
        let snapshot =
            collect_host_resource_snapshot(&SystemHostResourceSource::default(), Path::new("."));
        let value = serde_json::to_value(snapshot).unwrap();

        assert_eq!(
            value["capabilities"]["linuxDeepMetrics"]["state"],
            "unsupported"
        );
        assert_eq!(value["memory"]["availability"]["state"], "unsupported");
        assert_eq!(value["battery"]["availability"]["state"], "unsupported");
        assert_eq!(value["processes"]["availability"]["state"], "unsupported");
        assert_eq!(
            value["mountContext"]["availability"]["state"],
            "unsupported"
        );
        assert_eq!(value["cgroups"].as_array().map(Vec::len), Some(0));
    }
}
