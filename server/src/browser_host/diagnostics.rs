use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};
use bytes::Bytes;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use super::viewer_delivery_estimator::ViewerDeliverySnapshot;

pub const MAX_BROWSER_PAYLOAD_MEMORY_BYTES: usize = 128 * 1024 * 1024; // 128 MiB
pub const MAX_QUALIFICATION_EVENTS: usize = 256;
pub const MAX_ADMITTED_VIEWER_SNAPSHOTS: usize = 16;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemoryExhausted {
    pub requested_bytes: usize,
    pub current_reserved_bytes: usize,
    pub max_allowed_bytes: usize,
}

impl fmt::Display for MemoryExhausted {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "browser payload memory ceiling exhausted: requested {} bytes, currently reserved {} of {} bytes",
            self.requested_bytes, self.current_reserved_bytes, self.max_allowed_bytes
        )
    }
}

impl std::error::Error for MemoryExhausted {}

/// RAII reservation handle that releases reserved bytes back to the controller upon drop.
#[derive(Debug)]
pub struct MemoryReservation {
    bytes: usize,
    controller: Arc<MemoryAdmissionController>,
}

impl MemoryReservation {
    pub fn bytes(&self) -> usize {
        self.bytes
    }

    pub fn adjust(&mut self, actual_bytes: usize) -> Result<(), MemoryExhausted> {
        if actual_bytes > self.bytes {
            let diff = actual_bytes - self.bytes;
            loop {
                let current = self.controller.reserved_bytes.load(Ordering::SeqCst);
                let next = match current.checked_add(diff) {
                    Some(n) => n,
                    None => {
                        self.controller.rejections.fetch_add(1, Ordering::Relaxed);
                        return Err(MemoryExhausted {
                            requested_bytes: diff,
                            current_reserved_bytes: current,
                            max_allowed_bytes: self.controller.max_bytes,
                        });
                    }
                };

                if next > self.controller.max_bytes {
                    self.controller.rejections.fetch_add(1, Ordering::Relaxed);
                    return Err(MemoryExhausted {
                        requested_bytes: diff,
                        current_reserved_bytes: current,
                        max_allowed_bytes: self.controller.max_bytes,
                    });
                }

                if self
                    .controller
                    .reserved_bytes
                    .compare_exchange_weak(current, next, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok()
                {
                    let mut peak = self.controller.peak_reserved_bytes.load(Ordering::Relaxed);
                    while next > peak {
                        match self.controller.peak_reserved_bytes.compare_exchange_weak(
                            peak,
                            next,
                            Ordering::Relaxed,
                            Ordering::Relaxed,
                        ) {
                            Ok(_) => break,
                            Err(p) => peak = p,
                        }
                    }
                    break;
                }
            }
        } else if actual_bytes < self.bytes {
            let diff = self.bytes - actual_bytes;
            self.controller.release(diff);
        }
        self.bytes = actual_bytes;
        Ok(())
    }
}

impl Drop for MemoryReservation {
    fn drop(&mut self) {
        self.controller.release(self.bytes);
    }
}

#[derive(Debug)]
struct FrameReservationOwner {
    _reservation: MemoryReservation,
    controller: Arc<MemoryAdmissionController>,
}

impl Drop for FrameReservationOwner {
    fn drop(&mut self) {
        self.controller.unique_buffers.fetch_sub(1, Ordering::SeqCst);
    }
}

/// A complete BHJF frame wrapped with a shared memory reservation.
/// Multiple clones of this struct share the underlying `Bytes` and the same single `MemoryReservation`.
/// The reservation remains held until the LAST clone drops (including in slow-writer or outstanding queues).
#[derive(Debug)]
pub struct TrackedBhjfFrame {
    data: Bytes,
    owner: Arc<FrameReservationOwner>,
    controller: Arc<MemoryAdmissionController>,
    server_received_unix_ms: Option<u64>,
    received_at: Option<Instant>,
}

impl TrackedBhjfFrame {
    pub fn new(data: Bytes, reservation: MemoryReservation) -> Self {
        let controller = reservation.controller.clone();
        controller.active_clones.fetch_add(1, Ordering::SeqCst);
        controller.unique_buffers.fetch_add(1, Ordering::SeqCst);
        let owner = Arc::new(FrameReservationOwner {
            _reservation: reservation,
            controller: controller.clone(),
        });
        Self {
            data,
            owner,
            controller,
            server_received_unix_ms: None,
            received_at: None,
        }
    }

