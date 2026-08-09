use serde::{Deserialize, Serialize};

/// Server-owned resource monitor tuning. Values are bounded at runtime so a
/// malformed config cannot create a hot loop or unbounded history.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostResourceMonitorConfig {
    #[serde(
        default = "default_light_sample_seconds",
        alias = "light_sample_seconds"
    )]
    pub light_sample_seconds: u64,
    #[serde(
        default = "default_process_sample_seconds",
        alias = "process_sample_seconds"
    )]
    pub process_sample_seconds: u64,
    #[serde(default = "default_pss_sample_seconds", alias = "pss_sample_seconds")]
    pub pss_sample_seconds: u64,
    #[serde(default = "default_jitter_millis", alias = "jitter_millis")]
    pub jitter_millis: u64,
    #[serde(
        default = "default_process_deadline_millis",
        alias = "process_deadline_millis"
    )]
    pub process_deadline_millis: u64,
    #[serde(
        default = "default_snapshot_deadline_millis",
        alias = "snapshot_deadline_millis"
    )]
    pub snapshot_deadline_millis: u64,
    #[serde(default = "default_ring_capacity", alias = "ring_capacity")]
    pub ring_capacity: usize,
    #[serde(default = "default_max_alert_incidents", alias = "max_alert_incidents")]
    pub max_alert_incidents: usize,
    #[serde(
        default = "default_reclaimable_cache_percent",
        alias = "reclaimable_cache_percent"
    )]
    pub reclaimable_cache_percent: u8,
    #[serde(
        default = "default_available_warning_percent",
        alias = "available_warning_percent"
    )]
    pub available_warning_percent: u8,
    #[serde(
        default = "default_available_critical_percent",
        alias = "available_critical_percent"
    )]
    pub available_critical_percent: u8,
    #[serde(
        default = "default_available_oom_percent",
        alias = "available_oom_percent"
    )]
    pub available_oom_percent: u8,
    #[serde(default = "default_psi_some_percent", alias = "psi_some_percent")]
    pub psi_some_percent: u8,
    #[serde(default = "default_psi_full_percent", alias = "psi_full_percent")]
    pub psi_full_percent: u8,
}

fn default_light_sample_seconds() -> u64 {
    5
}
fn default_process_sample_seconds() -> u64 {
    15
}
fn default_pss_sample_seconds() -> u64 {
    60
}
fn default_jitter_millis() -> u64 {
    250
}
fn default_process_deadline_millis() -> u64 {
    150
}
fn default_snapshot_deadline_millis() -> u64 {
    500
}
fn default_ring_capacity() -> usize {
    144
}
fn default_max_alert_incidents() -> usize {
    50
}
fn default_reclaimable_cache_percent() -> u8 {
    25
}
fn default_available_warning_percent() -> u8 {
    15
}
fn default_available_critical_percent() -> u8 {
    10
}
fn default_available_oom_percent() -> u8 {
    5
}
fn default_psi_some_percent() -> u8 {
    10
}
fn default_psi_full_percent() -> u8 {
    1
}

impl Default for HostResourceMonitorConfig {
    fn default() -> Self {
        Self {
            light_sample_seconds: default_light_sample_seconds(),
            process_sample_seconds: default_process_sample_seconds(),
            pss_sample_seconds: default_pss_sample_seconds(),
            jitter_millis: default_jitter_millis(),
            process_deadline_millis: default_process_deadline_millis(),
            snapshot_deadline_millis: default_snapshot_deadline_millis(),
            ring_capacity: default_ring_capacity(),
            max_alert_incidents: default_max_alert_incidents(),
            reclaimable_cache_percent: default_reclaimable_cache_percent(),
            available_warning_percent: default_available_warning_percent(),
            available_critical_percent: default_available_critical_percent(),
            available_oom_percent: default_available_oom_percent(),
            psi_some_percent: default_psi_some_percent(),
            psi_full_percent: default_psi_full_percent(),
        }
    }
}

impl HostResourceMonitorConfig {
    pub fn clamped(&self) -> Self {
        let mut config = self.clone();
        config.light_sample_seconds = self.light_sample_seconds.clamp(1, 60);
        config.process_sample_seconds = self.process_sample_seconds.clamp(5, 300);
        config.pss_sample_seconds = self.pss_sample_seconds.clamp(15, 600);
        config.jitter_millis = self.jitter_millis.min(1_000);
        config.process_deadline_millis = self.process_deadline_millis.clamp(10, 1_000);
        config.snapshot_deadline_millis = self.snapshot_deadline_millis.clamp(50, 2_000);
        config.ring_capacity = self.ring_capacity.clamp(12, 144);
        config.max_alert_incidents = self.max_alert_incidents.clamp(1, 50);
        config.reclaimable_cache_percent = self.reclaimable_cache_percent.clamp(1, 90);
        config.available_warning_percent = self.available_warning_percent.clamp(1, 90);
        config.available_critical_percent = self.available_critical_percent.clamp(1, 80);
        config.available_oom_percent = self.available_oom_percent.clamp(1, 70);
        // Preserve the ordered severity bands even when a hand-edited config
        // supplies contradictory values. Alert classification depends on these
        // thresholds being strictly ordered.
        config.available_critical_percent = config
            .available_critical_percent
            .max(config.available_oom_percent.saturating_add(1));
        config.available_warning_percent = config
            .available_warning_percent
            .max(config.available_critical_percent.saturating_add(1));
        config.psi_some_percent = self.psi_some_percent.clamp(1, 100);
        config.psi_full_percent = self.psi_full_percent.clamp(1, 100);
        config
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_hot_loop_and_history_values() {
        let config = HostResourceMonitorConfig {
            light_sample_seconds: 0,
            process_sample_seconds: u64::MAX,
            pss_sample_seconds: 0,
            jitter_millis: u64::MAX,
            process_deadline_millis: 0,
            snapshot_deadline_millis: u64::MAX,
            ring_capacity: usize::MAX,
            max_alert_incidents: 0,
            reclaimable_cache_percent: 0,
            available_warning_percent: 0,
            available_critical_percent: 0,
            available_oom_percent: 0,
            psi_some_percent: 0,
            psi_full_percent: 0,
        }
        .clamped();

        assert_eq!(config.light_sample_seconds, 1);
        assert_eq!(config.process_sample_seconds, 300);
        assert_eq!(config.pss_sample_seconds, 15);
        assert_eq!(config.ring_capacity, 144);
        assert_eq!(config.max_alert_incidents, 1);
    }

    #[test]
    fn preserves_ordered_available_memory_severity_bands() {
        let config = HostResourceMonitorConfig {
            available_warning_percent: 2,
            available_critical_percent: 90,
            available_oom_percent: 70,
            ..Default::default()
        }
        .clamped();

        assert!(config.available_oom_percent < config.available_critical_percent);
        assert!(config.available_critical_percent < config.available_warning_percent);
    }
}
