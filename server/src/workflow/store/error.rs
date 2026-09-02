use crate::workflow::model::WorkflowModelError;
use thiserror::Error;

/// Storage errors for workflow repository operations.
#[derive(Debug, Error)]
pub enum WorkflowStoreError {
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Validation error: {0}")]
    Validation(#[from] WorkflowModelError),
    #[error("Workspace '{0}' not found")]
    WorkspaceNotFound(String),
    #[error("Item '{0}' not found")]
    ItemNotFound(String),
    #[error("Session '{0}' not found")]
    SessionNotFound(String),
    #[error("Note '{0}' not found")]
    NoteNotFound(String),
    #[error("Duplicate request ID '{0}' already processed")]
    DuplicateRequest(String),
    #[error("Hierarchy constraint violation: {0}")]
    HierarchyViolation(String),
    #[error("Optimistic concurrency conflict")]
    OptimisticConflict,
    #[error("Request replay conflict")]
    RequestConflict,
}
