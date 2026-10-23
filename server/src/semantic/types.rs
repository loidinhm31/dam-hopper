use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use super::resources::{
    FORCE_KILL_REAP_BUDGET, GRACEFUL_SHUTDOWN_TIMEOUT as RES_GRACEFUL_SHUTDOWN, MAX_QUEUED_BYTES,
    MAX_QUEUED_MESSAGES, MAX_RETAINED_STDERR_BYTES,
};

pub const MAX_QUEUE_COUNT: usize = MAX_QUEUED_MESSAGES;
pub const MAX_QUEUE_BYTES: usize = MAX_QUEUED_BYTES;
pub const MAX_STDERR_RING_BYTES: usize = MAX_RETAINED_STDERR_BYTES;
pub const STDIN_WRITE_TIMEOUT: Duration = Duration::from_millis(2000);
pub const GRACEFUL_SHUTDOWN_TIMEOUT: Duration = RES_GRACEFUL_SHUTDOWN;
pub const FORCED_KILL_GRACE: Duration = FORCE_KILL_REAP_BUDGET;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChildStatus {
    Starting,
    Running,
    ShuttingDown,
    Exited(Option<i32>),
    Crashed(String),
}

#[derive(Debug)]
pub struct BoundedMessage {
    payload: Vec<u8>,
    budget: ByteBudgetCounter,
}

impl BoundedMessage {
    pub fn new(payload: Vec<u8>, budget: ByteBudgetCounter) -> Self {
        Self { payload, budget }
    }

    pub fn payload(&self) -> &[u8] {
        &self.payload
    }

    pub fn into_bytes(mut self) -> Vec<u8> {
        let bytes = std::mem::take(&mut self.payload);
        self.budget.release(bytes.len());
        bytes
    }
}

impl std::ops::Deref for BoundedMessage {
    type Target = [u8];
    fn deref(&self) -> &Self::Target {
        &self.payload
    }
}

impl AsRef<[u8]> for BoundedMessage {
    fn as_ref(&self) -> &[u8] {
        &self.payload
    }
}

impl Drop for BoundedMessage {
    fn drop(&mut self) {
        if !self.payload.is_empty() {
            self.budget.release(self.payload.len());
        }
    }
}

#[derive(Debug)]
pub enum ChildEvent {
    Message(BoundedMessage),
    StderrSummary {
        total_lines: u64,
        total_bytes: u64,
        recent_snippet: String,
    },
    Terminated(ChildStatus),
}

/// Bounded byte tracker for an async queue ensuring total buffered payload size
/// does not exceed the pre-allocated maximum memory threshold.
#[derive(Clone, Debug, Default)]
pub struct ByteBudgetCounter {
    current_bytes: Arc<AtomicUsize>,
    max_bytes: usize,
}

impl ByteBudgetCounter {
    pub fn new(max_bytes: usize) -> Self {
        Self {
            current_bytes: Arc::new(AtomicUsize::new(0)),
            max_bytes,
        }
    }

    pub fn try_reserve(&self, bytes: usize) -> bool {
        let mut curr = self.current_bytes.load(Ordering::Acquire);
        loop {
            if curr + bytes > self.max_bytes {
                return false;
            }
            match self.current_bytes.compare_exchange_weak(
                curr,
                curr + bytes,
                Ordering::SeqCst,
                Ordering::Acquire,
            ) {
                Ok(_) => return true,
                Err(actual) => curr = actual,
            }
        }
    }

    pub fn release(&self, bytes: usize) {
        self.current_bytes.fetch_sub(bytes, Ordering::SeqCst);
    }

    pub fn current(&self) -> usize {
        self.current_bytes.load(Ordering::Acquire)
    }
}
