pub mod policy;
pub mod protocol;
pub mod timing_store;
pub mod server_audit;
pub mod coordinator;
pub mod status;
pub mod executor;
pub mod peer_auth;
pub mod preflight;
pub mod audit;
pub mod backend;
pub mod helper_client;
pub mod helper_server;
pub mod event;

pub(crate) mod activity;

#[cfg(test)]
pub mod tests;

pub use policy::{
    validate_timing_pair, AgentExecutableEntry, AgentExecutableSet, IdleSuspendAutomaticPolicy,
    RuntimeIdleSuspendTiming, StartupIdleSuspendPolicy,
};
pub use protocol::{
    decode_frame, encode_frame, read_frame_async, validate_request_id,
    validate_suspend_wake_seconds, write_frame_async,
    ForceSuspendAcceptedResponse, ForceSuspendRequest, HelperRequestFrame,
    HelperRequestPayload, HelperResponseFrame, HelperResponsePayload,
    IdleSuspendConflictResponse, IdleSuspendErrorCode, IdleSuspendTimingPatchRequest,
    IdleSuspendTimingPatchResponse, ProtocolError, RequestDeduplicator, SuspendOutcome,
    SuspendWithRtcWakeRequest, HELPER_PROTOCOL_VERSION, MAX_HELPER_FRAME_BYTES,
};
pub use peer_auth::{EnrolledPeerPolicy, PeerAuthError, PeerCredentials};
pub use preflight::{
    parse_systemd_inhibit_output, ActiveInhibitor, FakeInhibitorProvider, FakePreflightChecker,
    InhibitorProvider, PreflightChecker, PreflightError, SysfsPreflightChecker,
    SystemdInhibitCliProvider,
};
pub use timing_store::IdleSuspendTimingStore;
pub use server_audit::{
    AuditError, IdleSuspendServerAudit, IdleSuspendTimingAudit, ManualAuditRecord,
    ManualAuditResult, ServerAuditRecord, TimingAuditRecord, TimingAuditResult,
};
pub use coordinator::{
    CoordinatorForceSuspendResult, CoordinatorTimingCommand, CoordinatorTimingResult,
    ForceSuspendCommand, IdleSuspendCoordinator, UpdateTimingCommand,
};
pub use executor::{FakeExecutor, IdleSuspendExecutor, SystemdIdleSuspendExecutor, UnavailableExecutor};
pub use status::{
    ActivityMeasurementState, ActivityObservationReason, CoordinatorState,
    IdleSuspendActivityStatusV1, IdleSuspendMeasurementWarningV1, IdleSuspendStatusV1,
    IdleSuspendWarningProcessV1, MeasurementWarningReasonCode,
};
pub use audit::{HelperAudit, HelperAuditError, HelperAuditRecord, HelperAuditRecordType};
pub use backend::{FakeActionBackend, SuspendActionBackend, SystemdLogindBackend};
pub use helper_client::HelperClient;
pub use helper_server::HelperServer;
pub use event::{
    validate_canonical_uuid, validate_canonical_uuid_v4, ActionCorrelationId, ArmCancelledDataV1,
    ArmStartedDataV1, AttemptStartedDataV1, AutomaticPolicyV1, CoordinatorStartedDataV1,
    EventValidationError, EventWriteError, FinalCheckCompletedDataV1, FinalCheckStartedDataV1,
    HandoffClaimAcceptedDataV1, HandoffClaimRejectedDataV1, HelperOutcomeReceivedDataV1,
    HelperRequestDispatchedDataV1, IdleSuspendEventDataV1, IdleSuspendEventEnvelopeV1,
    IdleSuspendEventWriter, IdleSuspendModeV1, MeasurementRecoveredDataV1,
    MeasurementUnavailableDataV1, ProducerIdentity, ReconciliationCompletedDataV1,
    ServerIdleSuspendEventTypeV1, ServerIdleSuspendReasonCodeV1, TerminalRejectedDataV1,
    DEFAULT_IDLE_SUSPEND_EVENTS_PATH, IDLE_SUSPEND_EVENT_SCHEMA_VERSION, MAX_EVENT_LINE_BYTES,
};