    pub fn with_receipt_time(
        mut self,
        server_received_unix_ms: u64,
        received_at: Instant,
    ) -> Self {
        self.server_received_unix_ms = Some(server_received_unix_ms);
        self.received_at = Some(received_at);
        self
    }

    pub fn server_received_unix_ms(&self) -> Option<u64> {
        self.server_received_unix_ms
    }

    pub fn received_at(&self) -> Option<Instant> {
        self.received_at
    }

    pub fn data(&self) -> &Bytes {
        &self.data
    }

    pub fn clone_data(&self) -> Bytes {
        self.data.clone()
    }

    pub fn byte_length(&self) -> usize {
        self.data.len()
    }
}

impl Clone for TrackedBhjfFrame {
    fn clone(&self) -> Self {
        self.controller.active_clones.fetch_add(1, Ordering::SeqCst);
        Self {
            data: self.data.clone(),
            owner: self.owner.clone(),
            controller: self.controller.clone(),
            server_received_unix_ms: self.server_received_unix_ms,
            received_at: self.received_at,
        }
    }
}

impl Drop for TrackedBhjfFrame {
    fn drop(&mut self) {
        self.controller.active_clones.fetch_sub(1, Ordering::SeqCst);
    }
}

#[derive(Debug)]
pub struct MemoryAdmissionController {
    max_bytes: usize,
    reserved_bytes: AtomicUsize,
    peak_reserved_bytes: AtomicUsize,
    unique_buffers: AtomicUsize,
    active_clones: AtomicUsize,
    rejections: AtomicU64,
}

impl MemoryAdmissionController {
    pub fn new(max_bytes: usize) -> Arc<Self> {
        Arc::new(Self {
            max_bytes,
            reserved_bytes: AtomicUsize::new(0),
            peak_reserved_bytes: AtomicUsize::new(0),
            unique_buffers: AtomicUsize::new(0),
            active_clones: AtomicUsize::new(0),
            rejections: AtomicU64::new(0),
        })
    }

    pub fn current_reserved_bytes(&self) -> usize {
        self.reserved_bytes.load(Ordering::Relaxed)
    }

    pub fn peak_reserved_bytes(&self) -> usize {
        self.peak_reserved_bytes.load(Ordering::Relaxed)
    }

    pub fn unique_buffer_count(&self) -> usize {
        self.unique_buffers.load(Ordering::Relaxed)
    }

    pub fn active_clone_count(&self) -> usize {
        self.active_clones.load(Ordering::Relaxed)
    }

    pub fn rejection_count(&self) -> u64 {
        self.rejections.load(Ordering::Relaxed)
    }

    /// Try to reserve a number of bytes within the 128 MiB ceiling.
    pub fn try_reserve(self: &Arc<Self>, bytes: usize) -> Result<MemoryReservation, MemoryExhausted> {
        loop {
            let current = self.reserved_bytes.load(Ordering::SeqCst);
            let next = match current.checked_add(bytes) {
                Some(n) => n,
                None => {
                    self.rejections.fetch_add(1, Ordering::Relaxed);
                    return Err(MemoryExhausted {
                        requested_bytes: bytes,
                        current_reserved_bytes: current,
                        max_allowed_bytes: self.max_bytes,
                    });
                }
            };

            if next > self.max_bytes {
                self.rejections.fetch_add(1, Ordering::Relaxed);
                return Err(MemoryExhausted {
                    requested_bytes: bytes,
                    current_reserved_bytes: current,
                    max_allowed_bytes: self.max_bytes,
                });
            }

            if self
                .reserved_bytes
                .compare_exchange_weak(current, next, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                // Update peak
                let mut peak = self.peak_reserved_bytes.load(Ordering::Relaxed);
                while next > peak {
                    match self.peak_reserved_bytes.compare_exchange_weak(
                        peak,
                        next,
                        Ordering::Relaxed,
                        Ordering::Relaxed,
                    ) {
                        Ok(_) => break,
                        Err(p) => peak = p,
                    }
                }

                return Ok(MemoryReservation {
                    bytes,
                    controller: self.clone(),
                });
            }
        }
    }

