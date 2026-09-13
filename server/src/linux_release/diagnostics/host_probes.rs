use std::future::Future;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::linux_release::layout::Layout;
use super::model::{
    ActiveInhibitorProbeV1, Applicability, CollectionStatus, Historicity,
    ProjectedCurrentHostProbes, RtcWakealarmProbeV1, SourceCoverage, SourceEnvelope,
};
use super::redaction::validate_safe_executable_identity;

/// Abstract current host probe reader trait for testing and production.
pub trait CurrentHostProbeReader: Send + Sync {
    fn read_probes(
        &self,
        layout: &Layout,
        inhibitor_probe: Option<ActiveInhibitorProbeV1>,
    ) -> impl Future<Output = ProjectedCurrentHostProbes> + Send;
}

/// Production implementation reading host `/sys` and `/proc` files.
#[derive(Debug, Default, Clone)]
pub struct ProductionCurrentHostProbeReader;

impl CurrentHostProbeReader for ProductionCurrentHostProbeReader {
    async fn read_probes(
        &self,
        layout: &Layout,
        inhibitor_probe: Option<ActiveInhibitorProbeV1>,
    ) -> ProjectedCurrentHostProbes {
        let rtc_wakealarm = read_rtc_wakealarm(layout);
        let suspend_capabilities = read_suspend_capabilities(layout);
        let qualified_executables = read_qualified_executables(layout);

        ProjectedCurrentHostProbes {
            rtc_wakealarm,
            suspend_capabilities,
            active_inhibitors: inhibitor_probe,
            qualified_executables,
        }
    }
}

/// Probe RTC wakealarm capabilities from sysfs.
pub fn read_rtc_wakealarm(layout: &Layout) -> Option<RtcWakealarmProbeV1> {
    let rtc_dir = layout.rtc_device_dir();
    let wakealarm_path = layout.rtc_wakealarm_path();

    if !rtc_dir.exists() {
        return Some(RtcWakealarmProbeV1 {
            supported: false,
            wakealarm_time: None,
            now_time: None,
        });
    }

    let now_time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs());

    let wakealarm_time = if wakealarm_path.exists() {
        std::fs::read_to_string(&wakealarm_path)
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
    } else {
        None
    };

    Some(RtcWakealarmProbeV1 {
        supported: true,
        wakealarm_time,
        now_time,
    })
}

/// Probe Linux power suspend states from `/sys/power/state`.
pub fn read_suspend_capabilities(layout: &Layout) -> Option<Vec<String>> {
    let power_path = layout.power_state_path();
    let content = std::fs::read_to_string(power_path).ok()?;
    let mut states: Vec<String> = content
        .split_whitespace()
        .filter(|s| matches!(*s, "freeze" | "standby" | "mem" | "disk"))
        .map(|s| s.to_string())
        .collect();

    states.sort();
    states.dedup();
    Some(states)
}

/// Inspect `/proc/<pid>/exe` for enrolled server PID and validate with strict privacy rules.
pub fn read_qualified_executables(layout: &Layout) -> Option<Vec<String>> {
    let pid_path = layout.server_pid_path();
    let content = std::fs::read_to_string(pid_path).ok()?;
    let pid: u32 = content.trim().parse().ok()?;
    if pid == 0 {
        return None;
    }

    let exe_symlink = Path::new("/proc").join(pid.to_string()).join("exe");
    let target = std::fs::read_link(exe_symlink).ok()?;
    let validated = validate_safe_executable_identity(&target.to_string_lossy())?;

    Some(vec![validated])
}

/// Wrap probe collection into a typed `SourceEnvelope`.
pub async fn query_current_host_probes<R: CurrentHostProbeReader>(
    reader: &R,
    layout: &Layout,
    applicability: Applicability,
    inhibitor_probe: Option<ActiveInhibitorProbeV1>,
    coverage: SourceCoverage,
) -> SourceEnvelope<ProjectedCurrentHostProbes> {
    if applicability == Applicability::NotApplicable {
        return SourceEnvelope::empty(
            CollectionStatus::NotApplicable,
            Historicity::NonHistorical,
            Applicability::NotApplicable,
            false,
            coverage,
        );
    }

    let probes = reader.read_probes(layout, inhibitor_probe).await;

    SourceEnvelope {
        collection_status: CollectionStatus::Available,
        historicity: Historicity::NonHistorical,
        applicability: Applicability::Applicable,
        required_for_historical_completeness: false,
        record_count: 1,
        byte_count: 0,
        malformed_count: 0,
        truncated: false,
        retention_limited: false,
        rotation_suspected: false,
        drop_suspected: false,
        coverage,
        errors: Vec::new(),
        records: probes,
    }
}
