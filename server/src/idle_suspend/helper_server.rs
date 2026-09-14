use std::sync::Arc;

use parking_lot::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::idle_suspend::audit::{HelperAudit, HelperAuditRecord, HelperReasonCode};
use crate::idle_suspend::backend::SuspendActionBackend;
use crate::idle_suspend::peer_auth::{EnrolledPeerPolicy, PeerCredentials};
use crate::idle_suspend::preflight::{PreflightChecker, PreflightError};
use crate::idle_suspend::protocol::{
    read_frame_async, write_frame_async, HelperRequestFrame, HelperRequestPayload,
    HelperResponseFrame, HelperResponsePayload, ProtocolError, RequestDeduplicator, SuspendOutcome,
};

/// Core server handling helper IPC requests, peer authentication, preflight, audit, and execution.
pub struct HelperServer<P: PreflightChecker, B: SuspendActionBackend> {
    pub policy: EnrolledPeerPolicy,
    pub preflight: Arc<P>,
    pub backend: Arc<B>,
    pub audit: Arc<HelperAudit>,
    pub deduplicator: Arc<Mutex<RequestDeduplicator>>,
}

impl<P: PreflightChecker, B: SuspendActionBackend> HelperServer<P, B> {
    pub fn new(
        policy: EnrolledPeerPolicy,
        preflight: Arc<P>,
        backend: Arc<B>,
        audit: Arc<HelperAudit>,
        dedupe_capacity: usize,
    ) -> Self {
        Self {
            policy,
            preflight,
            backend,
            audit,
            deduplicator: Arc::new(Mutex::new(RequestDeduplicator::new(dedupe_capacity))),
        }
    }

