use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use tokio::sync::{Notify, RwLock};
use tokio_util::sync::CancellationToken;

use crate::{
    pty::{BroadcastEventSink, EventSink},
    system::{
        alerts::{
            AlertEngineState, AlertEvidence, AlertIncident, AlertSample, AlertSeverity, AlertState,
            AlertSummary, AlertThresholds, ResourceAlertEngineState, ResourceAlertIncident,
            ResourceAlertSample, ResourceAlertSummary, ResourceAlertTransition,
        },
        config::HostResourceMonitorConfig,
        platform::{
            collect_host_resource_snapshot_with_options, HostResourceSource,
            SystemHostResourceSource,
        },
        Availability, HostMetrics, HostMetricsSampler, HostResourceSnapshotV1,
    },
};

#[derive(Clone, Debug)]
pub struct AggregateSample {
    pub sampled_at: u64,
    pub available_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub psi_some_avg10: Option<f64>,
    pub psi_full_avg10: Option<f64>,
}

pub struct MonitorCache {
    pub latest: HostResourceSnapshotV1,
    pub legacy: HostMetrics,
    pub aggregate: VecDeque<AggregateSample>,
    pub incidents: VecDeque<AlertIncident>,
    pub alert: AlertSummary,
    resource_alerts: Vec<ResourceAlertSummary>,
    resource_incidents: VecDeque<ResourceAlertIncident>,
    engine: AlertEngineState,
    resource_engine: ResourceAlertEngineState,
}

#[derive(Clone)]
pub struct HostResourceMonitor {
    source: Arc<dyn HostResourceSource>,
    workspace_dir: Arc<RwLock<PathBuf>>,
    event_sink: BroadcastEventSink,
    config: Arc<RwLock<HostResourceMonitorConfig>>,
    config_generation: Arc<AtomicU64>,
    config_changed: Arc<Notify>,
    cache: Arc<RwLock<MonitorCache>>,
    cancellation: CancellationToken,
    task: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    legacy_sampler: HostMetricsSampler,
    started_at: std::time::Instant,
}

impl HostResourceMonitor {
    pub fn new(
        source: Arc<dyn HostResourceSource>,
        workspace_dir: Arc<RwLock<PathBuf>>,
        event_sink: BroadcastEventSink,
        config: HostResourceMonitorConfig,
    ) -> Self {
        let config = config.clamped();
        let ring_capacity = config.ring_capacity;
        let max_alert_incidents = config.max_alert_incidents;
        let now = source.now_ms();
        let workspace = workspace_dir
            .try_read()
            .map(|path| path.clone())
            .unwrap_or_else(|_| PathBuf::from("."));
        let legacy_sampler = HostMetricsSampler::new();
        let legacy = legacy_sampler.sample(&workspace);
        let alert = healthy_summary(now);
        let mut latest = HostResourceSnapshotV1::unavailable(now, &workspace);
        latest.alert = Some(alert.clone());
        Self {
            source,
            workspace_dir,
            event_sink,
            config: Arc::new(RwLock::new(config)),
            config_generation: Arc::new(AtomicU64::new(0)),
            config_changed: Arc::new(Notify::new()),
            cache: Arc::new(RwLock::new(MonitorCache {
                latest,
                legacy,
                aggregate: VecDeque::with_capacity(ring_capacity),
                incidents: VecDeque::with_capacity(max_alert_incidents),
                alert,
                resource_alerts: Vec::new(),
                resource_incidents: VecDeque::with_capacity(max_alert_incidents),
                // The engines measure transition durations with elapsed time;
                // wall time is only used in API/audit fields.
                engine: AlertEngineState::healthy(0),
                resource_engine: ResourceAlertEngineState::healthy(0),
            })),
            cancellation: CancellationToken::new(),
            task: Arc::new(Mutex::new(None)),
            legacy_sampler,
            started_at: std::time::Instant::now(),
        }
    }

    pub fn system(
        workspace_dir: Arc<RwLock<PathBuf>>,
        event_sink: BroadcastEventSink,
        config: HostResourceMonitorConfig,
    ) -> Self {
        Self::new(
            Arc::new(SystemHostResourceSource::default()),
            workspace_dir,
            event_sink,
            config,
        )
    }

