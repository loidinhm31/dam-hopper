use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};

use parking_lot::Mutex;

use crate::idle_suspend::protocol::{SuspendOutcome, SuspendWithRtcWakeRequest};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Trait defining the privileged execution seam for host suspend with RTC wake.
pub trait IdleSuspendExecutor: Send + Sync {
    /// Check whether the executor capability is supported and available on this host.
    fn check_capability(&self) -> BoxFuture<'_, bool>;

    /// Execute the fixed suspend request.
    fn execute_suspend(
        &self,
        request: SuspendWithRtcWakeRequest,
    ) -> BoxFuture<'_, SuspendOutcome>;
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
    fn check_capability(&self) -> BoxFuture<'_, bool> {
        Box::pin(async { false })
    }

    fn execute_suspend(&self, request: SuspendWithRtcWakeRequest) -> BoxFuture<'_, SuspendOutcome> {
        let reason = self.reason.clone();
        Box::pin(async move {
            SuspendOutcome::UnsupportedCapability {
                request_id: request.request_id,
                detail: reason,
            }
        })
    }
}

/// Enrolled production executor that communicates with the privileged systemd helper.
#[derive(Debug, Clone)]
pub struct SystemdIdleSuspendExecutor {
    client: crate::idle_suspend::helper_client::HelperClient,
}

impl SystemdIdleSuspendExecutor {
    pub fn new(socket_path: impl AsRef<std::path::Path>) -> Self {
        Self {
            client: crate::idle_suspend::helper_client::HelperClient::new(socket_path),
        }
    }

    pub fn from_client(client: crate::idle_suspend::helper_client::HelperClient) -> Self {
        Self { client }
    }

    pub fn client(&self) -> &crate::idle_suspend::helper_client::HelperClient {
        &self.client
    }
}

impl IdleSuspendExecutor for SystemdIdleSuspendExecutor {
    fn check_capability(&self) -> BoxFuture<'_, bool> {
        Box::pin(async move {
            if !self.client.is_socket_present() {
                return false;
            }
            match self.client.check_capability().await {
                Ok((supported, _)) => supported,
                Err(_) => false,
            }
        })
    }

    fn execute_suspend(
        &self,
        request: SuspendWithRtcWakeRequest,
    ) -> BoxFuture<'_, SuspendOutcome> {
        Box::pin(async move {
            let req_id = request.request_id.clone();
            match self.client.execute_suspend(request).await {
                Ok(outcome) => outcome,
                Err(e) => SuspendOutcome::ExecutionFailed {
                    request_id: req_id,
                    error: format!("Helper IPC communication error: {e}"),
                },
            }
        })
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
    fn check_capability(&self) -> BoxFuture<'_, bool> {
        let available = self.capability_available.load(Ordering::SeqCst);
        Box::pin(async move { available })
    }

    fn execute_suspend(&self, request: SuspendWithRtcWakeRequest) -> BoxFuture<'_, SuspendOutcome> {
        let outcome = self
            .configured_outcome
            .lock()
            .clone()
            .unwrap_or_else(|| SuspendOutcome::ResumedSuccessfully {
                request_id: request.request_id.clone(),
                elapsed_seconds: request.wake_after_seconds,
            });

        self.recorded_requests.lock().push(request);
        Box::pin(async move { outcome })
    }
}