    /// Process a single connection from a client.
    ///
    /// Evaluates peer credentials, decodes exactly one request frame, enforces bounds and
    /// deduplication, runs preflight, records durable audit intent, invokes the fixed backend,
    /// logs completion, and returns the response frame.
    pub async fn handle_connection<S: AsyncReadExt + AsyncWriteExt + Unpin>(
        &self,
        stream: &mut S,
        cred: PeerCredentials,
    ) -> Result<(), ProtocolError> {
        // 1. Peer authentication
        if let Err(e) = self.policy.verify_credentials(&cred) {
            let _ = self.audit.record(&HelperAuditRecord::new_request_rejected(
                cred.pid,
                cred.uid,
                HelperReasonCode::PeerAuthenticationFailed,
                None,
                Some(format!("Peer authentication failed: {e}")),
            ));
            let err_resp = HelperResponseFrame::new(HelperResponsePayload::Error {
                code: "permissionDenied".to_string(),
                message: format!("Peer authentication failed: {e}"),
            });
            let _ = write_frame_async(stream, &err_resp).await;
            return Ok(());
        }

        // 2. Read single request frame
        let req_frame: HelperRequestFrame = match read_frame_async(stream).await {
            Ok(f) => f,
            Err(e) => {
                let _ = self.audit.record(&HelperAuditRecord::new_request_rejected(
                    cred.pid,
                    cred.uid,
                    HelperReasonCode::InvalidFrame,
                    None,
                    Some(format!("Frame decode failed: {e}")),
                ));
                return Err(e);
            }
        };

        // 3. Validate frame contents
        if let Err(e) = req_frame.validate() {
            let _ = self.audit.record(&HelperAuditRecord::new_request_rejected(
                cred.pid,
                cred.uid,
                HelperReasonCode::InvalidFrame,
                None,
                Some(format!("Frame validation failed: {e}")),
            ));
            let err_resp = HelperResponseFrame::new(HelperResponsePayload::Error {
                code: "invalidFrame".to_string(),
                message: format!("Frame validation failed: {e}"),
            });
            let _ = write_frame_async(stream, &err_resp).await;
            return Ok(());
        }

        // 4. Dispatch request
        match req_frame.payload {
            HelperRequestPayload::ProbeCapability => {
                let (supported, detail, reason_code) = match self.preflight.run_all() {
                    Ok(()) => (true, "Host supports RTC wake and suspend".to_string(), None),
                    Err(e) => {
                        let reason = match &e {
                            PreflightError::Inhibited(..) => HelperReasonCode::InhibitorPresent,
                            PreflightError::UnsupportedSuspend(..)
                            | PreflightError::UnsupportedRtc(..) => {
                                HelperReasonCode::CapabilityUnsupported
                            }
                            PreflightError::RtcAlarmBusy(..) => HelperReasonCode::RtcBusy,
                            PreflightError::ProbeError(..) => HelperReasonCode::PreflightFailed,
                        };
                        (false, format!("Preflight check failed: {e}"), Some(reason))
                    }
                };

                let _ = self.audit.record(&HelperAuditRecord::new_capability_result(
                    supported,
                    cred.pid,
                    cred.uid,
                    reason_code,
                    Some(detail.clone()),
                ));

                let resp = HelperResponseFrame::new(HelperResponsePayload::Capability {
                    supported,
                    detail,
                });
                write_frame_async(stream, &resp).await?;
            }
            HelperRequestPayload::SuspendWithRtcWake(req) => {
                // Deduplicate request ID in synchronous scope to drop MutexGuard before any await
                let dedupe_result = {
                    let mut guard = self.deduplicator.lock();
                    guard.check_and_record(&req.request_id)
                };
                if let Err(e) = dedupe_result {
                    let _ = self.audit.record(&HelperAuditRecord::new_request_rejected(
                        cred.pid,
                        cred.uid,
                        HelperReasonCode::DuplicateRequest,
                        Some(req.request_id.clone()),
                        Some(format!("Deduplication rejected: {e}")),
                    ));
                    let err_resp = HelperResponseFrame::new(HelperResponsePayload::Error {
                        code: "duplicateRequestId".to_string(),
                        message: format!("Duplicate request ID: {e}"),
                    });
                    write_frame_async(stream, &err_resp).await?;
                    return Ok(());
                }

                // Preflight check
                let preflight_result = self.preflight.run_all();
                let (passed, preflight_reason) = match &preflight_result {
                    Ok(()) => (true, None),
                    Err(e) => {
                        let reason = match e {
                            PreflightError::Inhibited(..) => HelperReasonCode::InhibitorPresent,
                            PreflightError::UnsupportedSuspend(..)
                            | PreflightError::UnsupportedRtc(..) => {
                                HelperReasonCode::CapabilityUnsupported
                            }
                            PreflightError::RtcAlarmBusy(..) => HelperReasonCode::RtcBusy,
                            PreflightError::ProbeError(..) => HelperReasonCode::PreflightFailed,
                        };
                        (false, Some(reason))
                    }
                };

                // Emit preflight milestone (diagnostic best-effort)
                let _ = self.audit.record(&HelperAuditRecord::new_preflight_result(
                    passed,
                    &req.request_id,
                    cred.pid,
                    cred.uid,
                    preflight_reason,
                    preflight_result.as_ref().err().map(|e| e.to_string()),
                ));

                if let Err(err) = preflight_result {
                    let outcome = match err {
                        PreflightError::Inhibited(desc, who, why) => {
                            SuspendOutcome::BlockedByInhibitor {
                                request_id: req.request_id.clone(),
                                inhibitor: desc,
                                who,
                                why,
                            }
                        }
                        PreflightError::UnsupportedSuspend(msg)
                        | PreflightError::UnsupportedRtc(msg) => {
                            SuspendOutcome::UnsupportedCapability {
                                request_id: req.request_id.clone(),
                                detail: msg,
                            }
                        }
                        PreflightError::RtcAlarmBusy(msg) => SuspendOutcome::ExecutionFailed {
                            request_id: req.request_id.clone(),
                            error: format!("RTC alarm already programmed: {msg}"),
                        },
                        PreflightError::ProbeError(msg) => SuspendOutcome::ExecutionFailed {
                            request_id: req.request_id.clone(),
                            error: format!("Preflight probe error: {msg}"),
                        },
                    };

                    let _ = self.audit.record(&HelperAuditRecord::new_completed(
                        &req.request_id,
                        req.wake_after_seconds,
                        cred.pid,
                        cred.uid,
                        outcome.clone(),
                    ));

                    let resp =
                        HelperResponseFrame::new(HelperResponsePayload::SuspendOutcome(outcome));
                    write_frame_async(stream, &resp).await?;
                    return Ok(());
                }

                // Record intent before mutation. FAIL CLOSED: do not mutate if audit fails!
                let intent = HelperAuditRecord::new_intent(
                    &req.request_id,
                    req.wake_after_seconds,
                    cred.pid,
                    cred.uid,
                );
                if let Err(e) = self.audit.record(&intent) {
                    let outcome = SuspendOutcome::ExecutionFailed {
                        request_id: req.request_id.clone(),
                        error: format!("Audit record write failed: {e}"),
                    };
                    let resp =
                        HelperResponseFrame::new(HelperResponsePayload::SuspendOutcome(outcome));
                    write_frame_async(stream, &resp).await?;
                    return Ok(());
                }

                // Convert numeric wake_after_seconds to Option<u64> (0 is None = clear-only)
                let wake_opt = if req.wake_after_seconds == 0 {
                    None
                } else {
                    Some(req.wake_after_seconds)
                };

                // Program hardware RTC wakealarm
                let rtc_res = self.backend.program_rtc_wake(wake_opt);
                let rtc_ok = rtc_res.is_ok();
                let _ = self.audit.record(&HelperAuditRecord::new_rtc_result(
                    rtc_ok,
                    &req.request_id,
                    Some(req.wake_after_seconds),
                    cred.pid,
                    cred.uid,
                    if rtc_ok {
                        None
                    } else {
                        Some(HelperReasonCode::RtcProgrammingFailed)
                    },
                    rtc_res.as_ref().err().map(|e| e.to_string()),
                ));

                if let Err(e) = rtc_res {
                    let outcome = SuspendOutcome::ExecutionFailed {
                        request_id: req.request_id.clone(),
                        error: format!("RTC programming failed: {e}"),
                    };
                    let _ = self.audit.record(&HelperAuditRecord::new_completed(
                        &req.request_id,
                        req.wake_after_seconds,
                        cred.pid,
                        cred.uid,
                        outcome.clone(),
                    ));
                    let resp =
                        HelperResponseFrame::new(HelperResponsePayload::SuspendOutcome(outcome));
                    write_frame_async(stream, &resp).await?;
                    return Ok(());
                }

                // Trigger host suspend and block until resume
                let _ = self.audit.record(&HelperAuditRecord::new_suspend_invoked(
                    &req.request_id,
                    Some(req.wake_after_seconds),
                    cred.pid,
                    cred.uid,
                ));

                let outcome = match self.backend.trigger_suspend() {
                    Ok(elapsed) => SuspendOutcome::ResumedSuccessfully {
                        request_id: req.request_id.clone(),
                        elapsed_seconds: elapsed,
                    },
                    Err(e) => SuspendOutcome::ExecutionFailed {
                        request_id: req.request_id.clone(),
                        error: format!("Suspend execution failed: {e}"),
                    },
                };

                // Record completion audit (diagnostic best-effort: write failure cannot change outcome)
                let _ = self.audit.record(&HelperAuditRecord::new_completed(
                    &req.request_id,
                    req.wake_after_seconds,
                    cred.pid,
                    cred.uid,
                    outcome.clone(),
                ));

                // Send terminal outcome frame
                let resp =
                    HelperResponseFrame::new(HelperResponsePayload::SuspendOutcome(outcome));
                write_frame_async(stream, &resp).await?;
            }
        }

        Ok(())
    }
}
