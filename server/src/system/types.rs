use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DiskSourceKind {
    BlockDevice,
    Virtual,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostMetrics {
    pub sampled_at: u64,
    pub hostname: Option<String>,
    pub os_name: Option<String>,
    pub uptime_seconds: u64,
    pub cpu: CpuMetrics,
    pub memory: MemoryMetrics,
    pub disk: DiskMetrics,
    pub disks: Vec<DiskMetrics>,
    pub temperatures: Vec<TemperatureMetrics>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuMetrics {
    pub usage_percent: f64,
    pub logical_core_count: usize,
    pub physical_core_count: Option<usize>,
    pub load_average: Option<LoadAverageMetrics>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAverageMetrics {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryMetrics {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub usage_percent: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskMetrics {
    pub name: String,
    pub mount_point: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub usage_percent: f64,
    /// Collector-only filesystem metadata. It remains out of the legacy API
    /// shape while allowing alert classification to fail closed.
    #[serde(skip)]
    pub(crate) file_system: Option<String>,
    /// Source metadata from the existing sysinfo disk sample. It is internal
    /// because Phase 02 owns any additive resource DTO contract.
    #[serde(skip)]
    pub(crate) source: Option<String>,
    #[serde(skip)]
    pub(crate) source_kind: DiskSourceKind,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemperatureMetrics {
    pub label: String,
    pub celsius: f64,
    pub source: String,
}
