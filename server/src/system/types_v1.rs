use serde::Serialize;
use std::path::Path;
use uuid::Uuid;

use super::alerts::{AlertSummary, ResourceAlertSummary};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AvailabilityState {
    Available,
    Unsupported,
    PermissionDenied,
    TemporarilyUnavailable,
    Stale,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    pub state: AvailabilityState,
    pub sampled_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail_code: Option<String>,
}
impl Availability {
    pub fn available(sampled_at: u64) -> Self {
        Self {
            state: AvailabilityState::Available,
            sampled_at,
            detail_code: None,
        }
    }
    pub fn unsupported(sampled_at: u64) -> Self {
        Self {
            state: AvailabilityState::Unsupported,
            sampled_at,
            detail_code: None,
        }
    }
    pub fn unavailable(sampled_at: u64, detail_code: impl Into<String>) -> Self {
        Self {
            state: AvailabilityState::TemporarilyUnavailable,
            sampled_at,
            detail_code: Some(detail_code.into()),
        }
    }
    pub fn stale(sampled_at: u64, detail_code: impl Into<String>) -> Self {
        Self {
            state: AvailabilityState::Stale,
            sampled_at,
            detail_code: Some(detail_code.into()),
        }
    }
    pub fn denied(sampled_at: u64) -> Self {
        Self {
            state: AvailabilityState::PermissionDenied,
            sampled_at,
            detail_code: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AttributionLabel {
    SystemFileCache,
    CgroupFileCache,
    ProcessFileRss,
    MountFileMappings,
    UnattributedSharedCache,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Confidence {
    Low,
    Medium,
    High,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheAttribution {
    pub label: AttributionLabel,
    pub bytes: Option<u64>,
    pub confidence: Confidence,
    pub method: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshot {
    pub total_bytes: Option<u64>,
    pub available_bytes: Option<u64>,
    pub anon_bytes: Option<u64>,
    pub file_cache_bytes: Option<u64>,
    pub reclaimable_slab_bytes: Option<u64>,
    pub swap_used_bytes: Option<u64>,
    pub availability: Availability,
}
impl MemorySnapshot {
    pub fn empty() -> Self {
        Self::empty_at(0)
    }

    pub fn empty_at(sampled_at: u64) -> Self {
        Self {
            total_bytes: None,
            available_bytes: None,
            anon_bytes: None,
            file_cache_bytes: None,
            reclaimable_slab_bytes: None,
            swap_used_bytes: None,
            availability: Availability::unavailable(sampled_at, "notCollected"),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BatteryStatus {
    Charging,
    Discharging,
    Full,
    NotCharging,
    Unknown,
    Mixed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatterySnapshot {
    pub count: usize,
    pub capacity_percent: Option<f64>,
    pub status: Option<BatteryStatus>,
    pub remaining_energy_wh: Option<f64>,
    pub instantaneous_power_w: Option<f64>,
    pub availability: Availability,
}

impl BatterySnapshot {
    pub fn unsupported(sampled_at: u64) -> Self {
        Self {
            count: 0,
            capacity_percent: None,
            status: None,
            remaining_energy_wh: None,
            instantaneous_power_w: None,
            availability: Availability::unsupported(sampled_at),
        }
    }

    pub fn unavailable(sampled_at: u64, detail_code: impl Into<String>) -> Self {
        Self {
            availability: Availability::unavailable(sampled_at, detail_code),
            ..Self::unsupported(sampled_at)
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PsiLine {
    pub avg10: f64,
    pub avg60: f64,
    pub avg300: f64,
    pub total_micros: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryPressure {
    pub some: Option<PsiLine>,
    pub full: Option<PsiLine>,
    pub availability: Availability,
}

impl MemoryPressure {
    pub fn unavailable(sampled_at: u64, detail_code: impl Into<String>) -> Self {
        Self {
            some: None,
            full: None,
            availability: Availability::unavailable(sampled_at, detail_code),
        }
    }

    pub fn unsupported(sampled_at: u64) -> Self {
        Self {
            some: None,
            full: None,
            availability: Availability::unsupported(sampled_at),
        }
    }

    pub fn denied(sampled_at: u64) -> Self {
        Self {
            some: None,
            full: None,
            availability: Availability::denied(sampled_at),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CgroupMemory {
    pub path: String,
    pub namespace: String,
    pub current_bytes: Option<u64>,
    pub max_bytes: Option<u64>,
    pub max_unlimited: bool,
    pub high_bytes: Option<u64>,
    pub high_unlimited: bool,
    pub file_cache_bytes: Option<u64>,
    pub events: Vec<(String, u64)>,
    pub pressure: MemoryPressure,
    pub availability: Availability,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemory {
    pub pid: u32,
    pub start_ticks: Option<u64>,
    pub uid: Option<u32>,
    pub name: String,
    pub command_summary: Option<String>,
    pub rss_bytes: Option<u64>,
    pub anon_rss_bytes: Option<u64>,
    pub file_rss_bytes: Option<u64>,
    pub shmem_rss_bytes: Option<u64>,
    pub pss_bytes: Option<u64>,
    pub availability: Availability,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInventory {
    pub processes: Vec<ProcessMemory>,
    pub scanned_count: usize,
    pub truncated: bool,
    pub deadline_exceeded: bool,
    pub skipped_count: usize,
    pub permission_denied_count: usize,
    pub invalid_utf8_count: usize,
    pub malformed_count: usize,
    pub disappeared_count: usize,
    pub availability: Availability,
}
impl ProcessInventory {
    pub fn unavailable(sampled_at: u64, detail_code: impl Into<String>) -> Self {
        Self {
            processes: Vec::new(),
            scanned_count: 0,
            truncated: false,
            deadline_exceeded: false,
            skipped_count: 0,
            permission_denied_count: 0,
            invalid_utf8_count: 0,
            malformed_count: 0,
            disappeared_count: 0,
            availability: Availability::unavailable(sampled_at, detail_code),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MountContext {
    pub mount_point: String,
    pub fs_type: Option<String>,
    pub free_bytes: Option<u64>,
    pub active_mapped_paths: Vec<String>,
    pub active_mapped_paths_availability: Availability,
    pub cache_attribution: CacheAttribution,
    pub availability: Availability,
}
impl MountContext {
    pub fn for_workspace(workspace: &Path) -> Self {
        Self::for_workspace_at(workspace, 0)
    }

    pub fn for_workspace_at(workspace: &Path, sampled_at: u64) -> Self {
        Self {
            mount_point: workspace.to_string_lossy().to_string(),
            fs_type: None,
            free_bytes: None,
            active_mapped_paths: Vec::new(),
            active_mapped_paths_availability: Availability::unsupported(sampled_at),
            cache_attribution: CacheAttribution {
                label: AttributionLabel::MountFileMappings,
                bytes: None,
                confidence: Confidence::Low,
                method: "notCollected".into(),
            },
            availability: Availability::unavailable(sampled_at, "notCollected"),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostResourceSnapshotV1 {
    pub schema_version: u8,
    pub sample_id: String,
    pub sampled_at: u64,
    pub host: HostIdentity,
    pub capabilities: SnapshotCapabilities,
    pub memory: MemorySnapshot,
    pub battery: BatterySnapshot,
    pub pressure: PressureSnapshot,
    pub cgroups: Vec<CgroupMemory>,
    pub processes: ProcessInventory,
    pub mount_context: MountContext,
    pub alert: Option<AlertSummary>,
    /// Additive active thermal/disk incidents; legacy metrics remain separate.
    /// Always serialized so an empty array clears stale client presentation.
    pub current_alerts: Vec<ResourceAlertSummary>,
    pub action_capabilities: ActionCapabilities,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostIdentity {
    pub boot_id: Option<String>,
    pub hostname: Option<String>,
    pub os_name: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotCapabilities {
    pub linux_deep_metrics: Availability,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PressureSnapshot {
    pub memory: MemoryPressure,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionCapabilities {
    pub availability: Availability,
}
impl HostResourceSnapshotV1 {
    pub fn unavailable(sampled_at: u64, workspace: &Path) -> Self {
        let mut snapshot = Self::new(
            sampled_at,
            MemorySnapshot::empty_at(sampled_at),
            MountContext::for_workspace_at(workspace, sampled_at),
        )
        .with_deep_sections(
            Availability::unavailable(sampled_at, "snapshotDeadlineExceeded"),
            Availability::unavailable(sampled_at, "snapshotDeadlineExceeded"),
            Availability::unavailable(sampled_at, "snapshotDeadlineExceeded"),
        );
        snapshot.battery = BatterySnapshot::unavailable(sampled_at, "snapshotDeadlineExceeded");
        snapshot
    }

    pub fn new(sampled_at: u64, memory: MemorySnapshot, mount_context: MountContext) -> Self {
        let unavailable = Availability::unavailable(sampled_at, "notCollected");
        Self {
            schema_version: 1,
            sample_id: Uuid::new_v4().to_string(),
            sampled_at,
            host: HostIdentity {
                boot_id: None,
                hostname: sysinfo::System::host_name(),
                os_name: sysinfo::System::name(),
            },
            capabilities: SnapshotCapabilities {
                linux_deep_metrics: unavailable.clone(),
            },
            memory,
            battery: BatterySnapshot::unavailable(sampled_at, "notCollected"),
            pressure: PressureSnapshot {
                memory: MemoryPressure {
                    some: None,
                    full: None,
                    availability: unavailable.clone(),
                },
            },
            cgroups: Vec::new(),
            processes: ProcessInventory {
                processes: Vec::new(),
                scanned_count: 0,
                truncated: false,
                deadline_exceeded: false,
                skipped_count: 0,
                permission_denied_count: 0,
                invalid_utf8_count: 0,
                malformed_count: 0,
                disappeared_count: 0,
                availability: unavailable.clone(),
            },
            mount_context,
            alert: None,
            current_alerts: Vec::new(),
            action_capabilities: ActionCapabilities {
                availability: Availability::unsupported(sampled_at),
            },
        }
    }
    pub fn with_deep_sections(
        mut self,
        pressure: Availability,
        cgroups: Availability,
        processes: Availability,
    ) -> Self {
        self.pressure.memory.availability = pressure;
        self.processes.availability = processes;
        self.capabilities.linux_deep_metrics = cgroups;
        self
    }
}
