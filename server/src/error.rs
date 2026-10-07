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

    #[error("Idle suspend handoff in progress: {0}")]
    IdleSuspendHandoffInProgress(String),
    #[error("Unsupported media type: {0}")]
    UnsupportedMediaType(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error(transparent)]
    AgentStatusIntegration(#[from] crate::agent_status::IntegrationError),
    #[error(transparent)]
    Plans(#[from] crate::plans::PlansError),
    #[error(transparent)]
    GitBlame(#[from] GitBlameError),
}

#[derive(Debug, Error)]
pub enum GitBlameError {
    #[error("Invalid blame input: {0}")]
    InvalidInput(String),

    #[error("Blame content or response exceeds size limit: {0}")]
    TooLarge(String),

    #[error("File is binary or has unsupported object mode: {0}")]
    UnsupportedFile(String),

    #[error("Repository revision or root mapping changed during blame")]
    StaleRevision,

    #[error("Blame workers are busy")]
    Busy,

    #[error("Commit not found: {0}")]
    CommitNotFound(String),

    #[error("Commit object exceeds size limit: {0}")]
    CommitTooLarge(String),

    #[error("Git error: {0}")]
    Git(String),
}

impl GitBlameError {
    pub fn status_code(&self) -> u16 {
        match self {
            Self::InvalidInput(_) => 400,
            Self::CommitNotFound(_) => 404,
            Self::StaleRevision => 409,
            Self::TooLarge(_) | Self::CommitTooLarge(_) => 413,
            Self::UnsupportedFile(_) => 415,
            Self::Busy => 503,
            Self::Git(_) => 500,
        }
    }

    pub fn api_code(&self) -> Option<&'static str> {
        match self {
            Self::InvalidInput(_) => Some("GIT_BLAME_INVALID_INPUT"),
            Self::TooLarge(_) => Some("GIT_BLAME_TOO_LARGE"),
            Self::UnsupportedFile(_) => Some("GIT_BLAME_UNSUPPORTED_FILE"),
            Self::StaleRevision => Some("GIT_BLAME_STALE_REVISION"),
            Self::Busy => Some("GIT_BLAME_BUSY"),
            Self::CommitNotFound(_) => Some("GIT_COMMIT_NOT_FOUND"),
            Self::CommitTooLarge(_) => Some("GIT_COMMIT_TOO_LARGE"),
            Self::Git(_) => None,
        }
    }
}

impl From<git2::Error> for GitBlameError {
    fn from(err: git2::Error) -> Self {
        Self::Git(err.message().to_string())
    }
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
            AppError::Plans(err) => err.status_code(),
            AppError::GitBlame(error) => error.status_code(),
            AppError::ConfigNotFound(_)
            | AppError::NotFound(_)
            | AppError::SessionNotFound(_)
            | AppError::GitNotFound(_) => 404,
            AppError::GitUnavailable
            | AppError::WorktreeDirty(_)
            | AppError::IdleSuspendHandoffInProgress(_) => 409,
            AppError::Config(_) | AppError::InvalidInput(_) => 400,
            AppError::UnsupportedMediaType(_) => 415,
            AppError::Conflict(_) => 409,
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
            AppError::AgentStatusIntegration(e) => match e {
                crate::agent_status::IntegrationError::NonAbsolutePath(_)
                | crate::agent_status::IntegrationError::InvalidAgentDirectory(_)
                | crate::agent_status::IntegrationError::SymlinkNotAllowed(_)
                | crate::agent_status::IntegrationError::NotRegularFile(_) => 400,
                crate::agent_status::IntegrationError::RefusingOverwriteModified(_)
                | crate::agent_status::IntegrationError::RefusingDeleteModified(_)
                | crate::agent_status::IntegrationError::Conflict(_) => 409,
                crate::agent_status::IntegrationError::RestartRequired(_) => 428,
                crate::agent_status::IntegrationError::ConfigurationError(_)
                | crate::agent_status::IntegrationError::ManifestCorrupted(_, _) => 400,
                crate::agent_status::IntegrationError::Io(_) => 500,
            },
            _ => 500,
        }
    }

    pub fn api_code(&self) -> Option<&'static str> {
        match self {
            AppError::Workflow(error) => Some(error.api_code()),
            AppError::Plans(err) => Some(err.api_code()),
            AppError::GitBlame(error) => error.api_code(),
            AppError::GitUnavailable => Some("GIT_NOT_INITIALIZED"),
            AppError::WorktreeDirty(_) => Some("WORKTREE_DIRTY"),
            AppError::IdleSuspendHandoffInProgress(_) => Some("idleSuspendHandoffInProgress"),
            AppError::WorkspaceTarget(error) => Some(match error {
                WorkspaceTargetError::UnknownProject => "WORKSPACE_PROJECT_NOT_FOUND",
                WorkspaceTargetError::UnregisteredTarget => "WORKSPACE_TARGET_UNREGISTERED",
                WorkspaceTargetError::UnavailableTarget => "WORKSPACE_TARGET_UNAVAILABLE",
                WorkspaceTargetError::InvalidPath => "WORKSPACE_TARGET_INVALID_PATH",
            }),
            AppError::BrowserDebug(BrowserDebugError::IncarnationMismatch) => {
                Some("TERMINAL_INCARNATION_MISMATCH")
            }
            AppError::AgentStatusIntegration(e) => match e {
                crate::agent_status::IntegrationError::RefusingOverwriteModified(_)
                | crate::agent_status::IntegrationError::RefusingDeleteModified(_) => {
                    Some("EXTENSION_LOCALLY_MODIFIED")
                }
                crate::agent_status::IntegrationError::SymlinkNotAllowed(_) => {
                    Some("SYMLINK_NOT_ALLOWED")
                }
                _ => None,
            },
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