    pub fn start(&self) {
        let mut task = self
            .task
            .lock()
            .expect("resource monitor task mutex poisoned");
        if task.is_some() {
            return;
        }
        let monitor = self.clone();
        *task = Some(tokio::spawn(async move { monitor.run().await }));
    }

    pub async fn shutdown(&self) {
        self.cancellation.cancel();
        let task = self
            .task
            .lock()
            .expect("resource monitor task mutex poisoned")
            .take();
        if let Some(mut task) = task {
            if tokio::time::timeout(Duration::from_secs(2), &mut task)
                .await
                .is_err()
            {
                tracing::warn!("host resource monitor did not stop within 2 seconds");
                // Do not detach the monitor task if a dependency stalls. A
                // currently executing `spawn_blocking` filesystem read cannot
                // be force-cancelled safely, but it owns no monitor state and
                // cannot publish after this task is aborted.
                task.abort();
                let _ = task.await;
            }
        }
    }

    pub async fn snapshot(&self) -> HostResourceSnapshotV1 {
        let mut snapshot = self.cache.read().await.latest.clone();
        let config = self.config.read().await.clone();
        let maximum_age = config
            .light_sample_seconds
            .saturating_mul(2)
            .saturating_mul(1_000);
        if self.source.now_ms().saturating_sub(snapshot.sampled_at) > maximum_age {
            mark_snapshot_stale(&mut snapshot, self.source.now_ms(), "monitorStale");
        }
        snapshot
    }

    pub async fn legacy_metrics(&self) -> HostMetrics {
        self.cache.read().await.legacy.clone()
    }

    pub async fn alerts(&self, limit: usize) -> Vec<AlertIncident> {
        let cache = self.cache.read().await;
        cache
            .incidents
            .iter()
            .rev()
            .take(limit.min(50))
            .cloned()
            .collect()
    }

    /// Applies server-owned cadence and threshold changes without creating a
    /// second monitor. The current sample remains valid until the next tick.
    pub async fn reconfigure(&self, config: HostResourceMonitorConfig) {
        let config = config.clamped();
        *self.config.write().await = config.clone();
        self.config_generation.fetch_add(1, Ordering::Release);
        let mut cache = self.cache.write().await;
        while cache.aggregate.len() > config.ring_capacity {
            cache.aggregate.pop_front();
        }
        while cache.incidents.len() > config.max_alert_incidents {
            cache.incidents.pop_front();
        }
        trim_resource_alert_retention(&mut cache, config.max_alert_incidents);
        drop(cache);
        self.config_changed.notify_one();
    }

    pub async fn aggregate_len(&self) -> usize {
        self.cache.read().await.aggregate.len()
    }

