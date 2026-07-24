use thiserror::Error;

#[derive(Debug, Error)]
pub enum BrowserDebugError {
    #[error("invalid browser debug selection")]
    InvalidSelection,
    #[error("browser debug artifact not found")]
    NotFound,
    #[error("browser debug artifact already has a PNG")]
    PngAlreadyUploaded,
    #[error("browser debug artifact is too large")]
    TooLarge,
    #[error("browser debug upload must be a PNG")]
    InvalidPng,
    #[error("browser debug artifact I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("browser debug artifact task failed: {0}")]
    Task(String),
}

impl BrowserDebugError {
    pub fn status_code(&self) -> u16 {
        match self {
            Self::InvalidSelection | Self::InvalidPng => 400,
            Self::NotFound => 404,
            Self::PngAlreadyUploaded => 409,
            Self::TooLarge => 413,
            Self::Io(_) | Self::Task(_) => 500,
        }
    }
}
