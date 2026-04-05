use thiserror::Error;

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

    #[error("PTY error: {0}")]
    PtyError(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Git error: {0}")]
    Git(String),

    #[error("Git repository not found: {0}")]
    GitNotFound(String),
}

impl AppError {
    pub fn status_code(&self) -> u16 {
        match self {
            AppError::ConfigNotFound(_)
            | AppError::NotFound(_)
            | AppError::SessionNotFound(_)
            | AppError::GitNotFound(_) => 404,
            AppError::Config(_) | AppError::InvalidInput(_) => 400,
            _ => 500,
        }
    }
}
