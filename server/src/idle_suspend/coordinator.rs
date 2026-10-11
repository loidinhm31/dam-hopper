use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot, watch, RwLock};
use tokio_util::sync::CancellationToken;

use crate::config::{
    MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
    MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
};
use crate::idle_suspend::activity::{
    ActivityDelta, ActivityMeasurementState, ActivityObservation, ActivityObservationReason,
    ActivitySampler, ActivitySamplerResult, ActivityUnavailableReason, AgentActivityAdmission,
    SampleKind, SampleRequest, MAX_ACCEPTED_OBSERVATION_AGE, SAMPLE_CADENCE,
};
use crate::idle_suspend::event::{
    ActionCorrelationId, ArmCancelledDataV1, ArmStartedDataV1, AttemptStartedDataV1,
    AutomaticPolicyV1, CoordinatorStartedDataV1, FinalCheckCompletedDataV1,
    FinalCheckStartedDataV1, HandoffClaimAcceptedDataV1, HandoffClaimRejectedDataV1,
    HelperOutcomeReceivedDataV1, HelperRequestDispatchedDataV1, IdleSuspendEventDataV1,
    IdleSuspendEventWriter, IdleSuspendModeV1, MeasurementRecoveredDataV1,
    MeasurementUnavailableDataV1, ReconciliationCompletedDataV1, ServerIdleSuspendEventTypeV1,
    ServerIdleSuspendReasonCodeV1, TerminalRejectedDataV1,
};
use crate::idle_suspend::executor::{BoxFuture, IdleSuspendExecutor};
use crate::idle_suspend::policy::{
    validate_timing_pair_for_policy, IdleSuspendAutomaticPolicy, RuntimeIdleSuspendTiming,
    StartupIdleSuspendPolicy,
};
use crate::idle_suspend::protocol::{
    validate_suspend_wake_seconds, SuspendOutcome, SuspendWithRtcWakeRequest,
};
use crate::idle_suspend::server_audit::{
    validate_actor, IdleSuspendServerAudit, ManualAuditRecord, ManualAuditResult,
    TimingAuditRecord, TimingAuditResult,
};
use crate::idle_suspend::status::{
    AgentFreeInventoryState, AgentFreePhase, AgentFreeReasonCode, CoordinatorState,
    IdleSuspendActivityStatusV1, IdleSuspendAgentFreeStatusV1, IdleSuspendClientPresenceStatusV1,
    IdleSuspendMeasurementWarningV1, IdleSuspendStatusV1, IdleSuspendWarningProcessV1,
    MeasurementWarningReasonCode,
};
use crate::idle_suspend::timing_store::IdleSuspendTimingStore;
use crate::pty::fleet_state::PtyFleetSnapshot;
use crate::pty::manager::PtySessionManager;
/// Recommended timeout for unanswered sleep consent requests (2s under test, 60s in production).
pub const UNANSWERED_CONSENT_TIMEOUT_SECONDS: u64 = if cfg!(test) { 2 } else { 60 };
use crate::agent_status::types::{AgentSemanticBlockReason, AgentSemanticEvaluation};
use crate::api::auth::AuthenticatedActor;
use crate::idle_suspend::activity::process::ProcessDiscovery;
use crate::idle_suspend::activity::sampler::{
    AgentFreeAdmission, AgentFreeClaimTicket, ManagedAgentClaimEvidence,
};
use crate::idle_suspend::client_presence::{ClientPresenceRegistry, PresenceClaimError};
use crate::idle_suspend::protocol::{ConsentDecisionResponse, ConsentDecisionValue};
use crate::idle_suspend::server_audit::{ConsentAuditRecord, ConsentAuditResult};
use crate::idle_suspend::status::{ConsentDecision, ConsentState, IdleSuspendConsentStatusV1};

/// Command to request a timing update through the idle suspend coordinator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UpdateTimingCommand {
    pub actor: String,
    pub quiet_period_seconds: u64,
    pub wake_after_seconds: u64,
}

/// Commands processed sequentially by the coordinator queue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoordinatorTimingCommand {
    UpdateTiming(UpdateTimingCommand),
}

/// Result returned from processing a coordinator timing command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CoordinatorTimingResult {
    /// Update succeeded.
    Success {
        changed: bool,
        status_revision: u64,
        quiet_period_seconds: u64,
        wake_after_seconds: u64,
    },
    /// A helper handoff is currently in flight; caller must retry after resume.
    HandoffInProgress,
    /// Idle suspend feature is disabled or not operational.
    Disabled,
    /// Audit logging failed before mutation could be admitted.
    AuditFailed(String),
    /// Persistence to the canonical registry file failed.
    PersistenceFailed(String),
    /// Input bounds validation failed.
    ValidationFailed(String),
}

/// Command to request manual force machine sleep.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForceSuspendCommand {
    pub actor: String,
    pub wake_after_seconds: u64,
    pub force: bool,
}

/// Result returned from processing a coordinator manual force-suspend command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CoordinatorForceSuspendResult {
    /// Handoff admitted and accepted; in-flight execution begun.
    Accepted {
        request_id: String,
        status_revision: u64,
        fleet_snapshot: PtyFleetSnapshot,
    },
    /// Active fleet requires explicit confirmation; no claim or executor side-effects.
    ActiveFleetRequiresConfirmation { fleet_snapshot: PtyFleetSnapshot },
    /// A handoff is currently in flight; caller must retry after resume.
    HandoffInProgress,
    /// Generation mismatch between confirmation/snapshot and claim.
    GenerationConflict {
        expected: u64,
        actual: u64,
        fleet_snapshot: PtyFleetSnapshot,
    },
    /// Audit logging failed before mutation could be admitted.
    AuditFailed(String),
    /// Host lacks RTC alarm or suspend capability, or helper probe failed.
    CapabilityUnavailable(String),
    /// Input bounds or actor validation failed.
    ValidationFailed(String),
    /// Coordinator is disabled.
    Disabled,
    /// Coordinator is shutting down.
    ShuttingDown,
}
/// Command to submit a user consent decision.
#[derive(Debug, Clone)]
pub struct SubmitConsentDecisionCommand {
    pub actor: AuthenticatedActor,
    pub request_id: String,
    pub request_revision: u64,
    pub connection_id: String,
    pub decision: ConsentDecisionValue,
}

/// Result returned from processing a consent decision command.
#[derive(Debug, Clone)]
pub enum CoordinatorConsentDecisionResult {
    /// Decision was accepted and latched.
    Success {
        response: ConsentDecisionResponse,
        idempotent: bool,
    },
    /// Decision has already been settled and the incoming decision differs.
    DecisionAlreadySettled {
        request_id: String,
        settled_decision: ConsentDecisionValue,
    },
    /// The consent request has expired.
    Expired,
    /// The consent request was cancelled.
    Cancelled,
    /// No consent request is active or request_id/revision mismatch.
    Unavailable,
    /// Coordinator is disabled.
    Disabled,
    /// Coordinator is shutting down.
    ShuttingDown,
    /// A handoff is currently in progress.
    HandoffInProgress,
    /// Audit logging failed.
    AuditFailed(String),
}

enum CommandMessage {
    UpdateTiming {
        cmd: UpdateTimingCommand,
        reply: oneshot::Sender<CoordinatorTimingResult>,
    },
    ForceSuspend {
        cmd: ForceSuspendCommand,
        reply: oneshot::Sender<CoordinatorForceSuspendResult>,
    },
    SubmitConsentDecision {
        cmd: SubmitConsentDecisionCommand,
        reply: oneshot::Sender<CoordinatorConsentDecisionResult>,
    },
}
#[derive(Debug, Clone)]
pub(crate) struct AttemptContext {
    pub correlation_id: ActionCorrelationId,
    pub mode: IdleSuspendModeV1,
    pub fleet_generation: u64,
    pub activity_revision: Option<u64>,
    pub timing_revision: u64,
    pub status_revision: u64,
    pub wake_after_seconds: u64,
}

impl AttemptContext {
    pub fn new_automatic(
        fleet_generation: u64,
        activity_revision: Option<u64>,
        timing_revision: u64,
        status_revision: u64,
        wake_after_seconds: u64,
    ) -> Self {
        Self {
            correlation_id: ActionCorrelationId::new_v4(),
            mode: IdleSuspendModeV1::Automatic,
            fleet_generation,
            activity_revision,
            timing_revision,
            status_revision,
            wake_after_seconds,
        }
    }

    pub fn new_manual(
        fleet_generation: u64,
        timing_revision: u64,
        status_revision: u64,
        wake_after_seconds: u64,
    ) -> Self {
        Self {
            correlation_id: ActionCorrelationId::new_v4(),
            mode: IdleSuspendModeV1::Manual,
            fleet_generation,
            activity_revision: None,
            timing_revision,
            status_revision,
            wake_after_seconds,
        }
    }
}

fn emit_event(
    writer: Option<&IdleSuspendEventWriter>,
    event_type: ServerIdleSuspendEventTypeV1,
    correlation_id: Option<&ActionCorrelationId>,
    mode: Option<IdleSuspendModeV1>,
    data: IdleSuspendEventDataV1,
) {
    if let Some(w) = writer {
        let now_ms = IdleSuspendStatusV1::now_ms();
        if let Err(e) = w.emit(now_ms, event_type, correlation_id, mode, data) {
            tracing::warn!(
                "Failed to emit idle suspend event {}: {:?}",
                event_type.as_str(),
                e
            );
        }
    }
}

fn map_outcome_to_reason_code(outcome: &SuspendOutcome) -> ServerIdleSuspendReasonCodeV1 {
    match outcome {
        SuspendOutcome::ResumedSuccessfully { .. } => {
            ServerIdleSuspendReasonCodeV1::ResumedSuccessfully
        }
        SuspendOutcome::RejectedFleetActive { .. } => ServerIdleSuspendReasonCodeV1::ActiveFleet,
        SuspendOutcome::BlockedByInhibitor { .. } => {
            ServerIdleSuspendReasonCodeV1::InhibitorPresent
        }
        SuspendOutcome::UnsupportedCapability { .. } => {
            ServerIdleSuspendReasonCodeV1::CapabilityUnsupported
        }
        SuspendOutcome::ExecutionFailed { error, .. } => {
            let lower = error.to_lowercase();
            if lower.contains("busy") || lower.contains("already programmed") {
                ServerIdleSuspendReasonCodeV1::RtcBusy
            } else if lower.contains("programming") || lower.contains("rtc") {
                ServerIdleSuspendReasonCodeV1::RtcProgrammingFailed
            } else if lower.contains("duplicate") {
                ServerIdleSuspendReasonCodeV1::DuplicateRequest
            } else if lower.contains("communication")
                || lower.contains("unavailable")
                || lower.contains("helper ipc")
            {
                ServerIdleSuspendReasonCodeV1::HelperUnavailable
            } else if lower.contains("protocol") || lower.contains("unexpected response") {
                ServerIdleSuspendReasonCodeV1::ProtocolInvalid
            } else if lower.contains("returned") {
                ServerIdleSuspendReasonCodeV1::SuspendReturned
            } else {
                ServerIdleSuspendReasonCodeV1::SuspendFailed
            }
        }
    }
}

