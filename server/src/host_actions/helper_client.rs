use std::sync::Arc;

use super::{approval::ApprovedIntent, types::HostActionError};

#[derive(Clone, Debug)]
pub(crate) struct HelperReceipt {
    pub receipt_id: Option<String>,
    pub code: Option<String>,
}

#[allow(dead_code)] // Phase 05 IPC maps helper replies into every lifecycle state.
pub(crate) enum HelperOutcome {
    Succeeded(HelperReceipt),
    Denied(String),
    Unknown(String),
}

/// The future local IPC boundary. It deliberately accepts a typed intent only;
/// no command strings, signal numbers, or client-selected executable paths fit.
pub(crate) trait HostActionExecutor: Send + Sync {
    fn execute(&self, intent: &ApprovedIntent) -> Result<HelperOutcome, HostActionError>;
}

pub type SharedExecutor = Arc<dyn HostActionExecutor>;

#[derive(Default)]
pub(crate) struct UnavailableExecutor;

impl HostActionExecutor for UnavailableExecutor {
    fn execute(&self, _: &ApprovedIntent) -> Result<HelperOutcome, HostActionError> {
        Err(HostActionError::Unavailable)
    }
}