    fn release(&self, bytes: usize) {
        self.reserved_bytes.fetch_sub(bytes, Ordering::SeqCst);
    }
}

pub static GLOBAL_MEMORY_CONTROLLER: LazyLock<Arc<MemoryAdmissionController>> =
    LazyLock::new(|| MemoryAdmissionController::new(MAX_BROWSER_PAYLOAD_MEMORY_BYTES));

pub fn global_memory_controller() -> &'static Arc<MemoryAdmissionController> {
    &GLOBAL_MEMORY_CONTROLLER
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QualificationEvent {
    pub timestamp_unix_ms: u64,
    pub kind: String,
    pub session_id: String,
    pub frame_seq: Option<String>,
}

#[derive(Debug, Clone)]
struct OwnedViewerSnapshot {
    principal: String,
    snapshot: ViewerDeliverySnapshot,
}

pub struct StreamDiagnostics {
    pub events_received: AtomicU64,
    pub events_admitted: AtomicU64,
    pub events_dropped: AtomicU64,
    pub acks_enqueued: AtomicU64,
    pub acks_failed: AtomicU64,
    pub base64_decoded_bytes: AtomicU64,
    pub jpeg_bytes_total: AtomicU64,
    pub delivered_frames: AtomicU64,
    pub acks_received: AtomicU64,
    pub discards_received: AtomicU64,
    pub screenshot_count: AtomicU64,
    pub periodic_screenshot_violations: AtomicU64,
    pub zero_demand_stops: AtomicU64,
    pub demand_starts: AtomicU64,
    pub native_capture_timestamps_valid: AtomicU64,
    pub native_capture_timestamps_unavailable: AtomicU64,
    pub last_native_capture_unix_ms: AtomicU64,
    pub last_server_receipt_unix_ms: AtomicU64,
    pub last_local_send_unix_ms: AtomicU64,
    pub broadcast_lagged_frames: AtomicU64,
    events_ring: Mutex<VecDeque<QualificationEvent>>,
    viewer_snapshots: Mutex<HashMap<String, OwnedViewerSnapshot>>,
    pending_control_writes: Mutex<HashMap<String, (usize, Duration)>>,
}

impl Default for StreamDiagnostics {
    fn default() -> Self {
        Self {
            events_received: AtomicU64::new(0),
            events_admitted: AtomicU64::new(0),
            events_dropped: AtomicU64::new(0),
            acks_enqueued: AtomicU64::new(0),
            acks_failed: AtomicU64::new(0),
            base64_decoded_bytes: AtomicU64::new(0),
            jpeg_bytes_total: AtomicU64::new(0),
            delivered_frames: AtomicU64::new(0),
            acks_received: AtomicU64::new(0),
            discards_received: AtomicU64::new(0),
            screenshot_count: AtomicU64::new(0),
            periodic_screenshot_violations: AtomicU64::new(0),
            zero_demand_stops: AtomicU64::new(0),
            demand_starts: AtomicU64::new(0),
            native_capture_timestamps_valid: AtomicU64::new(0),
            native_capture_timestamps_unavailable: AtomicU64::new(0),
            last_native_capture_unix_ms: AtomicU64::new(0),
            last_server_receipt_unix_ms: AtomicU64::new(0),
            last_local_send_unix_ms: AtomicU64::new(0),
            broadcast_lagged_frames: AtomicU64::new(0),
            events_ring: Mutex::new(VecDeque::with_capacity(MAX_QUALIFICATION_EVENTS)),
            viewer_snapshots: Mutex::new(HashMap::with_capacity(MAX_ADMITTED_VIEWER_SNAPSHOTS)),
            pending_control_writes: Mutex::new(HashMap::with_capacity(
                MAX_ADMITTED_VIEWER_SNAPSHOTS,
            )),
        }
    }
}

impl StreamDiagnostics {
    pub fn record_qualification_event(
        &self,
        kind: &str,
        session_id: &str,
        frame_seq: Option<&str>,
    ) {
        let mut ring = self.events_ring.lock();
        if ring.len() >= MAX_QUALIFICATION_EVENTS {
            ring.pop_front();
        }
        ring.push_back(QualificationEvent {
            timestamp_unix_ms: chrono::Utc::now().timestamp_millis() as u64,
            kind: kind.to_string(),
            session_id: session_id.to_string(),
            frame_seq: frame_seq.map(|s| s.to_string()),
        });
    }

    pub fn export_qualification_events(&self) -> Vec<QualificationEvent> {
        let ring = self.events_ring.lock();
        ring.iter().cloned().collect()
    }

    /// Registers an admitted viewer subscription snapshot if within bounded capacity.
    pub fn register_viewer_snapshot(&self, snapshot: ViewerDeliverySnapshot) -> bool {
        self.register_viewer_snapshot_for_owner("", snapshot)
    }

    /// Registers an owner-qualified admitted viewer subscription snapshot within bounded capacity.
    pub fn register_viewer_snapshot_for_owner(
        &self,
        principal: &str,
        snapshot: ViewerDeliverySnapshot,
    ) -> bool {
        let mut map = self.viewer_snapshots.lock();
        if !map.contains_key(&snapshot.subscription_epoch)
            && map.len() >= MAX_ADMITTED_VIEWER_SNAPSHOTS
        {
            return false;
        }
        map.insert(
            snapshot.subscription_epoch.clone(),
            OwnedViewerSnapshot {
                principal: principal.to_string(),
                snapshot,
            },
        );
        true
    }

