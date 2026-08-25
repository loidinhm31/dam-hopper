use std::sync::{
    atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
    Arc,
};

#[derive(Clone, Default)]
pub struct CollectorHealth {
    running: Arc<AtomicBool>,
    malformed: Arc<AtomicU64>,
    rejected: Arc<AtomicU64>,
    queued: Arc<AtomicU64>,
    dropped: Arc<AtomicU64>,
    // Retained as a stable health field; the compatibility fallback keeps it at zero.
    dropped_missing_identity: Arc<AtomicU64>,
    dropped_invalid_timestamp: Arc<AtomicU64>,
    dropped_paused: Arc<AtomicU64>,
    dropped_queue_full: Arc<AtomicU64>,
    dropped_worker_unavailable: Arc<AtomicU64>,
    duplicate: Arc<AtomicU64>,
    unverified_version: Arc<AtomicU64>,
    core_schema_drift: Arc<AtomicU64>,
    unavailable_token_coverage: Arc<AtomicU64>,
    last_accepted_at_utc_ms: Arc<AtomicI64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectorHealthSnapshot {
    pub running: bool,
    pub malformed: u64,
    pub rejected: u64,
    pub queued: u64,
    pub dropped: u64,
    pub dropped_missing_identity: u64,
    pub dropped_invalid_timestamp: u64,
    pub dropped_paused: u64,
    pub dropped_queue_full: u64,
    pub dropped_worker_unavailable: u64,
    pub duplicate: u64,
    pub unverified_version: u64,
    pub core_schema_drift: u64,
    pub unavailable_token_coverage: u64,
    pub last_accepted_at_utc_ms: Option<i64>,
}

impl CollectorHealth {
    pub fn snapshot(&self) -> CollectorHealthSnapshot {
        let last = self.last_accepted_at_utc_ms.load(Ordering::Relaxed);
        CollectorHealthSnapshot {
            running: self.running.load(Ordering::Relaxed),
            malformed: self.malformed.load(Ordering::Relaxed),
            rejected: self.rejected.load(Ordering::Relaxed),
            queued: self.queued.load(Ordering::Relaxed),
            dropped: self.dropped.load(Ordering::Relaxed),
            dropped_missing_identity: self.dropped_missing_identity.load(Ordering::Relaxed),
            dropped_invalid_timestamp: self.dropped_invalid_timestamp.load(Ordering::Relaxed),
            dropped_paused: self.dropped_paused.load(Ordering::Relaxed),
            dropped_queue_full: self.dropped_queue_full.load(Ordering::Relaxed),
            dropped_worker_unavailable: self.dropped_worker_unavailable.load(Ordering::Relaxed),
            duplicate: self.duplicate.load(Ordering::Relaxed),
            unverified_version: self.unverified_version.load(Ordering::Relaxed),
            core_schema_drift: self.core_schema_drift.load(Ordering::Relaxed),
            unavailable_token_coverage: self.unavailable_token_coverage.load(Ordering::Relaxed),
            last_accepted_at_utc_ms: (last > 0).then_some(last),
        }
    }

    pub fn snapshot_with_duplicates(&self, duplicate: u64) -> CollectorHealthSnapshot {
        let mut snapshot = self.snapshot();
        snapshot.duplicate = duplicate;
        snapshot
    }

    pub(crate) fn running(&self, value: bool) {
        self.running.store(value, Ordering::Relaxed);
    }
    pub(crate) fn malformed(&self) {
        self.malformed.fetch_add(1, Ordering::Relaxed);
    }
    pub(crate) fn rejected(&self) {
        self.rejected.fetch_add(1, Ordering::Relaxed);
    }
    pub(crate) fn queued(&self) {
        self.queued.fetch_add(1, Ordering::Relaxed);
    }
    pub(crate) fn dropped(&self) {
        self.dropped.fetch_add(1, Ordering::Relaxed);
    }
    pub(crate) fn dropped_invalid_timestamp(&self) {
        self.dropped_invalid_timestamp
            .fetch_add(1, Ordering::Relaxed);
    }
    pub(crate) fn dropped_paused(&self) {
        self.dropped_paused.fetch_add(1, Ordering::Relaxed);
    }
    pub(crate) fn dropped_queue_full(&self) {
        self.dropped_queue_full.fetch_add(1, Ordering::Relaxed);
    }
    pub(crate) fn dropped_worker_unavailable(&self) {
        self.dropped_worker_unavailable
            .fetch_add(1, Ordering::Relaxed);
    }
    pub(crate) fn unverified_version(&self) {
        self.unverified_version.fetch_add(1, Ordering::Relaxed);
    }
    pub(crate) fn core_schema_drift(&self) {
        self.core_schema_drift.fetch_add(1, Ordering::Relaxed);
    }
    pub(crate) fn unavailable_token_coverage(&self) {
        self.unavailable_token_coverage
            .fetch_add(1, Ordering::Relaxed);
    }
    pub(crate) fn accepted(&self, timestamp: i64) {
        self.last_accepted_at_utc_ms
            .store(timestamp, Ordering::Relaxed);
    }
}
