use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub const MAX_QUEUE_COUNT: usize = 32;
pub const MAX_QUEUE_BYTES: usize = 4 * 1024 * 1024; // 4 MiB
pub const MAX_STDERR_RING_BYTES: usize = 64 * 1024; // 64 KiB
pub const STDIN_WRITE_TIMEOUT: Duration = Duration::from_millis(2000);
pub const GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(2000);
pub const FORCED_KILL_GRACE: Duration = Duration::from_millis(3000);

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
