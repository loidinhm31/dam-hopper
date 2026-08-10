use std::collections::BTreeMap;

use super::{
    is_real_persistent_disk, AvailabilityState, Confidence, HostMetrics, HostResourceSnapshotV1,
};

const COOLDOWN_MS: u64 = 5 * 60 * 1_000;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AlertState {
    Healthy,
    ReclaimableCacheHigh,
    ElevatedNoPressure,
    MemoryPressure,
    OomRisk,
    LimitedData,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AlertSeverity {
    Info,
    Warning,
    Critical,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertEvidence {
    pub available_percent: Option<f64>,
    pub reclaimable_percent: Option<f64>,
    pub psi_some_avg10: Option<f64>,
    pub psi_full_avg10: Option<f64>,
    pub cgroup_oom_delta: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertSummary {
    pub state: AlertState,
    pub severity: AlertSeverity,
    pub incident_id: Option<String>,
    pub opened_at: Option<u64>,
    pub updated_at: u64,
    pub duration_seconds: u64,
    /// Alert evidence applies to the monitored host, not a client-selected process.
    pub scope: String,
    pub confidence: Confidence,
    pub threshold: String,
    pub evidence: AlertEvidence,
    pub next_action: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertIncident {
    pub incident_id: String,
    pub state: AlertState,
    pub severity: AlertSeverity,
    pub opened_at: u64,
    pub updated_at: u64,
    pub resolved_at: Option<u64>,
    pub duration_seconds: u64,
    pub scope: String,
    pub threshold: String,
    pub confidence: Confidence,
    pub evidence: AlertEvidence,
    pub next_action: String,
}

#[derive(Clone, Debug)]
pub struct AlertSample {
    /// Monotonic elapsed time owned by the monitor or a fake clock in tests.
    pub observed_at_ms: u64,
    /// Wall-clock sample time used only for API/audit presentation.
    pub reported_at_ms: u64,
    pub available_percent: Option<f64>,
    pub reclaimable_percent: Option<f64>,
    pub psi_some_avg10: Option<f64>,
    pub psi_full_avg10: Option<f64>,
    pub primary_memory_available: bool,
    pub primary_psi_available: bool,
    pub oom_events_total: Option<u64>,
}

#[derive(Clone, Copy, Debug)]
pub struct AlertThresholds {
    pub reclaimable_cache_percent: f64,
    pub available_warning_percent: f64,
    pub available_critical_percent: f64,
    pub available_oom_percent: f64,
    pub psi_some_percent: f64,
    pub psi_full_percent: f64,
}

impl Default for AlertThresholds {
    fn default() -> Self {
        Self {
            reclaimable_cache_percent: 25.0,
            available_warning_percent: 15.0,
            available_critical_percent: 10.0,
            available_oom_percent: 5.0,
            psi_some_percent: 10.0,
            psi_full_percent: 1.0,
        }
    }
}

impl AlertThresholds {
    pub fn from_config(config: &crate::system::config::HostResourceMonitorConfig) -> Self {
        Self {
            reclaimable_cache_percent: config.reclaimable_cache_percent as f64,
            available_warning_percent: config.available_warning_percent as f64,
            available_critical_percent: config.available_critical_percent as f64,
            available_oom_percent: config.available_oom_percent as f64,
            psi_some_percent: config.psi_some_percent as f64,
            psi_full_percent: config.psi_full_percent as f64,
        }
    }
}

impl AlertSample {
    /// The caller supplies a monotonic observation time. Wall-clock
    /// `sampled_at` is retained separately for API/audit presentation and must
    /// never be used for transition durations.
    pub fn from_snapshot_with_monotonic(
        snapshot: &HostResourceSnapshotV1,
        observed_at_ms: u64,
    ) -> Self {
        let available_percent = snapshot
            .memory
            .available_bytes
            .zip(snapshot.memory.total_bytes)
            .and_then(|(available, total)| {
                (total > 0).then_some(available as f64 * 100.0 / total as f64)
            });
        let reclaimable_percent = snapshot
            .memory
            .file_cache_bytes
            .unwrap_or(0)
            .checked_add(snapshot.memory.reclaimable_slab_bytes.unwrap_or(0))
            .zip(snapshot.memory.total_bytes)
            .and_then(|(reclaimable, total)| {
                (total > 0).then_some(reclaimable as f64 * 100.0 / total as f64)
            });
        let pressure = &snapshot.pressure.memory;
        let oom_events_total = snapshot
            .cgroups
            .iter()
            .flat_map(|cgroup| cgroup.events.iter())
            .filter(|(name, _)| name == "oom" || name == "oom_kill")
            .map(|(_, value)| *value)
            .sum::<u64>();

        Self {
            observed_at_ms,
            reported_at_ms: snapshot.sampled_at,
            available_percent,
            reclaimable_percent,
            psi_some_avg10: pressure.some.as_ref().map(|line| line.avg10),
            psi_full_avg10: pressure.full.as_ref().map(|line| line.avg10),
            primary_memory_available: matches!(
                snapshot.memory.availability.state,
                AvailabilityState::Available
            ) && snapshot.memory.available_bytes.is_some(),
            primary_psi_available: matches!(
                pressure.availability.state,
                AvailabilityState::Available
            ) && (pressure.some.is_some() || pressure.full.is_some()),
            oom_events_total: (!snapshot.cgroups.is_empty()).then_some(oom_events_total),
        }
    }
}

#[derive(Clone, Debug)]
pub struct AlertEngineState {
    pub current: AlertState,
    current_since_ms: u64,
    candidate: Option<(AlertState, u64)>,
    recovery_since_ms: Option<u64>,
    recovery_samples: u8,
    pub incident_id: Option<String>,
    next_incident: u64,
    opened_at: Option<u64>,
    incident_since_ms: Option<u64>,
    last_observed_at_ms: u64,
    cooldown_until_ms: Option<u64>,
    last_oom_total: Option<u64>,
}

pub struct AlertEngine;

impl AlertEngine {
    pub fn advance(previous: &AlertEngineState, sample: &AlertSample) -> AlertTransition {
        AlertEngineState::advance(previous, sample)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AlertChange {
    Opened,
    Escalated,
    Updated,
    Resolved,
}

#[derive(Clone, Debug)]
pub struct AlertTransition {
    pub next: AlertEngineState,
    pub summary: AlertSummary,
    pub incident: Option<AlertIncident>,
    pub change: Option<AlertChange>,
}

struct TransitionInput<'a> {
    now: u64,
    sample: &'a AlertSample,
    oom_delta: bool,
    thresholds: &'a AlertThresholds,
}

impl AlertEngineState {
    pub fn healthy(now_ms: u64) -> Self {
        Self {
            current: AlertState::Healthy,
            current_since_ms: now_ms,
            candidate: None,
            recovery_since_ms: None,
            recovery_samples: 0,
            incident_id: None,
            next_incident: 1,
            opened_at: None,
            incident_since_ms: None,
            last_observed_at_ms: now_ms,
            cooldown_until_ms: None,
            last_oom_total: None,
        }
    }
}

impl AlertEngineState {
    /// Pure state transition. The caller owns the returned state and can feed
    /// it back into the next call, which keeps fake-clock tests deterministic.
    pub fn advance(previous: &Self, sample: &AlertSample) -> AlertTransition {
        Self::advance_with_thresholds(previous, sample, &AlertThresholds::default())
    }

    pub fn advance_with_thresholds(
        previous: &Self,
        sample: &AlertSample,
        thresholds: &AlertThresholds,
    ) -> AlertTransition {
        let now = sample.observed_at_ms.max(previous.last_observed_at_ms);
        let oom_delta = sample
            .oom_events_total
            .zip(previous.last_oom_total)
            .is_some_and(|(current, old)| current > old);
        let target = classify(sample, oom_delta, thresholds);
        let mut next = previous.clone();
        next.last_observed_at_ms = now;
        // A cgroup may restart and reset its counter. Keep the newest observed
        // value so a subsequent increment is still detected immediately.
        next.last_oom_total = sample.oom_events_total;
        let mut change = None;
        let mut incident = None;
        let input = TransitionInput {
            now,
            sample,
            oom_delta,
            thresholds,
        };

        if target == previous.current {
            next.candidate = None;
            next.recovery_since_ms = None;
            if target == AlertState::LimitedData {
                next.recovery_samples = 0;
            }
        } else if target == AlertState::LimitedData {
            // Loss of both primary signals is itself immediately actionable
            // context. Do not retain a prior pressure state when its evidence
            // can no longer be evaluated.
            transition(&mut next, target, &input, &mut change, &mut incident);
        } else if previous.current == AlertState::LimitedData {
            if target != AlertState::LimitedData {
                next.recovery_samples = previous.recovery_samples.saturating_add(1);
                if next.recovery_samples >= 2 {
                    transition(&mut next, target, &input, &mut change, &mut incident);
                }
            }
        } else if state_rank(target) > state_rank(previous.current)
            || previous.current == AlertState::Healthy
        {
            next.recovery_since_ms = None;
            let since = match previous.candidate {
                Some((candidate, started)) if candidate == target => started,
                _ => now,
            };
            next.candidate = Some((target, since));
            let duration = entry_duration_ms(target, sample, oom_delta, thresholds);
            if now.saturating_sub(since) >= duration {
                transition(&mut next, target, &input, &mut change, &mut incident);
            }
        } else if recovery_met(previous.current, sample, thresholds) {
            let since = previous.recovery_since_ms.unwrap_or(now);
            next.recovery_since_ms = Some(since);
            if now.saturating_sub(since) >= recovery_duration_ms(previous.current) {
                transition(
                    &mut next,
                    AlertState::Healthy,
                    &input,
                    &mut change,
                    &mut incident,
                );
            }
        } else {
            next.recovery_since_ms = None;
        }

        let summary = summary(&next, now, sample, oom_delta, thresholds);
        AlertTransition {
            next,
            summary,
            incident,
            change,
        }
    }
}

fn transition(
    next: &mut AlertEngineState,
    state: AlertState,
    input: &TransitionInput<'_>,
    change: &mut Option<AlertChange>,
    incident: &mut Option<AlertIncident>,
) {
    let old = next.current;
    next.current = state;
    next.current_since_ms = input.now;
    next.candidate = None;
    next.recovery_since_ms = None;
    next.recovery_samples = 0;
    if old == AlertState::Healthy && state != AlertState::Healthy {
        let id = format!("host-incident-{}", next.next_incident);
        next.next_incident = next.next_incident.saturating_add(1);
        next.incident_id = Some(id);
        next.opened_at = Some(input.sample.reported_at_ms);
        next.incident_since_ms = Some(input.now);
        *change = if next
            .cooldown_until_ms
            .is_some_and(|until| input.now < until)
        {
            None
        } else {
            Some(AlertChange::Opened)
        };
        *incident = Some(incident_from(next, input, None));
    } else if old != AlertState::Healthy && state == AlertState::Healthy {
        if let Some(id) = next.incident_id.clone() {
            *change = Some(AlertChange::Resolved);
            *incident = Some(incident_from(
                next,
                input,
                Some(input.sample.reported_at_ms),
            ));
            next.cooldown_until_ms = Some(input.now.saturating_add(COOLDOWN_MS));
            let _ = id;
        }
        next.incident_id = None;
        next.opened_at = None;
        next.incident_since_ms = None;
    } else if old != state && next.incident_id.is_some() {
        *change = Some(if state_rank(state) > state_rank(old) {
            AlertChange::Escalated
        } else {
            AlertChange::Updated
        });
        *incident = Some(incident_from(next, input, None));
    }
}

fn classify(sample: &AlertSample, oom_delta: bool, thresholds: &AlertThresholds) -> AlertState {
    if !sample.primary_memory_available && !sample.primary_psi_available {
        return AlertState::LimitedData;
    }
    if oom_delta
        || (sample
            .available_percent
            .is_some_and(|value| value < thresholds.available_oom_percent)
            && (sample.psi_some_avg10.is_some_and(|value| value >= 20.0)
                || sample.psi_full_avg10.is_some_and(|value| value >= 5.0)))
    {
        return AlertState::OomRisk;
    }
    if sample
        .available_percent
        .is_some_and(|value| value < thresholds.available_critical_percent)
        || sample
            .psi_some_avg10
            .is_some_and(|value| value >= thresholds.psi_some_percent)
        || sample
            .psi_full_avg10
            .is_some_and(|value| value >= thresholds.psi_full_percent)
    {
        return AlertState::MemoryPressure;
    }
    if sample
        .available_percent
        .is_some_and(|value| value < thresholds.available_warning_percent)
    {
        return AlertState::ElevatedNoPressure;
    }
    if sample
        .reclaimable_percent
        .is_some_and(|value| value >= thresholds.reclaimable_cache_percent)
        && sample
            .available_percent
            .is_some_and(|value| value >= thresholds.available_warning_percent)
        && sample.primary_psi_available
        && sample.psi_some_avg10.unwrap_or(0.0) < thresholds.psi_some_percent
        && sample.psi_full_avg10.unwrap_or(0.0) < thresholds.psi_full_percent
    {
        return AlertState::ReclaimableCacheHigh;
    }
    AlertState::Healthy
}

fn severity(state: AlertState) -> AlertSeverity {
    match state {
        AlertState::Healthy => AlertSeverity::Info,
        AlertState::ReclaimableCacheHigh
        | AlertState::ElevatedNoPressure
        | AlertState::LimitedData => AlertSeverity::Warning,
        AlertState::MemoryPressure | AlertState::OomRisk => AlertSeverity::Critical,
    }
}

fn state_rank(state: AlertState) -> u8 {
    match state {
        AlertState::Healthy => 0,
        AlertState::ReclaimableCacheHigh => 1,
        AlertState::ElevatedNoPressure => 2,
        AlertState::MemoryPressure => 3,
        AlertState::OomRisk => 4,
        AlertState::LimitedData => 1,
    }
}

fn entry_duration_ms(
    state: AlertState,
    sample: &AlertSample,
    oom_delta: bool,
    thresholds: &AlertThresholds,
) -> u64 {
    if oom_delta {
        return 0;
    }
    match state {
        AlertState::OomRisk => 15_000,
        AlertState::MemoryPressure
            if sample
                .psi_full_avg10
                .is_some_and(|value| value >= thresholds.psi_full_percent) =>
        {
            15_000
        }
        AlertState::MemoryPressure => 30_000,
        AlertState::LimitedData => 0,
        AlertState::ReclaimableCacheHigh | AlertState::ElevatedNoPressure => 30_000,
        AlertState::Healthy => 0,
    }
}

fn recovery_met(state: AlertState, sample: &AlertSample, thresholds: &AlertThresholds) -> bool {
    match state {
        AlertState::ReclaimableCacheHigh => sample
            .reclaimable_percent
            .is_none_or(|value| value < (thresholds.reclaimable_cache_percent - 5.0).max(0.0)),
        AlertState::ElevatedNoPressure => sample
            .available_percent
            .is_some_and(|value| value >= (thresholds.available_warning_percent + 5.0).min(100.0)),
        AlertState::MemoryPressure => {
            sample
                .available_percent
                .is_some_and(|value| value >= thresholds.available_warning_percent)
                && sample
                    .psi_some_avg10
                    .is_none_or(|value| value < thresholds.psi_some_percent / 2.0)
                && sample
                    .psi_full_avg10
                    .is_none_or(|value| value < thresholds.psi_full_percent / 2.0)
        }
        AlertState::OomRisk => {
            sample.oom_events_total.is_some()
                && recovery_met(AlertState::MemoryPressure, sample, thresholds)
        }
        AlertState::Healthy | AlertState::LimitedData => false,
    }
}

fn recovery_duration_ms(state: AlertState) -> u64 {
    match state {
        AlertState::OomRisk => 120_000,
        AlertState::ReclaimableCacheHigh
        | AlertState::ElevatedNoPressure
        | AlertState::MemoryPressure => 60_000,
        AlertState::Healthy | AlertState::LimitedData => 0,
    }
}

fn summary(
    state: &AlertEngineState,
    now: u64,
    sample: &AlertSample,
    oom_delta: bool,
    thresholds: &AlertThresholds,
) -> AlertSummary {
    AlertSummary {
        state: state.current,
        severity: severity(state.current),
        incident_id: state.incident_id.clone(),
        opened_at: state.opened_at,
        updated_at: sample.reported_at_ms,
        duration_seconds: state
            .incident_since_ms
            .map(|started| now.saturating_sub(started) / 1_000)
            .unwrap_or(0),
        scope: "host".into(),
        confidence: confidence(state.current, sample),
        threshold: threshold(state.current, thresholds),
        evidence: evidence(sample, oom_delta),
        next_action: next_action(state.current),
    }
}

fn incident_from(
    state: &AlertEngineState,
    input: &TransitionInput<'_>,
    resolved_at: Option<u64>,
) -> AlertIncident {
    let summary = summary(
        state,
        input.now,
        input.sample,
        input.oom_delta,
        input.thresholds,
    );
    AlertIncident {
        incident_id: state
            .incident_id
            .clone()
            .unwrap_or_else(|| "unknown".into()),
        state: summary.state,
        severity: summary.severity,
        opened_at: state.opened_at.unwrap_or(input.sample.reported_at_ms),
        updated_at: input.sample.reported_at_ms,
        resolved_at,
        duration_seconds: summary.duration_seconds,
        scope: summary.scope,
        threshold: summary.threshold,
        confidence: summary.confidence,
        evidence: summary.evidence,
        next_action: summary.next_action,
    }
}

fn confidence(state: AlertState, sample: &AlertSample) -> Confidence {
    if state == AlertState::LimitedData {
        return Confidence::Low;
    }
    if sample.available_percent.is_some() && sample.psi_some_avg10.is_some() {
        Confidence::High
    } else {
        Confidence::Medium
    }
}

fn threshold(state: AlertState, thresholds: &AlertThresholds) -> String {
    match state {
        AlertState::Healthy => "none".into(),
        AlertState::ReclaimableCacheHigh => format!(
            "reclaimable>={}%,available>={}%,psi_some<{}%,psi_full<{}%",
            thresholds.reclaimable_cache_percent,
            thresholds.available_warning_percent,
            thresholds.psi_some_percent,
            thresholds.psi_full_percent,
        ),
        AlertState::ElevatedNoPressure => {
            format!("available<{}%", thresholds.available_warning_percent)
        }
        AlertState::MemoryPressure => format!(
            "available<{}% or psi_some>={}%,psi_full>={}%",
            thresholds.available_critical_percent,
            thresholds.psi_some_percent,
            thresholds.psi_full_percent
        ),
        AlertState::OomRisk => format!(
            "oom_delta or available<{}% correlated with pressure",
            thresholds.available_oom_percent
        ),
        AlertState::LimitedData => "MemAvailable and PSI unavailable".into(),
    }
}

fn next_action(state: AlertState) -> String {
    match state {
        AlertState::Healthy => "No action required".into(),
        AlertState::ReclaimableCacheHigh => {
            "Inspect cache consumers; no mutation is suggested".into()
        }
        AlertState::ElevatedNoPressure => "Inspect top memory consumers and workload trend".into(),
        AlertState::MemoryPressure => "Inspect top consumers, PSI, swap, and cgroup limits".into(),
        AlertState::OomRisk => {
            "Stop starting memory-heavy work and inspect cgroup OOM evidence".into()
        }
        AlertState::LimitedData => "Restore readable MemAvailable and PSI sources".into(),
    }
}

fn evidence(sample: &AlertSample, oom_delta: bool) -> AlertEvidence {
    AlertEvidence {
        available_percent: sample.available_percent,
        reclaimable_percent: sample.reclaimable_percent,
        psi_some_avg10: sample.psi_some_avg10,
        psi_full_avg10: sample.psi_full_avg10,
        cgroup_oom_delta: oom_delta,
    }
}

const THERMAL_ALERT_CELSIUS: f64 = 60.0;
const THERMAL_ALERT_DURATION_MS: u64 = 300_000;
const MAX_RESOURCE_TARGETS: usize = 50;
const MAX_RESOURCE_TEXT_BYTES: usize = 128;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ResourceAlertState {
    TemperatureHigh,
    DiskFull,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct ResourceAlertEvidence {
    pub temperature_source: Option<String>,
    pub temperature_label: Option<String>,
    pub temperature_celsius: Option<f64>,
    pub disk_mount_point: Option<String>,
    pub disk_name: Option<String>,
    pub disk_usage_percent: Option<f64>,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct ResourceAlertSummary {
    pub state: ResourceAlertState,
    pub incident_id: String,
    pub opened_at: u64,
    pub updated_at: u64,
    pub duration_seconds: u64,
    pub scope: String,
    pub evidence: ResourceAlertEvidence,
}

#[allow(dead_code)]
#[derive(Clone, Debug)]
pub(crate) struct ResourceAlertIncident {
    pub summary: ResourceAlertSummary,
    pub resolved_at: Option<u64>,
}

#[derive(Clone, Debug)]
struct ResourceAlertTarget {
    state: ResourceAlertState,
    condition: bool,
    evidence: ResourceAlertEvidence,
}

/// A normalized, cached legacy sample for target-specific resource alerts.
/// This is intentionally crate-private until Phase 02 adds its DTO contract.
#[derive(Clone, Debug)]
pub(crate) struct ResourceAlertSample {
    observed_at_ms: u64,
    reported_at_ms: u64,
    targets: BTreeMap<String, ResourceAlertTarget>,
}

impl ResourceAlertSample {
    pub(crate) fn from_legacy(metrics: &HostMetrics, observed_at_ms: u64) -> Self {
        let mut targets = BTreeMap::new();
        for temperature in &metrics.temperatures {
            let Some(source) = bounded_text(&temperature.source) else {
                continue;
            };
            let celsius = temperature
                .celsius
                .is_finite()
                .then_some(temperature.celsius);
            insert_target(
                &mut targets,
                format!("temperature:{source}"),
                ResourceAlertTarget {
                    state: ResourceAlertState::TemperatureHigh,
                    condition: celsius.is_some_and(|value| value > THERMAL_ALERT_CELSIUS),
                    evidence: ResourceAlertEvidence {
                        temperature_source: Some(source),
                        temperature_label: bounded_text(&temperature.label),
                        temperature_celsius: celsius,
                        disk_mount_point: None,
                        disk_name: None,
                        disk_usage_percent: None,
                    },
                },
            );
        }
        for disk in &metrics.disks {
            let Some(mount_point) = bounded_text(&disk.mount_point) else {
                continue;
            };
            let usage_percent = disk.usage_percent.is_finite().then_some(disk.usage_percent);
            insert_target(
                &mut targets,
                format!("disk:{mount_point}"),
                ResourceAlertTarget {
                    state: ResourceAlertState::DiskFull,
                    condition: is_real_persistent_disk(disk)
                        && usage_percent.is_some_and(|value| value >= 95.0),
                    evidence: ResourceAlertEvidence {
                        temperature_source: None,
                        temperature_label: None,
                        temperature_celsius: None,
                        disk_mount_point: Some(mount_point),
                        disk_name: bounded_text(&disk.name),
                        disk_usage_percent: usage_percent,
                    },
                },
            );
        }
        Self {
            observed_at_ms,
            reported_at_ms: metrics.sampled_at,
            targets,
        }
    }
}

fn bounded_text(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && value.len() <= MAX_RESOURCE_TEXT_BYTES).then(|| value.to_owned())
}

fn insert_target(
    targets: &mut BTreeMap<String, ResourceAlertTarget>,
    key: String,
    target: ResourceAlertTarget,
) {
    if targets.insert(key.clone(), target).is_some() {
        // Duplicate source/mount metadata is ambiguous. Reset it rather than
        // allowing either record to maintain an alert lifecycle.
        if let Some(target) = targets.get_mut(&key) {
            target.condition = false;
        }
    }
}

#[derive(Clone, Debug)]
struct ResourceAlertLifecycle {
    candidate_since_ms: u64,
    active: Option<ResourceAlertSummary>,
    opened_at_ms: Option<u64>,
}

#[derive(Clone, Debug)]
pub(crate) struct ResourceAlertEngineState {
    targets: BTreeMap<String, ResourceAlertLifecycle>,
    last_observed_at_ms: u64,
    next_incident: u64,
}

impl ResourceAlertEngineState {
    pub(crate) fn healthy(now_ms: u64) -> Self {
        Self {
            targets: BTreeMap::new(),
            last_observed_at_ms: now_ms,
            next_incident: 1,
        }
    }

    /// Retains the deterministic prefix used when bounded targets are admitted.
    pub(crate) fn retain_targets(&mut self, max_targets: usize) {
        let max_targets = max_targets.clamp(1, MAX_RESOURCE_TARGETS);
        let discarded = self
            .targets
            .keys()
            .skip(max_targets)
            .cloned()
            .collect::<Vec<_>>();
        for key in discarded {
            self.targets.remove(&key);
        }
    }

    pub(crate) fn advance(
        previous: &Self,
        sample: &ResourceAlertSample,
        max_targets: usize,
    ) -> ResourceAlertTransition {
        let now = sample.observed_at_ms.max(previous.last_observed_at_ms);
        let max_targets = max_targets.clamp(1, MAX_RESOURCE_TARGETS);
        let mut next = previous.clone();
        next.last_observed_at_ms = now;
        let mut incidents = Vec::new();

        let reset_keys = next
            .targets
            .keys()
            .filter(|key| {
                sample
                    .targets
                    .get(*key)
                    .is_none_or(|target| !target.condition)
            })
            .cloned()
            .collect::<Vec<_>>();
        for key in reset_keys {
            let Some(lifecycle) = next.targets.remove(&key) else {
                continue;
            };
            if let Some(mut summary) = lifecycle.active {
                if let Some(target) = sample.targets.get(&key) {
                    summary.evidence = target.evidence.clone();
                }
                summary.updated_at = sample.reported_at_ms;
                summary.duration_seconds = lifecycle
                    .opened_at_ms
                    .map(|opened| now.saturating_sub(opened) / 1_000)
                    .unwrap_or(0);
                incidents.push(ResourceAlertIncident {
                    summary,
                    resolved_at: Some(sample.reported_at_ms),
                });
            }
        }

        for (key, target) in &sample.targets {
            if !target.condition {
                continue;
            }
            if !next.targets.contains_key(key) && next.targets.len() >= max_targets {
                continue;
            }
            let lifecycle = next
                .targets
                .entry(key.clone())
                .or_insert(ResourceAlertLifecycle {
                    candidate_since_ms: now,
                    active: None,
                    opened_at_ms: None,
                });
            if let Some(summary) = &mut lifecycle.active {
                summary.updated_at = sample.reported_at_ms;
                summary.duration_seconds = lifecycle
                    .opened_at_ms
                    .map(|opened| now.saturating_sub(opened) / 1_000)
                    .unwrap_or(0);
                summary.evidence = target.evidence.clone();
                continue;
            }
            if now.saturating_sub(lifecycle.candidate_since_ms) < resource_entry_duration(target) {
                continue;
            }

            let summary = ResourceAlertSummary {
                state: target.state,
                incident_id: format!("host-resource-incident-{}", next.next_incident),
                opened_at: sample.reported_at_ms,
                updated_at: sample.reported_at_ms,
                duration_seconds: 0,
                scope: key.clone(),
                evidence: target.evidence.clone(),
            };
            next.next_incident = next.next_incident.saturating_add(1);
            lifecycle.opened_at_ms = Some(now);
            lifecycle.active = Some(summary.clone());
            incidents.push(ResourceAlertIncident {
                summary,
                resolved_at: None,
            });
        }

        let active = next
            .targets
            .values()
            .filter_map(|lifecycle| lifecycle.active.clone())
            .collect();
        ResourceAlertTransition {
            next,
            active,
            incidents,
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ResourceAlertTransition {
    pub(crate) next: ResourceAlertEngineState,
    pub(crate) active: Vec<ResourceAlertSummary>,
    pub(crate) incidents: Vec<ResourceAlertIncident>,
}

fn resource_entry_duration(target: &ResourceAlertTarget) -> u64 {
    match target.state {
        ResourceAlertState::TemperatureHigh => THERMAL_ALERT_DURATION_MS,
        ResourceAlertState::DiskFull => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(
        at: u64,
        available: Option<f64>,
        some: Option<f64>,
        full: Option<f64>,
    ) -> AlertSample {
        AlertSample {
            observed_at_ms: at,
            reported_at_ms: at,
            available_percent: available,
            reclaimable_percent: Some(5.0),
            psi_some_avg10: some,
            psi_full_avg10: full,
            primary_memory_available: available.is_some(),
            primary_psi_available: some.is_some() || full.is_some(),
            oom_events_total: Some(0),
        }
    }

    #[test]
    fn requires_sustained_pressure_and_honors_hysteresis() {
        let mut state = AlertEngineState::healthy(0);
        state = AlertEngineState::advance(&state, &sample(0, Some(8.0), Some(0.0), Some(0.0))).next;
        assert_eq!(state.current, AlertState::Healthy);
        state = AlertEngineState::advance(&state, &sample(29_999, Some(8.0), Some(0.0), Some(0.0)))
            .next;
        assert_eq!(state.current, AlertState::Healthy);
        state = AlertEngineState::advance(&state, &sample(30_000, Some(8.0), Some(0.0), Some(0.0)))
            .next;
        assert_eq!(state.current, AlertState::MemoryPressure);
        state =
            AlertEngineState::advance(&state, &sample(90_000, Some(16.0), Some(0.0), Some(0.0)))
                .next;
        assert_eq!(state.current, AlertState::MemoryPressure);
        state =
            AlertEngineState::advance(&state, &sample(150_000, Some(16.0), Some(0.0), Some(0.0)))
                .next;
        assert_eq!(state.current, AlertState::Healthy);
    }

    #[test]
    fn clock_backwards_does_not_shortcut_entry() {
        let state = AlertEngineState::healthy(100_000);
        let next =
            AlertEngineState::advance(&state, &sample(0, Some(8.0), Some(0.0), Some(0.0))).next;
        assert_eq!(next.current, AlertState::Healthy);
    }

    #[test]
    fn escalation_keeps_incident_id_and_oom_delta_is_immediate() {
        let mut state = AlertEngineState::healthy(0);
        state = AlertEngineState::advance(&state, &sample(0, Some(8.0), Some(0.0), Some(0.0))).next;
        state = AlertEngineState::advance(&state, &sample(30_000, Some(8.0), Some(0.0), Some(0.0)))
            .next;
        let id = state.incident_id.clone().unwrap();
        let transition = AlertEngineState::advance(
            &state,
            &AlertSample {
                oom_events_total: Some(1),
                ..sample(31_000, Some(4.0), Some(20.0), Some(5.0))
            },
        );
        assert_eq!(transition.next.current, AlertState::OomRisk);
        assert_eq!(transition.next.incident_id.as_deref(), Some(id.as_str()));
        assert_eq!(transition.change, Some(AlertChange::Escalated));
        assert_eq!(transition.summary.duration_seconds, 1);
        assert_eq!(transition.incident.unwrap().duration_seconds, 1);
    }

    #[test]
    fn incident_duration_survives_escalation_until_resolution() {
        let mut state = AlertEngineState::healthy(0);
        state = AlertEngineState::advance(&state, &sample(0, Some(8.0), Some(0.0), Some(0.0))).next;
        state = AlertEngineState::advance(&state, &sample(30_000, Some(8.0), Some(0.0), Some(0.0)))
            .next;
        state = AlertEngineState::advance(
            &state,
            &AlertSample {
                oom_events_total: Some(1),
                ..sample(31_000, Some(4.0), Some(20.0), Some(5.0))
            },
        )
        .next;

        let state = AlertEngineState::advance(
            &state,
            &AlertSample {
                oom_events_total: Some(1),
                ..sample(151_000, Some(20.0), Some(0.0), Some(0.0))
            },
        )
        .next;
        let transition = AlertEngineState::advance(
            &state,
            &AlertSample {
                oom_events_total: Some(1),
                ..sample(271_000, Some(20.0), Some(0.0), Some(0.0))
            },
        );

        assert_eq!(transition.change, Some(AlertChange::Resolved));
        assert_eq!(transition.incident.unwrap().duration_seconds, 241);
    }

    #[test]
    fn limited_data_recovers_after_two_samples() {
        let mut state = AlertEngineState::healthy(0);
        state = AlertEngineState::advance(&state, &sample(0, None, None, None)).next;
        assert_eq!(state.current, AlertState::LimitedData);
        state = AlertEngineState::advance(&state, &sample(1, Some(50.0), None, None)).next;
        assert_eq!(state.current, AlertState::LimitedData);
        state = AlertEngineState::advance(&state, &sample(2, Some(50.0), None, None)).next;
        assert_eq!(state.current, AlertState::Healthy);
    }

    #[test]
    fn loss_of_primary_signals_replaces_an_active_pressure_state() {
        let mut state = AlertEngineState::healthy(0);
        state = AlertEngineState::advance(&state, &sample(0, Some(8.0), Some(0.0), Some(0.0))).next;
        state = AlertEngineState::advance(&state, &sample(30_000, Some(8.0), Some(0.0), Some(0.0)))
            .next;
        let incident_id = state.incident_id.clone();

        let transition = AlertEngineState::advance(&state, &sample(31_000, None, None, None));
        assert_eq!(transition.next.current, AlertState::LimitedData);
        assert_eq!(transition.next.incident_id, incident_id);
        assert_eq!(transition.change, Some(AlertChange::Updated));
    }

    #[test]
    fn forward_wall_clock_jump_does_not_bypass_monotonic_entry_duration() {
        let state = AlertEngineState::healthy(0);
        let state =
            AlertEngineState::advance(&state, &sample(0, Some(8.0), Some(0.0), Some(0.0))).next;
        let transition = AlertEngineState::advance(
            &state,
            &AlertSample {
                reported_at_ms: u64::MAX,
                ..sample(29_999, Some(8.0), Some(0.0), Some(0.0))
            },
        );

        assert_eq!(transition.next.current, AlertState::Healthy);
    }

    #[test]
    fn configured_thresholds_drive_labels_and_recovery() {
        let thresholds = AlertThresholds {
            available_warning_percent: 30.0,
            available_critical_percent: 20.0,
            available_oom_percent: 10.0,
            psi_some_percent: 8.0,
            psi_full_percent: 2.0,
            ..Default::default()
        };
        let mut state = AlertEngineState::healthy(0);
        state = AlertEngineState::advance_with_thresholds(
            &state,
            &sample(0, Some(19.0), Some(0.0), Some(0.0)),
            &thresholds,
        )
        .next;
        let transition = AlertEngineState::advance_with_thresholds(
            &state,
            &sample(30_000, Some(19.0), Some(0.0), Some(0.0)),
            &thresholds,
        );

        assert_eq!(transition.next.current, AlertState::MemoryPressure);
        assert!(transition.summary.threshold.contains("available<20%"));
    }

    #[test]
    fn cgroup_counter_reset_rebases_the_next_oom_delta() {
        let state = AlertEngineState::healthy(0);
        let state = AlertEngineState::advance(
            &state,
            &AlertSample {
                oom_events_total: Some(5),
                ..sample(0, Some(50.0), Some(0.0), Some(0.0))
            },
        )
        .next;
        let state = AlertEngineState::advance(
            &state,
            &AlertSample {
                oom_events_total: Some(1),
                ..sample(1, Some(50.0), Some(0.0), Some(0.0))
            },
        )
        .next;
        let transition = AlertEngineState::advance(
            &state,
            &AlertSample {
                oom_events_total: Some(2),
                ..sample(2, Some(50.0), Some(0.0), Some(0.0))
            },
        );

        assert_eq!(transition.next.current, AlertState::OomRisk);
    }

    fn legacy_metrics(
        sampled_at: u64,
        temperatures: Vec<super::super::TemperatureMetrics>,
        disks: Vec<super::super::DiskMetrics>,
    ) -> HostMetrics {
        HostMetrics {
            sampled_at,
            hostname: None,
            os_name: None,
            uptime_seconds: 0,
            cpu: super::super::CpuMetrics {
                usage_percent: 0.0,
                logical_core_count: 0,
                physical_core_count: None,
                load_average: None,
            },
            memory: super::super::MemoryMetrics {
                total_bytes: 0,
                used_bytes: 0,
                available_bytes: 0,
                usage_percent: 0.0,
            },
            disk: super::super::DiskMetrics {
                name: "workspace".into(),
                mount_point: "/".into(),
                total_bytes: 0,
                available_bytes: 0,
                used_bytes: 0,
                usage_percent: 0.0,
                file_system: None,
                source: None,
                source_kind: super::super::DiskSourceKind::Unknown,
            },
            disks,
            temperatures,
        }
    }

    fn disk(
        mount_point: &str,
        source: &str,
        source_kind: super::super::DiskSourceKind,
        file_system: &str,
        usage_percent: f64,
    ) -> super::super::DiskMetrics {
        super::super::DiskMetrics {
            name: "disk".into(),
            mount_point: mount_point.into(),
            total_bytes: 100,
            available_bytes: 100 - usage_percent as u64,
            used_bytes: usage_percent as u64,
            usage_percent,
            file_system: Some(file_system.into()),
            source: Some(source.into()),
            source_kind,
        }
    }

    fn persistent_disk(
        mount_point: &str,
        file_system: &str,
        usage_percent: f64,
    ) -> super::super::DiskMetrics {
        disk(
            mount_point,
            "/dev/nvme0n1p1",
            super::super::DiskSourceKind::BlockDevice,
            file_system,
            usage_percent,
        )
    }

    fn resource_sample(
        at: u64,
        temperatures: Vec<super::super::TemperatureMetrics>,
        disks: Vec<super::super::DiskMetrics>,
    ) -> ResourceAlertSample {
        ResourceAlertSample::from_legacy(&legacy_metrics(at, temperatures, disks), at)
    }

    #[test]
    fn thermal_alert_requires_exact_continuity_and_resets_before_recovery() {
        let hot = || {
            vec![super::super::TemperatureMetrics {
                label: "package".into(),
                celsius: 60.1,
                source: "thermal_zone0".into(),
            }]
        };
        let mut state = ResourceAlertEngineState::healthy(0);
        state =
            ResourceAlertEngineState::advance(&state, &resource_sample(0, hot(), Vec::new()), 50)
                .next;
        let transition = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(299_999, hot(), Vec::new()),
            50,
        );
        assert!(transition.incidents.is_empty());
        state = transition.next;

        let transition = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(300_000, hot(), Vec::new()),
            50,
        );
        assert_eq!(transition.incidents.len(), 1);
        assert_eq!(
            transition.active[0].state,
            ResourceAlertState::TemperatureHigh
        );
        assert_eq!(transition.active[0].scope, "temperature:thermal_zone0");
        state = transition.next;

        let transition = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(
                300_001,
                vec![super::super::TemperatureMetrics {
                    label: "package".into(),
                    celsius: 60.0,
                    source: "thermal_zone0".into(),
                }],
                Vec::new(),
            ),
            50,
        );
        assert_eq!(transition.incidents.len(), 1);
        assert!(transition.incidents[0].resolved_at.is_some());
        state = transition.next;

        state = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(300_002, hot(), Vec::new()),
            50,
        )
        .next;
        let transition = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(600_001, hot(), Vec::new()),
            50,
        );
        assert!(transition.incidents.is_empty());
        let transition = ResourceAlertEngineState::advance(
            &transition.next,
            &resource_sample(600_002, hot(), Vec::new()),
            50,
        );
        assert_eq!(transition.incidents.len(), 1);
        assert_ne!(
            transition.incidents[0].summary.incident_id,
            "host-resource-incident-1"
        );
    }

    #[test]
    fn unavailable_temperature_resets_active_and_pending_lifecycles() {
        let hot = || {
            vec![super::super::TemperatureMetrics {
                label: "package".into(),
                celsius: 60.1,
                source: "thermal_zone0".into(),
            }]
        };
        let mut state = ResourceAlertEngineState::healthy(0);
        state =
            ResourceAlertEngineState::advance(&state, &resource_sample(0, hot(), Vec::new()), 50)
                .next;
        state = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(300_000, hot(), Vec::new()),
            50,
        )
        .next;

        let transition = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(300_001, Vec::new(), Vec::new()),
            50,
        );
        assert_eq!(transition.incidents.len(), 1);
        assert!(transition.incidents[0].resolved_at.is_some());
        state = transition.next;

        state = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(300_002, hot(), Vec::new()),
            50,
        )
        .next;
        let transition = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(600_001, hot(), Vec::new()),
            50,
        );
        assert!(transition.incidents.is_empty());
        assert!(transition.active.is_empty());
        state = ResourceAlertEngineState::advance(
            &transition.next,
            &resource_sample(600_002, hot(), Vec::new()),
            50,
        )
        .next;

        let transition = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(
                600_003,
                vec![super::super::TemperatureMetrics {
                    label: "package".into(),
                    celsius: f64::NAN,
                    source: "thermal_zone0".into(),
                }],
                Vec::new(),
            ),
            50,
        );
        assert_eq!(transition.incidents.len(), 1);
        assert!(transition.incidents[0].resolved_at.is_some());
        assert!(transition.active.is_empty());
    }

    #[test]
    fn disk_targets_are_independent_and_virtual_filesystems_do_not_alert() {
        let mut state = ResourceAlertEngineState::healthy(0);
        let transition = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(
                0,
                Vec::new(),
                vec![
                    persistent_disk("/data", "ext4", 95.0),
                    persistent_disk("/backup", "xfs", 96.0),
                    persistent_disk("/container", "overlay", 99.0),
                    disk(
                        "/loop",
                        "/dev/loop0",
                        super::super::DiskSourceKind::BlockDevice,
                        "ext4",
                        99.0,
                    ),
                ],
            ),
            50,
        );
        assert_eq!(transition.active.len(), 2);
        assert_eq!(transition.incidents.len(), 2);
        assert_eq!(
            transition.active[0].evidence.disk_mount_point.as_deref(),
            Some("/backup")
        );
        assert_eq!(transition.active[0].evidence.disk_usage_percent, Some(96.0));
        state = transition.next;

        let transition = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(1, Vec::new(), vec![persistent_disk("/data", "ext4", 94.9)]),
            50,
        );
        assert!(transition.active.is_empty());
        assert_eq!(transition.incidents.len(), 2);
        assert!(transition
            .incidents
            .iter()
            .all(|incident| incident.resolved_at.is_some()));
    }

    #[test]
    fn target_state_is_capped_and_repeated_samples_are_deduplicated() {
        let mut state = ResourceAlertEngineState::healthy(0);
        let transition = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(
                0,
                Vec::new(),
                vec![
                    persistent_disk("/a", "ext4", 95.0),
                    persistent_disk("/b", "ext4", 95.0),
                ],
            ),
            1,
        );
        assert_eq!(transition.active.len(), 1);
        assert_eq!(transition.incidents.len(), 1);
        state = transition.next;

        let transition = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(1, Vec::new(), vec![persistent_disk("/a", "ext4", 95.0)]),
            1,
        );
        assert!(transition.incidents.is_empty());
        state = transition.next;
        let transition = ResourceAlertEngineState::advance(
            &state,
            &resource_sample(2, Vec::new(), vec![persistent_disk("/b", "ext4", 95.0)]),
            1,
        );
        assert_eq!(transition.incidents.len(), 2);
        assert_eq!(transition.active.len(), 1);
    }
}
