use std::{
    io::Write,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use axum::body::Bytes;
use serde::Serialize;
use tokio::sync::{watch, Notify};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[cfg(test)]
use std::sync::atomic::AtomicU64;

use crate::system::{
    monitor::{
        freshness_ttl_ms, CachedHostResourcePair, HostResourceMonitor, StreamStatusBasis,
    },
    HostMetrics, HostResourceSnapshotV1,
};

pub const MAX_DATA_FRAME_BYTES: usize = 262_144; // 256 KiB
pub const MAX_CONTROL_FRAME_BYTES: usize = 4_096; // 4 KiB

#[derive(Clone, Debug)]
pub struct PublishedFrame {
    pub bytes: Bytes,
    pub server_epoch: Uuid,
    pub revision: u64,
    pub snapshot_observed_at: Option<Instant>,
    pub metrics_observed_at: Option<Instant>,
    pub light_sample_ms: u64,
    pub freshness_ttl_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("frame exceeds limit of {limit} bytes (actual {frame_bytes} bytes) for epoch {server_epoch}, revision {revision}")]
pub struct FrameTooLarge {
    pub server_epoch: Uuid,
    pub revision: u64,
    pub frame_bytes: usize,
    pub limit: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum ControlFrameError {
    #[error("control frame exceeds 4096 byte limit")]
    FrameTooLarge,
    #[error("failed to serialize control event payload: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("io error while encoding control frame: {0}")]
    Io(#[from] std::io::Error),
}

/// A writer that fails immediately if extending the buffer would exceed `limit`.
struct BoundedWriter {
    buf: Vec<u8>,
    limit: usize,
}

impl BoundedWriter {
    fn new(limit: usize) -> Self {
        Self {
            buf: Vec::with_capacity(limit.min(16_384)),
            limit,
        }
    }

    fn into_inner(self) -> Vec<u8> {
        self.buf
    }
}

impl Write for BoundedWriter {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        if self.buf.len().saturating_add(data.len()) > self.limit {
            return Err(std::io::Error::other("frame size limit exceeded"));
        }
        self.buf.extend_from_slice(data);
        Ok(data.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WireHostResourceDataPayload<'a> {
    schema_version: u32,
    server_epoch: Uuid,
    revision: String,
    snapshot: &'a HostResourceSnapshotV1,
    metrics: &'a HostMetrics,
    light_sample_ms: u64,
}

/// Encodes a complete framed SSE data event: `event: host-resources\ndata: {..}\n\n`.
/// Rejects before exceeding 256 KiB without writing partial or truncated JSON.
pub fn encode_data_frame(pair: &CachedHostResourcePair) -> Result<PublishedFrame, FrameTooLarge> {
    let prefix = b"event: host-resources\ndata: ";
    let suffix = b"\n\n";
    let json_limit = MAX_DATA_FRAME_BYTES.saturating_sub(suffix.len());

    let mut writer = BoundedWriter::new(json_limit);
    if writer.write_all(prefix).is_err() {
        return Err(FrameTooLarge {
            server_epoch: pair.server_epoch,
            revision: pair.revision,
            frame_bytes: MAX_DATA_FRAME_BYTES + 1,
            limit: MAX_DATA_FRAME_BYTES,
        });
    }

    let payload = WireHostResourceDataPayload {
        schema_version: 1,
        server_epoch: pair.server_epoch,
        revision: pair.revision.to_string(),
        snapshot: &pair.snapshot,
        metrics: &pair.metrics,
        light_sample_ms: pair.light_sample_ms,
    };

    if serde_json::to_writer(&mut writer, &payload).is_err() {
        return Err(FrameTooLarge {
            server_epoch: pair.server_epoch,
            revision: pair.revision,
            frame_bytes: MAX_DATA_FRAME_BYTES + 1,
            limit: MAX_DATA_FRAME_BYTES,
        });
    }

    let mut buf = writer.into_inner();
    buf.extend_from_slice(suffix);
    if buf.len() > MAX_DATA_FRAME_BYTES {
        return Err(FrameTooLarge {
            server_epoch: pair.server_epoch,
            revision: pair.revision,
            frame_bytes: buf.len(),
            limit: MAX_DATA_FRAME_BYTES,
        });
    }

    let freshness_ttl_ms = freshness_ttl_ms(
        pair.light_sample_ms,
        pair.snapshot_deadline_ms,
        pair.jitter_ms,
    );

    Ok(PublishedFrame {
        bytes: Bytes::from(buf),
        server_epoch: pair.server_epoch,
        revision: pair.revision,
        snapshot_observed_at: pair.snapshot_observed_at,
        metrics_observed_at: pair.metrics_observed_at,
        light_sample_ms: pair.light_sample_ms,
        freshness_ttl_ms,
    })
}

pub fn encode_control_event<T: Serialize>(
    name: &'static str,
    payload: &T,
) -> Result<Bytes, ControlFrameError> {
    let suffix = b"\n\n";
    let json_limit = MAX_CONTROL_FRAME_BYTES.saturating_sub(suffix.len());

    let mut writer = BoundedWriter::new(json_limit);
    if writer.write_all(b"event: ").is_err()
        || writer.write_all(name.as_bytes()).is_err()
        || writer.write_all(b"\ndata: ").is_err()
    {
        return Err(ControlFrameError::FrameTooLarge);
    }
    if serde_json::to_writer(&mut writer, payload).is_err() {
        return Err(ControlFrameError::FrameTooLarge);
    }

    let mut buf = writer.into_inner();
    buf.extend_from_slice(suffix);
    if buf.len() > MAX_CONTROL_FRAME_BYTES {
        return Err(ControlFrameError::FrameTooLarge);
    }

    Ok(Bytes::from(buf))
}

#[derive(Clone, Debug, Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostResourceStatusPayload {
    pub server_epoch: Uuid,
    pub revision: String,
    pub snapshot_age_ms: Option<u64>,
    pub metrics_age_ms: Option<u64>,
    pub freshness_ttl_ms: u64,
}

#[derive(Clone, Debug, Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostResourceErrorPayload {
    pub code: String,
    pub error: String,
}

pub fn encode_status_control(
    basis: &StreamStatusBasis,
    now: Instant,
) -> Result<Bytes, ControlFrameError> {
    let snapshot_age_ms = basis
        .snapshot_observed_at
        .map(|at| now.saturating_duration_since(at).as_millis() as u64);
    let metrics_age_ms = basis
        .metrics_observed_at
        .map(|at| now.saturating_duration_since(at).as_millis() as u64);

    let payload = HostResourceStatusPayload {
        server_epoch: basis.server_epoch,
        revision: basis.revision.to_string(),
        snapshot_age_ms,
        metrics_age_ms,
        freshness_ttl_ms: basis.freshness_ttl_ms(),
    };
    encode_control_event("host-resources-status", &payload)
}

pub fn encode_status_control_for_frame(
    frame: &PublishedFrame,
    now: Instant,
) -> Result<Bytes, ControlFrameError> {
    let snapshot_age_ms = frame
        .snapshot_observed_at
        .map(|at| now.saturating_duration_since(at).as_millis() as u64);
    let metrics_age_ms = frame
        .metrics_observed_at
        .map(|at| now.saturating_duration_since(at).as_millis() as u64);

    let payload = HostResourceStatusPayload {
        server_epoch: frame.server_epoch,
        revision: frame.revision.to_string(),
        snapshot_age_ms,
        metrics_age_ms,
        freshness_ttl_ms: frame.freshness_ttl_ms,
    };
    encode_control_event("host-resources-status", &payload)
}

pub fn encode_error_control(
    code: impl Into<String>,
    error: impl Into<String>,
) -> Result<Bytes, ControlFrameError> {
    let payload = HostResourceErrorPayload {
        code: code.into(),
        error: error.into(),
    };
    encode_control_event("host-resources-error", &payload)
}

#[cfg(test)]
#[derive(Default)]
pub(crate) struct PublisherTestCounters {
    pub encode_count: AtomicU64,
    pub reuse_count: AtomicU64,
    pub invalidation_count: AtomicU64,
    pub oversize_count: AtomicU64,
}

struct PublisherInner {
    monitor: HostResourceMonitor,
    interest_count: AtomicUsize,
    wake_notify: Notify,
    cancellation: CancellationToken,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    watch_tx: watch::Sender<Option<Result<Arc<PublishedFrame>, FrameTooLarge>>>,
    _watch_rx: watch::Receiver<Option<Result<Arc<PublishedFrame>, FrameTooLarge>>>,
    #[cfg(test)]
    test_counters: PublisherTestCounters,
}

#[derive(Clone)]
pub struct HostResourcePublisher {
    inner: Arc<PublisherInner>,
}

impl HostResourcePublisher {
    pub fn new(monitor: HostResourceMonitor) -> Self {
        let (watch_tx, watch_rx) = watch::channel(None);
        Self {
            inner: Arc::new(PublisherInner {
                monitor,
                interest_count: AtomicUsize::new(0),
                wake_notify: Notify::new(),
                cancellation: CancellationToken::new(),
                task: Mutex::new(None),
                watch_tx,
                _watch_rx: watch_rx,
                #[cfg(test)]
                test_counters: PublisherTestCounters::default(),
            }),
        }
    }

    pub fn start(&self) {
        let mut task = self
            .inner
            .task
            .lock()
            .expect("publisher task mutex poisoned");
        if task.is_some() {
            return;
        }
        let inner = Arc::clone(&self.inner);
        *task = Some(tokio::spawn(async move {
            run_publisher(inner).await;
        }));
    }

    pub async fn shutdown(&self) {
        self.inner.cancellation.cancel();
        self.inner.wake_notify.notify_waiters();
        let task = self
            .inner
            .task
            .lock()
            .expect("publisher task mutex poisoned")
            .take();
        if let Some(mut task) = task {
            if tokio::time::timeout(Duration::from_secs(2), &mut task)
                .await
                .is_err()
            {
                tracing::warn!("host resource publisher task did not stop within 2 seconds");
                task.abort();
                let _ = task.await;
            }
        }
    }

    pub fn subscribe(&self) -> StreamSubscription {
        self.inner.interest_count.fetch_add(1, Ordering::Release);
        self.inner.wake_notify.notify_one();
        StreamSubscription {
            _guard: SubscriptionGuard {
                inner: Arc::clone(&self.inner),
            },
            watch_rx: self.inner.watch_tx.subscribe(),
            last_revision: None,
        }
    }

    pub async fn current_status_basis(&self) -> StreamStatusBasis {
        self.inner.monitor.current_status_basis().await
    }

    #[cfg(test)]
    pub(crate) fn test_counters(&self) -> &PublisherTestCounters {
        &self.inner.test_counters
    }
}

struct SubscriptionGuard {
    inner: Arc<PublisherInner>,
}

impl Drop for SubscriptionGuard {
    fn drop(&mut self) {
        self.inner.interest_count.fetch_sub(1, Ordering::Release);
        self.inner.wake_notify.notify_one();
    }
}

pub struct StreamSubscription {
    _guard: SubscriptionGuard,
    watch_rx: watch::Receiver<Option<Result<Arc<PublishedFrame>, FrameTooLarge>>>,
    last_revision: Option<(Uuid, u64)>,
}

impl StreamSubscription {
    pub async fn latest(&mut self) -> Result<Arc<PublishedFrame>, FrameTooLarge> {
        loop {
            {
                let borrowed = self.watch_rx.borrow_and_update();
                if let Some(res) = &*borrowed {
                    let frame_res = res.clone();
                    match &frame_res {
                        Ok(frame) => {
                            self.last_revision = Some((frame.server_epoch, frame.revision));
                        }
                        Err(err) => {
                            self.last_revision = Some((err.server_epoch, err.revision));
                        }
                    }
                    return frame_res;
                }
            }
            if self.watch_rx.changed().await.is_err() {
                futures_util::future::pending::<()>().await;
            }
        }
    }

    pub async fn changed(&mut self) -> Result<Arc<PublishedFrame>, FrameTooLarge> {
        loop {
            if self.watch_rx.changed().await.is_err() {
                futures_util::future::pending::<()>().await;
            }
            let borrowed = self.watch_rx.borrow_and_update();
            if let Some(res) = &*borrowed {
                let key = match res {
                    Ok(frame) => (frame.server_epoch, frame.revision),
                    Err(err) => (err.server_epoch, err.revision),
                };
                if self.last_revision == Some(key) {
                    continue;
                }
                self.last_revision = Some(key);
                return res.clone();
            }
        }
    }
}

async fn run_publisher(inner: Arc<PublisherInner>) {
    let mut monitor_rx = inner.monitor.subscribe_stream_changes();
    #[cfg(test)]
    let mut retained_frame: Option<Result<Arc<PublishedFrame>, FrameTooLarge>> = None;
    let mut last_encoded: Option<(Uuid, u64)> = None;
    loop {
        let interest = inner.interest_count.load(Ordering::Acquire);
        if interest > 0 {
            let pair = inner.monitor.read_stream_pair().await;
            let pair_key = (pair.server_epoch, pair.revision);
            let is_new = last_encoded != Some(pair_key);
            if is_new {
                #[cfg(test)]
                if retained_frame.is_some() {
                    inner
                        .test_counters
                        .invalidation_count
                        .fetch_add(1, Ordering::Relaxed);
                }

                #[cfg(test)]
                inner.test_counters.encode_count.fetch_add(1, Ordering::Relaxed);

                let frame_res = encode_data_frame(&pair).map(Arc::new);
                #[cfg(test)]
                if frame_res.is_err() {
                    inner
                        .test_counters
                        .oversize_count
                        .fetch_add(1, Ordering::Relaxed);
                }

                last_encoded = Some(pair_key);
                #[cfg(test)]
                {
                    retained_frame = Some(frame_res.clone());
                }
                let _ = inner.watch_tx.send_replace(Some(frame_res));
            } else {
                #[cfg(test)]
                inner.test_counters.reuse_count.fetch_add(1, Ordering::Relaxed);
            }
        } else {
            let basis = inner.monitor.current_status_basis().await;
            if last_encoded != Some((basis.server_epoch, basis.revision)) {
                let _ = inner.watch_tx.send_replace(None);
            }
        }

        tokio::select! {
            _ = inner.cancellation.cancelled() => {
                break;
            }
            _ = inner.wake_notify.notified() => {}
            res = monitor_rx.changed() => {
                if res.is_err() {
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::{path::PathBuf, sync::Arc};
    use tokio::sync::RwLock;

    use super::*;
    use crate::{
        pty::BroadcastEventSink,
        system::{
            config::HostResourceMonitorConfig,
            monitor::HostResourceMonitor,
            Availability, HostResourceSnapshotV1,
        },
    };

    fn make_test_monitor() -> HostResourceMonitor {
        let root = Arc::new(RwLock::new(PathBuf::from("/tmp")));
        let (sink, _) = BroadcastEventSink::new(8);
        HostResourceMonitor::system(root, sink, HostResourceMonitorConfig::default())
    }

    #[test]
    fn test_control_frame_encoding_and_size_limit() {
        let now = Instant::now();
        let basis = StreamStatusBasis {
            server_epoch: Uuid::new_v4(),
            revision: 42,
            snapshot_observed_at: Some(now),
            metrics_observed_at: Some(now),
            light_sample_ms: 5000,
            snapshot_deadline_ms: 500,
            jitter_ms: 250,
        };

        let status_bytes = encode_status_control(&basis, now).expect("status encode success");
        let status_str = std::str::from_utf8(&status_bytes).expect("valid utf-8");
        assert!(status_str.starts_with("event: host-resources-status\ndata: {"));
        assert!(status_str.ends_with("\n\n"));
        assert!(status_bytes.len() <= MAX_CONTROL_FRAME_BYTES);

        let error_bytes = encode_error_control("MFA_REQUIRED", "Step-up required")
            .expect("error encode success");
        let error_str = std::str::from_utf8(&error_bytes).expect("valid utf-8");
        assert!(error_str.starts_with("event: host-resources-error\ndata: {"));
        assert!(error_str.ends_with("\n\n"));
        assert!(error_bytes.len() <= MAX_CONTROL_FRAME_BYTES);

        // Huge payload exceeding 4096 bytes must be rejected
        let huge_error = "x".repeat(5000);
        let err = encode_error_control("HUGE_ERROR", huge_error);
        assert!(matches!(err, Err(ControlFrameError::FrameTooLarge)));
    }

    #[tokio::test]
    async fn test_data_frame_oversize_rejection() {
        let monitor = make_test_monitor();
        let epoch = Uuid::new_v4();
        let mut snapshot = HostResourceSnapshotV1::unavailable(1000, PathBuf::from("/tmp").as_path());
        let huge_command = "a".repeat(300_000);
        snapshot.processes.processes.push(crate::system::ProcessMemory {
            pid: 1,
            start_ticks: Some(100),
            uid: Some(1000),
            name: "huge_proc".into(),
            command_summary: Some(huge_command),
            rss_bytes: Some(1024),
            anon_rss_bytes: None,
            file_rss_bytes: None,
            shmem_rss_bytes: None,
            pss_bytes: None,
            availability: Availability::available(1000),
        });

        let pair = CachedHostResourcePair {
            server_epoch: epoch,
            revision: 1,
            snapshot,
            metrics: monitor.legacy_metrics().await,
            snapshot_observed_at: None,
            metrics_observed_at: None,
            light_sample_ms: 5000,
            snapshot_deadline_ms: 500,
            jitter_ms: 250,
        };
        let result = encode_data_frame(&pair);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_eq!(err.server_epoch, epoch);
        assert_eq!(err.revision, 1);
        assert_eq!(err.limit, MAX_DATA_FRAME_BYTES);
    }

    #[tokio::test]
    async fn test_demand_driven_publisher_zero_readers_no_encode() {
        let monitor = make_test_monitor();
        let publisher = HostResourcePublisher::new(monitor.clone());
        publisher.start();

        // With zero subscribers, trigger multiple reconfigurations (which commit new revisions)
        for i in 1..=5 {
            monitor
                .reconfigure(HostResourceMonitorConfig {
                    light_sample_seconds: i,
                    ..Default::default()
                })
                .await;
        }

        // Give publisher loop a moment to observe
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Verify encode_count is still 0!
        assert_eq!(publisher.test_counters().encode_count.load(Ordering::Relaxed), 0);

        // When a subscriber connects, first encode happens
        let mut sub = publisher.subscribe();
        let frame = sub.latest().await.expect("initial frame encoded on demand");
        assert_eq!(publisher.test_counters().encode_count.load(Ordering::Relaxed), 1);
        assert_eq!(frame.light_sample_ms, 5000);

        publisher.shutdown().await;
    }

    #[tokio::test]
    async fn test_zero_reader_reuse_when_revision_unchanged() {
        let monitor = make_test_monitor();
        let publisher = HostResourcePublisher::new(monitor.clone());
        publisher.start();

        // First subscriber connects and receives frame
        {
            let mut sub1 = publisher.subscribe();
            let frame1 = sub1.latest().await.expect("frame 1");
            assert_eq!(frame1.revision, 0);
        }
        // Sub1 dropped, interest is 0. Encode count should be 1.
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(publisher.test_counters().encode_count.load(Ordering::Relaxed), 1);

        // Second subscriber connects without any new monitor commits
        {
            let mut sub2 = publisher.subscribe();
            let frame2 = sub2.latest().await.expect("frame 2");
            assert_eq!(frame2.revision, 0);
        }

        // Second subscriber reused the retained frame!
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(publisher.test_counters().encode_count.load(Ordering::Relaxed), 1);
        assert!(publisher.test_counters().reuse_count.load(Ordering::Relaxed) >= 1);

        publisher.shutdown().await;
    }

    #[tokio::test]
    async fn test_old_frame_invalidated_on_new_revision_renewed_demand() {
        let monitor = make_test_monitor();
        let publisher = HostResourcePublisher::new(monitor.clone());
        publisher.start();

        // Sub1 receives revision 0
        {
            let mut sub1 = publisher.subscribe();
            let frame1 = sub1.latest().await.expect("frame 1");
            assert_eq!(frame1.revision, 0);
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(publisher.test_counters().encode_count.load(Ordering::Relaxed), 1);

        // Now interest is 0. Monitor commits multiple revisions.
        monitor
            .reconfigure(HostResourceMonitorConfig {
                light_sample_seconds: 2,
                ..Default::default()
            })
            .await;
        monitor
            .reconfigure(HostResourceMonitorConfig {
                light_sample_seconds: 3,
                ..Default::default()
            })
            .await;
        monitor
            .reconfigure(HostResourceMonitorConfig {
                light_sample_seconds: 4,
                ..Default::default()
            })
            .await;

        tokio::time::sleep(Duration::from_millis(50)).await;
        // Zero interest: no new encodes happened during those 3 commits!
        assert_eq!(publisher.test_counters().encode_count.load(Ordering::Relaxed), 1);

        // Renewed demand: Sub2 connects
        let mut sub2 = publisher.subscribe();
        let frame2 = sub2.latest().await.expect("frame 2");
        assert_eq!(frame2.light_sample_ms, 4000);
        assert_eq!(publisher.test_counters().encode_count.load(Ordering::Relaxed), 2);
        assert!(publisher.test_counters().invalidation_count.load(Ordering::Relaxed) >= 1);

        publisher.shutdown().await;
    }

    #[tokio::test]
    async fn test_multiple_subscribers_share_same_frame() {
        let monitor = make_test_monitor();
        let publisher = HostResourcePublisher::new(monitor.clone());
        publisher.start();

        let mut sub1 = publisher.subscribe();
        let mut sub2 = publisher.subscribe();

        let frame1 = sub1.latest().await.expect("sub1 frame");
        let frame2 = sub2.latest().await.expect("sub2 frame");

        // Both subscribers share the exact same Arc pointer
        assert!(Arc::ptr_eq(&frame1, &frame2));

        // Advance revision
        monitor
            .reconfigure(HostResourceMonitorConfig {
                light_sample_seconds: 10,
                ..Default::default()
            })
            .await;

        let frame1_next = sub1.changed().await.expect("sub1 next");
        let frame2_next = sub2.changed().await.expect("sub2 next");

        assert_eq!(frame1_next.revision, frame2_next.revision);
        assert!(Arc::ptr_eq(&frame1_next, &frame2_next));

        publisher.shutdown().await;
    }
}
