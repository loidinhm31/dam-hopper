use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HostAction {
    DropCleanCaches,
    TerminateSameUserProcess { target: ProcessTarget },
}

impl HostAction {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::DropCleanCaches => "dropCleanCaches",
            Self::TerminateSameUserProcess { .. } => "terminateSameUserProcess",
        }
    }

    pub fn target(&self) -> Option<&ProcessTarget> {
        match self {
            Self::DropCleanCaches => None,
            Self::TerminateSameUserProcess { target } => Some(target),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessTarget {
    pub boot_id: String,
    pub pid: u32,
    pub start_time_ticks: u64,
    pub uid: u32,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionIntentRequest {
    pub action: HostAction,
    pub sample_id: String,
    pub alert_id: Option<String>,
    pub reason: Option<String>,
}

impl ActionIntentRequest {
    pub fn validate(&self) -> Result<(), HostActionError> {
        if self.sample_id.is_empty() || self.sample_id.len() > 128 {
            return Err(HostActionError::InvalidIntent);
        }
        if self
            .alert_id
            .as_ref()
            .is_some_and(|value| value.len() > 128)
            || self.reason.as_ref().is_some_and(|value| value.len() > 512)
            || self
                .action
                .target()
                .is_some_and(|target| target.name.is_empty() || target.name.len() > 128)
        {
            return Err(HostActionError::InvalidIntent);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveIntentRequest {
    pub challenge_nonce: String,
    pub username: String,
    pub password: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRequest {
    pub intent_id: String,
    pub approval_token: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionCapabilitiesResponse {
    pub available: bool,
    pub reason: String,
    pub actions: Vec<&'static str>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentChallenge {
    pub intent_id: String,
    pub challenge_nonce: String,
    pub expires_at: u64,
    pub preview: ActionPreview,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionPreview {
    pub action: HostAction,
    pub warning: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionState {
    Queued,
    Executing,
    Succeeded,
    Failed,
    Denied,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionExecution {
    pub execution_id: String,
    pub state: ExecutionState,
    pub code: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Error)]
pub enum HostActionError {
    #[error("invalid action intent")]
    InvalidIntent,
    #[error("action target is stale or not present in the current snapshot")]
    StaleTarget,
    #[error("host action capability is unavailable")]
    CapabilityUnavailable,
    #[error("too many pending action intents")]
    IntentLimit,
    #[error("action intent was not found or has expired")]
    IntentExpired,
    #[error("action approval is invalid or already consumed")]
    InvalidApproval,
    #[error("action queue is full")]
    QueueFull,
    #[error("clean-cache action is cooling down")]
    Cooldown,
    #[error("host action audit storage is unavailable")]
    AuditUnavailable,
    #[error("host action execution is unavailable")]
    Unavailable,
    #[error("too many failed re-authentication attempts")]
    RateLimited,
}