    async fn run(&self) {
        let mut pending_collection: Option<tokio::task::JoinHandle<HostResourceSnapshotV1>> = None;
        let mut last_process = None;
        let mut last_pss = None;
        let mut next_delay = Duration::ZERO;
        loop {
            tokio::select! {
                _ = self.cancellation.cancelled() => {
                    if let Some(collection) = pending_collection.take() {
                        collection.abort();
                    }
                    break;
                }
                _ = tokio::time::sleep(next_delay) => {}
                _ = self.config_changed.notified() => {
                    next_delay = Duration::ZERO;
                    continue;
                }
            }

            let config = self.config.read().await.clone();

            if let Some(collection) = pending_collection.as_ref() {
                if collection.is_finished() {
                    // The deadline has already published an unavailable sample.
                    // Reap a late worker without allowing it to overwrite newer
                    // monitor state.
                    let _ = pending_collection
                        .take()
                        .expect("finished resource collection is present")
                        .await;
                } else {
                    let workspace = self.workspace_dir.read().await.clone();
                    let legacy = match self.sample_legacy(&workspace).await {
                        Some(legacy) => legacy,
                        None => break,
                    };
                    let sampled_at = self.source.now_ms();
                    let snapshot = self.deadline_snapshot(sampled_at, &workspace).await;
                    self.update(snapshot, legacy, None, elapsed_ms(self.started_at))
                        .await;
                    next_delay = jittered_delay(&config);
                    continue;
                }
            }

            let now = std::time::Instant::now();
            let collect_processes = last_process
                .is_none_or(|at| now.duration_since(at).as_secs() >= config.process_sample_seconds);
            let collect_pss = last_pss
                .is_none_or(|at| now.duration_since(at).as_secs() >= config.pss_sample_seconds);
            if collect_processes {
                last_process = Some(now);
            }
            if collect_pss {
                last_pss = Some(now);
            }
            let workspace = self.workspace_dir.read().await.clone();
            let source = Arc::clone(&self.source);
            let sample_workspace = workspace.clone();
            let sampled_at = source.now_ms();
            let deadline = Duration::from_millis(config.snapshot_deadline_millis);
            let process_deadline_millis = config.process_deadline_millis;
            let mut collection = tokio::task::spawn_blocking(move || {
                collect_host_resource_snapshot_with_options(
                    source.as_ref(),
                    &sample_workspace,
                    collect_processes,
                    collect_pss,
                    process_deadline_millis,
                )
            });
            let collection_result = tokio::select! {
                _ = self.cancellation.cancelled() => {
                    collection.abort();
                    break;
                }
                result = &mut collection => Some(result),
                _ = tokio::time::sleep(deadline) => None,
            };
            let (snapshot, observed_at_ms) = match collection_result {
                Some(Ok(snapshot)) => (snapshot, Some(elapsed_ms(self.started_at))),
                Some(Err(error)) => {
                    tracing::warn!(%error, "host resource collection task failed");
                    (self.deadline_snapshot(sampled_at, &workspace).await, None)
                }
                None => {
                    pending_collection = Some(collection);
                    (self.deadline_snapshot(sampled_at, &workspace).await, None)
                }
            };
            let Some(legacy) = self.sample_legacy(&workspace).await else {
                break;
            };
            self.update(
                snapshot,
                legacy,
                observed_at_ms,
                elapsed_ms(self.started_at),
            )
            .await;
            next_delay = jittered_delay(&config);
        }
    }

    async fn update(
        &self,
        mut snapshot: HostResourceSnapshotV1,
        legacy: HostMetrics,
        observed_at_ms: Option<u64>,
        legacy_observed_at_ms: u64,
    ) {
        // Pair the config with a generation, then verify it after taking the
        // cache lock. This prevents an in-flight collection from publishing
        // once with superseded capacities or thresholds after reconfiguration.
        let (config, mut cache) = loop {
            let config = self.config.read().await.clone();
            let generation = self.config_generation.load(Ordering::Acquire);
            let cache = self.cache.write().await;
            if generation == self.config_generation.load(Ordering::Acquire) {
                break (config, cache);
            }
            drop(cache);
        };
        if snapshot.processes.availability.detail_code.as_deref() == Some("processCadenceSkipped") {
            snapshot.processes = cache.latest.processes.clone();
            snapshot.processes.availability =
                Availability::stale(snapshot.sampled_at, "processCadenceSkipped");
            for process in &mut snapshot.processes.processes {
                process.availability =
                    Availability::stale(snapshot.sampled_at, "processCadenceSkipped");
            }
        } else if !snapshot.processes.processes.is_empty() {
            for process in &mut snapshot.processes.processes {
                if process.pss_bytes.is_none() {
                    process.pss_bytes = cache
                        .latest
                        .processes
                        .processes
                        .iter()
                        .find(|old| {
                            old.pid == process.pid && old.start_ticks == process.start_ticks
                        })
                        .and_then(|old| old.pss_bytes);
                }
            }
        }
        let transition = observed_at_ms.map(|observed_at_ms| {
            let sample = AlertSample::from_snapshot_with_monotonic(&snapshot, observed_at_ms);
            let thresholds = AlertThresholds::from_config(&config);
            let transition =
                AlertEngineState::advance_with_thresholds(&cache.engine, &sample, &thresholds);
            (sample, transition)
        });
        // Legacy collection succeeds independently of deep-snapshot deadlines,
        // so resource lifecycle time advances on every successful legacy sample.
        let resource_sample = ResourceAlertSample::from_legacy(&legacy, legacy_observed_at_ms);
        let resource_transition = ResourceAlertEngineState::advance(
            &cache.resource_engine,
            &resource_sample,
            config.max_alert_incidents,
        );
        update_resource_alerts(&mut cache, resource_transition, config.max_alert_incidents);
        if let Some((sample, transition)) = transition {
            cache.engine = transition.next;
            snapshot.alert = Some(transition.summary.clone());
            cache.latest = snapshot.clone();
            cache.legacy = legacy;
            cache.aggregate.push_back(AggregateSample {
                sampled_at: snapshot.sampled_at,
                available_bytes: snapshot.memory.available_bytes,
                total_bytes: snapshot.memory.total_bytes,
                psi_some_avg10: sample.psi_some_avg10,
                psi_full_avg10: sample.psi_full_avg10,
            });
            while cache.aggregate.len() > config.ring_capacity {
                cache.aggregate.pop_front();
            }
            if let Some(incident) = transition.incident {
                update_incident(&mut cache.incidents, incident);
            }
            while cache.incidents.len() > config.max_alert_incidents {
                cache.incidents.pop_front();
            }
            cache.alert = transition.summary.clone();
            // Resource alerts stay internal until Phase 02 defines their
            // additive event payload. Preserve the existing memory event.
            let should_emit = transition.change.is_some();
            drop(cache);
            if should_emit {
                self.event_sink.send_host_alert_changed(&transition.summary);
            }
            return;
        }
        snapshot.alert = Some(cache.alert.clone());
        cache.latest = snapshot;
        cache.legacy = legacy;
        while cache.incidents.len() > config.max_alert_incidents {
            cache.incidents.pop_front();
        }
    }

