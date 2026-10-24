use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use super::types::ByteBudgetCounter;

/// Cheap, non-transactional atomic snapshot of semantic session pressure,
/// queues, open document overlays, child process lifecycles, and navigation request outcomes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiagnosticsSnapshot {
    pub in_flight_requests: usize,
    pub peak_in_flight_requests: usize,
    pub command_queue_slots: usize,
    pub peak_command_queue_slots: usize,
    pub child_outbound_queue_slots: usize,
    pub peak_child_outbound_queue_slots: usize,
    pub child_outbound_bytes: usize,
    pub peak_child_outbound_bytes: usize,
    pub open_documents: usize,
    pub peak_open_documents: usize,
    pub overlay_bytes: usize,
    pub peak_overlay_bytes: usize,
    pub spawn_attempts: usize,
    pub successful_spawns: usize,
    pub restart_attempts: usize,
    pub successful_restarts: usize,
    pub navigation_timeouts: usize,
    pub navigation_cancellations: usize,
    pub navigation_overloads: usize,
    pub stale_results: usize,
}

/// Shared atomic counters tracking actual transition highwaters, queue slot reservations,
/// overlay retained storage, process lifecycles, and request terminal outcomes.
#[derive(Debug, Default)]
pub struct SessionPressureCounters {
    pub in_flight_requests: AtomicUsize,
    pub peak_in_flight_requests: AtomicUsize,
    pub command_queue_slots: AtomicUsize,
    pub peak_command_queue_slots: AtomicUsize,
    pub child_outbound_queue_slots: AtomicUsize,
    pub peak_child_outbound_queue_slots: AtomicUsize,
    pub child_outbound_bytes: AtomicUsize,
    pub peak_child_outbound_bytes: AtomicUsize,
    pub open_documents: AtomicUsize,
    pub peak_open_documents: AtomicUsize,
    pub overlay_bytes: AtomicUsize,
    pub peak_overlay_bytes: AtomicUsize,
    pub spawn_attempts: AtomicUsize,
    pub successful_spawns: AtomicUsize,
    pub restart_attempts: AtomicUsize,
    pub successful_restarts: AtomicUsize,
    pub navigation_timeouts: AtomicUsize,
    pub navigation_cancellations: AtomicUsize,
    pub navigation_overloads: AtomicUsize,
    pub stale_results: AtomicUsize,
}

impl SessionPressureCounters {
    pub fn new() -> Self {
        Self::default()
    }

    #[inline]
    pub fn update_peak(peak: &AtomicUsize, current: usize) {
        peak.fetch_max(current, Ordering::Relaxed);
    }

    #[inline]
    pub fn snapshot(&self) -> SessionDiagnosticsSnapshot {
        SessionDiagnosticsSnapshot {
            in_flight_requests: self.in_flight_requests.load(Ordering::Acquire),
            peak_in_flight_requests: self.peak_in_flight_requests.load(Ordering::Acquire),
            command_queue_slots: self.command_queue_slots.load(Ordering::Acquire),
            peak_command_queue_slots: self.peak_command_queue_slots.load(Ordering::Acquire),
            child_outbound_queue_slots: self.child_outbound_queue_slots.load(Ordering::Acquire),
            peak_child_outbound_queue_slots: self
                .peak_child_outbound_queue_slots
                .load(Ordering::Acquire),
            child_outbound_bytes: self.child_outbound_bytes.load(Ordering::Acquire),
            peak_child_outbound_bytes: self.peak_child_outbound_bytes.load(Ordering::Acquire),
            open_documents: self.open_documents.load(Ordering::Acquire),
            peak_open_documents: self.peak_open_documents.load(Ordering::Acquire),
            overlay_bytes: self.overlay_bytes.load(Ordering::Acquire),
            peak_overlay_bytes: self.peak_overlay_bytes.load(Ordering::Acquire),
            spawn_attempts: self.spawn_attempts.load(Ordering::Acquire),
            successful_spawns: self.successful_spawns.load(Ordering::Acquire),
            restart_attempts: self.restart_attempts.load(Ordering::Acquire),
            successful_restarts: self.successful_restarts.load(Ordering::Acquire),
            navigation_timeouts: self.navigation_timeouts.load(Ordering::Acquire),
            navigation_cancellations: self.navigation_cancellations.load(Ordering::Acquire),
            navigation_overloads: self.navigation_overloads.load(Ordering::Acquire),
            stale_results: self.stale_results.load(Ordering::Acquire),
        }
    }
}

/// RAII slot permit tracking command queue slot reservation.
/// Distinct from active command processing: released at dequeue before actor execution.
#[derive(Debug)]
pub struct CommandSlotPermit {
    counters: Arc<SessionPressureCounters>,
}

impl CommandSlotPermit {
    pub fn new(counters: Arc<SessionPressureCounters>) -> Self {
        let cur = counters.command_queue_slots.fetch_add(1, Ordering::SeqCst) + 1;
        SessionPressureCounters::update_peak(&counters.peak_command_queue_slots, cur);
        Self { counters }
    }
}

impl Drop for CommandSlotPermit {
    fn drop(&mut self) {
        self.counters
            .command_queue_slots
            .fetch_sub(1, Ordering::SeqCst);
    }
}

/// Envelope wrapping an enqueued session command with its queue slot reservation permit.
#[derive(Debug)]
pub struct EnqueuedCommand<T> {
    pub cmd: T,
    pub permit: CommandSlotPermit,
}

/// RAII slot permit tracking child outbound queue slot and payload byte reservation.
/// Released at dequeue before active stdin write, cleanly distinguishing queued state from active writer.
#[derive(Debug)]
pub struct OutboundSlotPermit {
    pub len: usize,
    counters: Arc<SessionPressureCounters>,
    budget: ByteBudgetCounter,
}

impl OutboundSlotPermit {
    pub fn new(
        len: usize,
        counters: Arc<SessionPressureCounters>,
        budget: ByteBudgetCounter,
    ) -> Self {
        let cur_slots = counters
            .child_outbound_queue_slots
            .fetch_add(1, Ordering::SeqCst)
            + 1;
        SessionPressureCounters::update_peak(&counters.peak_child_outbound_queue_slots, cur_slots);
        let cur_bytes = counters
            .child_outbound_bytes
            .fetch_add(len, Ordering::SeqCst)
            + len;
        SessionPressureCounters::update_peak(&counters.peak_child_outbound_bytes, cur_bytes);
        Self {
            len,
            counters,
            budget,
        }
    }
}

impl Drop for OutboundSlotPermit {
    fn drop(&mut self) {
        self.counters
            .child_outbound_queue_slots
            .fetch_sub(1, Ordering::SeqCst);
        self.counters
            .child_outbound_bytes
            .fetch_sub(self.len, Ordering::SeqCst);
        self.budget.release(self.len);
    }
}

/// Envelope wrapping an outbound child message with its queue slot and byte reservation permit.
#[derive(Debug)]
pub struct OutboundChildMessage {
    pub payload: Vec<u8>,
    pub permit: OutboundSlotPermit,
}
