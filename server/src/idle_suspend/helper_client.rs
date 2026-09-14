use std::path::{Path, PathBuf};

use crate::idle_suspend::protocol::{
    read_frame_async, write_frame_async, HelperRequestFrame, HelperResponseFrame,
    HelperResponsePayload, ProtocolError, SuspendOutcome, SuspendWithRtcWakeRequest,
};

/// Client used by the unprivileged server process to communicate with the privileged helper.
#[derive(Debug, Clone)]
pub struct HelperClient {
    socket_path: PathBuf,
}

impl HelperClient {
    pub fn new(socket_path: impl AsRef<Path>) -> Self {
        Self {
            socket_path: socket_path.as_ref().to_path_buf(),
        }
    }

    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }

    /// Check if the helper socket exists on the filesystem.
    pub fn is_socket_present(&self) -> bool {
        self.socket_path.exists()
    }

    /// Send a capability probe request to the helper over the Unix domain socket.
    pub async fn check_capability(&self) -> Result<(bool, String), ProtocolError> {
        let mut stream = tokio::net::UnixStream::connect(&self.socket_path).await?;
        let req = HelperRequestFrame::new_probe();
        write_frame_async(&mut stream, &req).await?;
        let resp: HelperResponseFrame = read_frame_async(&mut stream).await?;

        match resp.payload {
            HelperResponsePayload::Capability { supported, detail } => Ok((supported, detail)),
            HelperResponsePayload::Error { code, message } => {
                Err(ProtocolError::IoError(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!("{code}: {message}"),
                )))
            }
            _ => Err(ProtocolError::IoError(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Unexpected response payload for capability probe",
            ))),
        }
    }

    /// Send a fixed suspend-with-RTC-wake request to the helper and await resumption.
    pub async fn execute_suspend(
        &self,
        req: SuspendWithRtcWakeRequest,
    ) -> Result<SuspendOutcome, ProtocolError> {
        let mut stream = tokio::net::UnixStream::connect(&self.socket_path).await?;
        let req_id = req.request_id.clone();
        let frame = HelperRequestFrame::new_suspend(req)?;
        write_frame_async(&mut stream, &frame).await?;
        let resp: HelperResponseFrame = read_frame_async(&mut stream).await?;

        match resp.payload {
            HelperResponsePayload::SuspendOutcome(outcome) => Ok(outcome),
            HelperResponsePayload::Error { code, message } => {
                Ok(SuspendOutcome::ExecutionFailed {
                    request_id: req_id,
                    error: format!("{code}: {message}"),
                })
            }
            _ => Ok(SuspendOutcome::ExecutionFailed {
                request_id: req_id,
                error: "Unexpected response payload from helper".to_string(),
            }),
        }
    }
}