/// Authoritative coordinator for terminal idle suspend.
pub struct IdleSuspendCoordinator {
    command_tx: mpsc::Sender<CommandMessage>,
    status_rx: watch::Receiver<IdleSuspendStatusV1>,
    shutdown_token: CancellationToken,
    join_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl IdleSuspendCoordinator {
    /// Start the coordinator task with its state machine and fleet watch.
    pub fn start(
        startup_policy: StartupIdleSuspendPolicy,
        runtime_timing: Arc<RwLock<RuntimeIdleSuspendTiming>>,
        timing_store: Option<IdleSuspendTimingStore>,
        server_audit: Option<IdleSuspendServerAudit>,
        executor: Arc<dyn IdleSuspendExecutor>,
        pty_manager: PtySessionManager,
    ) -> Self {
        Self::start_with_sink(
            startup_policy,
            runtime_timing,
            timing_store,
            server_audit,
            executor,
            pty_manager,
            None,
            None,
        )
    }

    pub fn start_with_writer(
        startup_policy: StartupIdleSuspendPolicy,
        runtime_timing: Arc<RwLock<RuntimeIdleSuspendTiming>>,
        timing_store: Option<IdleSuspendTimingStore>,
        server_audit: Option<IdleSuspendServerAudit>,
        executor: Arc<dyn IdleSuspendExecutor>,
        pty_manager: PtySessionManager,
        event_writer: Option<Arc<IdleSuspendEventWriter>>,
    ) -> Self {
        Self::start_with_sink(
            startup_policy,
            runtime_timing,
            timing_store,
            server_audit,
            executor,
            pty_manager,
            None,
            event_writer,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn start_with_components(
        startup_policy: StartupIdleSuspendPolicy,
        runtime_timing: Arc<RwLock<RuntimeIdleSuspendTiming>>,
        timing_store: Option<IdleSuspendTimingStore>,
        server_audit: Option<IdleSuspendServerAudit>,
        executor: Arc<dyn IdleSuspendExecutor>,
        pty_manager: PtySessionManager,
        event_sink: Option<Arc<dyn crate::pty::EventSink>>,
        event_writer: Option<Arc<IdleSuspendEventWriter>>,
        client_presence: Option<Arc<crate::idle_suspend::ClientPresenceRegistry>>,
        agent_status: Option<crate::agent_status::AgentStatusRuntime>,
        auth_service: Option<Arc<crate::auth::AuthService>>,
    ) -> Self {
        Self::start_internal(
            startup_policy,
            runtime_timing,
            timing_store,
            server_audit,
            executor,
            pty_manager,
            event_sink,
            None,
            event_writer,
            client_presence,
            agent_status,
            auth_service,
        )
    }

    pub fn start_with_sink(
        startup_policy: StartupIdleSuspendPolicy,
        runtime_timing: Arc<RwLock<RuntimeIdleSuspendTiming>>,
        timing_store: Option<IdleSuspendTimingStore>,
        server_audit: Option<IdleSuspendServerAudit>,
        executor: Arc<dyn IdleSuspendExecutor>,
        pty_manager: PtySessionManager,
        event_sink: Option<Arc<dyn crate::pty::EventSink>>,
        event_writer: Option<Arc<IdleSuspendEventWriter>>,
    ) -> Self {
        Self::start_internal(
            startup_policy,
            runtime_timing,
            timing_store,
            server_audit,
            executor,
            pty_manager,
            event_sink,
            None,
            event_writer,
            None,
            None,
            None,
        )
    }

    #[cfg(test)]
    pub(crate) fn start_with_sampler(
        startup_policy: StartupIdleSuspendPolicy,
        runtime_timing: Arc<RwLock<RuntimeIdleSuspendTiming>>,
        timing_store: Option<IdleSuspendTimingStore>,
        server_audit: Option<IdleSuspendServerAudit>,
        executor: Arc<dyn IdleSuspendExecutor>,
        pty_manager: PtySessionManager,
        event_sink: Option<Arc<dyn crate::pty::EventSink>>,
        sampler: ActivitySampler,
        sampler_rx: mpsc::Receiver<ActivitySamplerResult>,
        event_writer: Option<Arc<IdleSuspendEventWriter>>,
    ) -> Self {
        Self::start_internal(
            startup_policy,
            runtime_timing,
            timing_store,
            server_audit,
            executor,
            pty_manager,
            event_sink,
            Some((sampler, sampler_rx)),
            event_writer,
            None,
            None,
            None,
        )
    }
    #[allow(clippy::too_many_arguments)]
    fn start_internal(
        startup_policy: StartupIdleSuspendPolicy,
        runtime_timing: Arc<RwLock<RuntimeIdleSuspendTiming>>,
        timing_store: Option<IdleSuspendTimingStore>,
        server_audit: Option<IdleSuspendServerAudit>,
        executor: Arc<dyn IdleSuspendExecutor>,
        pty_manager: PtySessionManager,
        event_sink: Option<Arc<dyn crate::pty::EventSink>>,
        injected_sampler: Option<(ActivitySampler, mpsc::Receiver<ActivitySamplerResult>)>,
        event_writer: Option<Arc<IdleSuspendEventWriter>>,
        client_presence: Option<Arc<crate::idle_suspend::ClientPresenceRegistry>>,
        agent_status: Option<crate::agent_status::AgentStatusRuntime>,
        auth_service: Option<Arc<crate::auth::AuthService>>,
    ) -> Self {
        let client_presence =
            client_presence.unwrap_or_else(crate::idle_suspend::ClientPresenceRegistry::new);
        let agent_status = agent_status
            .unwrap_or_else(crate::agent_status::AgentStatusRuntime::platform_unqualified);
        let event_sink = event_sink.unwrap_or_else(|| pty_manager.sink());
        let (command_tx, command_rx) = mpsc::channel(32);
        let shutdown_token = CancellationToken::new();

        let fleet_watcher = pty_manager.fleet_watcher();
        let fleet_snapshot = fleet_watcher.snapshot();
        let (quiet, wake) = runtime_timing
            .try_read()
            .map(|r| (r.quiet_period_seconds, r.wake_after_seconds))
            .unwrap_or((300, 600));

        let initial_state = if startup_policy.enabled {
            CoordinatorState::Watching
        } else {
            CoordinatorState::Disabled
        };

        let initial_activity =
            if startup_policy.automatic_policy == IdleSuspendAutomaticPolicy::AgentActivity {
                Some(IdleSuspendActivityStatusV1 {
                    measurement_state: ActivityMeasurementState::Initializing,
                    reason_code: Some(ActivityObservationReason::Reconciling),
                    recognized_agent_count: None,
                    monitored_terminal_count: None,
                    sampled_at_ms: None,
                    last_activity_at_ms: None,
                    network_coverage: "tcp4-tcp6".to_string(),
                    measurement_warning: Some(IdleSuspendMeasurementWarningV1 {
                        reason_code: MeasurementWarningReasonCode::Reconciling,
                        blocked_since_ms: IdleSuspendStatusV1::now_ms(),
                        processes: Vec::new(),
                        processes_truncated: false,
                    }),
                })
            } else {
                None
            };
        let (initial_agent_free, initial_client_presence, initial_consent) =
            if startup_policy.automatic_policy == IdleSuspendAutomaticPolicy::AgentFree {
                (
                    Some(IdleSuspendAgentFreeStatusV1 {
                        phase: AgentFreePhase::Reconciling,
                        scope: "managed-terminals".to_string(),
                        inventory_state: AgentFreeInventoryState::Uninitialized,
                        inventory_revision: 0,
                        semantic_revision: 0,
                        idle_count: None,
                        blocked_count: None,
                        working_count: None,
                        unknown_count: None,
                        free_since_ms: None,
                        eligible_at_ms: None,
                        deferred_until_ms: None,
                        reason_code: Some(AgentFreeReasonCode::Reconciling),
                    }),
                    Some(client_presence.snapshot()),
                    None,
                )
            } else {
                (None, None, None)
            };

        let initial_status = IdleSuspendStatusV1 {
            version: 1,
            status_revision: 1,
            state: initial_state,
            automatic_policy: startup_policy.automatic_policy,
            enabled: startup_policy.enabled,
            timing_mutable: startup_policy.enabled && initial_state != CoordinatorState::HandedOff,
            timing_mutable_reason: if !startup_policy.enabled {
                Some("disabled".to_string())
            } else {
                None
            },
            capability_code: startup_policy.capability_selection.as_str().to_string(),
            current_epoch: 0,
            quiet_period_seconds: quiet,
            wake_after_seconds: wake,
            min_quiet_period_seconds: MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
            max_quiet_period_seconds: MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
            min_wake_after_seconds: MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
            max_wake_after_seconds: MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
            fleet_snapshot,
            arm_deadline_ms: None,
            last_outcome: None,
            detail: None,
            activity: initial_activity,
            agent_free: initial_agent_free,
            client_presence: initial_client_presence,
            consent: initial_consent,
            timestamp_ms: IdleSuspendStatusV1::now_ms(),
        };

        let (status_tx, status_rx) = watch::channel(initial_status);
        event_sink.send_idle_suspend_changed(1);
        let shutdown_clone = shutdown_token.clone();

        let join_handle = tokio::spawn(async move {
            run_coordinator(
                startup_policy,
                runtime_timing,
                timing_store,
                server_audit,
                executor,
                pty_manager,
                event_sink,
                fleet_watcher,
                command_rx,
                status_tx,
                shutdown_clone,
                quiet,
                wake,
                initial_state,
                injected_sampler,
                event_writer,
                client_presence,
                agent_status,
                auth_service,
            )
            .await;
        });

        Self {
            command_tx,
            status_rx,
            shutdown_token,
            join_handle: Mutex::new(Some(join_handle)),
        }
    }

    /// Read the latest authoritative status snapshot.
    pub fn status(&self) -> IdleSuspendStatusV1 {
        self.status_rx.borrow().clone()
    }

    /// Subscribe to live status updates.
    pub fn subscribe_status(&self) -> watch::Receiver<IdleSuspendStatusV1> {
        self.status_rx.clone()
    }

    /// Submit an authenticated timing update to the coordinator.
    pub async fn update_timing(&self, cmd: UpdateTimingCommand) -> CoordinatorTimingResult {
        let (reply_tx, reply_rx) = oneshot::channel();
        let msg = CommandMessage::UpdateTiming {
            cmd,
            reply: reply_tx,
        };
        if self.command_tx.send(msg).await.is_err() {
            return CoordinatorTimingResult::Disabled;
        }
        reply_rx.await.unwrap_or(CoordinatorTimingResult::Disabled)
    }

    /// Submit an authenticated manual force sleep command to the coordinator.
    pub async fn force_suspend(&self, cmd: ForceSuspendCommand) -> CoordinatorForceSuspendResult {
        let (reply_tx, reply_rx) = oneshot::channel();
        let msg = CommandMessage::ForceSuspend {
            cmd,
            reply: reply_tx,
        };
        if self.command_tx.send(msg).await.is_err() {
            return CoordinatorForceSuspendResult::ShuttingDown;
        }
        reply_rx
            .await
            .unwrap_or(CoordinatorForceSuspendResult::ShuttingDown)
    }

    /// Submit an authenticated consent decision to the coordinator.
    pub async fn submit_consent_decision(
        &self,
        cmd: SubmitConsentDecisionCommand,
    ) -> CoordinatorConsentDecisionResult {
        if self.shutdown_token.is_cancelled() {
            return CoordinatorConsentDecisionResult::ShuttingDown;
        }
        let (reply_tx, reply_rx) = oneshot::channel();
        let msg = CommandMessage::SubmitConsentDecision {
            cmd,
            reply: reply_tx,
        };
        if self.command_tx.send(msg).await.is_err() {
            return CoordinatorConsentDecisionResult::ShuttingDown;
        }
        reply_rx
            .await
            .unwrap_or(CoordinatorConsentDecisionResult::ShuttingDown)
    }

    /// Gracefully shutdown the coordinator, cancelling any active grace.
    pub async fn shutdown(&self) {
        self.shutdown_token.cancel();
        let handle = self.join_handle.lock().take();
        if let Some(h) = handle {
            let _ = h.await;
        }
    }
}

// ---------------------------------------------------------------------------
// Coordinator loop and state machine
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
async fn run_coordinator(
    startup_policy: StartupIdleSuspendPolicy,
    runtime_timing: Arc<RwLock<RuntimeIdleSuspendTiming>>,
    timing_store: Option<IdleSuspendTimingStore>,
    server_audit: Option<IdleSuspendServerAudit>,
    executor: Arc<dyn IdleSuspendExecutor>,
    pty_manager: PtySessionManager,
    event_sink: Arc<dyn crate::pty::EventSink>,
    mut fleet_watcher: crate::pty::fleet_state::PtyFleetWatcher,
    mut command_rx: mpsc::Receiver<CommandMessage>,
    status_tx: watch::Sender<IdleSuspendStatusV1>,
    shutdown_token: CancellationToken,
    mut quiet_period_seconds: u64,
    mut wake_after_seconds: u64,
    mut state: CoordinatorState,
    injected_sampler: Option<(ActivitySampler, mpsc::Receiver<ActivitySamplerResult>)>,
    event_writer: Option<Arc<IdleSuspendEventWriter>>,
    client_presence: Arc<ClientPresenceRegistry>,
    agent_status: crate::agent_status::AgentStatusRuntime,
    auth_service: Option<Arc<crate::auth::AuthService>>,
) {
    let mut active_attempt: Option<AttemptContext> = None;
    let mut prior_measurement_available: Option<bool> = None;
    let initial_snapshot = fleet_watcher.snapshot();
    let mut status_revision = 1u64;
    let mut current_epoch = 0u64;
    let mut epoch_ready = false;
    let mut seen_non_quiescent = !initial_snapshot.is_quiescent();
    let mut arm_deadline: Option<tokio::time::Instant> = None;
    let mut armed_generation: Option<u64> = None;
    let mut last_outcome: Option<SuspendOutcome> = None;
    let mut detail: Option<String> = None;

    let is_agent_free_policy =
        startup_policy.automatic_policy == IdleSuspendAutomaticPolicy::AgentFree;
    #[cfg(not(test))]
    if is_agent_free_policy && quiet_period_seconds >= 60 {
        quiet_period_seconds = 10800;
    }

    let mut process_discovery = ProcessDiscovery::new();
    let mut free_anchor: Option<Instant> = None;
    let mut free_anchor_nfg: Option<u64> = None;
    let mut free_since_ms: Option<u64> = None;
    let mut eligible_at_ms: Option<u64> = None;
    let mut deferred_until: Option<Instant> = None;
    let mut deferred_until_ms: Option<u64> = None;
    let mut agent_free_phase = AgentFreePhase::Reconciling;
    let mut inventory_state = AgentFreeInventoryState::Uninitialized;
    let mut inventory_revision = 0u64;
    let mut semantic_revision = agent_status.revision();
    let mut last_seen_non_free_gen = agent_status.non_free_generation();
    let mut idle_count: Option<u32> = None;
    let mut blocked_count: Option<u32> = None;
    let mut working_count: Option<u32> = None;
    let mut unknown_count: Option<u32> = None;
    let mut agent_free_reason: Option<AgentFreeReasonCode> = Some(AgentFreeReasonCode::Reconciling);
    let mut active_consent: Option<ActiveConsentRequest> = None;
    let mut last_settled_consent: Option<ActiveConsentRequest> = None;
    let mut next_consent_request_seq = 1u64;

    let is_agent_policy =
        startup_policy.automatic_policy == IdleSuspendAutomaticPolicy::AgentActivity;

    // Agent activity observation and sampling components
    let (sampler, mut sampler_rx) = if is_agent_policy {
        if let Some((s, rx)) = injected_sampler {
            (Some(s), Some(rx))
        } else {
            let (tx, rx) = mpsc::channel(16);
            let s = ActivitySampler::new(
                Arc::new(pty_manager.clone()),
                Arc::clone(&startup_policy.agent_executables),
                tx,
            );
            (Some(s), Some(rx))
        }
    } else {
        (None, None)
    };

    let mut activity_watcher = pty_manager.activity_watcher();

    let mut activity_revision = 1u64;
    let mut epoch_activity_revision = 1u64;
    let mut last_attempted_epoch_activity_revision: Option<u64> = None;
    let mut next_request_id = 1u64;
    let mut pending_final_request: Option<SampleRequest> = None;
    let mut current_observation: Option<ActivityObservation> = None;
    let mut warning_onset_ms: Option<u64> = if is_agent_policy {
        Some(IdleSuspendStatusV1::now_ms())
    } else {
        None
    };
    let mut quiet_anchor: Option<Instant> = None;
    let mut baseline_established = false;
    let mut reconciling = is_agent_policy;
    let mut last_qualifying_activity_at: Option<Instant> = if seen_non_quiescent {
        Some(Instant::now())
    } else {
        None
    };
    let automatic_policy_v1 = match startup_policy.automatic_policy {
        IdleSuspendAutomaticPolicy::EmptyFleet => AutomaticPolicyV1::EmptyFleet,
        IdleSuspendAutomaticPolicy::AgentActivity => AutomaticPolicyV1::AgentActivity,
        IdleSuspendAutomaticPolicy::AgentFree => AutomaticPolicyV1::AgentFree,
    };
    let initial_timing_revision = runtime_timing
        .try_read()
        .map(|r| r.status_revision)
        .unwrap_or(1);
    let quiet_bounded = quiet_period_seconds.clamp(
        MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
        MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
    );
    let wake_bounded = if wake_after_seconds == 0 {
        0
    } else {
        wake_after_seconds.clamp(
            MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
            MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
        )
    };
    emit_event(
        event_writer.as_deref(),
        ServerIdleSuspendEventTypeV1::CoordinatorStarted,
        None,
        None,
        IdleSuspendEventDataV1::CoordinatorStarted(CoordinatorStartedDataV1 {
            automatic_policy: automatic_policy_v1,
            quiet_period_seconds: quiet_bounded,
            wake_after_seconds: wake_bounded,
            timing_revision: initial_timing_revision,
            status_revision,
        }),
    );

    let mut cadence_interval = tokio::time::interval(SAMPLE_CADENCE);
    cadence_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    let mut in_flight_suspend: Option<BoxFuture<'static, SuspendOutcome>> = None;
    let mut in_flight_manual_audit: Option<ManualAuditRecord> = None;

    loop {
        let sleep_fut = async {
            if let Some(deadline) = arm_deadline {
                tokio::time::sleep_until(deadline).await;
            } else {
                std::future::pending::<()>().await;
            }
        };

        let suspend_fut = async {
            match in_flight_suspend.as_mut() {
                Some(fut) => fut.await,
                None => std::future::pending::<SuspendOutcome>().await,
            }
        };

        tokio::select! {
            _ = shutdown_token.cancelled() => {
                if let Some(ctx) = active_attempt.take() {
                    let snap = pty_manager.fleet_snapshot();
                    if state == CoordinatorState::Armed {
                        emit_event(
                            event_writer.as_deref(),
                            ServerIdleSuspendEventTypeV1::ArmCancelled,
                            Some(&ctx.correlation_id),
                            Some(ctx.mode),
                            IdleSuspendEventDataV1::ArmCancelled(ArmCancelledDataV1 {
                                reason_code: ServerIdleSuspendReasonCodeV1::Shutdown,
                                fleet_generation: snap.generation,
                                activity_revision: ctx.activity_revision,
                            }),
                        );
                    }
                    emit_event(
                        event_writer.as_deref(),
                        ServerIdleSuspendEventTypeV1::TerminalRejected,
                        Some(&ctx.correlation_id),
                        Some(ctx.mode),
                        IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                            reason_code: ServerIdleSuspendReasonCodeV1::Shutdown,
                            fleet_generation: Some(snap.generation),
                            activity_revision: ctx.activity_revision,
                        }),
                    );
                }
                if state == CoordinatorState::Armed || state == CoordinatorState::FinalCheck {
                    state = CoordinatorState::Watching;
                    publish_status_checked(
                        &status_tx,
                        Some(&*event_sink),
                        state,
                        &startup_policy,
                        quiet_period_seconds,
                        wake_after_seconds,
                        &mut status_revision,
                        current_epoch,
                        pty_manager.fleet_snapshot(),
                        None,
                        &last_outcome,
                        &detail,
                        current_observation.as_ref(),
                        reconciling,
                        warning_onset_ms,
                        last_qualifying_activity_at,
                        false,
                        Some(epoch_activity_revision) == last_attempted_epoch_activity_revision,
                    );
                }
                if is_agent_free_policy {
                    if state == CoordinatorState::Armed || state == CoordinatorState::FinalCheck {
                        state = CoordinatorState::Watching;
                    }
                    pty_manager.release_handoff();
                    client_presence.release_host_suspending();
                    publish_agent_free_status_checked(
                        &status_tx,
                        Some(&*event_sink),
                        state,
                        &startup_policy,
                        quiet_period_seconds,
                        wake_after_seconds,
                        &mut status_revision,
                        current_epoch,
                        pty_manager.fleet_snapshot(),
                        &last_outcome,
                        &detail,
                        Some(IdleSuspendAgentFreeStatusV1 {
                            phase: agent_free_phase,
                            scope: "managed-terminals".to_string(),
                            inventory_state,
                            inventory_revision,
                            semantic_revision,
                            idle_count,
                            blocked_count,
                            working_count,
                            unknown_count,
                            free_since_ms,
                            eligible_at_ms,
                            deferred_until_ms,
                            reason_code: agent_free_reason,
                        }),
                        Some(client_presence.snapshot()),
                        active_consent.as_ref().map(|r| r.to_status()),
                    );
                }
                if let Some(s) = &sampler {
                    s.cancel_current();
                    s.shutdown_and_join();
                }
                break;
            }

            outcome = suspend_fut => {
                in_flight_suspend = None;
                let outcome_reason = map_outcome_to_reason_code(&outcome);
                if let Some(ctx) = active_attempt.as_ref() {
                    emit_event(
                        event_writer.as_deref(),
                        ServerIdleSuspendEventTypeV1::HelperOutcomeReceived,
                        Some(&ctx.correlation_id),
                        Some(ctx.mode),
                        IdleSuspendEventDataV1::HelperOutcomeReceived(HelperOutcomeReceivedDataV1 {
                            reason_code: outcome_reason,
                        }),
                    );
                }
                if let Some(mut manual_audit_rec) = in_flight_manual_audit.take() {
                    if let Some(audit) = server_audit.as_ref() {
                        let now_ms = IdleSuspendStatusV1::now_ms();
                        manual_audit_rec.timestamp_ms = now_ms;
                        manual_audit_rec.result = ManualAuditResult::TerminalOutcome(outcome.clone());
                        let _ = audit.record_manual_event(&manual_audit_rec);
                    }
                }
                handle_outcome(
                    outcome.clone(),
                    &mut state,
                    &mut epoch_ready,
                    current_epoch,
                    &mut status_revision,
                    &mut last_outcome,
                    &mut detail,
                    &pty_manager,
                    wake_after_seconds,
                    quiet_period_seconds,
                    &status_tx,
                    &startup_policy,
                    &event_sink,
                    is_agent_policy,
                    &mut reconciling,
                    &sampler,
                    &mut next_request_id,
                    activity_revision,
                    epoch_activity_revision,
                    current_observation.as_ref(),
                    warning_onset_ms,
                    last_qualifying_activity_at,
                    Some(epoch_activity_revision) == last_attempted_epoch_activity_revision,
                );
                if let Some(ctx) = active_attempt.take() {
                    emit_event(
                        event_writer.as_deref(),
                        ServerIdleSuspendEventTypeV1::ReconciliationCompleted,
                        Some(&ctx.correlation_id),
                        Some(ctx.mode),
                        IdleSuspendEventDataV1::ReconciliationCompleted(ReconciliationCompletedDataV1 {
                            reason_code: outcome_reason,
                        }),
                    );
                }
                if is_agent_free_policy {
                    pty_manager.release_handoff();
                    client_presence.release_host_suspending();
                    free_anchor = None;
                    free_anchor_nfg = None;
                    free_since_ms = None;
                    eligible_at_ms = None;
                    deferred_until = None;
                    deferred_until_ms = None;
                    active_consent = None;
                    agent_free_phase = AgentFreePhase::Reconciling;
                    agent_free_reason = Some(AgentFreeReasonCode::Reconciling);
                    last_outcome = Some(outcome.clone());
                    state = match &outcome {
                        SuspendOutcome::ResumedSuccessfully { .. } => CoordinatorState::Resumed,
                        _ => CoordinatorState::Failed,
                    };
                    publish_agent_free_status_checked(
                        &status_tx,
                        Some(&*event_sink),
                        state,
                        &startup_policy,
                        quiet_period_seconds,
                        wake_after_seconds,
                        &mut status_revision,
                        current_epoch,
                        pty_manager.fleet_snapshot(),
                        &last_outcome,
                        &detail,
                        Some(IdleSuspendAgentFreeStatusV1 {
                            phase: agent_free_phase,
                            scope: "managed-terminals".to_string(),
                            inventory_state,
                            inventory_revision,
                            semantic_revision,
                            idle_count,
                            blocked_count,
                            working_count,
                            unknown_count,
                            free_since_ms,
                            eligible_at_ms,
                            deferred_until_ms,
                            reason_code: agent_free_reason,
                        }),
                        Some(client_presence.snapshot()),
                        None,
                    );
                }
            }

            msg = command_rx.recv() => {
                let Some(command_msg) = msg else {
                    break;
                };
                match command_msg {
                    CommandMessage::UpdateTiming { cmd, reply } => {
                        // Invalidate pending final sample request on timing change
                        if let Some(s) = &sampler {
                            if pending_final_request.take().is_some() {
                                s.cancel_current();
                                if state == CoordinatorState::FinalCheck {
                                    state = CoordinatorState::Watching;
                                }
                            }
                        }
                        if state == CoordinatorState::Armed {
                            if let Some(ctx) = active_attempt.take() {
                                let snap = pty_manager.fleet_snapshot();
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::ArmCancelled,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::ArmCancelled(ArmCancelledDataV1 {
                                        reason_code: ServerIdleSuspendReasonCodeV1::GraceCancelled,
                                        fleet_generation: snap.generation,
                                        activity_revision: ctx.activity_revision,
                                    }),
                                );
                            }
                        }
                        let result = handle_timing(
                            cmd,
                            &mut state,
                            &mut status_revision,
                            &mut arm_deadline,
                            &mut armed_generation,
                            &mut quiet_period_seconds,
                            &mut wake_after_seconds,
                            &startup_policy,
                            &runtime_timing,
                            timing_store.as_ref(),
                            server_audit.as_ref(),
                            &pty_manager,
                            epoch_ready,
                            is_agent_policy,
                            &mut quiet_anchor,
                            baseline_established,
                            last_attempted_epoch_activity_revision,
                            epoch_activity_revision,
                        ).await;

                        publish_status_checked(
                            &status_tx,
                            Some(&*event_sink),
                            state,
                            &startup_policy,
                            quiet_period_seconds,
                            wake_after_seconds,
                            &mut status_revision,
                            current_epoch,
                            pty_manager.fleet_snapshot(),
                            arm_deadline,
                            &last_outcome,
                            &detail,
                            current_observation.as_ref(),
                            reconciling,
                            warning_onset_ms,
                            last_qualifying_activity_at,
                            arm_deadline.is_some(),
                            Some(epoch_activity_revision) == last_attempted_epoch_activity_revision,
                        );
                        if state == CoordinatorState::Armed && active_attempt.is_none() {
                            let snap = pty_manager.fleet_snapshot();
                            let timing_rev = runtime_timing.try_read().map(|r| r.status_revision).unwrap_or(1);
                            let act_rev = if is_agent_policy { Some(epoch_activity_revision) } else { None };
                            let new_ctx = AttemptContext::new_automatic(
                                snap.generation,
                                act_rev,
                                timing_rev,
                                status_revision,
                                wake_after_seconds,
                            );
                            emit_event(
                                event_writer.as_deref(),
                                ServerIdleSuspendEventTypeV1::AttemptStarted,
                                Some(&new_ctx.correlation_id),
                                Some(new_ctx.mode),
                                IdleSuspendEventDataV1::AttemptStarted(AttemptStartedDataV1 {
                                    fleet_generation: new_ctx.fleet_generation,
                                    activity_revision: new_ctx.activity_revision,
                                    timing_revision: new_ctx.timing_revision,
                                    status_revision: new_ctx.status_revision,
                                    wake_after_seconds: new_ctx.wake_after_seconds,
                                }),
                            );
                            emit_event(
                                event_writer.as_deref(),
                                ServerIdleSuspendEventTypeV1::ArmStarted,
                                Some(&new_ctx.correlation_id),
                                Some(new_ctx.mode),
                                IdleSuspendEventDataV1::ArmStarted(ArmStartedDataV1 {
                                    fleet_generation: new_ctx.fleet_generation,
                                    activity_revision: new_ctx.activity_revision,
                                    quiet_period_seconds,
                                    deadline_after_seconds: quiet_period_seconds,
                                }),
                            );
                            active_attempt = Some(new_ctx);
                        }
                        let _ = reply.send(result);
                        if is_agent_free_policy {
                            if let Some(r) = active_consent.as_mut() {
                                r.state = ConsentState::Cancelled;
                            }
                            free_anchor = None;
                            free_anchor_nfg = None;
                            free_since_ms = None;
                            eligible_at_ms = None;
                            agent_free_phase = AgentFreePhase::Reconciling;
                            agent_free_reason = Some(AgentFreeReasonCode::Reconciling);
                            publish_agent_free_status_checked(
                                &status_tx,
                                Some(&*event_sink),
                                state,
                                &startup_policy,
                                quiet_period_seconds,
                                wake_after_seconds,
                                &mut status_revision,
                                current_epoch,
                                pty_manager.fleet_snapshot(),
                                &last_outcome,
                                &detail,
                                Some(IdleSuspendAgentFreeStatusV1 {
                                    phase: agent_free_phase,
                                    scope: "managed-terminals".to_string(),
                                    inventory_state,
                                    inventory_revision,
                                    semantic_revision,
                                    idle_count,
                                    blocked_count,
                                    working_count,
                                    unknown_count,
                                    free_since_ms,
                                    eligible_at_ms,
                                    deferred_until_ms,
                                    reason_code: agent_free_reason,
                                }),
                                Some(client_presence.snapshot()),
                                active_consent.as_ref().map(|r| r.to_status()),
                            );
                        }
                    }
                    CommandMessage::ForceSuspend { cmd, reply } => {
                        // Invalidate pending final sample request on manual force
                        if let Some(s) = &sampler {
                            if pending_final_request.take().is_some() {
                                s.cancel_current();
                                if state == CoordinatorState::FinalCheck {
                                    state = CoordinatorState::Watching;
                                }
                            }
                        }

                        if state == CoordinatorState::Armed {
                            if let Some(ctx) = active_attempt.take() {
                                let snap = pty_manager.fleet_snapshot();
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::ArmCancelled,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::ArmCancelled(ArmCancelledDataV1 {
                                        reason_code: ServerIdleSuspendReasonCodeV1::GraceCancelled,
                                        fleet_generation: snap.generation,
                                        activity_revision: ctx.activity_revision,
                                    }),
                                );
                            }
                        }

                        if is_agent_free_policy {
                            if let Some(r) = active_consent.as_mut() {
                                r.state = ConsentState::Cancelled;
                            }
                            free_anchor = None;
                            free_anchor_nfg = None;
                            free_since_ms = None;
                            eligible_at_ms = None;
                        }
                        let timing_rev = runtime_timing.try_read().map(|r| r.status_revision).unwrap_or(1);
                        let (result, maybe_fut, maybe_audit, maybe_attempt) = handle_force_suspend(
                            cmd,
                            &mut state,
                            &mut status_revision,
                            &mut arm_deadline,
                            &mut armed_generation,
                            &executor,
                            &pty_manager,
                            server_audit.as_ref(),
                            in_flight_suspend.is_some(),
                            timing_rev,
                            event_writer.as_deref(),
                        ).await;
                        if maybe_fut.is_some() {
                            in_flight_suspend = maybe_fut;
                            in_flight_manual_audit = maybe_audit;
                            active_attempt = maybe_attempt;
                        }
                        publish_status_checked(
                            &status_tx,
                            Some(&*event_sink),
                            state,
                            &startup_policy,
                            quiet_period_seconds,
                            wake_after_seconds,
                            &mut status_revision,
                            current_epoch,
                            pty_manager.fleet_snapshot(),
                            arm_deadline,
                            &last_outcome,
                            &detail,
                            current_observation.as_ref(),
                            reconciling,
                            warning_onset_ms,
                            last_qualifying_activity_at,
                            arm_deadline.is_some(),
                            Some(epoch_activity_revision) == last_attempted_epoch_activity_revision,
                        );
                        let _ = reply.send(result);
                    }
                    CommandMessage::SubmitConsentDecision { cmd, reply } => {
                        if !is_agent_free_policy || !startup_policy.enabled {
                            let _ = reply.send(CoordinatorConsentDecisionResult::Disabled);
                            continue;
                        }
                        if active_consent.is_none() {
                            if let Some(req) = last_settled_consent.as_ref() {
                                if req.request_id == cmd.request_id && req.request_revision == cmd.request_revision {
                                    if let Some(settled) = req.decision {
                                        if settled == cmd.decision {
                                            let resp = ConsentDecisionResponse {
                                                version: 1,
                                                request_id: req.request_id.clone(),
                                                decision: settled,
                                                status_revision,
                                                settled: true,
                                            };
                                            let _ = reply.send(CoordinatorConsentDecisionResult::Success {
                                                response: resp,
                                                idempotent: true,
                                            });
                                        } else {
                                            let _ = reply.send(CoordinatorConsentDecisionResult::DecisionAlreadySettled {
                                                request_id: req.request_id.clone(),
                                                settled_decision: settled,
                                            });
                                        }
                                        continue;
                                    }
                                }
                            }
                            let _ = reply.send(CoordinatorConsentDecisionResult::Unavailable);
                            continue;
                        }
                        let req = active_consent.as_mut().unwrap();
                        if req.request_id != cmd.request_id || req.request_revision != cmd.request_revision {
                            let _ = reply.send(CoordinatorConsentDecisionResult::Unavailable);
                            continue;
                        }
                        if let Some(settled) = req.decision {
                            if settled == cmd.decision {
                                let resp = ConsentDecisionResponse {
                                    version: 1,
                                    request_id: req.request_id.clone(),
                                    decision: settled,
                                    status_revision,
                                    settled: true,
                                };
                                let _ = reply.send(CoordinatorConsentDecisionResult::Success {
                                    response: resp,
                                    idempotent: true,
                                });
                            } else {
                                let _ = reply.send(CoordinatorConsentDecisionResult::DecisionAlreadySettled {
                                    request_id: req.request_id.clone(),
                                    settled_decision: settled,
                                });
                            }
                            continue;
                        }
                        if state == CoordinatorState::HandedOff || in_flight_suspend.is_some() {
                            let _ = reply.send(CoordinatorConsentDecisionResult::HandoffInProgress);
                            continue;
                        }
                        if req.state == ConsentState::Cancelled {
                            let _ = reply.send(CoordinatorConsentDecisionResult::Cancelled);
                            continue;
                        }
                        if req.state == ConsentState::Expired || Instant::now() >= req.expires_at {
                            let _ = reply.send(CoordinatorConsentDecisionResult::Expired);
                            continue;
                        }

                        // First valid decision!
                        req.decision = Some(cmd.decision);
                        last_settled_consent = Some(req.clone());
                        if let Some(audit) = server_audit.as_ref() {
                            if let Ok(rec) = ConsentAuditRecord::new(
                                cmd.actor.subject.clone(),
                                cmd.request_id.clone(),
                                cmd.request_revision,
                                cmd.connection_id.clone(),
                                cmd.decision,
                                status_revision,
                                ConsentAuditResult::Admitted,
                            ) {
                                let _ = audit.record_consent_event(&rec);
                            }
                        }

                        if cmd.decision == ConsentDecisionValue::Approve {
                            req.state = ConsentState::Approved;
                            req.approving_connection_id = Some(cmd.connection_id.clone());
                            req.approving_actor = Some(cmd.actor.clone());
                            agent_free_phase = AgentFreePhase::Approved;
                            agent_free_reason = Some(AgentFreeReasonCode::AllFree);
                            let resp = ConsentDecisionResponse {
                                version: 1,
                                request_id: req.request_id.clone(),
                                decision: ConsentDecisionValue::Approve,
                                status_revision,
                                settled: true,
                            };
                            let _ = reply.send(CoordinatorConsentDecisionResult::Success {
                                response: resp,
                                idempotent: false,
                            });

                            attempt_agent_free_final_check(
                                true,
                                &mut agent_free_phase,
                                &mut agent_free_reason,
                                &mut active_consent,
                                &mut deferred_until,
                                &mut deferred_until_ms,
                                &mut free_anchor,
                                &mut free_anchor_nfg,
                                &mut free_since_ms,
                                &mut eligible_at_ms,
                                &mut inventory_state,
                                &mut inventory_revision,
                                &mut semantic_revision,
                                &mut idle_count,
                                &mut blocked_count,
                                &mut working_count,
                                &mut unknown_count,
                                &mut next_request_id,
                                &mut next_consent_request_seq,
                                &mut state,
                                &mut in_flight_suspend,
                                &mut active_attempt,
                                &mut status_revision,
                                &client_presence,
                                auth_service.as_ref(),
                                &agent_status,
                                &mut process_discovery,
                                &pty_manager,
                                &startup_policy,
                                &runtime_timing,
                                &executor,
                                event_writer.as_deref(),
                                wake_after_seconds,
                                quiet_period_seconds,
                            ).await;
                        } else {
                            req.state = ConsentState::Denied;
                            agent_free_phase = AgentFreePhase::Deferred;
                            agent_free_reason = Some(AgentFreeReasonCode::ClientRefusal);
                            let defer_dur = Duration::from_secs(quiet_period_seconds);
                            deferred_until = Some(Instant::now() + defer_dur);
                            deferred_until_ms = Some(IdleSuspendStatusV1::now_ms() + defer_dur.as_millis() as u64);
                            free_anchor = None;
                            free_anchor_nfg = None;
                            free_since_ms = None;
                            eligible_at_ms = None;
                            let resp = ConsentDecisionResponse {
                                version: 1,
                                request_id: req.request_id.clone(),
                                decision: ConsentDecisionValue::Deny,
                                status_revision,
                                settled: true,
                            };
                            let _ = reply.send(CoordinatorConsentDecisionResult::Success {
                                response: resp,
                                idempotent: false,
                            });
                        }

                        publish_agent_free_status_checked(
                            &status_tx,
                            Some(&*event_sink),
                            state,
                            &startup_policy,
                            quiet_period_seconds,
                            wake_after_seconds,
                            &mut status_revision,
                            current_epoch,
                            pty_manager.fleet_snapshot(),
                            &last_outcome,
                            &detail,
                            Some(IdleSuspendAgentFreeStatusV1 {
                                phase: agent_free_phase,
                                scope: "managed-terminals".to_string(),
                                inventory_state,
                                inventory_revision,
                                semantic_revision,
                                idle_count,
                                blocked_count,
                                working_count,
                                unknown_count,
                                free_since_ms,
                                eligible_at_ms,
                                deferred_until_ms,
                                reason_code: agent_free_reason,
                            }),
                            Some(client_presence.snapshot()),
                            active_consent.as_ref().map(|r| r.to_status()),
                        );
                    }
                }
            }

            // PTY Activity invalidation signal (terminal input or session lifecycle)
            _ = activity_watcher.changed(), if is_agent_policy || is_agent_free_policy => {
                if is_agent_policy {
                seen_non_quiescent = true;
                if let Some(s) = &sampler {
                    if pending_final_request.take().is_some() {
                        s.cancel_current();
                    }
                }
                last_qualifying_activity_at = Some(Instant::now());
                quiet_anchor = Some(Instant::now());
                if state == CoordinatorState::Armed || state == CoordinatorState::FinalCheck {
                    state = CoordinatorState::Watching;
                    if let Some(ctx) = active_attempt.take() {
                        let snap = pty_manager.fleet_snapshot();
                        emit_event(
                            event_writer.as_deref(),
                            ServerIdleSuspendEventTypeV1::ArmCancelled,
                            Some(&ctx.correlation_id),
                            Some(ctx.mode),
                            IdleSuspendEventDataV1::ArmCancelled(ArmCancelledDataV1 {
                                reason_code: ServerIdleSuspendReasonCodeV1::RecentInput,
                                fleet_generation: snap.generation,
                                activity_revision: Some(epoch_activity_revision),
                            }),
                        );
                        emit_event(
                            event_writer.as_deref(),
                            ServerIdleSuspendEventTypeV1::TerminalRejected,
                            Some(&ctx.correlation_id),
                            Some(ctx.mode),
                            IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                                reason_code: ServerIdleSuspendReasonCodeV1::RecentInput,
                                fleet_generation: Some(snap.generation),
                                activity_revision: Some(epoch_activity_revision),
                            }),
                        );
                    }
                }
                arm_deadline = None;
                publish_status_checked(
                    &status_tx,
                    Some(&*event_sink),
                    state,
                    &startup_policy,
                    quiet_period_seconds,
                    wake_after_seconds,
                    &mut status_revision,
                    current_epoch,
                    pty_manager.fleet_snapshot(),
                    arm_deadline,
                    &last_outcome,
                    &detail,
                    current_observation.as_ref(),
                    reconciling,
                    warning_onset_ms,
                    last_qualifying_activity_at,
                    false,
                    Some(epoch_activity_revision) == last_attempted_epoch_activity_revision,
                );
                } else if is_agent_free_policy {
                if let Some(r) = active_consent.as_mut() {
                    r.state = ConsentState::Cancelled;
                }
                free_anchor = None;
                free_anchor_nfg = None;
                free_since_ms = None;
                eligible_at_ms = None;
                if agent_free_phase != AgentFreePhase::HandedOff {
                    agent_free_phase = AgentFreePhase::Blocked;
                    agent_free_reason = Some(AgentFreeReasonCode::SafetyInvalidation);
                }
                publish_agent_free_status_checked(
                    &status_tx,
                    Some(&*event_sink),
                    state,
                    &startup_policy,
                    quiet_period_seconds,
                    wake_after_seconds,
                    &mut status_revision,
                    current_epoch,
                    pty_manager.fleet_snapshot(),
                    &last_outcome,
                    &detail,
                    Some(IdleSuspendAgentFreeStatusV1 {
                        phase: agent_free_phase,
                        scope: "managed-terminals".to_string(),
                        inventory_state,
                        inventory_revision,
                        semantic_revision,
                        idle_count,
                        blocked_count,
                        working_count,
                        unknown_count,
                        free_since_ms,
                        eligible_at_ms,
                        deferred_until_ms,
                        reason_code: agent_free_reason,
                    }),
                    Some(client_presence.snapshot()),
                    active_consent.as_ref().map(|r| r.to_status()),
                );
            }
            }

            // Recurring 2-second scheduled background observation tick (agent-activity policy only)
            _ = cadence_interval.tick(), if is_agent_policy || is_agent_free_policy => {
                if is_agent_policy {
                if let Some(s) = &sampler {
                    if pending_final_request.is_none() {
                        let req = SampleRequest::new(
                            next_request_id,
                            SampleKind::Scheduled,
                            activity_revision,
                            epoch_activity_revision,
                            status_revision,
                            Instant::now(),
                        );
                        next_request_id = next_request_id.wrapping_add(1).max(1);
                        s.try_send_scheduled(req);
                    }
                }
                } else if is_agent_free_policy {
                if !startup_policy.enabled || in_flight_suspend.is_some() {
                    continue;
                }

                // 1. Deferral check
                if let Some(deadline) = deferred_until {
                    if Instant::now() >= deadline {
                        deferred_until = None;
                        deferred_until_ms = None;
                        if free_anchor.is_some() {
                            agent_free_phase = AgentFreePhase::Tracking;
                        } else {
                            agent_free_phase = AgentFreePhase::Reconciling;
                            agent_free_reason = Some(AgentFreeReasonCode::Reconciling);
                        }
                    } else {
                        agent_free_phase = AgentFreePhase::Deferred;
                    }
                }

                // 2. Non-free generation check
                let current_nfg = agent_status.non_free_generation();
                if current_nfg > last_seen_non_free_gen {
                    last_seen_non_free_gen = current_nfg;
                    if free_anchor.is_some() {
                        free_anchor = None;
                        free_anchor_nfg = None;
                        free_since_ms = None;
                        eligible_at_ms = None;
                        if let Some(r) = active_consent.as_mut() {
                            r.state = ConsentState::Cancelled;
                        }
                        if agent_free_phase == AgentFreePhase::Tracking
                            || agent_free_phase == AgentFreePhase::AwaitingConsent
                            || agent_free_phase == AgentFreePhase::Approved
                            || agent_free_phase == AgentFreePhase::FinalCheck
                        {
                            agent_free_phase = AgentFreePhase::Blocked;
                            agent_free_reason = Some(AgentFreeReasonCode::SafetyInvalidation);
                        }
                    }
                }

                // 3. Unanswered timeout check
                if agent_free_phase == AgentFreePhase::AwaitingConsent {
                    if let Some(req) = active_consent.as_mut() {
                        if req.decision.is_none() && Instant::now() >= req.expires_at {
                            req.state = ConsentState::Expired;
                            agent_free_phase = AgentFreePhase::Deferred;
                            agent_free_reason = Some(AgentFreeReasonCode::UnansweredTimeout);
                            let defer_dur = Duration::from_secs(quiet_period_seconds);
                            deferred_until = Some(Instant::now() + defer_dur);
                            deferred_until_ms = Some(IdleSuspendStatusV1::now_ms() + defer_dur.as_millis() as u64);
                            free_anchor = None;
                            free_anchor_nfg = None;
                            free_since_ms = None;
                            eligible_at_ms = None;
                        }
                    }
                }

                // 4. Last client disconnect check
                let pres = client_presence.snapshot();
                if agent_free_phase == AgentFreePhase::AwaitingConsent || agent_free_phase == AgentFreePhase::Approved {
                    if pres.connection_count == 0 && pres.pending_upgrade_count == 0 {
                        if let Some(r) = active_consent.as_mut() {
                            r.state = ConsentState::Cancelled;
                        }
                        agent_free_phase = AgentFreePhase::Deferred;
                        agent_free_reason = Some(AgentFreeReasonCode::LastClientDisconnected);
                        let defer_dur = Duration::from_secs(quiet_period_seconds);
                        deferred_until = Some(Instant::now() + defer_dur);
                        deferred_until_ms = Some(IdleSuspendStatusV1::now_ms() + defer_dur.as_millis() as u64);
                        free_anchor = None;
                        free_anchor_nfg = None;
                        free_since_ms = None;
                        eligible_at_ms = None;
                    }
                }

                // 5. Managed inventory & semantic evaluation
                let pty_snapshot = pty_manager.capture_activity_snapshot();
                let prep_res = process_discovery.prepare_sample(
                    &pty_snapshot,
                    &startup_policy.agent_executables,
                    Instant::now() + Duration::from_millis(100),
                );
                match prep_res {
                    Err(_) => {
                        inventory_state = AgentFreeInventoryState::Degraded;
                        inventory_revision = inventory_revision.wrapping_add(1);
                        free_anchor = None;
                        free_anchor_nfg = None;
                        free_since_ms = None;
                        eligible_at_ms = None;
                        idle_count = None;
                        blocked_count = None;
                        working_count = None;
                        unknown_count = None;
                        if deferred_until.is_none() {
                            agent_free_phase = AgentFreePhase::Blocked;
                            agent_free_reason = Some(AgentFreeReasonCode::Unavailable);
                        }
                    }
                    Ok(prepared) => {
                        inventory_state = AgentFreeInventoryState::Consistent;
                        inventory_revision = inventory_revision.wrapping_add(1);
                        let sample = process_discovery.commit_sample(prepared);
                        let matched_agents = sample.matched_agents;
                        let now_ms = IdleSuspendStatusV1::now_ms();
                        let eval = agent_status.evaluate_managed_agents_with_details(
                            &matched_agents,
                            &sample.uncovered_retained_processes,
                            now_ms,
                            Some(Instant::now()),
                        );
                        semantic_revision = agent_status.revision();
                        match eval {
                            AgentSemanticEvaluation::Free { idle_count: ic, blocked_count: bc, .. } => {
                                idle_count = Some(ic as u32);
                                blocked_count = Some(bc as u32);
                                working_count = Some(0);
                                unknown_count = Some(0);
                                    if free_anchor.is_none() {
                                        let now = Instant::now();
                                        free_anchor = Some(now);
                                        free_anchor_nfg = Some(current_nfg);
                                        free_since_ms = Some(now_ms);
                                        let el_ms = now_ms + quiet_period_seconds * 1000;
                                        eligible_at_ms = Some(el_ms);
                                        if deferred_until.is_none() {
                                            agent_free_phase = AgentFreePhase::Tracking;
                                            agent_free_reason = if ic == 0 && bc == 0 {
                                                Some(AgentFreeReasonCode::NoAgents)
                                            } else {
                                                Some(AgentFreeReasonCode::AllFree)
                                            };
                                        }
                                    } else {
                                        let anchor = free_anchor.unwrap();
                                        let elapsed = Instant::now().duration_since(anchor);
                                        let defer_active = deferred_until.is_some();
                                        if !defer_active && elapsed > Duration::from_secs(quiet_period_seconds) {
                                            let pres_now = client_presence.snapshot();
                                            if pres_now.connection_count > 0 {
                                                if agent_free_phase == AgentFreePhase::Tracking {
                                                    let req_id = format!("consent-{}", uuid::Uuid::new_v4());
                                                    let req_rev = next_consent_request_seq;
                                                    next_consent_request_seq = next_consent_request_seq.wrapping_add(1);
                                                    let req_at = Instant::now();
                                                    let req_at_ms = IdleSuspendStatusV1::now_ms();
                                                    let exp_at = req_at + Duration::from_secs(UNANSWERED_CONSENT_TIMEOUT_SECONDS);
                                                    let exp_at_ms = req_at_ms + UNANSWERED_CONSENT_TIMEOUT_SECONDS * 1000;
                                                    active_consent = Some(ActiveConsentRequest {
                                                        request_id: req_id,
                                                        request_revision: req_rev,
                                                        requested_at: req_at,
                                                        requested_at_ms: req_at_ms,
                                                        expires_at: exp_at,
                                                        expires_at_ms: exp_at_ms,
                                                        wake_after_seconds,
                                                        decision: None,
                                                        state: ConsentState::Pending,
                                                        approving_connection_id: None,
                                                        approving_actor: None,
                                                    });
                                                    agent_free_phase = AgentFreePhase::AwaitingConsent;
                                                    agent_free_reason = Some(AgentFreeReasonCode::AllFree);
                                                }
                                            } else if pres_now.pending_upgrade_count > 0 {
                                                // Pending upgrade, wait
                                            } else {
                                                // Zero clients
                                                if agent_free_phase == AgentFreePhase::Tracking {
                                                    agent_free_phase = AgentFreePhase::FinalCheck;
                                                    agent_free_reason = Some(AgentFreeReasonCode::AllFree);
                                                    attempt_agent_free_final_check(
                                                        false,
                                                        &mut agent_free_phase,
                                                        &mut agent_free_reason,
                                                        &mut active_consent,
                                                        &mut deferred_until,
                                                        &mut deferred_until_ms,
                                                        &mut free_anchor,
                                                        &mut free_anchor_nfg,
                                                        &mut free_since_ms,
                                                        &mut eligible_at_ms,
                                                        &mut inventory_state,
                                                        &mut inventory_revision,
                                                        &mut semantic_revision,
                                                        &mut idle_count,
                                                        &mut blocked_count,
                                                        &mut working_count,
                                                        &mut unknown_count,
                                                        &mut next_request_id,
                                                        &mut next_consent_request_seq,
                                                        &mut state,
                                                        &mut in_flight_suspend,
                                                        &mut active_attempt,
                                                        &mut status_revision,
                                                        &client_presence,
                                                        auth_service.as_ref(),
                                                        &agent_status,
                                                        &mut process_discovery,
                                                        &pty_manager,
                                                        &startup_policy,
                                                        &runtime_timing,
                                                        &executor,
                                                        event_writer.as_deref(),
                                                        wake_after_seconds,
                                                        quiet_period_seconds,
                                                    ).await;
                                                }
                                            }
                                        }
                                    }
                            }
                            AgentSemanticEvaluation::Working { working_count: wc, .. } => {
                                working_count = Some(wc as u32);
                                free_anchor = None;
                                free_anchor_nfg = None;
                                free_since_ms = None;
                                eligible_at_ms = None;
                                if let Some(r) = active_consent.as_mut() {
                                    r.state = ConsentState::Cancelled;
                                }
                                if deferred_until.is_none() {
                                    agent_free_phase = AgentFreePhase::Blocked;
                                    agent_free_reason = Some(AgentFreeReasonCode::Working);
                                }
                            }
                            AgentSemanticEvaluation::Unknown { reason, .. } => {
                                unknown_count = Some(1);
                                free_anchor = None;
                                free_anchor_nfg = None;
                                free_since_ms = None;
                                eligible_at_ms = None;
                                if let Some(r) = active_consent.as_mut() {
                                    r.state = ConsentState::Cancelled;
                                }
                                if deferred_until.is_none() {
                                    agent_free_phase = AgentFreePhase::Blocked;
                                    agent_free_reason = Some(match reason {
                                        AgentSemanticBlockReason::ExpiredLease { .. } => AgentFreeReasonCode::Expired,
                                        AgentSemanticBlockReason::AmbiguousOwner { .. } => AgentFreeReasonCode::Ambiguous,
                                        _ => AgentFreeReasonCode::Unknown,
                                    });
                                }
                            }
                        }
                    }
                }

                publish_agent_free_status_checked(
                    &status_tx,
                    Some(&*event_sink),
                    state,
                    &startup_policy,
                    quiet_period_seconds,
                    wake_after_seconds,
                    &mut status_revision,
                    current_epoch,
                    pty_manager.fleet_snapshot(),
                    &last_outcome,
                    &detail,
                    Some(IdleSuspendAgentFreeStatusV1 {
                        phase: agent_free_phase,
                        scope: "managed-terminals".to_string(),
                        inventory_state,
                        inventory_revision,
                        semantic_revision,
                        idle_count,
                        blocked_count,
                        working_count,
                        unknown_count,
                        free_since_ms,
                        eligible_at_ms,
                        deferred_until_ms,
                        reason_code: agent_free_reason,
                    }),
                    Some(client_presence.snapshot()),
                    active_consent.as_ref().map(|r| r.to_status()),
                );
            }
            }

            // Activity sampler result received from dedicated worker thread
            res_opt = async {
                if let Some(rx) = sampler_rx.as_mut() {
                    rx.recv().await
                } else {
                    std::future::pending::<Option<ActivitySamplerResult>>().await
                }
            }, if is_agent_policy => {
                let Some(res) = res_opt else {
                    break;
                };

                let observation = res.observation;
                activity_revision = observation.activity_revision;
                epoch_activity_revision = observation.epoch_activity_revision;
                // Availability transition check
                let is_avail = observation.is_available();
                if prior_measurement_available != Some(is_avail) {
                    if is_avail {
                        if prior_measurement_available.is_some() {
                            emit_event(
                                event_writer.as_deref(),
                                ServerIdleSuspendEventTypeV1::MeasurementRecovered,
                                None,
                                None,
                                IdleSuspendEventDataV1::MeasurementRecovered(MeasurementRecoveredDataV1 {
                                    activity_revision,
                                }),
                            );
                        }
                        prior_measurement_available = Some(true);
                    } else {
                        emit_event(
                            event_writer.as_deref(),
                            ServerIdleSuspendEventTypeV1::MeasurementUnavailable,
                            None,
                            None,
                            IdleSuspendEventDataV1::MeasurementUnavailable(MeasurementUnavailableDataV1 {
                                reason_code: ServerIdleSuspendReasonCodeV1::MeasurementUnavailable,
                            }),
                        );
                        prior_measurement_available = Some(false);
                    }
                }

                // Update continuous warning onset tracking
                if observation.is_available() {
                    warning_onset_ms = None;
                    reconciling = false;
                } else if warning_onset_ms.is_none() {
                    warning_onset_ms = Some(IdleSuspendStatusV1::now_ms());
                }
                // Handle genuine activity vs baseline
                match observation.delta {
                    ActivityDelta::Genuine(_) => {
                        last_qualifying_activity_at = Some(Instant::now());
                        seen_non_quiescent = true;
                        quiet_anchor = Some(Instant::now());
                        if let Some(s) = &sampler {
                            if pending_final_request.take().is_some() {
                                s.cancel_current();
                            }
                        }
                        if state == CoordinatorState::Armed || state == CoordinatorState::FinalCheck {
                            state = CoordinatorState::Watching;
                            if let Some(ctx) = active_attempt.take() {
                                let snap = pty_manager.fleet_snapshot();
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::ArmCancelled,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::ArmCancelled(ArmCancelledDataV1 {
                                        reason_code: ServerIdleSuspendReasonCodeV1::RecentOutput,
                                        fleet_generation: snap.generation,
                                        activity_revision: Some(epoch_activity_revision),
                                    }),
                                );
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::TerminalRejected,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                                        reason_code: ServerIdleSuspendReasonCodeV1::RecentOutput,
                                        fleet_generation: Some(snap.generation),
                                        activity_revision: Some(epoch_activity_revision),
                                    }),
                                );
                            }
                        }
                    }
                    ActivityDelta::BaselineEstablished => {
                        baseline_established = true;
                        if quiet_anchor.is_none() {
                            quiet_anchor = Some(Instant::now());
                        }
                    }
                    ActivityDelta::Unchanged => {}
                }

                // If this is the response to our pending final request, evaluate admission
                if res.request.kind == SampleKind::Final {
                    if let Some(pending_req) = pending_final_request.take() {
                        let now = Instant::now();
                        let is_current = res.request.request_id == pending_req.request_id
                            && observation.is_available()
                            && observation.delta == ActivityDelta::Unchanged
                            && Some(epoch_activity_revision) != last_attempted_epoch_activity_revision
                            && observation.completed_at <= pending_req.deadline
                            && now.saturating_duration_since(observation.completed_at) <= MAX_ACCEPTED_OBSERVATION_AGE;

                        let ticket_valid = res.ticket.as_ref().map(|t| now >= t.eligibility_deadline).unwrap_or(false);

                        if is_current && ticket_valid {
                            let snap = pty_manager.fleet_snapshot();
                            if let Some(ctx) = active_attempt.as_ref() {
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::FinalCheckCompleted,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::FinalCheckCompleted(FinalCheckCompletedDataV1 {
                                        accepted: true,
                                        reason_code: None,
                                        fleet_generation: snap.generation,
                                        activity_revision: Some(epoch_activity_revision),
                                    }),
                                );
                            }

                            let ticket = res.ticket.as_ref().unwrap();
                            let admission = AgentActivityAdmission {
                                ticket,
                                automatic_policy: startup_policy.automatic_policy,
                                automatic_enabled: startup_policy.enabled,
                                accepted_request_id: pending_req.request_id,
                                accepted_activity_revision: activity_revision,
                                accepted_epoch_activity_revision: epoch_activity_revision,
                                accepted_timing_revision: pending_req.timing_revision,
                                now,
                            };

                            match pty_manager.try_claim_agent_activity_handoff(admission) {
                                Ok(claim) => {
                                    last_attempted_epoch_activity_revision = Some(epoch_activity_revision);
                                    state = CoordinatorState::HandedOff;
                                    arm_deadline = None;
                                    if let Some(ctx) = active_attempt.as_ref() {
                                        emit_event(
                                            event_writer.as_deref(),
                                            ServerIdleSuspendEventTypeV1::HandoffClaimAccepted,
                                            Some(&ctx.correlation_id),
                                            Some(ctx.mode),
                                            IdleSuspendEventDataV1::HandoffClaimAccepted(HandoffClaimAcceptedDataV1 {
                                                fleet_generation: claim.generation,
                                            }),
                                        );
                                        emit_event(
                                            event_writer.as_deref(),
                                            ServerIdleSuspendEventTypeV1::HelperRequestDispatched,
                                            Some(&ctx.correlation_id),
                                            Some(ctx.mode),
                                            IdleSuspendEventDataV1::HelperRequestDispatched(HelperRequestDispatchedDataV1 {
                                                wake_after_seconds,
                                            }),
                                        );
                                    }
                                    let req_id = active_attempt.as_ref()
                                        .map(|c| c.correlation_id.as_str().to_string())
                                        .unwrap_or_else(|| ActionCorrelationId::new_v4().as_str().to_string());
                                    let req = SuspendWithRtcWakeRequest {
                                        request_id: req_id,
                                        wake_after_seconds,
                                    };
                                    let exec = Arc::clone(&executor);
                                    in_flight_suspend = Some(Box::pin(async move {
                                        exec.execute_suspend(req).await
                                    }));
                                }
                                Err(err) => {
                                    tracing::warn!("Agent activity handoff admission denied: {:?}", err);
                                    state = CoordinatorState::Watching;
                                    arm_deadline = None;
                                    if let Some(ctx) = active_attempt.take() {
                                        let reason = match err {
                                            crate::pty::fleet_state::HandoffClaimError::GenerationMismatch { .. } => {
                                                 ServerIdleSuspendReasonCodeV1::StaleFleetGeneration
                                             }
                                             crate::pty::fleet_state::HandoffClaimError::NotQuiescent => {
                                                 ServerIdleSuspendReasonCodeV1::ActiveFleet
                                             }
                                             crate::pty::fleet_state::HandoffClaimError::HandoffAlreadyActive => {
                                                 ServerIdleSuspendReasonCodeV1::HandoffBusy
                                             }
                                             _ => ServerIdleSuspendReasonCodeV1::HandoffLost,
                                         };
                                         emit_event(
                                             event_writer.as_deref(),
                                             ServerIdleSuspendEventTypeV1::HandoffClaimRejected,
                                             Some(&ctx.correlation_id),
                                             Some(ctx.mode),
                                             IdleSuspendEventDataV1::HandoffClaimRejected(HandoffClaimRejectedDataV1 {
                                                 reason_code: reason,
                                                 expected_fleet_generation: None,
                                                 actual_fleet_generation: None,
                                             }),
                                         );
                                         emit_event(
                                             event_writer.as_deref(),
                                             ServerIdleSuspendEventTypeV1::TerminalRejected,
                                             Some(&ctx.correlation_id),
                                             Some(ctx.mode),
                                             IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                                                 reason_code: reason,
                                                 fleet_generation: Some(snap.generation),
                                                 activity_revision: Some(epoch_activity_revision),
                                             }),
                                         );
                                     }
                                 }
                            }
                        } else {
                            // Final sample was late, stale, or unavailable: abort claim without spending epoch
                            state = CoordinatorState::Watching;
                            arm_deadline = None;
                            if let Some(ctx) = active_attempt.take() {
                                let snap = pty_manager.fleet_snapshot();
                                let reason = if !observation.is_available() {
                                    ServerIdleSuspendReasonCodeV1::MeasurementUnavailable
                                } else if observation.delta != ActivityDelta::Unchanged {
                                    ServerIdleSuspendReasonCodeV1::RecentOutput
                                } else if Some(epoch_activity_revision) == last_attempted_epoch_activity_revision {
                                    ServerIdleSuspendReasonCodeV1::StaleActivityRevision
                                } else {
                                    ServerIdleSuspendReasonCodeV1::FinalCheckFailed
                                };
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::FinalCheckCompleted,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::FinalCheckCompleted(FinalCheckCompletedDataV1 {
                                        accepted: false,
                                        reason_code: Some(reason),
                                        fleet_generation: snap.generation,
                                        activity_revision: Some(epoch_activity_revision),
                                    }),
                                );
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::TerminalRejected,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                                        reason_code: reason,
                                        fleet_generation: Some(snap.generation),
                                        activity_revision: Some(epoch_activity_revision),
                                    }),
                                );
                            }
                        }
                    }
                }

                // Update countdown arming for agent policy
                if (state == CoordinatorState::Watching || state == CoordinatorState::Armed) && startup_policy.enabled && !reconciling && baseline_established {
                    let snap = pty_manager.fleet_snapshot();
                    let lifecycle_clear = snap.creating_count == 0
                        && snap.restart_pending_count == 0
                        && !snap.closing
                        && !snap.disposing
                        && !snap.handoff_active;

                    let epoch_eligible = Some(epoch_activity_revision) != last_attempted_epoch_activity_revision;
                    let qualifying_context = seen_non_quiescent;

                    if observation.is_available() && lifecycle_clear && epoch_eligible && qualifying_context {
                        let anchor = quiet_anchor.unwrap_or(Instant::now());
                        let deadline_instant = anchor + Duration::from_secs(quiet_period_seconds);
                        arm_deadline = Some(tokio::time::Instant::from_std(deadline_instant));
                        if state == CoordinatorState::Watching {
                            state = CoordinatorState::Armed;
                        }
                        if active_attempt.is_none() {
                            let timing_rev = runtime_timing.try_read().map(|r| r.status_revision).unwrap_or(1);
                            let ctx = AttemptContext::new_automatic(
                                snap.generation,
                                Some(epoch_activity_revision),
                                timing_rev,
                                status_revision,
                                wake_after_seconds,
                            );
                            emit_event(
                                event_writer.as_deref(),
                                ServerIdleSuspendEventTypeV1::AttemptStarted,
                                Some(&ctx.correlation_id),
                                Some(ctx.mode),
                                IdleSuspendEventDataV1::AttemptStarted(AttemptStartedDataV1 {
                                    fleet_generation: ctx.fleet_generation,
                                    activity_revision: ctx.activity_revision,
                                    timing_revision: ctx.timing_revision,
                                    status_revision: ctx.status_revision,
                                    wake_after_seconds: ctx.wake_after_seconds,
                                }),
                            );
                            emit_event(
                                event_writer.as_deref(),
                                ServerIdleSuspendEventTypeV1::ArmStarted,
                                Some(&ctx.correlation_id),
                                Some(ctx.mode),
                                IdleSuspendEventDataV1::ArmStarted(ArmStartedDataV1 {
                                    fleet_generation: ctx.fleet_generation,
                                    activity_revision: ctx.activity_revision,
                                    quiet_period_seconds,
                                    deadline_after_seconds: quiet_period_seconds,
                                }),
                            );
                            active_attempt = Some(ctx);
                        }
                    } else {
                        arm_deadline = None;
                        if state == CoordinatorState::Armed {
                            state = CoordinatorState::Watching;
                            if let Some(ctx) = active_attempt.take() {
                                let reason = if !observation.is_available() {
                                    ServerIdleSuspendReasonCodeV1::RecentInput
                                } else if !lifecycle_clear {
                                    ServerIdleSuspendReasonCodeV1::ActiveFleet
                                } else {
                                    ServerIdleSuspendReasonCodeV1::RecentInput
                                };
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::ArmCancelled,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::ArmCancelled(ArmCancelledDataV1 {
                                        reason_code: reason,
                                        fleet_generation: snap.generation,
                                        activity_revision: Some(epoch_activity_revision),
                                    }),
                                );
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::TerminalRejected,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                                        reason_code: reason,
                                        fleet_generation: Some(snap.generation),
                                        activity_revision: Some(epoch_activity_revision),
                                    }),
                                );
                            }
                        }
                    }
                }

                current_observation = Some(observation);

                publish_status_checked(
                    &status_tx,
                    Some(&*event_sink),
                    state,
                    &startup_policy,
                    quiet_period_seconds,
                    wake_after_seconds,
                    &mut status_revision,
                    current_epoch,
                    pty_manager.fleet_snapshot(),
                    arm_deadline,
                    &last_outcome,
                    &detail,
                    current_observation.as_ref(),
                    reconciling,
                    warning_onset_ms,
                    last_qualifying_activity_at,
                    arm_deadline.is_some(),
                    Some(epoch_activity_revision) == last_attempted_epoch_activity_revision,
                );
            }

            changed = fleet_watcher.changed() => {
                if changed.is_err() {
                    break;
                }
                let snapshot = fleet_watcher.snapshot();
                if is_agent_policy {
                    // Agent policy fleet watcher handles lifecycle blockers
                    if snapshot.creating_count > 0 || snapshot.restart_pending_count > 0 || snapshot.closing || snapshot.disposing {
                        if let Some(s) = &sampler {
                            if pending_final_request.take().is_some() {
                                s.cancel_current();
                            }
                        }
                        if state == CoordinatorState::Armed || state == CoordinatorState::FinalCheck {
                            state = CoordinatorState::Watching;
                            if let Some(ctx) = active_attempt.take() {
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::ArmCancelled,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::ArmCancelled(ArmCancelledDataV1 {
                                        reason_code: ServerIdleSuspendReasonCodeV1::ActiveFleet,
                                        fleet_generation: snapshot.generation,
                                        activity_revision: Some(epoch_activity_revision),
                                    }),
                                );
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::TerminalRejected,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                                        reason_code: ServerIdleSuspendReasonCodeV1::ActiveFleet,
                                        fleet_generation: Some(snapshot.generation),
                                        activity_revision: Some(epoch_activity_revision),
                                    }),
                                );
                            }
                        }
                        arm_deadline = None;
                    }
                } else {
                    let timing_rev = runtime_timing.try_read().map(|r| r.status_revision).unwrap_or(1);
                    handle_fleet(
                        snapshot,
                        &mut state,
                        &mut seen_non_quiescent,
                        &mut epoch_ready,
                        &mut current_epoch,
                        &mut arm_deadline,
                        &mut armed_generation,
                        &mut status_revision,
                        &startup_policy,
                        quiet_period_seconds,
                        wake_after_seconds,
                        timing_rev,
                        event_writer.as_deref(),
                        &mut active_attempt,
                    );
                }

                publish_status_checked(
                    &status_tx,
                    Some(&*event_sink),
                    state,
                    &startup_policy,
                    quiet_period_seconds,
                    wake_after_seconds,
                    &mut status_revision,
                    current_epoch,
                    snapshot,
                    arm_deadline,
                    &last_outcome,
                    &detail,
                    current_observation.as_ref(),
                    reconciling,
                    warning_onset_ms,
                    last_qualifying_activity_at,
                    arm_deadline.is_some(),
                    Some(epoch_activity_revision) == last_attempted_epoch_activity_revision,
                );
            }

            _ = sleep_fut => {
                if is_agent_policy {
                    // Agent policy quiet deadline reached: Enter FinalCheck and request fresh Final sample
                    arm_deadline = None;
                    state = CoordinatorState::FinalCheck;
                    let anchor = quiet_anchor.unwrap_or_else(Instant::now);
                    let eligibility_deadline = anchor + Duration::from_secs(quiet_period_seconds);
                    let req = SampleRequest::new(
                        next_request_id,
                        SampleKind::Final,
                        activity_revision,
                        epoch_activity_revision,
                        status_revision,
                        eligibility_deadline,
                    );
                    next_request_id = next_request_id.wrapping_add(1).max(1);
                    pending_final_request = Some(req);
                    if let Some(s) = &sampler {
                        s.send_final(req);
                    }
                    if let Some(ctx) = active_attempt.as_ref() {
                        let snap = pty_manager.fleet_snapshot();
                        let timing_rev = runtime_timing.try_read().map(|r| r.status_revision).unwrap_or(1);
                        emit_event(
                            event_writer.as_deref(),
                            ServerIdleSuspendEventTypeV1::FinalCheckStarted,
                            Some(&ctx.correlation_id),
                            Some(ctx.mode),
                            IdleSuspendEventDataV1::FinalCheckStarted(FinalCheckStartedDataV1 {
                                fleet_generation: snap.generation,
                                activity_revision: Some(epoch_activity_revision),
                                timing_revision: timing_rev,
                            }),
                        );
                    }
                    publish_status_checked(
                        &status_tx,
                        Some(&*event_sink),
                        state,
                        &startup_policy,
                        quiet_period_seconds,
                        wake_after_seconds,
                        &mut status_revision,
                        current_epoch,
                        pty_manager.fleet_snapshot(),
                        None,
                        &last_outcome,
                        &detail,
                        current_observation.as_ref(),
                        reconciling,
                        warning_onset_ms,
                        last_qualifying_activity_at,
                        false,
                        Some(epoch_activity_revision) == last_attempted_epoch_activity_revision,
                    );
                } else {
                    let expected_gen = armed_generation.unwrap_or(0);
                    let timing_rev = runtime_timing.try_read().map(|r| r.status_revision).unwrap_or(1);
                    if let Some(ctx) = active_attempt.as_ref() {
                        emit_event(
                            event_writer.as_deref(),
                            ServerIdleSuspendEventTypeV1::FinalCheckStarted,
                            Some(&ctx.correlation_id),
                            Some(ctx.mode),
                            IdleSuspendEventDataV1::FinalCheckStarted(FinalCheckStartedDataV1 {
                                fleet_generation: expected_gen,
                                activity_revision: None,
                                timing_revision: timing_rev,
                            }),
                        );
                        emit_event(
                            event_writer.as_deref(),
                            ServerIdleSuspendEventTypeV1::FinalCheckCompleted,
                            Some(&ctx.correlation_id),
                            Some(ctx.mode),
                            IdleSuspendEventDataV1::FinalCheckCompleted(FinalCheckCompletedDataV1 {
                                accepted: true,
                                reason_code: None,
                                fleet_generation: expected_gen,
                                activity_revision: None,
                            }),
                        );
                    }
                    let claim_res = handle_deadline(
                        &mut state,
                        &mut epoch_ready,
                        current_epoch,
                        expected_gen,
                        &mut arm_deadline,
                        &mut armed_generation,
                        &mut status_revision,
                        &last_outcome,
                        &detail,
                        &pty_manager,
                        wake_after_seconds,
                        quiet_period_seconds,
                        &status_tx,
                        &startup_policy,
                        &event_sink,
                    );
                    match claim_res {
                        Ok(claim) => {
                            if let Some(ctx) = active_attempt.as_ref() {
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::HandoffClaimAccepted,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::HandoffClaimAccepted(HandoffClaimAcceptedDataV1 {
                                        fleet_generation: claim.generation,
                                    }),
                                );
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::HelperRequestDispatched,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::HelperRequestDispatched(HelperRequestDispatchedDataV1 {
                                        wake_after_seconds,
                                    }),
                                );
                            }
                            let req_id = active_attempt.as_ref()
                                 .map(|c| c.correlation_id.as_str().to_string())
                                 .unwrap_or_else(|| ActionCorrelationId::new_v4().as_str().to_string());
                            let req = SuspendWithRtcWakeRequest {
                                request_id: req_id,
                                wake_after_seconds,
                            };
                            let exec = Arc::clone(&executor);
                            in_flight_suspend = Some(Box::pin(async move {
                                exec.execute_suspend(req).await
                            }));
                        }
                        Err(err) => {
                            if let Some(ctx) = active_attempt.take() {
                                let (reason, exp, act) = match err {
                                    crate::pty::fleet_state::HandoffClaimError::GenerationMismatch { expected, actual } => {
                                        (ServerIdleSuspendReasonCodeV1::StaleFleetGeneration, Some(expected), Some(actual))
                                    }
                                    crate::pty::fleet_state::HandoffClaimError::NotQuiescent => {
                                        (ServerIdleSuspendReasonCodeV1::ActiveFleet, None, None)
                                    }
                                    crate::pty::fleet_state::HandoffClaimError::HandoffAlreadyActive => {
                                        (ServerIdleSuspendReasonCodeV1::HandoffBusy, None, None)
                                    }
                                    _ => (ServerIdleSuspendReasonCodeV1::HandoffLost, None, None),
                                };
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::HandoffClaimRejected,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::HandoffClaimRejected(HandoffClaimRejectedDataV1 {
                                        reason_code: reason,
                                        expected_fleet_generation: exp,
                                        actual_fleet_generation: act,
                                    }),
                                );
                                emit_event(
                                    event_writer.as_deref(),
                                    ServerIdleSuspendEventTypeV1::TerminalRejected,
                                    Some(&ctx.correlation_id),
                                    Some(ctx.mode),
                                    IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                                        reason_code: reason,
                                        fleet_generation: Some(expected_gen),
                                        activity_revision: None,
                                    }),
                                );
                            }
                        }
                    }
                }
            }
        }
    }
}
#[derive(Debug, Clone)]
#[allow(dead_code)]
struct ActiveConsentRequest {
    request_id: String,
    request_revision: u64,
    requested_at: Instant,
    requested_at_ms: u64,
    expires_at: Instant,
    expires_at_ms: u64,
    wake_after_seconds: u64,
    decision: Option<ConsentDecisionValue>,
    state: ConsentState,
    approving_connection_id: Option<String>,
    approving_actor: Option<AuthenticatedActor>,
}

