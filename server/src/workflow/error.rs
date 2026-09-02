use thiserror::Error;

use crate::workflow::store::WorkflowStoreError;
use crate::workspace_target::WorkspaceTargetError;

/// Sanitized, stable errors exposed by workflow HTTP endpoints.
#[derive(Debug, Clone, Error)]
pub enum WorkflowError {
    #[error("Workflow resource not found")]
    NotFound,
    #[error("Workflow request conflicts with current state")]
    Conflict,
    #[error("Workflow transition is not allowed")]
    InvalidTransition,
    #[error("Workflow target is unavailable")]
    TargetUnavailable,
    #[error("Workflow request exceeds a supported limit")]
    LimitExceeded,
    #[error("Workflow storage is unavailable")]
    StoreUnavailable,
    #[error("Invalid workflow request")]
    InvalidRequest,
}

impl WorkflowError {
    pub fn status_code(&self) -> u16 {
        match self {
            Self::NotFound => 404,
            Self::Conflict | Self::InvalidTransition | Self::TargetUnavailable => 409,
            Self::LimitExceeded | Self::InvalidRequest => 400,
            Self::StoreUnavailable => 503,
        }
    }
    pub fn api_code(&self) -> &'static str {
        match self {
            Self::NotFound => "workflow_not_found",
            Self::Conflict => "workflow_conflict",
            Self::InvalidTransition => "workflow_invalid_transition",
            Self::TargetUnavailable => "workflow_target_unavailable",
            Self::LimitExceeded => "workflow_limit_exceeded",
            Self::StoreUnavailable => "workflow_store_unavailable",
            Self::InvalidRequest => "workflow_invalid_request",
        }
    }
}

impl From<WorkflowStoreError> for WorkflowError {
    fn from(error: WorkflowStoreError) -> Self {
        match error {
            WorkflowStoreError::ItemNotFound(_)
            | WorkflowStoreError::SessionNotFound(_)
            | WorkflowStoreError::NoteNotFound(_)
            | WorkflowStoreError::WorkspaceNotFound(_) => Self::NotFound,
            WorkflowStoreError::OptimisticConflict
            | WorkflowStoreError::RequestConflict
            | WorkflowStoreError::DuplicateRequest(_) => Self::Conflict,
            WorkflowStoreError::HierarchyViolation(_) => Self::InvalidRequest,
            WorkflowStoreError::Validation(error) => match error {
                crate::workflow::model::WorkflowModelError::InvalidItemTransition { .. }
                | crate::workflow::model::WorkflowModelError::InvalidSessionTransition { .. } => Self::InvalidTransition,
                _ => Self::InvalidRequest,
            },
            WorkflowStoreError::Sqlite(_) => Self::StoreUnavailable,
        }
    }
}

impl From<WorkspaceTargetError> for WorkflowError {
    fn from(error: WorkspaceTargetError) -> Self {
        match error {
            WorkspaceTargetError::UnknownProject => Self::NotFound,
            WorkspaceTargetError::UnregisteredTarget
            | WorkspaceTargetError::UnavailableTarget => Self::TargetUnavailable,
            WorkspaceTargetError::InvalidPath => Self::InvalidRequest,
        }
    }
}
