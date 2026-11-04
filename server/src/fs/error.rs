use thiserror::Error;

#[derive(Debug, Error)]
pub enum FsError {
    #[error("not found")]
    NotFound,

    #[error("path escape")]
    PathEscape,

    #[error("permission denied")]
    PermissionDenied,

    /// File size in bytes exceeded the read cap.
    #[error("too large: {0} bytes")]
    TooLarge(u64),

    /// FS subsystem not available (workspace root canonicalize failed at startup).
    #[error("fs subsystem unavailable")]
    Unavailable,

    /// Write rejected: file was modified since the client last read it (mtime mismatch).
    #[error("conflict: file modified since last read")]
    Conflict,

    /// Mutation refused: project root delete, .git write without force, etc.
    #[error("mutation refused: {0}")]
    MutationRefused(String),

    /// Invalid filename: empty, contains path separators, or `..`.
    #[error("invalid name: {0}")]
    InvalidName(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

impl FsError {
    pub fn status_code(&self) -> u16 {
        match self {
            FsError::NotFound => 404,
            FsError::PathEscape => 403,
            FsError::PermissionDenied => 403,
            FsError::MutationRefused(_) => 409,
            FsError::TooLarge(_) => 413,
            FsError::Unavailable => 503,
            FsError::Conflict => 409,
            FsError::InvalidName(_) => 400,
            FsError::Io(_) => 500,
        }
    }

    pub fn api_code(&self) -> Option<&'static str> {
        match self {
            FsError::NotFound => Some("NOT_FOUND"),
            FsError::PathEscape => Some("PATH_ESCAPE"),
            FsError::PermissionDenied => Some("PERMISSION_DENIED"),
            FsError::MutationRefused(_) => Some("MUTATION_REFUSED"),
            FsError::TooLarge(_) => Some("TOO_LARGE"),
            FsError::Unavailable => Some("FS_UNAVAILABLE"),
            FsError::Conflict => Some("CONFLICT"),
            FsError::InvalidName(_) => Some("INVALID_NAME"),
            FsError::Io(_) => None,
        }
    }
}