impl ActiveConsentRequest {
    fn to_status(&self) -> IdleSuspendConsentStatusV1 {
        IdleSuspendConsentStatusV1 {
            request_id: self.request_id.clone(),
            request_revision: self.request_revision,
            state: self.state,
            requested_at_ms: self.requested_at_ms,
            expires_at_ms: self.expires_at_ms,
            decision: self.decision.map(|d| match d {
                ConsentDecisionValue::Approve => ConsentDecision::Approve,
                ConsentDecisionValue::Deny => ConsentDecision::Deny,
            }),
            wake_after_seconds: self.wake_after_seconds,
        }
    }
}

async fn revalidate_approving_actor(
    auth_service: Option<&Arc<crate::auth::AuthService>>,
    actor: &AuthenticatedActor,
) -> bool {
    if let Some(auth) = auth_service {
        if let Some(store) = auth.store() {
            if let Ok(Some(user)) = store.get_user(&actor.subject).await {
                if !user.is_enabled {
                    return false;
                }
                if let Some(expected_av) = actor.auth_version {
                    if user.auth_version != expected_av {
                        return false;
                    }
                }
            } else {
                return false;
            }
            if let Some(sid) = &actor.session_id {
                if let Ok(Some(session)) = store.get_session(sid).await {
                    if session.revoked_at.is_some() {
                        return false;
                    }
                    let exp = crate::auth::bson_to_chrono(session.expires_at);
                    let now = chrono::Utc::now();
                    if now >= exp {
                        return false;
                    }
                    let mfa_verified_at = crate::auth::bson_to_chrono(session.mfa_verified_at);
                    let mfa_due = crate::auth::policy::compute_mfa_due_at(mfa_verified_at, exp);
                    if now >= mfa_due {
                        return false;
                    }
                    if let Some(expected_cv) = actor.credential_version {
                        if session.credential_version != expected_cv {
                            return false;
                        }
                    }
                } else {
                    return false;
                }
            }
        }
    }
    true
}

