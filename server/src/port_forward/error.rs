use thiserror::Error;

#[derive(Debug, Error)]
pub enum PortForwardError {
    #[error("Port is not allowed: {0}")]
    PortNotAllowed(u16),

    #[error("Port not found in active sessions: {0}")]
    PortNotFound(u16),
}