    async fn sample_legacy(&self, workspace: &std::path::Path) -> Option<HostMetrics> {
        let sampler = self.legacy_sampler.clone();
        let workspace = workspace.to_path_buf();
        let mut task = tokio::task::spawn_blocking(move || sampler.sample(&workspace));
        tokio::select! {
            _ = self.cancellation.cancelled() => {
                task.abort();
                None
            }
            result = &mut task => match result {
                Ok(metrics) => Some(metrics),
                Err(error) => {
                    tracing::warn!(%error, "legacy host metrics collection task failed");
                    None
                }
            },
        }
    }

    async fn deadline_snapshot(
        &self,
        sampled_at: u64,
        workspace: &std::path::Path,
    ) -> HostResourceSnapshotV1 {
        let cache = self.cache.read().await;
        let mut snapshot = cache.latest.clone();
        if snapshot.sampled_at == 0 {
            return HostResourceSnapshotV1::unavailable(sampled_at, workspace);
        }

        snapshot.sample_id = uuid::Uuid::new_v4().to_string();
        snapshot.sampled_at = sampled_at;
        mark_snapshot_stale(&mut snapshot, sampled_at, "snapshotDeadlineExceeded");
        snapshot.processes =
            crate::system::ProcessInventory::unavailable(sampled_at, "snapshotDeadlineExceeded");
        snapshot.alert = Some(cache.alert.clone());
        snapshot
    }
}

