use thiserror::Error;

use crate::browser_debug::BrowserDebugError;
use crate::fs::FsError;
use crate::tunnel::TunnelError;
use crate::workflow::error::WorkflowError;
use crate::workspace_target::WorkspaceTargetError;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Config error: {0}")]
    Config(String),

    #[error("Config not found: {0}")]
    ConfigNotFound(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Unavailable: {0}")]
    Unavailable(String),

    #[error("PTY error: {0}")]
    PtyError(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Persistence error: {0}")]
    PersistenceError(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Git error: {0}")]
    Git(String),

    #[error("Worktree is dirty: {0}")]
    WorktreeDirty(String),

    #[error("Git repository not found: {0}")]
    GitNotFound(String),

    #[error("Git is not initialized for this project")]
    GitUnavailable,

    #[error("FS error: {0}")]
    Fs(FsError),

    #[error("Tunnel error: {0}")]
    Tunnel(TunnelError),

    #[error("Browser debug error: {0}")]
    BrowserDebug(#[from] BrowserDebugError),

    #[error("Workspace target error: {0}")]
    WorkspaceTarget(WorkspaceTargetError),
    #[error(transparent)]
    Workflow(#[from] WorkflowError),
}

pub type Result<T> = std::result::Result<T, AppError>;

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl From<TunnelError> for AppError {
    fn from(e: TunnelError) -> Self {
        AppError::Tunnel(e)
    }
}

impl AppError {
    pub fn status_code(&self) -> u16 {
        match self {
            AppError::Workflow(error) => error.status_code(),
            AppError::ConfigNotFound(_)
            | AppError::NotFound(_)
            | AppError::SessionNotFound(_)
            | AppError::GitNotFound(_) => 404,
            AppError::GitUnavailable | AppError::WorktreeDirty(_) => 409,
            AppError::Config(_) | AppError::InvalidInput(_) => 400,
            AppError::Fs(e) => e.status_code(),
            AppError::Unavailable(_) => 503,
            AppError::WorkspaceTarget(error) => match error {
                WorkspaceTargetError::UnknownProject => 404,
                WorkspaceTargetError::UnregisteredTarget => 400,
                WorkspaceTargetError::UnavailableTarget => 409,
                WorkspaceTargetError::InvalidPath => 400,
            },
            AppError::Tunnel(e) => tunnel_error_status(e),
            AppError::BrowserDebug(e) => e.status_code(),
            _ => 500,
        }
    }

    pub fn api_code(&self) -> Option<&'static str> {
        match self {
            AppError::Workflow(error) => Some(error.api_code()),
            AppError::GitUnavailable => Some("GIT_NOT_INITIALIZED"),
            AppError::WorktreeDirty(_) => Some("WORKTREE_DIRTY"),
            AppError::WorkspaceTarget(error) => Some(match error {
                WorkspaceTargetError::UnknownProject => "WORKSPACE_PROJECT_NOT_FOUND",
                WorkspaceTargetError::UnregisteredTarget => "WORKSPACE_TARGET_UNREGISTERED",
                WorkspaceTargetError::UnavailableTarget => "WORKSPACE_TARGET_UNAVAILABLE",
                WorkspaceTargetError::InvalidPath => "WORKSPACE_TARGET_INVALID_PATH",
            }),
            _ => None,
        }
    }
}

fn tunnel_error_status(e: &TunnelError) -> u16 {
    match e {
        TunnelError::NotFound(_) => 404,
        TunnelError::DuplicatePort(_) | TunnelError::CreationCancelled => 409,
        TunnelError::BinaryMissing | TunnelError::BinaryMissingHint(_) => 503,
        TunnelError::InstallInProgress => 409,
        TunnelError::SpawnFailed(_) | TunnelError::InstallFailed(_) | TunnelError::Io(_) => 500,
    }
}
