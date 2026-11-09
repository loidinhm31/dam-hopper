use std::collections::VecDeque;
use std::fmt;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};

use bytes::Bytes;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

pub const MAX_BROWSER_PAYLOAD_MEMORY_BYTES: usize = 128 * 1024 * 1024; // 128 MiB
pub const MAX_QUALIFICATION_EVENTS: usize = 256;

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
        }
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
    events_ring: Mutex<VecDeque<QualificationEvent>>,
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
            events_ring: Mutex::new(VecDeque::with_capacity(MAX_QUALIFICATION_EVENTS)),
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
}

pub static GLOBAL_STREAM_DIAGNOSTICS: LazyLock<StreamDiagnostics> =
    LazyLock::new(StreamDiagnostics::default);

pub fn global_stream_diagnostics() -> &'static StreamDiagnostics {
    &GLOBAL_STREAM_DIAGNOSTICS
}