fn elapsed_ms(started_at: std::time::Instant) -> u64 {
    started_at
        .elapsed()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn jittered_delay(config: &HostResourceMonitorConfig) -> Duration {
    let jitter =
        u64::try_from(uuid::Uuid::new_v4().as_u128() % u128::from(config.jitter_millis + 1))
            .unwrap_or(config.jitter_millis);
    Duration::from_secs(config.light_sample_seconds) + Duration::from_millis(jitter)
}

fn mark_snapshot_stale(snapshot: &mut HostResourceSnapshotV1, sampled_at: u64, detail_code: &str) {
    snapshot.memory.availability = Availability::stale(sampled_at, detail_code);
    snapshot.pressure.memory.availability = Availability::stale(sampled_at, detail_code);
    snapshot.capabilities.linux_deep_metrics = Availability::stale(sampled_at, detail_code);
    snapshot.mount_context.availability = Availability::stale(sampled_at, detail_code);
    snapshot.mount_context.active_mapped_paths_availability =
        Availability::stale(sampled_at, detail_code);
    snapshot.action_capabilities.availability = Availability::stale(sampled_at, detail_code);
    snapshot.processes.availability = Availability::stale(sampled_at, detail_code);
    for process in &mut snapshot.processes.processes {
        process.availability = Availability::stale(sampled_at, detail_code);
    }
    for cgroup in &mut snapshot.cgroups {
        cgroup.availability = Availability::stale(sampled_at, detail_code);
        cgroup.pressure.availability = Availability::stale(sampled_at, detail_code);
    }
}

fn update_incident(incidents: &mut VecDeque<AlertIncident>, updated: AlertIncident) {
    if let Some(existing) = incidents
        .iter_mut()
        .find(|item| item.incident_id == updated.incident_id)
    {
        *existing = updated;
    } else {
        incidents.push_back(updated);
    }
}

fn update_resource_alerts(
    cache: &mut MonitorCache,
    transition: ResourceAlertTransition,
    maximum_history: usize,
) {
    cache.resource_engine = transition.next;
    cache.resource_alerts = transition.active;
    for incident in transition.incidents {
        if let Some(existing) = cache
            .resource_incidents
            .iter_mut()
            .find(|item| item.summary.incident_id == incident.summary.incident_id)
        {
            *existing = incident;
        } else {
            cache.resource_incidents.push_back(incident);
        }
    }
    trim_resource_alert_retention(cache, maximum_history);
}

fn trim_resource_alert_retention(cache: &mut MonitorCache, maximum_history: usize) {
    cache.resource_engine.retain_targets(maximum_history);
    cache.resource_alerts.truncate(maximum_history);
    while cache.resource_incidents.len() > maximum_history {
        cache.resource_incidents.pop_front();
    }
}

fn healthy_summary(now: u64) -> AlertSummary {
    AlertSummary {
        state: AlertState::Healthy,
        severity: AlertSeverity::Info,
        incident_id: None,
        opened_at: None,
        updated_at: now,
        duration_seconds: 0,
        scope: "host".into(),
        confidence: crate::system::Confidence::Low,
        threshold: "none".into(),
        evidence: AlertEvidence {
            available_percent: None,
            reclaimable_percent: None,
            psi_some_avg10: None,
            psi_full_avg10: None,
            cgroup_oom_delta: false,
        },
        next_action: "No action required".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn keeps_bounded_aggregate_history() {
        let root = Arc::new(RwLock::new(PathBuf::from("/tmp")));
        let (sink, _) = BroadcastEventSink::new(8);
        let monitor = HostResourceMonitor::system(
            root,
            sink,
            HostResourceMonitorConfig {
                ring_capacity: 12,
                ..Default::default()
            },
        );
        assert_eq!(monitor.aggregate_len().await, 0);
    }

    #[tokio::test]
    async fn starts_once_and_owns_its_shutdown_handle() {
        let root = Arc::new(RwLock::new(PathBuf::from("/tmp")));
        let (sink, _) = BroadcastEventSink::new(8);
        let monitor = HostResourceMonitor::system(root, sink, Default::default());

        monitor.start();
        monitor.start();
        assert!(monitor.task.lock().unwrap().is_some());
        monitor.shutdown().await;
        assert!(monitor.task.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn reconfiguration_keeps_one_monitor_and_clamps_runtime_values() {
        let root = Arc::new(RwLock::new(PathBuf::from("/tmp")));
        let (sink, _) = BroadcastEventSink::new(8);
        let monitor = HostResourceMonitor::system(root, sink, Default::default());

        monitor
            .reconfigure(HostResourceMonitorConfig {
                light_sample_seconds: 0,
                max_alert_incidents: 999,
                ..Default::default()
            })
            .await;

        let config = monitor.config.read().await;
        assert_eq!(config.light_sample_seconds, 1);
        assert_eq!(config.max_alert_incidents, 50);
        assert!(monitor.task.lock().unwrap().is_none());
    }

    #[tokio::test]
    async fn reconfiguration_immediately_trims_private_resource_alert_retention() {
        let root = Arc::new(RwLock::new(PathBuf::from("/tmp")));
        let (sink, _) = BroadcastEventSink::new(8);
        let monitor = HostResourceMonitor::system(root, sink, Default::default());
        let mut legacy = monitor.legacy_metrics().await;
        legacy.temperatures.clear();
        legacy.disks = ["/a", "/b"]
            .into_iter()
            .map(|mount_point| crate::system::DiskMetrics {
                name: "disk".into(),
                mount_point: mount_point.into(),
                total_bytes: 100,
                available_bytes: 5,
                used_bytes: 95,
                usage_percent: 95.0,
                file_system: Some("ext4".into()),
                source: Some(format!("/dev{}", mount_point)),
                source_kind: crate::system::DiskSourceKind::BlockDevice,
            })
            .collect();
        legacy.sampled_at = 1;
        monitor
            .update(
                HostResourceSnapshotV1::unavailable(1, PathBuf::from("/tmp").as_path()),
                legacy.clone(),
                None,
                0,
            )
            .await;
        {
            let cache = monitor.cache.read().await;
            assert_eq!(cache.resource_alerts.len(), 2);
            assert_eq!(cache.resource_incidents.len(), 2);
        }

        monitor
            .reconfigure(HostResourceMonitorConfig {
                max_alert_incidents: 1,
                ..Default::default()
            })
            .await;
        {
            let cache = monitor.cache.read().await;
            assert_eq!(cache.resource_alerts.len(), 1);
            assert_eq!(cache.resource_incidents.len(), 1);
            assert_eq!(cache.resource_alerts[0].scope, "disk:/a");
            assert_eq!(cache.resource_incidents[0].summary.scope, "disk:/b");
        }

        legacy.sampled_at = 2;
        monitor
            .update(
                HostResourceSnapshotV1::unavailable(2, PathBuf::from("/tmp").as_path()),
                legacy,
                None,
                1,
            )
            .await;
        let cache = monitor.cache.read().await;
        assert_eq!(cache.resource_alerts.len(), 1);
        assert_eq!(cache.resource_incidents.len(), 1);
        assert_eq!(cache.resource_alerts[0].scope, "disk:/a");
    }

    #[tokio::test]
    async fn monitor_uses_elapsed_time_for_sustained_alerts() {
        let root = Arc::new(RwLock::new(PathBuf::from("/tmp")));
        let (sink, _) = BroadcastEventSink::new(8);
        let monitor = HostResourceMonitor::system(root, sink, Default::default());
        let mut cache = monitor.cache.write().await;
        let first = AlertSample {
            observed_at_ms: 0,
            reported_at_ms: u64::MAX - 1,
            available_percent: Some(8.0),
            reclaimable_percent: Some(0.0),
            psi_some_avg10: Some(0.0),
            psi_full_avg10: Some(0.0),
            primary_memory_available: true,
            primary_psi_available: true,
            oom_events_total: Some(0),
        };
        cache.engine = AlertEngineState::advance(&cache.engine, &first).next;
        let later = AlertSample {
            observed_at_ms: 30_000,
            reported_at_ms: u64::MAX,
            ..first
        };
        cache.engine = AlertEngineState::advance(&cache.engine, &later).next;
        assert_eq!(cache.engine.current, AlertState::MemoryPressure);
    }

    #[tokio::test]
    async fn deadline_snapshot_preserves_prior_light_evidence_without_alert_transition() {
        let root = Arc::new(RwLock::new(PathBuf::from("/tmp")));
        let (sink, _) = BroadcastEventSink::new(8);
        let monitor = HostResourceMonitor::system(root, sink, Default::default());
        let mut prior = HostResourceSnapshotV1::unavailable(1, PathBuf::from("/tmp").as_path());
        prior.memory.total_bytes = Some(100);
        prior.memory.available_bytes = Some(50);
        prior.memory.availability = Availability::available(1);
        prior.alert = Some(healthy_summary(1));
        monitor.cache.write().await.latest = prior;

        let snapshot = monitor
            .deadline_snapshot(2, PathBuf::from("/tmp").as_path())
            .await;
        assert_eq!(snapshot.memory.available_bytes, Some(50));
        assert_eq!(
            snapshot.memory.availability.state,
            crate::system::AvailabilityState::Stale
        );
        assert_eq!(
            snapshot.processes.availability.detail_code.as_deref(),
            Some("snapshotDeadlineExceeded")
        );
    }

    #[tokio::test]
    async fn deadline_updates_advance_resource_lifecycle_without_emitting_memory_events() {
        let root = Arc::new(RwLock::new(PathBuf::from("/tmp")));
        let (sink, _) = BroadcastEventSink::new(8);
        let mut host_alerts = sink.subscribe_host_alerts();
        let monitor = HostResourceMonitor::system(root, sink, Default::default());
        let mut legacy = monitor.legacy_metrics().await;
        legacy.disks.clear();
        legacy.temperatures = vec![crate::system::TemperatureMetrics {
            label: "package".into(),
            celsius: 60.1,
            source: "thermal_zone0".into(),
        }];

        legacy.sampled_at = 1;
        monitor
            .update(
                HostResourceSnapshotV1::unavailable(1, PathBuf::from("/tmp").as_path()),
                legacy.clone(),
                None,
                0,
            )
            .await;
        legacy.sampled_at = 2;
        monitor
            .update(
                HostResourceSnapshotV1::unavailable(2, PathBuf::from("/tmp").as_path()),
                legacy,
                None,
                300_000,
            )
            .await;

        let cache = monitor.cache.read().await;
        assert_eq!(cache.resource_alerts.len(), 1);
        assert_eq!(
            cache.resource_alerts[0].state,
            crate::system::alerts::ResourceAlertState::TemperatureHigh
        );
        assert_eq!(
            cache.resource_alerts[0]
                .evidence
                .temperature_source
                .as_deref(),
            Some("thermal_zone0")
        );
        assert_eq!(cache.resource_incidents.len(), 1);
        drop(cache);
        assert!(monitor.alerts(50).await.is_empty());
        assert!(host_alerts.try_recv().is_err());
    }

    #[tokio::test]
    async fn resource_lifecycle_keeps_memory_alert_event_bytes_unchanged() {
        let (sink, _) = BroadcastEventSink::new(1);
        let mut receiver = sink.subscribe_host_alerts();
        sink.send_host_alert_changed(&AlertSummary {
            state: AlertState::MemoryPressure,
            severity: AlertSeverity::Critical,
            incident_id: Some("host-incident-1".into()),
            opened_at: Some(1),
            updated_at: 2,
            duration_seconds: 1,
            scope: "host".into(),
            confidence: crate::system::Confidence::High,
            threshold: "available<10%".into(),
            evidence: AlertEvidence {
                available_percent: Some(8.0),
                reclaimable_percent: None,
                psi_some_avg10: Some(12.0),
                psi_full_avg10: None,
                cgroup_oom_delta: false,
            },
            next_action: "Inspect top consumers".into(),
        });

        assert_eq!(
            receiver.recv().await.unwrap(),
            r#"{"kind":"host:alertChanged","payload":{"state":"memoryPressure","severity":"critical","incidentId":"host-incident-1","openedAt":1,"updatedAt":2,"durationSeconds":1,"scope":"host","confidence":"high","threshold":"available<10%","evidence":{"availablePercent":8.0,"reclaimablePercent":null,"psiSomeAvg10":12.0,"psiFullAvg10":null,"cgroupOomDelta":false},"nextAction":"Inspect top consumers"}}"#
        );
    }

    #[tokio::test]
    async fn cache_age_marks_all_retained_evidence_stale() {
        let root = Arc::new(RwLock::new(PathBuf::from("/tmp")));
        let (sink, _) = BroadcastEventSink::new(8);
        let monitor = HostResourceMonitor::system(root, sink, Default::default());
        let mut snapshot = HostResourceSnapshotV1::unavailable(1, PathBuf::from("/tmp").as_path());
        snapshot.processes.availability = Availability::available(1);
        snapshot.cgroups.push(crate::system::CgroupMemory {
            path: "test".into(),
            namespace: "host".into(),
            current_bytes: None,
            max_bytes: None,
            max_unlimited: false,
            high_bytes: None,
            high_unlimited: false,
            file_cache_bytes: None,
            events: Vec::new(),
            pressure: crate::system::MemoryPressure::unsupported(1),
            availability: Availability::available(1),
        });

        mark_snapshot_stale(&mut snapshot, 2, "monitorStale");
        assert_eq!(
            snapshot.processes.availability.state,
            crate::system::AvailabilityState::Stale
        );
        assert_eq!(
            snapshot.cgroups[0].availability.state,
            crate::system::AvailabilityState::Stale
        );
        assert_eq!(
            snapshot.cgroups[0].pressure.availability.state,
            crate::system::AvailabilityState::Stale
        );
        drop(monitor);
    }
}