    /// Updates an already-admitted viewer snapshot; unknown/forged subscriptions are ignored.
    pub fn update_viewer_snapshot(&self, mut snapshot: ViewerDeliverySnapshot) -> bool {
        let mut map = self.viewer_snapshots.lock();
        if let Some(entry) = map.get_mut(&snapshot.subscription_epoch) {
            snapshot.control_bytes_written = snapshot
                .control_bytes_written
                .max(entry.snapshot.control_bytes_written);
            entry.snapshot = snapshot;
            true
        } else {
            false
        }
    }

    /// Records control-socket bytes and write duration for an admitted pair's subscription.
    pub fn record_control_write(
        &self,
        subscription_epoch: &str,
        bytes: usize,
        write_duration: Duration,
    ) {
        {
            let mut pending = self.pending_control_writes.lock();
            if let Some((b, d)) = pending.get_mut(subscription_epoch) {
                *b = b.saturating_add(bytes);
                *d = write_duration;
            } else if pending.len() < MAX_ADMITTED_VIEWER_SNAPSHOTS * 2 {
                pending.insert(subscription_epoch.to_string(), (bytes, write_duration));
            }
        }
        let mut map = self.viewer_snapshots.lock();
        if let Some(entry) = map.get_mut(subscription_epoch) {
            entry.snapshot.control_bytes_written = entry
                .snapshot
                .control_bytes_written
                .saturating_add(bytes as u64);
            let ms = write_duration.as_secs_f64() * 1000.0;
            entry.snapshot.last_write_duration_ms = Some(ms);
        }
    }

    pub fn take_pending_control_write(&self, subscription_epoch: &str) -> Option<(usize, Duration)> {
        self.pending_control_writes.lock().remove(subscription_epoch)
    }

    pub fn clear_pending_control_write(&self, subscription_epoch: &str) {
        self.pending_control_writes.lock().remove(subscription_epoch);
    }
    /// Removes a viewer snapshot on pair/session teardown.
    pub fn remove_viewer_snapshot(&self, subscription_epoch: &str) -> Option<ViewerDeliverySnapshot> {
        self.pending_control_writes.lock().remove(subscription_epoch);
        self.viewer_snapshots
            .lock()
            .remove(subscription_epoch)
            .map(|e| e.snapshot)
    }

    pub fn viewer_snapshot(&self, subscription_epoch: &str) -> Option<ViewerDeliverySnapshot> {
        self.viewer_snapshots
            .lock()
            .get(subscription_epoch)
            .map(|e| e.snapshot.clone())
    }

    pub fn viewer_snapshot_for_owner(
        &self,
        principal: &str,
        subscription_epoch: &str,
    ) -> Option<ViewerDeliverySnapshot> {
        self.viewer_snapshots
            .lock()
            .get(subscription_epoch)
            .filter(|e| e.principal == principal)
            .map(|e| e.snapshot.clone())
    }

    pub fn viewer_snapshots_for_session(&self, browser_session_id: &str) -> Vec<ViewerDeliverySnapshot> {
        self.viewer_snapshots
            .lock()
            .values()
            .filter(|e| e.snapshot.browser_session_id == browser_session_id)
            .map(|e| e.snapshot.clone())
            .collect()
    }

    pub fn viewer_snapshots_for_owner_session(
        &self,
        principal: &str,
        browser_session_id: &str,
    ) -> Vec<ViewerDeliverySnapshot> {
        self.viewer_snapshots
            .lock()
            .values()
            .filter(|e| {
                e.principal == principal && e.snapshot.browser_session_id == browser_session_id
            })
            .map(|e| e.snapshot.clone())
            .collect()
    }

    pub fn export_viewer_snapshots(&self) -> Vec<ViewerDeliverySnapshot> {
        self.viewer_snapshots
            .lock()
            .values()
            .map(|e| e.snapshot.clone())
            .collect()
    }

    pub fn viewer_snapshot_count(&self) -> usize {
        self.viewer_snapshots.lock().len()
    }
}

pub static GLOBAL_STREAM_DIAGNOSTICS: LazyLock<StreamDiagnostics> =
    LazyLock::new(StreamDiagnostics::default);

pub fn global_stream_diagnostics() -> &'static StreamDiagnostics {
    &GLOBAL_STREAM_DIAGNOSTICS
}
