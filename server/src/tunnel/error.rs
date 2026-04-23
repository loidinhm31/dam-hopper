use thiserror::Error;
use uuid::Uuid;

#[derive(Error, Debug)]
pub enum TunnelError {
    #[error("cloudflared binary not found; install via: {0}")]
    BinaryMissingHint(String),
    #[error("cloudflared binary not found")]
    BinaryMissing,
    #[error("tunnel not found: {0}")]
    NotFound(Uuid),
    #[error("tunnel already running on port {0}")]
    DuplicatePort(u16),
    #[error("spawn failed: {0}")]
    SpawnFailed(String),
    #[error("install failed: {0}")]
    InstallFailed(String),
    #[error("install already in progress")]
    InstallInProgress,
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}