#[allow(clippy::too_many_arguments)]
async fn attempt_agent_free_final_check(
    is_client_approved: bool,
    agent_free_phase: &mut AgentFreePhase,
    agent_free_reason: &mut Option<AgentFreeReasonCode>,
    active_consent: &mut Option<ActiveConsentRequest>,
    deferred_until: &mut Option<Instant>,
    deferred_until_ms: &mut Option<u64>,
    free_anchor: &mut Option<Instant>,
    free_anchor_nfg: &mut Option<u64>,
    free_since_ms: &mut Option<u64>,
    eligible_at_ms: &mut Option<u64>,
    inventory_state: &mut AgentFreeInventoryState,
    inventory_revision: &mut u64,
    semantic_revision: &mut u64,
    idle_count: &mut Option<u32>,
    blocked_count: &mut Option<u32>,
    working_count: &mut Option<u32>,
    unknown_count: &mut Option<u32>,
    next_request_id: &mut u64,
    next_consent_request_seq: &mut u64,
    state: &mut CoordinatorState,
    in_flight_suspend: &mut Option<BoxFuture<'static, SuspendOutcome>>,
    active_attempt: &mut Option<AttemptContext>,
    status_revision: &mut u64,
    client_presence: &Arc<ClientPresenceRegistry>,
    auth_service: Option<&Arc<crate::auth::AuthService>>,
    agent_status: &crate::agent_status::AgentStatusRuntime,
    process_discovery: &mut ProcessDiscovery,
    pty_manager: &PtySessionManager,
    startup_policy: &StartupIdleSuspendPolicy,
    runtime_timing: &Arc<RwLock<RuntimeIdleSuspendTiming>>,
    executor: &Arc<dyn IdleSuspendExecutor>,
    event_writer: Option<&IdleSuspendEventWriter>,
    wake_after_seconds: u64,
    quiet_period_seconds: u64,
) {
    if is_client_approved {
        let Some(req) = active_consent.as_ref() else {
            return;
        };
        let Some(approving_conn_id) = &req.approving_connection_id else {
            return;
        };
        let Some(approving_act) = &req.approving_actor else {
            return;
        };

        let pres_snapshot = client_presence.snapshot();
        if pres_snapshot.connection_count == 0
            || !client_presence.is_connection_live(approving_conn_id)
        {
            if let Some(r) = active_consent.as_mut() {
                r.state = ConsentState::Cancelled;
            }
            *agent_free_phase = AgentFreePhase::Deferred;
            *agent_free_reason = Some(AgentFreeReasonCode::LastClientDisconnected);
            let defer_dur = Duration::from_secs(quiet_period_seconds);
            *deferred_until = Some(Instant::now() + defer_dur);
            *deferred_until_ms = Some(IdleSuspendStatusV1::now_ms() + defer_dur.as_millis() as u64);
            *free_anchor = None;
            *free_anchor_nfg = None;
            *free_since_ms = None;
            *eligible_at_ms = None;
            return;
        }

        if !revalidate_approving_actor(auth_service, approving_act).await {
            if let Some(r) = active_consent.as_mut() {
                r.state = ConsentState::Cancelled;
            }
            *agent_free_phase = AgentFreePhase::Deferred;
            *agent_free_reason = Some(AgentFreeReasonCode::SafetyInvalidation);
            let defer_dur = Duration::from_secs(quiet_period_seconds);
            *deferred_until = Some(Instant::now() + defer_dur);
            *deferred_until_ms = Some(IdleSuspendStatusV1::now_ms() + defer_dur.as_millis() as u64);
            *free_anchor = None;
            *free_anchor_nfg = None;
            *free_since_ms = None;
            *eligible_at_ms = None;
            return;
        }
    } else {
        let pres_snapshot = client_presence.snapshot();
        if pres_snapshot.connection_count > 0 {
            let req_id = format!("consent-{}", uuid::Uuid::new_v4());
            let req_rev = *next_consent_request_seq;
            *next_consent_request_seq = next_consent_request_seq.wrapping_add(1);
            let req_at = Instant::now();
            let req_at_ms = IdleSuspendStatusV1::now_ms();
            let exp_at = req_at + Duration::from_secs(UNANSWERED_CONSENT_TIMEOUT_SECONDS);
            let exp_at_ms = req_at_ms + UNANSWERED_CONSENT_TIMEOUT_SECONDS * 1000;
            *active_consent = Some(ActiveConsentRequest {
                request_id: req_id,
                request_revision: req_rev,
                requested_at: req_at,
                requested_at_ms: req_at_ms,
                expires_at: exp_at,
                expires_at_ms: exp_at_ms,
                wake_after_seconds,
                decision: None,
                state: ConsentState::Pending,
                approving_connection_id: None,
                approving_actor: None,
            });
            *agent_free_phase = AgentFreePhase::AwaitingConsent;
            *agent_free_reason = Some(AgentFreeReasonCode::AllFree);
            return;
        }
    }

    let pty_snapshot = pty_manager.capture_activity_snapshot();
    let prep_res = process_discovery.prepare_sample(
        &pty_snapshot,
        &startup_policy.agent_executables,
        Instant::now() + Duration::from_millis(100),
    );

    match prep_res {
        Err(_) => {
            *inventory_state = AgentFreeInventoryState::Degraded;
            *agent_free_phase = AgentFreePhase::Blocked;
            *agent_free_reason = Some(AgentFreeReasonCode::Unavailable);
            *free_anchor = None;
            *free_anchor_nfg = None;
            *free_since_ms = None;
            *eligible_at_ms = None;
            if let Some(r) = active_consent.as_mut() {
                r.state = ConsentState::Cancelled;
            }
        }
        Ok(prepared) => {
            *inventory_state = AgentFreeInventoryState::Consistent;
            *inventory_revision = inventory_revision.wrapping_add(1);
            let sample = process_discovery.commit_sample(prepared);
            let matched_agents = sample.matched_agents;
            let roots = pty_snapshot
                .roots
                .iter()
                .filter_map(|r| {
                    r.qualification
                        .process_identity()
                        .map(|pid| (r.terminal.clone(), pid))
                })
                .collect::<Vec<_>>();
            let now_ms = IdleSuspendStatusV1::now_ms();
            let eval = agent_status.evaluate_managed_agents_with_details(
                &matched_agents,
                &sample.uncovered_retained_processes,
                now_ms,
                Some(Instant::now()),
            );
            *semantic_revision = agent_status.revision();
            match eval {
                AgentSemanticEvaluation::Free {
                    idle_count: ic,
                    blocked_count: bc,
                    min_lease_remaining_ms,
                    non_free_generation: nfg,
                    semantic_revision: s_rev,
                } => {
                    *idle_count = Some(ic as u32);
                    *blocked_count = Some(bc as u32);
                    *working_count = Some(0);
                    *unknown_count = Some(0);

                    if free_anchor.is_none()
                        || free_anchor_nfg.is_none()
                        || free_anchor_nfg.unwrap() != nfg
                        || Instant::now().duration_since(free_anchor.unwrap())
                            <= Duration::from_secs(quiet_period_seconds)
                    {
                        *agent_free_phase = AgentFreePhase::Blocked;
                        *agent_free_reason = Some(AgentFreeReasonCode::SafetyInvalidation);
                        *free_anchor = None;
                        *free_anchor_nfg = None;
                        *free_since_ms = None;
                        *eligible_at_ms = None;
                        if let Some(r) = active_consent.as_mut() {
                            r.state = ConsentState::Cancelled;
                        }
                        return;
                    }

                    let matched_evidence = matched_agents
                        .iter()
                        .map(|m| ManagedAgentClaimEvidence {
                            identity: m.identity,
                            terminal: m.terminal.clone(),
                            safe_executable_identity: m.safe_executable_identity.clone(),
                            is_idle: true,
                        })
                        .collect();

                    let timing_rev = runtime_timing
                        .try_read()
                        .map(|r| r.status_revision)
                        .unwrap_or(1);
                    let ticket = AgentFreeClaimTicket {
                        request_id: *next_request_id,
                        completed_at: Instant::now(),
                        semantic_revision: s_rev,
                        non_free_generation: free_anchor_nfg.unwrap(),
                        timing_revision: timing_rev,
                        fleet_generation: pty_snapshot.fleet.generation,
                        input_revision: pty_manager.input_revision(),
                        roots,
                        matched_agents: matched_evidence,
                        idle_count: ic,
                        blocked_count: bc,
                        min_lease_remaining_ms,
                        eligibility_deadline: free_anchor.unwrap()
                            + Duration::from_secs(quiet_period_seconds),
                    };
                    *next_request_id = next_request_id.wrapping_add(1).max(1);

                    let admission = AgentFreeAdmission {
                        ticket: &ticket,
                        automatic_policy: IdleSuspendAutomaticPolicy::AgentFree,
                        automatic_enabled: true,
                        accepted_request_id: ticket.request_id,
                        accepted_semantic_revision: ticket.semantic_revision,
                        accepted_non_free_generation: ticket.non_free_generation,
                        accepted_timing_revision: ticket.timing_revision,
                        now: Instant::now(),
                    };

                    match pty_manager.try_claim_agent_free_handoff(admission) {
                        Ok(_handoff_claim) => {
                            let mut presence_claimed = true;
                            if !is_client_approved {
                                let pres_rev = client_presence.snapshot().revision;
                                match client_presence.try_claim_no_client_fence(pres_rev) {
                                    Ok(_) => {}
                                    Err(PresenceClaimError::LiveConnectionsPresent { .. })
                                    | Err(PresenceClaimError::PendingUpgradesPresent { .. }) => {
                                        pty_manager.release_handoff();
                                        let req_id = format!("consent-{}", uuid::Uuid::new_v4());
                                        let req_rev = *next_consent_request_seq;
                                        *next_consent_request_seq =
                                            next_consent_request_seq.wrapping_add(1);
                                        let req_at = Instant::now();
                                        let req_at_ms = IdleSuspendStatusV1::now_ms();
                                        let exp_at = req_at
                                            + Duration::from_secs(
                                                UNANSWERED_CONSENT_TIMEOUT_SECONDS,
                                            );
                                        let exp_at_ms =
                                            req_at_ms + UNANSWERED_CONSENT_TIMEOUT_SECONDS * 1000;
                                        *active_consent = Some(ActiveConsentRequest {
                                            request_id: req_id,
                                            request_revision: req_rev,
                                            requested_at: req_at,
                                            requested_at_ms: req_at_ms,
                                            expires_at: exp_at,
                                            expires_at_ms: exp_at_ms,
                                            wake_after_seconds,
                                            decision: None,
                                            state: ConsentState::Pending,
                                            approving_connection_id: None,
                                            approving_actor: None,
                                        });
                                        *agent_free_phase = AgentFreePhase::AwaitingConsent;
                                        *agent_free_reason = Some(AgentFreeReasonCode::AllFree);
                                        presence_claimed = false;
                                    }
                                    Err(_) => {
                                        pty_manager.release_handoff();
                                        *agent_free_phase = AgentFreePhase::Blocked;
                                        *free_anchor_nfg = None;
                                        *free_since_ms = None;
                                        *eligible_at_ms = None;
                                        presence_claimed = false;
                                    }
                                }
                            } else {
                                let req = active_consent.as_ref().unwrap();
                                let conn_id = req.approving_connection_id.as_deref().unwrap_or("");
                                let act = req.approving_actor.as_ref().unwrap();
                                match client_presence.try_claim_approved_client_fence(conn_id, act)
                                {
                                    Ok(_) => {}
                                    Err(_) => {
                                        pty_manager.release_handoff();
                                        if let Some(r) = active_consent.as_mut() {
                                            r.state = ConsentState::Cancelled;
                                        }
                                        *agent_free_phase = AgentFreePhase::Deferred;
                                        *agent_free_reason =
                                            Some(AgentFreeReasonCode::LastClientDisconnected);
                                        let defer_dur = Duration::from_secs(quiet_period_seconds);
                                        *deferred_until = Some(Instant::now() + defer_dur);
                                        *deferred_until_ms = Some(
                                            IdleSuspendStatusV1::now_ms()
                                                + defer_dur.as_millis() as u64,
                                        );
                                        *free_anchor = None;
                                        *free_anchor_nfg = None;
                                        *free_since_ms = None;
                                        *eligible_at_ms = None;
                                        presence_claimed = false;
                                    }
                                }
                            }

                            if presence_claimed {
                                let attempt_ctx = AttemptContext::new_automatic(
                                    pty_snapshot.fleet.generation,
                                    None,
                                    ticket.timing_revision,
                                    *status_revision,
                                    wake_after_seconds,
                                );
                                emit_event(
                                    event_writer,
                                    ServerIdleSuspendEventTypeV1::FinalCheckCompleted,
                                    Some(&attempt_ctx.correlation_id),
                                    Some(attempt_ctx.mode),
                                    IdleSuspendEventDataV1::FinalCheckCompleted(
                                        FinalCheckCompletedDataV1 {
                                            accepted: true,
                                            reason_code: None,
                                            fleet_generation: pty_snapshot.fleet.generation,
                                            activity_revision: None,
                                        },
                                    ),
                                );
                                emit_event(
                                    event_writer,
                                    ServerIdleSuspendEventTypeV1::HandoffClaimAccepted,
                                    Some(&attempt_ctx.correlation_id),
                                    Some(attempt_ctx.mode),
                                    IdleSuspendEventDataV1::HandoffClaimAccepted(
                                        HandoffClaimAcceptedDataV1 {
                                            fleet_generation: pty_snapshot.fleet.generation,
                                        },
                                    ),
                                );
                                emit_event(
                                    event_writer,
                                    ServerIdleSuspendEventTypeV1::HelperRequestDispatched,
                                    Some(&attempt_ctx.correlation_id),
                                    Some(attempt_ctx.mode),
                                    IdleSuspendEventDataV1::HelperRequestDispatched(
                                        HelperRequestDispatchedDataV1 { wake_after_seconds },
                                    ),
                                );
                                *active_attempt = Some(attempt_ctx);
                                let suspend_req = SuspendWithRtcWakeRequest {
                                    request_id: format!("req-{}", uuid::Uuid::new_v4()),
                                    wake_after_seconds,
                                };
                                let exec = Arc::clone(executor);
                                let presence = Arc::clone(client_presence);
                                let maybe_approving_conn = if is_client_approved {
                                    active_consent
                                        .as_ref()
                                        .and_then(|r| r.approving_connection_id.clone())
                                } else {
                                    None
                                };
                                *in_flight_suspend = Some(Box::pin(async move {
                                    if let Some(conn_id) = &maybe_approving_conn {
                                        if !presence.is_connection_live(conn_id) {
                                            tracing::warn!("Approving socket lost before physical dispatch — cancelling suspend");
                                            return SuspendOutcome::ExecutionFailed {
                                                request_id: suspend_req.request_id,
                                                error: "Approving client disconnected before physical dispatch".to_string(),
                                            };
                                        }
                                    }
                                    exec.execute_suspend(suspend_req).await
                                }));
                                *state = CoordinatorState::HandedOff;
                                *agent_free_phase = AgentFreePhase::HandedOff;
                            }
                        }
                        Err(err) => {
                            tracing::warn!("Agent-free PTY handoff claim rejected: {err:?}");
                            *agent_free_phase = AgentFreePhase::Blocked;
                            *agent_free_reason = Some(AgentFreeReasonCode::Ambiguous);
                            *free_anchor = None;
                            *free_since_ms = None;
                            *free_anchor_nfg = None;
                            *eligible_at_ms = None;
                            if let Some(r) = active_consent.as_mut() {
                                r.state = ConsentState::Cancelled;
                            }
                        }
                    }
                }
                AgentSemanticEvaluation::Working {
                    working_count: wc, ..
                } => {
                    *working_count = Some(wc as u32);
                    *agent_free_phase = AgentFreePhase::Blocked;
                    *agent_free_reason = Some(AgentFreeReasonCode::Working);
                    *free_anchor = None;
                    *free_since_ms = None;
                    *free_anchor_nfg = None;
                    *eligible_at_ms = None;
                    if let Some(r) = active_consent.as_mut() {
                        r.state = ConsentState::Cancelled;
                    }
                }
                AgentSemanticEvaluation::Unknown { reason, .. } => {
                    *unknown_count = Some(1);
                    *agent_free_phase = AgentFreePhase::Blocked;
                    *agent_free_reason = Some(match reason {
                        AgentSemanticBlockReason::ExpiredLease { .. } => {
                            AgentFreeReasonCode::Expired
                        }
                        AgentSemanticBlockReason::AmbiguousOwner { .. } => {
                            AgentFreeReasonCode::Ambiguous
                        }
                        _ => AgentFreeReasonCode::Unknown,
                    });
                    *free_anchor = None;
                    *free_since_ms = None;
                    *free_anchor_nfg = None;
                    *eligible_at_ms = None;
                    if let Some(r) = active_consent.as_mut() {
                        r.state = ConsentState::Cancelled;
                    }
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn publish_agent_free_status_checked(
    tx: &watch::Sender<IdleSuspendStatusV1>,
    event_sink: Option<&dyn crate::pty::EventSink>,
    state: CoordinatorState,
    startup_policy: &StartupIdleSuspendPolicy,
    quiet_period_seconds: u64,
    wake_after_seconds: u64,
    status_revision: &mut u64,
    current_epoch: u64,
    fleet_snapshot: PtyFleetSnapshot,
    last_outcome: &Option<SuspendOutcome>,
    detail: &Option<String>,
    agent_free: Option<IdleSuspendAgentFreeStatusV1>,
    client_presence: Option<IdleSuspendClientPresenceStatusV1>,
    consent: Option<IdleSuspendConsentStatusV1>,
) {
    let new_status = IdleSuspendStatusV1 {
        version: 1,
        status_revision: *status_revision,
        state,
        automatic_policy: startup_policy.automatic_policy,
        enabled: startup_policy.enabled,
        timing_mutable: startup_policy.enabled && state != CoordinatorState::HandedOff,
        timing_mutable_reason: if !startup_policy.enabled {
            Some("disabled".to_string())
        } else if state == CoordinatorState::HandedOff {
            Some("handoffInProgress".to_string())
        } else {
            None
        },
        capability_code: startup_policy.capability_selection.as_str().to_string(),
        current_epoch,
        quiet_period_seconds,
        wake_after_seconds,
        min_quiet_period_seconds: MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
        max_quiet_period_seconds: MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
        min_wake_after_seconds: MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
        max_wake_after_seconds: MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
        fleet_snapshot,
        arm_deadline_ms: None,
        last_outcome: last_outcome.clone(),
        detail: detail.clone(),
        activity: None,
        agent_free,
        client_presence,
        consent,
        timestamp_ms: IdleSuspendStatusV1::now_ms(),
    };

    let prev = tx.borrow().clone();
    if new_status.is_meaningful_change(&prev) {
        *status_revision = status_revision.wrapping_add(1);
        let mut final_status = new_status;
        final_status.status_revision = *status_revision;
        if let Some(sink) = event_sink {
            sink.send_idle_suspend_changed(*status_revision);
        }
        let _ = tx.send(final_status);
    } else {
        let _ = tx.send(new_status);
    }
}

// ---------------------------------------------------------------------------
// Helpers and Handlers
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
fn publish_status_checked(
    tx: &watch::Sender<IdleSuspendStatusV1>,
    event_sink: Option<&dyn crate::pty::EventSink>,
    state: CoordinatorState,
    startup_policy: &StartupIdleSuspendPolicy,
    quiet_period_seconds: u64,
    wake_after_seconds: u64,
    status_revision: &mut u64,
    current_epoch: u64,
    fleet_snapshot: PtyFleetSnapshot,
    arm_deadline: Option<tokio::time::Instant>,
    last_outcome: &Option<SuspendOutcome>,
    detail: &Option<String>,
    current_observation: Option<&ActivityObservation>,
    reconciling: bool,
    warning_onset_ms: Option<u64>,
    last_qualifying_activity_at: Option<Instant>,
    is_armed: bool,
    epoch_spent: bool,
) {
    let arm_deadline_ms = arm_deadline.map(|d| {
        let now = tokio::time::Instant::now();
        let sys_now = IdleSuspendStatusV1::now_ms();
        if d > now {
            sys_now.saturating_add((d - now).as_millis() as u64)
        } else {
            sys_now
        }
    });

    let activity = if startup_policy.automatic_policy == IdleSuspendAutomaticPolicy::AgentActivity {
        let measurement_state = if reconciling {
            ActivityMeasurementState::Initializing
        } else if let Some(obs) = current_observation {
            obs.measurement_state
        } else {
            ActivityMeasurementState::Initializing
        };

        let lifecycle_busy =
            fleet_snapshot.creating_count > 0 || fleet_snapshot.restart_pending_count > 0;

        let reason_code = if reconciling {
            Some(ActivityObservationReason::Reconciling)
        } else if let Some(obs) = current_observation {
            if !obs.is_available() {
                obs.reason
            } else if lifecycle_busy {
                Some(ActivityObservationReason::LifecycleBusy)
            } else if epoch_spent {
                Some(ActivityObservationReason::EpochSpent)
            } else if !is_armed && arm_deadline.is_none() && obs.is_available() {
                Some(ActivityObservationReason::Quiet)
            } else {
                obs.reason
            }
        } else {
            Some(ActivityObservationReason::Reconciling)
        };

        let measurement_warning = if measurement_state != ActivityMeasurementState::Available {
            let reason_code = match current_observation.and_then(|o| o.failure_reason) {
                Some(r) => match r {
                    ActivityUnavailableReason::ProcAccess => {
                        MeasurementWarningReasonCode::ProcAccess
                    }
                    ActivityUnavailableReason::ScanLimit => MeasurementWarningReasonCode::ScanLimit,
                    ActivityUnavailableReason::ScanTimeout => {
                        MeasurementWarningReasonCode::ScanTimeout
                    }
                    ActivityUnavailableReason::SocketDiagnostics => {
                        MeasurementWarningReasonCode::SocketDiagnostics
                    }
                    ActivityUnavailableReason::UnsupportedTransport => {
                        MeasurementWarningReasonCode::UnsupportedTransport
                    }
                    ActivityUnavailableReason::NamespaceMismatch => {
                        MeasurementWarningReasonCode::NamespaceMismatch
                    }
                    ActivityUnavailableReason::StaleObservation => {
                        MeasurementWarningReasonCode::StaleObservation
                    }
                    ActivityUnavailableReason::IdentityUncertain => {
                        MeasurementWarningReasonCode::IdentityUncertain
                    }
                    ActivityUnavailableReason::CounterOverflow => {
                        MeasurementWarningReasonCode::CounterOverflow
                    }
                    ActivityUnavailableReason::Reconciling => {
                        MeasurementWarningReasonCode::Reconciling
                    }
                },
                None => MeasurementWarningReasonCode::Reconciling,
            };

            let (processes, processes_truncated) = if let Some(obs) = current_observation {
                if let Some(ctx) = &obs.failure_context {
                    let mut procs: Vec<IdleSuspendWarningProcessV1> = ctx
                        .processes
                        .iter()
                        .map(|p| IdleSuspendWarningProcessV1 {
                            pid: p.process.pid,
                            executable_identity: p.safe_executable_identity.clone(),
                        })
                        .collect();
                    procs.sort_by_key(|p| p.pid);
                    procs.dedup_by_key(|p| p.pid);
                    let truncated = procs.len() > 32;
                    procs.truncate(32);
                    (procs, truncated)
                } else {
                    (Vec::new(), false)
                }
            } else {
                (Vec::new(), false)
            };

            Some(IdleSuspendMeasurementWarningV1 {
                reason_code,
                blocked_since_ms: warning_onset_ms.unwrap_or_else(IdleSuspendStatusV1::now_ms),
                processes,
                processes_truncated,
            })
        } else {
            None
        };

        Some(IdleSuspendActivityStatusV1 {
            measurement_state,
            reason_code,
            recognized_agent_count: current_observation.and_then(|o| o.recognized_agent_count),
            monitored_terminal_count: current_observation.and_then(|o| o.monitored_terminal_count),
            sampled_at_ms: current_observation.map(|_| IdleSuspendStatusV1::now_ms()),
            last_activity_at_ms: last_qualifying_activity_at.map(|t| {
                let elapsed = t.elapsed();
                IdleSuspendStatusV1::now_ms().saturating_sub(elapsed.as_millis() as u64)
            }),
            network_coverage: "tcp4-tcp6".to_string(),
            measurement_warning,
        })
    } else {
        None
    };
    let (agent_free, client_presence, consent) =
        if startup_policy.automatic_policy == IdleSuspendAutomaticPolicy::AgentFree {
            let prev = tx.borrow();
            (
                prev.agent_free.clone().or_else(|| {
                    Some(IdleSuspendAgentFreeStatusV1 {
                        phase: AgentFreePhase::Reconciling,
                        scope: "managed-terminals".to_string(),
                        inventory_state: AgentFreeInventoryState::Uninitialized,
                        inventory_revision: 0,
                        semantic_revision: 0,
                        idle_count: None,
                        blocked_count: None,
                        working_count: None,
                        unknown_count: None,
                        free_since_ms: None,
                        eligible_at_ms: None,
                        deferred_until_ms: None,
                        reason_code: Some(AgentFreeReasonCode::Reconciling),
                    })
                }),
                prev.client_presence.clone().or_else(|| {
                    Some(IdleSuspendClientPresenceStatusV1 {
                        connection_count: 0,
                        pending_upgrade_count: 0,
                        revision: 0,
                        available: false,
                    })
                }),
                prev.consent.clone(),
            )
        } else {
            (None, None, None)
        };

    let new_status = IdleSuspendStatusV1 {
        version: 1,
        status_revision: *status_revision,
        state,
        automatic_policy: startup_policy.automatic_policy,
        enabled: startup_policy.enabled,
        timing_mutable: startup_policy.enabled && state != CoordinatorState::HandedOff,
        timing_mutable_reason: if !startup_policy.enabled {
            Some("disabled".to_string())
        } else if state == CoordinatorState::HandedOff {
            Some("handoffInProgress".to_string())
        } else {
            None
        },
        capability_code: startup_policy.capability_selection.as_str().to_string(),
        current_epoch,
        quiet_period_seconds,
        wake_after_seconds,
        min_quiet_period_seconds: MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
        max_quiet_period_seconds: MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS,
        min_wake_after_seconds: MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
        max_wake_after_seconds: MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
        fleet_snapshot,
        arm_deadline_ms,
        last_outcome: last_outcome.clone(),
        detail: detail.clone(),
        activity,
        agent_free,
        client_presence,
        consent,
        timestamp_ms: IdleSuspendStatusV1::now_ms(),
    };

    let prev = tx.borrow().clone();
    if new_status.is_meaningful_change(&prev) {
        *status_revision = status_revision.wrapping_add(1);
        let mut final_status = new_status;
        final_status.status_revision = *status_revision;
        if let Some(sink) = event_sink {
            sink.send_idle_suspend_changed(*status_revision);
        }
        let _ = tx.send(final_status);
    } else {
        let _ = tx.send(new_status);
    }
}

#[allow(clippy::too_many_arguments)]
async fn handle_timing(
    cmd: UpdateTimingCommand,
    state: &mut CoordinatorState,
    status_revision: &mut u64,
    arm_deadline: &mut Option<tokio::time::Instant>,
    armed_generation: &mut Option<u64>,
    quiet_period_seconds: &mut u64,
    wake_after_seconds: &mut u64,
    startup_policy: &StartupIdleSuspendPolicy,
    runtime_timing: &Arc<RwLock<RuntimeIdleSuspendTiming>>,
    timing_store: Option<&IdleSuspendTimingStore>,
    server_audit: Option<&IdleSuspendServerAudit>,
    pty_manager: &PtySessionManager,
    epoch_ready: bool,
    is_agent_policy: bool,
    quiet_anchor: &mut Option<Instant>,
    baseline_established: bool,
    last_attempted_epoch_activity_revision: Option<u64>,
    epoch_activity_revision: u64,
) -> CoordinatorTimingResult {
    let cur_quiet = *quiet_period_seconds;
    let cur_wake = *wake_after_seconds;

    if let Err(e) = validate_timing_pair_for_policy(
        cmd.quiet_period_seconds,
        cmd.wake_after_seconds,
        startup_policy.automatic_policy,
    ) {
        if let Some(audit) = server_audit {
            if let Ok(rec) = TimingAuditRecord::new(
                cmd.actor.clone(),
                cur_quiet,
                cur_wake,
                cmd.quiet_period_seconds,
                cmd.wake_after_seconds,
                format!("tx-{}", *status_revision),
                TimingAuditResult::RejectedInvalidInput,
            ) {
                let _ = audit.record_timing_event(&rec);
            }
        }
        return CoordinatorTimingResult::ValidationFailed(e.to_string());
    }

    if *state == CoordinatorState::HandedOff || pty_manager.fleet_snapshot().handoff_active {
        if let Some(audit) = server_audit {
            if let Ok(rec) = TimingAuditRecord::new(
                cmd.actor.clone(),
                cur_quiet,
                cur_wake,
                cmd.quiet_period_seconds,
                cmd.wake_after_seconds,
                format!("tx-{}", *status_revision),
                TimingAuditResult::RejectedHandoffInProgress,
            ) {
                let _ = audit.record_timing_event(&rec);
            }
        }
        return CoordinatorTimingResult::HandoffInProgress;
    }

    let tx_id = format!("tx-{}", *status_revision);
    if let Some(audit) = server_audit {
        let rec = match TimingAuditRecord::new(
            cmd.actor.clone(),
            cur_quiet,
            cur_wake,
            cmd.quiet_period_seconds,
            cmd.wake_after_seconds,
            tx_id.clone(),
            TimingAuditResult::Admitted,
        ) {
            Ok(r) => r,
            Err(e) => return CoordinatorTimingResult::AuditFailed(e.to_string()),
        };
        if let Err(e) = audit.record_timing_event(&rec) {
            return CoordinatorTimingResult::AuditFailed(e.to_string());
        }
    }

    if let Some(store) = timing_store {
        if let Err(e) = store.persist_timing_pair_for_policy(
            cmd.quiet_period_seconds,
            cmd.wake_after_seconds,
            startup_policy.automatic_policy,
        ) {
            if let Some(audit) = server_audit {
                if let Ok(rec) = TimingAuditRecord::new(
                    cmd.actor.clone(),
                    cur_quiet,
                    cur_wake,
                    cmd.quiet_period_seconds,
                    cmd.wake_after_seconds,
                    tx_id.clone(),
                    TimingAuditResult::PersistenceFailed,
                ) {
                    let _ = audit.record_timing_event(&rec);
                }
            }
            return CoordinatorTimingResult::PersistenceFailed(e.to_string());
        }
    }

    if let Some(audit) = server_audit {
        if let Ok(rec) = TimingAuditRecord::new(
            cmd.actor.clone(),
            cur_quiet,
            cur_wake,
            cmd.quiet_period_seconds,
            cmd.wake_after_seconds,
            tx_id,
            TimingAuditResult::Committed,
        ) {
            let _ = audit.record_timing_event(&rec);
        }
    }

    let changed = cur_quiet != cmd.quiet_period_seconds || cur_wake != cmd.wake_after_seconds;
    *quiet_period_seconds = cmd.quiet_period_seconds;
    *wake_after_seconds = cmd.wake_after_seconds;
    let _ = runtime_timing
        .write()
        .await
        .apply_update(cmd.quiet_period_seconds, cmd.wake_after_seconds);

    if changed {
        *status_revision = status_revision.wrapping_add(1);

        if is_agent_policy {
            if startup_policy.enabled
                && baseline_established
                && Some(epoch_activity_revision) != last_attempted_epoch_activity_revision
            {
                let anchor = Instant::now();
                *quiet_anchor = Some(anchor);
                let deadline = anchor + Duration::from_secs(cmd.quiet_period_seconds);
                *arm_deadline = Some(tokio::time::Instant::from_std(deadline));
                if *state == CoordinatorState::Watching {
                    *state = CoordinatorState::Armed;
                }
            }
        } else if *state == CoordinatorState::Armed {
            *arm_deadline = None;
            *armed_generation = None;
            *state = CoordinatorState::Watching;

            let snap = pty_manager.fleet_snapshot();
            if snap.is_quiescent() && epoch_ready && startup_policy.enabled {
                *state = CoordinatorState::Armed;
                *arm_deadline = Some(
                    tokio::time::Instant::now() + Duration::from_secs(cmd.quiet_period_seconds),
                );
                *armed_generation = Some(snap.generation);
            }
        }
    }

    CoordinatorTimingResult::Success {
        changed,
        status_revision: *status_revision,
        quiet_period_seconds: cmd.quiet_period_seconds,
        wake_after_seconds: cmd.wake_after_seconds,
    }
}

fn handle_fleet(
    snapshot: PtyFleetSnapshot,
    state: &mut CoordinatorState,
    seen_non_quiescent: &mut bool,
    epoch_ready: &mut bool,
    current_epoch: &mut u64,
    arm_deadline: &mut Option<tokio::time::Instant>,
    armed_generation: &mut Option<u64>,
    status_revision: &mut u64,
    startup_policy: &StartupIdleSuspendPolicy,
    quiet_period_seconds: u64,
    wake_after_seconds: u64,
    timing_revision: u64,
    event_writer: Option<&IdleSuspendEventWriter>,
    active_attempt: &mut Option<AttemptContext>,
) {
    if !startup_policy.enabled {
        *state = CoordinatorState::Disabled;
        return;
    }

    if *state == CoordinatorState::HandedOff {
        return;
    }

    if *state == CoordinatorState::Armed {
        if !snapshot.is_quiescent() {
            *arm_deadline = None;
            *armed_generation = None;
            *state = CoordinatorState::Watching;
            *seen_non_quiescent = true;
            *status_revision = status_revision.wrapping_add(1);
            if let Some(ctx) = active_attempt.take() {
                emit_event(
                    event_writer,
                    ServerIdleSuspendEventTypeV1::ArmCancelled,
                    Some(&ctx.correlation_id),
                    Some(ctx.mode),
                    IdleSuspendEventDataV1::ArmCancelled(ArmCancelledDataV1 {
                        reason_code: ServerIdleSuspendReasonCodeV1::ActiveFleet,
                        fleet_generation: snapshot.generation,
                        activity_revision: None,
                    }),
                );
                emit_event(
                    event_writer,
                    ServerIdleSuspendEventTypeV1::TerminalRejected,
                    Some(&ctx.correlation_id),
                    Some(ctx.mode),
                    IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                        reason_code: ServerIdleSuspendReasonCodeV1::ActiveFleet,
                        fleet_generation: Some(snapshot.generation),
                        activity_revision: None,
                    }),
                );
            }
        } else if Some(snapshot.generation) != *armed_generation {
            *arm_deadline = None;
            *armed_generation = None;
            *state = CoordinatorState::Watching;
            *status_revision = status_revision.wrapping_add(1);
            if let Some(ctx) = active_attempt.take() {
                emit_event(
                    event_writer,
                    ServerIdleSuspendEventTypeV1::ArmCancelled,
                    Some(&ctx.correlation_id),
                    Some(ctx.mode),
                    IdleSuspendEventDataV1::ArmCancelled(ArmCancelledDataV1 {
                        reason_code: ServerIdleSuspendReasonCodeV1::StaleFleetGeneration,
                        fleet_generation: snapshot.generation,
                        activity_revision: None,
                    }),
                );
                emit_event(
                    event_writer,
                    ServerIdleSuspendEventTypeV1::TerminalRejected,
                    Some(&ctx.correlation_id),
                    Some(ctx.mode),
                    IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                        reason_code: ServerIdleSuspendReasonCodeV1::StaleFleetGeneration,
                        fleet_generation: Some(snapshot.generation),
                        activity_revision: None,
                    }),
                );
            }
        }
    } else if !snapshot.is_quiescent() {
        *seen_non_quiescent = true;
        if *state != CoordinatorState::Watching {
            *state = CoordinatorState::Watching;
            *status_revision = status_revision.wrapping_add(1);
        }
    } else if *seen_non_quiescent {
        *seen_non_quiescent = false;
        *epoch_ready = true;
        *current_epoch = current_epoch.wrapping_add(1);
        *state = CoordinatorState::Armed;
        *arm_deadline =
            Some(tokio::time::Instant::now() + Duration::from_secs(quiet_period_seconds));
        *armed_generation = Some(snapshot.generation);
        *status_revision = status_revision.wrapping_add(1);

        let ctx = AttemptContext::new_automatic(
            snapshot.generation,
            None,
            timing_revision,
            *status_revision,
            wake_after_seconds,
        );
        emit_event(
            event_writer,
            ServerIdleSuspendEventTypeV1::AttemptStarted,
            Some(&ctx.correlation_id),
            Some(ctx.mode),
            IdleSuspendEventDataV1::AttemptStarted(AttemptStartedDataV1 {
                fleet_generation: ctx.fleet_generation,
                activity_revision: None,
                timing_revision: ctx.timing_revision,
                status_revision: ctx.status_revision,
                wake_after_seconds: ctx.wake_after_seconds,
            }),
        );
        emit_event(
            event_writer,
            ServerIdleSuspendEventTypeV1::ArmStarted,
            Some(&ctx.correlation_id),
            Some(ctx.mode),
            IdleSuspendEventDataV1::ArmStarted(ArmStartedDataV1 {
                fleet_generation: ctx.fleet_generation,
                activity_revision: None,
                quiet_period_seconds,
                deadline_after_seconds: quiet_period_seconds,
            }),
        );
        *active_attempt = Some(ctx);
    }
}

fn handle_deadline(
    state: &mut CoordinatorState,
    epoch_ready: &mut bool,
    _current_epoch: u64,
    expected_gen: u64,
    arm_deadline: &mut Option<tokio::time::Instant>,
    armed_generation: &mut Option<u64>,
    status_revision: &mut u64,
    _last_outcome: &Option<SuspendOutcome>,
    _detail: &Option<String>,
    pty_manager: &PtySessionManager,
    _wake_after_seconds: u64,
    _quiet_period_seconds: u64,
    _status_tx: &watch::Sender<IdleSuspendStatusV1>,
    _startup_policy: &StartupIdleSuspendPolicy,
    _event_sink: &Arc<dyn crate::pty::EventSink>,
) -> Result<crate::pty::fleet_state::HandoffClaim, crate::pty::fleet_state::HandoffClaimError> {
    *arm_deadline = None;
    *armed_generation = None;
    *state = CoordinatorState::FinalCheck;
    *status_revision = status_revision.wrapping_add(1);

    match pty_manager.try_claim_handoff(expected_gen) {
        Ok(claim) => {
            *state = CoordinatorState::HandedOff;
            *status_revision = status_revision.wrapping_add(1);
            Ok(claim)
        }
        Err(err) => {
            tracing::warn!("Handoff claim rejected at deadline: {:?}", err);
            *state = CoordinatorState::Watching;
            *epoch_ready = false;
            *status_revision = status_revision.wrapping_add(1);
            Err(err)
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_outcome(
    outcome: SuspendOutcome,
    state: &mut CoordinatorState,
    epoch_ready: &mut bool,
    current_epoch: u64,
    status_revision: &mut u64,
    last_outcome: &mut Option<SuspendOutcome>,
    detail: &mut Option<String>,
    pty_manager: &PtySessionManager,
    wake_after_seconds: u64,
    quiet_period_seconds: u64,
    status_tx: &watch::Sender<IdleSuspendStatusV1>,
    startup_policy: &StartupIdleSuspendPolicy,
    event_sink: &Arc<dyn crate::pty::EventSink>,
    is_agent_policy: bool,
    reconciling: &mut bool,
    sampler: &Option<ActivitySampler>,
    next_request_id: &mut u64,
    activity_revision: u64,
    epoch_activity_revision: u64,
    current_observation: Option<&ActivityObservation>,
    warning_onset_ms: Option<u64>,
    last_qualifying_activity_at: Option<Instant>,
    epoch_spent: bool,
) {
    *last_outcome = Some(outcome.clone());

    match outcome {
        SuspendOutcome::ResumedSuccessfully { .. } => {
            *state = CoordinatorState::Resumed;
            *detail = None;
        }
        SuspendOutcome::RejectedFleetActive { reason, .. } => {
            *state = CoordinatorState::Suppressed;
            *detail = Some(format!("fleet active: {reason}"));
        }
        SuspendOutcome::BlockedByInhibitor { inhibitor, .. } => {
            *state = CoordinatorState::Suppressed;
            *detail = Some(format!("inhibited by {inhibitor}"));
        }
        SuspendOutcome::UnsupportedCapability { detail: d, .. } => {
            *state = CoordinatorState::Suppressed;
            *detail = Some(format!("unsupported capability: {d}"));
        }
        SuspendOutcome::ExecutionFailed { error, .. } => {
            *state = CoordinatorState::Failed;
            *detail = Some(format!("suspend failed: {error}"));
        }
    }

    pty_manager.release_handoff();
    *epoch_ready = false;

    if is_agent_policy {
        *reconciling = true;
        if let Some(s) = sampler {
            let req = SampleRequest::new(
                *next_request_id,
                SampleKind::Recovery,
                activity_revision,
                epoch_activity_revision,
                *status_revision,
                Instant::now(),
            );
            *next_request_id = next_request_id.wrapping_add(1).max(1);
            s.send_recovery(req);
        }
    }

    publish_status_checked(
        status_tx,
        Some(event_sink.as_ref()),
        *state,
        startup_policy,
        quiet_period_seconds,
        wake_after_seconds,
        status_revision,
        current_epoch,
        pty_manager.fleet_snapshot(),
        None,
        last_outcome,
        detail,
        current_observation,
        *reconciling,
        warning_onset_ms,
        last_qualifying_activity_at,
        false,
        epoch_spent,
    );
}

#[allow(clippy::too_many_arguments)]
async fn handle_force_suspend(
    cmd: ForceSuspendCommand,
    state: &mut CoordinatorState,
    status_revision: &mut u64,
    arm_deadline: &mut Option<tokio::time::Instant>,
    armed_generation: &mut Option<u64>,
    executor: &Arc<dyn IdleSuspendExecutor>,
    pty_manager: &PtySessionManager,
    server_audit: Option<&IdleSuspendServerAudit>,
    in_flight_suspend_active: bool,
    timing_revision: u64,
    event_writer: Option<&IdleSuspendEventWriter>,
) -> (
    CoordinatorForceSuspendResult,
    Option<BoxFuture<'static, SuspendOutcome>>,
    Option<ManualAuditRecord>,
    Option<AttemptContext>,
) {
    let actor = match validate_actor(&cmd.actor) {
        Ok(a) => a,
        Err(_) => {
            return (
                CoordinatorForceSuspendResult::ValidationFailed(
                    "Actor identifier invalid or exceeds maximum length".into(),
                ),
                None,
                None,
                None,
            );
        }
    };

    if let Err(e) = validate_suspend_wake_seconds(cmd.wake_after_seconds) {
        let snapshot = pty_manager.fleet_snapshot();
        let request_id = ActionCorrelationId::new_v4().as_str().to_string();
        if let Some(audit) = server_audit {
            if let Ok(rec) = ManualAuditRecord::new(
                actor.clone(),
                request_id,
                cmd.wake_after_seconds,
                cmd.force,
                false,
                snapshot.generation,
                snapshot.live_count,
                snapshot.creating_count,
                snapshot.restart_pending_count,
                ManualAuditResult::RejectedValidation,
            ) {
                let _ = audit.record_manual_event(&rec);
            }
        }
        return (
            CoordinatorForceSuspendResult::ValidationFailed(e.to_string()),
            None,
            None,
            None,
        );
    }

    let snapshot_init = pty_manager.fleet_snapshot();
    let ctx = AttemptContext::new_manual(
        snapshot_init.generation,
        timing_revision,
        *status_revision,
        cmd.wake_after_seconds,
    );
    let request_id = ctx.correlation_id.as_str().to_string();

    emit_event(
        event_writer,
        ServerIdleSuspendEventTypeV1::AttemptStarted,
        Some(&ctx.correlation_id),
        Some(ctx.mode),
        IdleSuspendEventDataV1::AttemptStarted(AttemptStartedDataV1 {
            fleet_generation: snapshot_init.generation,
            activity_revision: None,
            timing_revision,
            status_revision: *status_revision,
            wake_after_seconds: cmd.wake_after_seconds,
        }),
    );

    if *state == CoordinatorState::HandedOff
        || pty_manager.fleet_snapshot().handoff_active
        || in_flight_suspend_active
    {
        let snapshot = pty_manager.fleet_snapshot();
        if let Some(audit) = server_audit {
            if let Ok(rec) = ManualAuditRecord::new(
                actor.clone(),
                request_id.clone(),
                cmd.wake_after_seconds,
                cmd.force,
                false,
                snapshot.generation,
                snapshot.live_count,
                snapshot.creating_count,
                snapshot.restart_pending_count,
                ManualAuditResult::RejectedHandoffInProgress,
            ) {
                let _ = audit.record_manual_event(&rec);
            }
        }
        emit_event(
            event_writer,
            ServerIdleSuspendEventTypeV1::TerminalRejected,
            Some(&ctx.correlation_id),
            Some(ctx.mode),
            IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                reason_code: ServerIdleSuspendReasonCodeV1::HandoffBusy,
                fleet_generation: Some(snapshot.generation),
                activity_revision: None,
            }),
        );
        return (
            CoordinatorForceSuspendResult::HandoffInProgress,
            None,
            None,
            None,
        );
    }

    // Bounded capability probe (3s timeout)
    let has_capability = tokio::time::timeout(Duration::from_secs(3), executor.check_capability())
        .await
        .unwrap_or_default();

    if !has_capability {
        let snapshot = pty_manager.fleet_snapshot();
        if let Some(audit) = server_audit {
            if let Ok(rec) = ManualAuditRecord::new(
                actor.clone(),
                request_id.clone(),
                cmd.wake_after_seconds,
                cmd.force,
                false,
                snapshot.generation,
                snapshot.live_count,
                snapshot.creating_count,
                snapshot.restart_pending_count,
                ManualAuditResult::RejectedCapability,
            ) {
                let _ = audit.record_manual_event(&rec);
            }
        }
        emit_event(
            event_writer,
            ServerIdleSuspendEventTypeV1::TerminalRejected,
            Some(&ctx.correlation_id),
            Some(ctx.mode),
            IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                reason_code: ServerIdleSuspendReasonCodeV1::CapabilityUnsupported,
                fleet_generation: Some(snapshot.generation),
                activity_revision: None,
            }),
        );
        return (
            CoordinatorForceSuspendResult::CapabilityUnavailable(
                "Host lacks required suspend capability or capability probe failed".into(),
            ),
            None,
            None,
            None,
        );
    }

    let snapshot_before = pty_manager.fleet_snapshot();
    let is_active = !snapshot_before.is_quiescent();

    if is_active && !cmd.force {
        if let Some(audit) = server_audit {
            if let Ok(rec) = ManualAuditRecord::new(
                actor,
                request_id.clone(),
                cmd.wake_after_seconds,
                cmd.force,
                false,
                snapshot_before.generation,
                snapshot_before.live_count,
                snapshot_before.creating_count,
                snapshot_before.restart_pending_count,
                ManualAuditResult::RejectedConfirmationRequired,
            ) {
                let _ = audit.record_manual_event(&rec);
            }
        }
        emit_event(
            event_writer,
            ServerIdleSuspendEventTypeV1::TerminalRejected,
            Some(&ctx.correlation_id),
            Some(ctx.mode),
            IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                reason_code: ServerIdleSuspendReasonCodeV1::ActiveFleet,
                fleet_generation: Some(snapshot_before.generation),
                activity_revision: None,
            }),
        );
        return (
            CoordinatorForceSuspendResult::ActiveFleetRequiresConfirmation {
                fleet_snapshot: snapshot_before,
            },
            None,
            None,
            None,
        );
    }

    let effective_force = is_active && cmd.force;

    if let Some(audit) = server_audit {
        let attempt_rec = match ManualAuditRecord::new(
            actor.clone(),
            request_id.clone(),
            cmd.wake_after_seconds,
            cmd.force,
            effective_force,
            snapshot_before.generation,
            snapshot_before.live_count,
            snapshot_before.creating_count,
            snapshot_before.restart_pending_count,
            ManualAuditResult::Attempted,
        ) {
            Ok(r) => r,
            Err(e) => {
                emit_event(
                    event_writer,
                    ServerIdleSuspendEventTypeV1::TerminalRejected,
                    Some(&ctx.correlation_id),
                    Some(ctx.mode),
                    IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                        reason_code: ServerIdleSuspendReasonCodeV1::AuditWriteFailed,
                        fleet_generation: Some(snapshot_before.generation),
                        activity_revision: None,
                    }),
                );
                return (
                    CoordinatorForceSuspendResult::AuditFailed(e.to_string()),
                    None,
                    None,
                    None,
                );
            }
        };
        if let Err(e) = audit.record_manual_event(&attempt_rec) {
            emit_event(
                event_writer,
                ServerIdleSuspendEventTypeV1::TerminalRejected,
                Some(&ctx.correlation_id),
                Some(ctx.mode),
                IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                    reason_code: ServerIdleSuspendReasonCodeV1::AuditWriteFailed,
                    fleet_generation: Some(snapshot_before.generation),
                    activity_revision: None,
                }),
            );
            return (
                CoordinatorForceSuspendResult::AuditFailed(e.to_string()),
                None,
                None,
                None,
            );
        }
    }

    let claim_res = if cmd.force {
        pty_manager.try_claim_forced_handoff(snapshot_before.generation)
    } else {
        pty_manager.try_claim_handoff(snapshot_before.generation)
    };

    match claim_res {
        Ok(claim) => {
            *state = CoordinatorState::HandedOff;
            *arm_deadline = None;
            *armed_generation = None;
            *status_revision = status_revision.wrapping_add(1);

            let snapshot_after = pty_manager.fleet_snapshot();

            let manual_audit_rec = if let Some(audit) = server_audit {
                if let Ok(rec) = ManualAuditRecord::new(
                    actor,
                    request_id.clone(),
                    cmd.wake_after_seconds,
                    cmd.force,
                    effective_force,
                    claim.generation,
                    snapshot_after.live_count,
                    snapshot_after.creating_count,
                    snapshot_after.restart_pending_count,
                    ManualAuditResult::Accepted,
                ) {
                    let _ = audit.record_manual_event(&rec);
                    Some(rec)
                } else {
                    None
                }
            } else {
                None
            };

            emit_event(
                event_writer,
                ServerIdleSuspendEventTypeV1::HandoffClaimAccepted,
                Some(&ctx.correlation_id),
                Some(ctx.mode),
                IdleSuspendEventDataV1::HandoffClaimAccepted(HandoffClaimAcceptedDataV1 {
                    fleet_generation: claim.generation,
                }),
            );
            emit_event(
                event_writer,
                ServerIdleSuspendEventTypeV1::HelperRequestDispatched,
                Some(&ctx.correlation_id),
                Some(ctx.mode),
                IdleSuspendEventDataV1::HelperRequestDispatched(HelperRequestDispatchedDataV1 {
                    wake_after_seconds: cmd.wake_after_seconds,
                }),
            );

            let req = SuspendWithRtcWakeRequest {
                request_id: request_id.clone(),
                wake_after_seconds: cmd.wake_after_seconds,
            };
            let exec = Arc::clone(executor);
            let fut: BoxFuture<'static, SuspendOutcome> =
                Box::pin(async move { exec.execute_suspend(req).await });

            (
                CoordinatorForceSuspendResult::Accepted {
                    request_id,
                    status_revision: *status_revision,
                    fleet_snapshot: snapshot_after,
                },
                Some(fut),
                manual_audit_rec,
                Some(ctx),
            )
        }
        Err(err) => {
            let snapshot_err = pty_manager.fleet_snapshot();
            match err {
                crate::pty::fleet_state::HandoffClaimError::GenerationMismatch {
                    expected,
                    actual,
                } => {
                    if let Some(audit) = server_audit {
                        if let Ok(rec) = ManualAuditRecord::new(
                            actor.clone(),
                            request_id.clone(),
                            cmd.wake_after_seconds,
                            cmd.force,
                            effective_force,
                            actual,
                            snapshot_err.live_count,
                            snapshot_err.creating_count,
                            snapshot_err.restart_pending_count,
                            ManualAuditResult::RejectedConflict,
                        ) {
                            let _ = audit.record_manual_event(&rec);
                        }
                    }
                    emit_event(
                        event_writer,
                        ServerIdleSuspendEventTypeV1::HandoffClaimRejected,
                        Some(&ctx.correlation_id),
                        Some(ctx.mode),
                        IdleSuspendEventDataV1::HandoffClaimRejected(HandoffClaimRejectedDataV1 {
                            reason_code: ServerIdleSuspendReasonCodeV1::StaleFleetGeneration,
                            expected_fleet_generation: Some(expected),
                            actual_fleet_generation: Some(actual),
                        }),
                    );
                    emit_event(
                        event_writer,
                        ServerIdleSuspendEventTypeV1::TerminalRejected,
                        Some(&ctx.correlation_id),
                        Some(ctx.mode),
                        IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                            reason_code: ServerIdleSuspendReasonCodeV1::StaleFleetGeneration,
                            fleet_generation: Some(snapshot_err.generation),
                            activity_revision: None,
                        }),
                    );
                    (
                        CoordinatorForceSuspendResult::GenerationConflict {
                            expected,
                            actual,
                            fleet_snapshot: snapshot_err,
                        },
                        None,
                        None,
                        None,
                    )
                }
                crate::pty::fleet_state::HandoffClaimError::NotQuiescent => {
                    if let Some(audit) = server_audit {
                        if let Ok(rec) = ManualAuditRecord::new(
                            actor.clone(),
                            request_id.clone(),
                            cmd.wake_after_seconds,
                            cmd.force,
                            effective_force,
                            snapshot_err.generation,
                            snapshot_err.live_count,
                            snapshot_err.creating_count,
                            snapshot_err.restart_pending_count,
                            ManualAuditResult::RejectedConfirmationRequired,
                        ) {
                            let _ = audit.record_manual_event(&rec);
                        }
                    }
                    emit_event(
                        event_writer,
                        ServerIdleSuspendEventTypeV1::HandoffClaimRejected,
                        Some(&ctx.correlation_id),
                        Some(ctx.mode),
                        IdleSuspendEventDataV1::HandoffClaimRejected(HandoffClaimRejectedDataV1 {
                            reason_code: ServerIdleSuspendReasonCodeV1::ActiveFleet,
                            expected_fleet_generation: None,
                            actual_fleet_generation: None,
                        }),
                    );
                    emit_event(
                        event_writer,
                        ServerIdleSuspendEventTypeV1::TerminalRejected,
                        Some(&ctx.correlation_id),
                        Some(ctx.mode),
                        IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                            reason_code: ServerIdleSuspendReasonCodeV1::ActiveFleet,
                            fleet_generation: Some(snapshot_err.generation),
                            activity_revision: None,
                        }),
                    );
                    (
                        CoordinatorForceSuspendResult::ActiveFleetRequiresConfirmation {
                            fleet_snapshot: snapshot_err,
                        },
                        None,
                        None,
                        None,
                    )
                }
                crate::pty::fleet_state::HandoffClaimError::HandoffAlreadyActive => {
                    if let Some(audit) = server_audit {
                        if let Ok(rec) = ManualAuditRecord::new(
                            actor.clone(),
                            request_id.clone(),
                            cmd.wake_after_seconds,
                            cmd.force,
                            effective_force,
                            snapshot_err.generation,
                            snapshot_err.live_count,
                            snapshot_err.creating_count,
                            snapshot_err.restart_pending_count,
                            ManualAuditResult::RejectedHandoffInProgress,
                        ) {
                            let _ = audit.record_manual_event(&rec);
                        }
                    }
                    emit_event(
                        event_writer,
                        ServerIdleSuspendEventTypeV1::HandoffClaimRejected,
                        Some(&ctx.correlation_id),
                        Some(ctx.mode),
                        IdleSuspendEventDataV1::HandoffClaimRejected(HandoffClaimRejectedDataV1 {
                            reason_code: ServerIdleSuspendReasonCodeV1::HandoffBusy,
                            expected_fleet_generation: None,
                            actual_fleet_generation: None,
                        }),
                    );
                    emit_event(
                        event_writer,
                        ServerIdleSuspendEventTypeV1::TerminalRejected,
                        Some(&ctx.correlation_id),
                        Some(ctx.mode),
                        IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                            reason_code: ServerIdleSuspendReasonCodeV1::HandoffBusy,
                            fleet_generation: Some(snapshot_err.generation),
                            activity_revision: None,
                        }),
                    );
                    (
                        CoordinatorForceSuspendResult::HandoffInProgress,
                        None,
                        None,
                        None,
                    )
                }
                crate::pty::fleet_state::HandoffClaimError::Closing
                | crate::pty::fleet_state::HandoffClaimError::Disposing => {
                    if let Some(audit) = server_audit {
                        if let Ok(rec) = ManualAuditRecord::new(
                            actor.clone(),
                            request_id.clone(),
                            cmd.wake_after_seconds,
                            cmd.force,
                            effective_force,
                            snapshot_err.generation,
                            snapshot_err.live_count,
                            snapshot_err.creating_count,
                            snapshot_err.restart_pending_count,
                            ManualAuditResult::RejectedShuttingDown,
                        ) {
                            let _ = audit.record_manual_event(&rec);
                        }
                    }
                    emit_event(
                        event_writer,
                        ServerIdleSuspendEventTypeV1::HandoffClaimRejected,
                        Some(&ctx.correlation_id),
                        Some(ctx.mode),
                        IdleSuspendEventDataV1::HandoffClaimRejected(HandoffClaimRejectedDataV1 {
                            reason_code: ServerIdleSuspendReasonCodeV1::Shutdown,
                            expected_fleet_generation: None,
                            actual_fleet_generation: None,
                        }),
                    );
                    emit_event(
                        event_writer,
                        ServerIdleSuspendEventTypeV1::TerminalRejected,
                        Some(&ctx.correlation_id),
                        Some(ctx.mode),
                        IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                            reason_code: ServerIdleSuspendReasonCodeV1::Shutdown,
                            fleet_generation: Some(snapshot_err.generation),
                            activity_revision: None,
                        }),
                    );
                    (
                        CoordinatorForceSuspendResult::ShuttingDown,
                        None,
                        None,
                        None,
                    )
                }
                _ => {
                    emit_event(
                        event_writer,
                        ServerIdleSuspendEventTypeV1::HandoffClaimRejected,
                        Some(&ctx.correlation_id),
                        Some(ctx.mode),
                        IdleSuspendEventDataV1::HandoffClaimRejected(HandoffClaimRejectedDataV1 {
                            reason_code: ServerIdleSuspendReasonCodeV1::HandoffLost,
                            expected_fleet_generation: None,
                            actual_fleet_generation: None,
                        }),
                    );
                    emit_event(
                        event_writer,
                        ServerIdleSuspendEventTypeV1::TerminalRejected,
                        Some(&ctx.correlation_id),
                        Some(ctx.mode),
                        IdleSuspendEventDataV1::TerminalRejected(TerminalRejectedDataV1 {
                            reason_code: ServerIdleSuspendReasonCodeV1::HandoffLost,
                            fleet_generation: Some(snapshot_err.generation),
                            activity_revision: None,
                        }),
                    );
                    (
                        CoordinatorForceSuspendResult::ValidationFailed(format!("{err:?}")),
                        None,
                        None,
                        None,
                    )
                }
            }
        }
    }
}
