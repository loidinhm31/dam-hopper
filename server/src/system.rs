pub mod alerts;
pub mod config;
pub mod monitor;
pub use alerts::{
    AlertChange, AlertEngine, AlertEngineState, AlertEvidence, AlertIncident, AlertSample,
    AlertSeverity, AlertState, AlertSummary, AlertThresholds,
};
pub use monitor::HostResourceMonitor;

use std::{
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use sysinfo::{DiskKind, Disks, System};

mod types;
pub(crate) use types::DiskSourceKind;
pub use types::{
    CpuMetrics, DiskMetrics, HostMetrics, LoadAverageMetrics, MemoryMetrics, TemperatureMetrics,
};
pub mod platform;
mod types_v1;
pub use types_v1::*;

#[cfg(target_os = "linux")]
mod linux;

const THERMAL_ZONE_ROOT: &str = "/sys/class/thermal";

#[derive(Clone, Default)]
pub struct HostMetricsSampler {
    inner: Arc<Mutex<SamplerInner>>,
}

struct SamplerInner {
    system: System,
    disks: Disks,
}

impl Default for SamplerInner {
    fn default() -> Self {
        let mut system = System::new_all();
        system.refresh_cpu_usage();
        system.refresh_memory();

        Self {
            system,
            disks: Disks::new_with_refreshed_list(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiskMountSnapshot {
    pub name: String,
    pub mount_point: PathBuf,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub file_system: Option<String>,
    pub(crate) source: Option<String>,
    pub(crate) source_kind: DiskSourceKind,
}

impl HostMetricsSampler {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn sample(&self, workspace_root: &Path) -> HostMetrics {
        let mut inner = self
            .inner
            .lock()
            .expect("host metrics sampler mutex poisoned");
        inner.system.refresh_cpu_usage();
        inner.system.refresh_memory();
        inner.disks.refresh(true);

        let total_memory = inner.system.total_memory();
        let available_memory = inner.system.available_memory();
        let used_memory = total_memory.saturating_sub(available_memory);
        let load = System::load_average();
        let disk_snapshots =
            sorted_disk_snapshots(inner.disks.list().iter().map(|disk| DiskMountSnapshot {
                name: os_str_to_string(disk.name()),
                mount_point: disk.mount_point().to_path_buf(),
                total_bytes: disk.total_space(),
                available_bytes: disk.available_space(),
                file_system: Some(os_str_to_string(disk.file_system())),
                source: Some(os_str_to_string(disk.name())),
                source_kind: disk_source_kind(disk.name(), disk.kind()),
            }));
        let disk = select_workspace_disk(workspace_root, disk_snapshots.iter().cloned())
            .unwrap_or_else(|| fallback_disk(workspace_root));
        let disks = disk_snapshots
            .into_iter()
            .map(DiskMountSnapshot::into_metrics)
            .collect();

        HostMetrics {
            sampled_at: sampled_at_ms(),
            hostname: System::host_name(),
            os_name: System::name(),
            uptime_seconds: System::uptime(),
            cpu: CpuMetrics {
                usage_percent: clamp_percent(inner.system.global_cpu_usage() as f64),
                logical_core_count: inner.system.cpus().len(),
                physical_core_count: System::physical_core_count(),
                load_average: Some(LoadAverageMetrics {
                    one: load.one,
                    five: load.five,
                    fifteen: load.fifteen,
                }),
            },
            memory: MemoryMetrics {
                total_bytes: total_memory,
                used_bytes: used_memory,
                available_bytes: available_memory,
                usage_percent: usage_percent(used_memory, total_memory),
            },
            disk: disk.into_metrics(),
            disks,
            temperatures: read_thermal_zones(Path::new(THERMAL_ZONE_ROOT)),
        }
    }
}

impl DiskMountSnapshot {
    fn into_metrics(self) -> DiskMetrics {
        let used_bytes = self.total_bytes.saturating_sub(self.available_bytes);
        DiskMetrics {
            name: self.name,
            mount_point: self.mount_point.to_string_lossy().to_string(),
            total_bytes: self.total_bytes,
            available_bytes: self.available_bytes,
            used_bytes,
            usage_percent: usage_percent(used_bytes, self.total_bytes),
            file_system: self.file_system,
            source: self.source,
            source_kind: self.source_kind,
        }
    }
}

/// A resource alert needs both an allowlisted persistent filesystem and a
/// verified block-device source from the existing sysinfo sample. Filesystem
/// type alone is insufficient: loop, zram, bind-like, and unknown sources are
/// rejected even when they report ext4 or xfs.
pub fn is_real_persistent_disk(disk: &DiskMetrics) -> bool {
    if disk.name.trim().is_empty()
        || !Path::new(&disk.mount_point).is_absolute()
        || disk.total_bytes == 0
        || disk.available_bytes > disk.total_bytes
        || disk.source_kind != DiskSourceKind::BlockDevice
    {
        return false;
    }

    let Some(source) = disk.source.as_deref().map(str::trim) else {
        return false;
    };
    if !is_block_device_source(source) {
        return false;
    }

    let Some(file_system) = disk.file_system.as_deref() else {
        return false;
    };
    matches!(
        file_system.trim().to_ascii_lowercase().as_str(),
        "apfs"
            | "btrfs"
            | "ext2"
            | "ext3"
            | "ext4"
            | "exfat"
            | "f2fs"
            | "hfs"
            | "hfsplus"
            | "jfs"
            | "ntfs"
            | "ntfs3"
            | "reiserfs"
            | "ufs"
            | "vfat"
            | "xfs"
            | "zfs"
    )
}

fn disk_source_kind(source: &OsStr, kind: DiskKind) -> DiskSourceKind {
    let source = source.to_string_lossy();
    if !is_block_device_source(&source) {
        return if is_virtual_device_source(&source) {
            DiskSourceKind::Virtual
        } else {
            DiskSourceKind::Unknown
        };
    }
    match kind {
        DiskKind::HDD | DiskKind::SSD => DiskSourceKind::BlockDevice,
        DiskKind::Unknown(_) => DiskSourceKind::Unknown,
    }
}

fn is_block_device_source(source: &str) -> bool {
    source.starts_with("/dev/") && !is_virtual_device_source(source)
}

fn is_virtual_device_source(source: &str) -> bool {
    matches!(
        source,
        "/dev/loop" | "/dev/zram" | "/dev/ram" | "/dev/fd" | "/dev/mapper/control"
    ) || ["/dev/loop", "/dev/zram", "/dev/ram", "/dev/fd"]
        .iter()
        .any(|prefix| source.starts_with(prefix))
}

pub fn usage_percent(used: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        clamp_percent((used as f64 / total as f64) * 100.0)
    }
}

pub fn select_workspace_disk<I>(workspace_root: &Path, disks: I) -> Option<DiskMountSnapshot>
where
    I: IntoIterator<Item = DiskMountSnapshot>,
{
    let workspace = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());

    disks
        .into_iter()
        .filter(|disk| workspace.starts_with(&disk.mount_point))
        .max_by_key(|disk| disk.mount_point.components().count())
}

pub fn sorted_disk_snapshots<I>(disks: I) -> Vec<DiskMountSnapshot>
where
    I: IntoIterator<Item = DiskMountSnapshot>,
{
    let mut disks = disks.into_iter().collect::<Vec<_>>();
    disks.sort_by(|left, right| {
        left.mount_point
            .cmp(&right.mount_point)
            .then_with(|| left.name.cmp(&right.name))
    });
    disks
}

fn fallback_disk(workspace_root: &Path) -> DiskMountSnapshot {
    DiskMountSnapshot {
        name: "workspace".to_string(),
        mount_point: workspace_root.to_path_buf(),
        total_bytes: 0,
        available_bytes: 0,
        file_system: None,
        source: None,
        source_kind: DiskSourceKind::Unknown,
    }
}

fn sampled_at_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn clamp_percent(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 100.0)
    } else {
        0.0
    }
}

fn os_str_to_string(value: &OsStr) -> String {
    value.to_string_lossy().to_string()
}

fn read_thermal_zones(root: &Path) -> Vec<TemperatureMetrics> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };

    let mut temperatures = entries
        .filter_map(Result::ok)
        .filter_map(|entry| read_thermal_zone(&entry.path()))
        .collect::<Vec<_>>();
    temperatures.sort_by(|left, right| left.label.cmp(&right.label));
    temperatures
}

fn read_thermal_zone(path: &Path) -> Option<TemperatureMetrics> {
    let source = path.file_name()?.to_string_lossy().to_string();
    if !source.starts_with("thermal_zone") {
        return None;
    }

    let raw_temp = fs::read_to_string(path.join("temp")).ok()?;
    let milli_celsius = raw_temp.trim().parse::<f64>().ok()?;
    if !milli_celsius.is_finite() {
        return None;
    }

    let label = fs::read_to_string(path.join("type"))
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| source.clone());

    Some(TemperatureMetrics {
        label,
        celsius: milli_celsius / 1000.0,
        source,
    })
}

#[cfg(test)]
mod tests;
