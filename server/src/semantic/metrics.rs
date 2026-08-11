//! Bounded semantic runtime counters. No source, host path, stderr, or command
//! content is retained.

use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Default)]
pub struct SemanticMetrics {
    pub sessions_started: AtomicU64,
    pub sessions_reused: AtomicU64,
    pub sessions_evicted: AtomicU64,
    pub sessions_crashed: AtomicU64,
    pub requests_rejected: AtomicU64,
    pub requests_cancelled: AtomicU64,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct SemanticMetricsSnapshot {
    pub sessions_started: u64,
    pub sessions_reused: u64,
    pub sessions_evicted: u64,
    pub sessions_crashed: u64,
    pub requests_rejected: u64,
    pub requests_cancelled: u64,
}

impl SemanticMetrics {
    pub fn snapshot(&self) -> SemanticMetricsSnapshot {
        let load = |counter: &AtomicU64| counter.load(Ordering::Relaxed);
        SemanticMetricsSnapshot {
            sessions_started: load(&self.sessions_started),
            sessions_reused: load(&self.sessions_reused),
            sessions_evicted: load(&self.sessions_evicted),
            sessions_crashed: load(&self.sessions_crashed),
            requests_rejected: load(&self.requests_rejected),
            requests_cancelled: load(&self.requests_cancelled),
        }
    }
}
