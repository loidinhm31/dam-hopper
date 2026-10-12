use std::path::{Path, PathBuf};

#[cfg(unix)]
use crate::idle_suspend::protocol::{
    read_frame_async, write_frame_async, HelperRequestFrame, HelperResponseFrame,
    HelperResponsePayload,
};
use crate::idle_suspend::protocol::{
    CapabilityProbeOutcome, CapabilityProbeRequest, ProbeDiagnostics, ProbeFailure,
    ProbeFailureReason, ProtocolError, SuspendOutcome, SuspendWithRtcWakeRequest,
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

    /// Send a capability probe request to the helper over the Unix domain socket.
    #[cfg(unix)]
    pub async fn check_capability(
        &self,
        request: CapabilityProbeRequest,
    ) -> CapabilityProbeOutcome {
        let mut stream = match tokio::net::UnixStream::connect(&self.socket_path).await {
            Ok(s) => s,
            Err(e) => {
                let reason = match e.kind() {
                    std::io::ErrorKind::NotFound => ProbeFailureReason::SocketNotFound,
                    std::io::ErrorKind::PermissionDenied => {
                        ProbeFailureReason::SocketPermissionDenied
                    }
                    std::io::ErrorKind::ConnectionRefused => ProbeFailureReason::ConnectionRefused,
                    _ => ProbeFailureReason::IpcIoError,
                };
                return CapabilityProbeOutcome::Unavailable(ProbeFailure {
                    reason,
                    diagnostics: ProbeDiagnostics {
                        stage: Some("connect"),
                        errno: e.raw_os_error(),
                        socket_path: Some(self.socket_path.display().to_string()),
                        actual_uid: None,
                        expected_uid: None,
                        actual_pid: None,
                        expected_pid: None,
                        bounded_detail: format!("Failed to connect to helper socket: {e}"),
                    },
                });
            }
        };

        let req_frame = match HelperRequestFrame::new_probe(request.clone()) {
            Ok(f) => f,
            Err(e) => {
                return CapabilityProbeOutcome::Unavailable(ProbeFailure {
                    reason: ProbeFailureReason::IpcProtocolError,
                    diagnostics: ProbeDiagnostics {
                        stage: Some("encode"),
                        errno: None,
                        socket_path: Some(self.socket_path.display().to_string()),
                        actual_uid: None,
                        expected_uid: None,
                        actual_pid: None,
                        expected_pid: None,
                        bounded_detail: format!("Failed to create probe request frame: {e}"),
                    },
                });
            }
        };

        if let Err(e) = write_frame_async(&mut stream, &req_frame).await {
            return CapabilityProbeOutcome::Unavailable(ProbeFailure {
                reason: ProbeFailureReason::IpcIoError,
                diagnostics: ProbeDiagnostics {
                    stage: Some("write"),
                    errno: None,
                    socket_path: Some(self.socket_path.display().to_string()),
                    actual_uid: None,
                    expected_uid: None,
                    actual_pid: None,
                    expected_pid: None,
                    bounded_detail: format!("Failed to write probe frame: {e}"),
                },
            });
        }

        let resp_frame: HelperResponseFrame = match read_frame_async(&mut stream).await {
            Ok(f) => f,
            Err(e) => {
                let reason = match e {
                    ProtocolError::UnsupportedVersion { .. } => {
                        ProbeFailureReason::ProtocolVersionMismatch
                    }
                    _ => ProbeFailureReason::IpcProtocolError,
                };
                return CapabilityProbeOutcome::Unavailable(ProbeFailure {
                    reason,
                    diagnostics: ProbeDiagnostics {
                        stage: Some("read"),
                        errno: None,
                        socket_path: Some(self.socket_path.display().to_string()),
                        actual_uid: None,
                        expected_uid: None,
                        actual_pid: None,
                        expected_pid: None,
                        bounded_detail: format!("Failed to read probe response frame: {e}"),
                    },
                });
            }
        };

        if let Err(e) = resp_frame.validate() {
            return CapabilityProbeOutcome::Unavailable(ProbeFailure {
                reason: ProbeFailureReason::ProtocolVersionMismatch,
                diagnostics: ProbeDiagnostics {
                    stage: Some("validate"),
                    errno: None,
                    socket_path: Some(self.socket_path.display().to_string()),
                    actual_uid: None,
                    expected_uid: None,
                    actual_pid: None,
                    expected_pid: None,
                    bounded_detail: format!("Invalid helper response frame version: {e}"),
                },
            });
        }

        match resp_frame.payload {
            HelperResponsePayload::Capability {
                request_id: resp_req_id,
                supported,
                reason,
                detail,
            } => {
                if resp_req_id != request.request_id {
                    return CapabilityProbeOutcome::Unavailable(ProbeFailure {
                        reason: ProbeFailureReason::IpcProtocolError,
                        diagnostics: ProbeDiagnostics {
                            stage: Some("correlation"),
                            errno: None,
                            socket_path: Some(self.socket_path.display().to_string()),
                            actual_uid: None,
                            expected_uid: None,
                            actual_pid: None,
                            expected_pid: None,
                            bounded_detail: format!(
                                "Response request_id mismatch: expected {}, got {}",
                                request.request_id, resp_req_id
                            ),
                        },
                    });
                }
                if supported {
                    CapabilityProbeOutcome::Supported
                } else {
                    let fail_reason = reason.unwrap_or(ProbeFailureReason::UnknownHelperFailure);
                    CapabilityProbeOutcome::Unavailable(ProbeFailure {
                        reason: fail_reason,
                        diagnostics: ProbeDiagnostics {
                            stage: Some("preflight"),
                            errno: None,
                            socket_path: Some(self.socket_path.display().to_string()),
                            actual_uid: None,
                            expected_uid: None,
                            actual_pid: None,
                            expected_pid: None,
                            bounded_detail: detail
                                .unwrap_or_else(|| "Capability unsupported".into()),
                        },
                    })
                }
            }
            HelperResponsePayload::Error { code, message } => {
                let reason = if code == "permissionDenied" {
                    ProbeFailureReason::PeerAuthFailed
                } else {
                    ProbeFailureReason::UnknownHelperFailure
                };
                CapabilityProbeOutcome::Unavailable(ProbeFailure {
                    reason,
                    diagnostics: ProbeDiagnostics {
                        stage: Some("auth"),
                        errno: None,
                        socket_path: Some(self.socket_path.display().to_string()),
                        actual_uid: None,
                        expected_uid: None,
                        actual_pid: None,
                        expected_pid: None,
                        bounded_detail: format!("{code}: {message}"),
                    },
                })
            }
            _ => CapabilityProbeOutcome::Unavailable(ProbeFailure {
                reason: ProbeFailureReason::IpcProtocolError,
                diagnostics: ProbeDiagnostics {
                    stage: Some("payload"),
                    errno: None,
                    socket_path: Some(self.socket_path.display().to_string()),
                    actual_uid: None,
                    expected_uid: None,
                    actual_pid: None,
                    expected_pid: None,
                    bounded_detail: "Unexpected response payload variant for capability probe"
                        .into(),
                },
            }),
        }
    }

    #[cfg(windows)]
    pub async fn check_capability(
        &self,
        _request: CapabilityProbeRequest,
    ) -> CapabilityProbeOutcome {
        CapabilityProbeOutcome::Unavailable(ProbeFailure {
            reason: ProbeFailureReason::ExecutorUnavailable,
            diagnostics: ProbeDiagnostics {
                stage: Some("platform"),
                errno: None,
                socket_path: None,
                actual_uid: None,
                expected_uid: None,
                actual_pid: None,
                expected_pid: None,
                bounded_detail: "Unix domain sockets are unavailable on Windows".into(),
            },
        })
    }

    /// Send a fixed suspend-with-RTC-wake request to the helper and await resumption.
    #[cfg(unix)]
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
            HelperResponsePayload::Error { code, message } => Ok(SuspendOutcome::ExecutionFailed {
                request_id: req_id,
                error: format!("{code}: {message}"),
            }),
            _ => Ok(SuspendOutcome::ExecutionFailed {
                request_id: req_id,
                error: "Unexpected response payload from helper".to_string(),
            }),
        }
    }

    #[cfg(windows)]
    pub async fn execute_suspend(
        &self,
        _req: SuspendWithRtcWakeRequest,
    ) -> Result<SuspendOutcome, ProtocolError> {
        Err(ProtocolError::IoError(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "Unix domain sockets are unavailable on Windows",
        )))
    }
}
