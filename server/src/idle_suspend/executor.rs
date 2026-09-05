use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};

use parking_lot::Mutex;

use crate::idle_suspend::protocol::{SuspendOutcome, SuspendWithRtcWakeRequest};

/// Trait defining the privileged execution seam for host suspend with RTC wake.
pub trait IdleSuspendExecutor: Send + Sync {
    /// Check whether the executor capability is supported and available on this host.
    fn check_capability(&self) -> impl Future<Output = bool> + Send;

    /// Execute the fixed suspend request.
    fn execute_suspend(
        &self,
        request: SuspendWithRtcWakeRequest,
    ) -> impl Future<Output = SuspendOutcome> + Send;
}

/// Production executor used in Phase 01 and Phase 02 before Phase 03 operator sign-off.
///
/// Always fails closed: capability returns false, and execution returns `UnsupportedCapability`.
#[derive(Debug, Clone)]
pub struct UnavailableExecutor {
    reason: String,
}

impl UnavailableExecutor {
    pub fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
        }
    }
}

impl Default for UnavailableExecutor {
    fn default() -> Self {
        Self::new("Privileged idle-suspend helper is not configured or signed off")
    }
}

impl IdleSuspendExecutor for UnavailableExecutor {
    async fn check_capability(&self) -> bool {
        false
    }

    async fn execute_suspend(&self, request: SuspendWithRtcWakeRequest) -> SuspendOutcome {
        SuspendOutcome::UnsupportedCapability {
            request_id: request.request_id,
            detail: self.reason.clone(),
        }
    }
}

/// Fake in-memory executor for deterministic test coverage.
#[derive(Debug)]
pub struct FakeExecutor {
    pub capability_available: AtomicBool,
    pub recorded_requests: Mutex<Vec<SuspendWithRtcWakeRequest>>,
    pub configured_outcome: Mutex<Option<SuspendOutcome>>,
}

impl Default for FakeExecutor {
    fn default() -> Self {
        Self {
            capability_available: AtomicBool::new(true),
            recorded_requests: Mutex::new(Vec::new()),
            configured_outcome: Mutex::new(None),
        }
    }
}

impl FakeExecutor {
    pub fn new(available: bool) -> Self {
        Self {
            capability_available: AtomicBool::new(available),
            recorded_requests: Mutex::new(Vec::new()),
            configured_outcome: Mutex::new(None),
        }
    }

    pub fn set_outcome(&self, outcome: SuspendOutcome) {
        *self.configured_outcome.lock() = Some(outcome);
    }

    pub fn recorded_requests(&self) -> Vec<SuspendWithRtcWakeRequest> {
        self.recorded_requests.lock().clone()
    }
}

impl IdleSuspendExecutor for FakeExecutor {
    async fn check_capability(&self) -> bool {
        self.capability_available.load(Ordering::SeqCst)
    }

    async fn execute_suspend(&self, request: SuspendWithRtcWakeRequest) -> SuspendOutcome {
        let outcome = self
            .configured_outcome
            .lock()
            .clone()
            .unwrap_or_else(|| SuspendOutcome::ResumedSuccessfully {
                request_id: request.request_id.clone(),
                elapsed_seconds: request.wake_after_seconds,
            });

        self.recorded_requests.lock().push(request);
        outcome
    }
}
