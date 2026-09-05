pub mod policy;
pub mod protocol;
pub mod timing_store;
pub mod timing_audit;
pub mod coordinator;
pub mod status;
pub mod executor;
pub mod peer_auth;
pub mod preflight;
pub mod audit;
pub mod backend;
pub mod helper_client;
pub mod helper_server;

#[cfg(test)]
pub mod tests;

pub use policy::{
    validate_timing_pair, RuntimeIdleSuspendTiming, StartupIdleSuspendPolicy,
};
pub use protocol::{
    decode_frame, encode_frame, read_frame_async, validate_request_id, write_frame_async,
    HelperRequestFrame, HelperRequestPayload, HelperResponseFrame, HelperResponsePayload,
    IdleSuspendErrorCode, IdleSuspendTimingPatchRequest, IdleSuspendTimingPatchResponse,
    ProtocolError, RequestDeduplicator, SuspendOutcome, SuspendWithRtcWakeRequest,
    HELPER_PROTOCOL_VERSION, MAX_HELPER_FRAME_BYTES,
};
pub use peer_auth::{EnrolledPeerPolicy, PeerAuthError, PeerCredentials};
pub use preflight::{
    ActiveInhibitor, FakeInhibitorProvider, FakePreflightChecker, InhibitorProvider,
    PreflightChecker, PreflightError, SysfsPreflightChecker, SystemdInhibitCliProvider,
};
pub use timing_store::IdleSuspendTimingStore;
pub use timing_audit::{IdleSuspendTimingAudit, TimingAuditRecord, TimingAuditResult};
pub use coordinator::{
    CoordinatorTimingCommand, CoordinatorTimingResult, IdleSuspendCoordinator,
    UpdateTimingCommand,
};
pub use executor::{FakeExecutor, IdleSuspendExecutor, SystemdIdleSuspendExecutor, UnavailableExecutor};
pub use status::{CoordinatorState, IdleSuspendStatusV1};
pub use audit::{HelperAudit, HelperAuditError, HelperAuditRecord, HelperAuditRecordType};
pub use backend::{FakeActionBackend, SuspendActionBackend, SystemdLogindBackend};
pub use helper_client::HelperClient;
pub use helper_server::HelperServer;
