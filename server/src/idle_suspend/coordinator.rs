use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot, watch, RwLock};
use tokio_util::sync::CancellationToken;

use crate::config::{
    MAX_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MAX_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
    MIN_IDLE_SUSPEND_QUIET_PERIOD_SECONDS, MIN_IDLE_SUSPEND_WAKE_AFTER_SECONDS,
};
use crate::idle_suspend::executor::{BoxFuture, IdleSuspendExecutor};
use crate::idle_suspend::policy::{
    validate_timing_pair, RuntimeIdleSuspendTiming, StartupIdleSuspendPolicy,
};
use crate::idle_suspend::protocol::{
    validate_suspend_wake_seconds, SuspendOutcome, SuspendWithRtcWakeRequest,
};
use crate::idle_suspend::server_audit::{
    validate_actor, IdleSuspendServerAudit, ManualAuditRecord, ManualAuditResult,
    TimingAuditRecord, TimingAuditResult,
};
use crate::idle_suspend::status::{CoordinatorState, IdleSuspendStatusV1};
use crate::idle_suspend::timing_store::IdleSuspendTimingStore;
use crate::pty::fleet_state::{HandoffClaimError, PtyFleetSnapshot};
use crate::pty::manager::PtySessionManager;

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
    ActiveFleetRequiresConfirmation {
        fleet_snapshot: PtyFleetSnapshot,
    },
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

enum CommandMessage {
    UpdateTiming {
        cmd: UpdateTimingCommand,
        reply: oneshot::Sender<CoordinatorTimingResult>,
    },
    ForceSuspend {
        cmd: ForceSuspendCommand,
        reply: oneshot::Sender<CoordinatorForceSuspendResult>,
    },
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
    ) -> Self {
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

        let initial_status = IdleSuspendStatusV1 {
            version: 1,
            status_revision: 1,
            state: initial_state,
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
            timestamp_ms: IdleSuspendStatusV1::now_ms(),
        };

        let (status_tx, status_rx) = watch::channel(initial_status);
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
        reply_rx.await.unwrap_or(CoordinatorForceSuspendResult::ShuttingDown)
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
) {
    let initial_snapshot = fleet_watcher.snapshot();
    let mut state = if startup_policy.enabled {
        CoordinatorState::Watching
    } else {
        CoordinatorState::Disabled
    };
    let mut status_revision = 1u64;
    let mut current_epoch = 0u64;
    let mut epoch_ready = false;
    let mut seen_non_quiescent = !initial_snapshot.is_quiescent();
    let mut arm_deadline: Option<tokio::time::Instant> = None;
    let mut armed_generation: Option<u64> = None;
    let mut last_outcome: Option<SuspendOutcome> = None;
    let mut detail: Option<String> = None;
    publish_status(
        &status_tx,
        Some(&*event_sink),
        state,
        &startup_policy,
        quiet_period_seconds,
        wake_after_seconds,
        status_revision,
        current_epoch,
        initial_snapshot,
        arm_deadline,
        &last_outcome,
        &detail,
    );

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
                if state == CoordinatorState::Armed {
                    state = CoordinatorState::Watching;
                    status_revision = status_revision.wrapping_add(1);
                    publish_status(&status_tx, Some(&*event_sink), state, &startup_policy, quiet_period_seconds, wake_after_seconds, status_revision, current_epoch, pty_manager.fleet_snapshot(), None, &last_outcome, &detail);
                }
                break;
            }
            outcome = suspend_fut => {
                in_flight_suspend = None;
                if let Some(mut manual_audit_rec) = in_flight_manual_audit.take() {
                    if let Some(audit) = server_audit.as_ref() {
                        let now_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64;
                        manual_audit_rec.timestamp_ms = now_ms;
                        manual_audit_rec.result = ManualAuditResult::TerminalOutcome(outcome.clone());
                        let _ = audit.record_manual_event(&manual_audit_rec);
                    }
                }
                handle_outcome(
                    outcome,
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
                );
            }
            msg = command_rx.recv() => {
                let Some(command_msg) = msg else {
                    break;
                };
                match command_msg {
                    CommandMessage::UpdateTiming { cmd, reply } => {
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
                        ).await;
                        publish_status(&status_tx, Some(&*event_sink), state, &startup_policy, quiet_period_seconds, wake_after_seconds, status_revision, current_epoch, pty_manager.fleet_snapshot(), arm_deadline, &last_outcome, &detail);
                        let _ = reply.send(result);
                    }
                    CommandMessage::ForceSuspend { cmd, reply } => {
                        let (result, maybe_fut, maybe_audit) = handle_force_suspend(
                            cmd,
                            &mut state,
                            &mut status_revision,
                            &mut arm_deadline,
                            &mut armed_generation,
                            &executor,
                            &pty_manager,
                            server_audit.as_ref(),
                            in_flight_suspend.is_some(),
                        ).await;
                        if maybe_fut.is_some() {
                            in_flight_suspend = maybe_fut;
                            in_flight_manual_audit = maybe_audit;
                        }
                        publish_status(&status_tx, Some(&*event_sink), state, &startup_policy, quiet_period_seconds, wake_after_seconds, status_revision, current_epoch, pty_manager.fleet_snapshot(), arm_deadline, &last_outcome, &detail);
                        let _ = reply.send(result);
                    }
                }
            }
            changed = fleet_watcher.changed() => {
                if changed.is_err() {
                    break;
                }
                let snapshot = fleet_watcher.snapshot();
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
                );
                publish_status(&status_tx, Some(&*event_sink), state, &startup_policy, quiet_period_seconds, wake_after_seconds, status_revision, current_epoch, snapshot, arm_deadline, &last_outcome, &detail);
            }
            _ = sleep_fut => {
                let claimed = handle_deadline(
                    &mut state,
                    &mut epoch_ready,
                    current_epoch,
                    armed_generation.unwrap_or(0),
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
                if claimed {
                    let req = SuspendWithRtcWakeRequest {
                        request_id: format!("epoch-{}", current_epoch),
                        wake_after_seconds,
                    };
                    let exec = Arc::clone(&executor);
                    in_flight_suspend = Some(Box::pin(async move {
                        exec.execute_suspend(req).await
                    }));
                }
            }
        }
    }
}

fn publish_status(
    tx: &watch::Sender<IdleSuspendStatusV1>,
    event_sink: Option<&dyn crate::pty::EventSink>,
    state: CoordinatorState,
    startup_policy: &StartupIdleSuspendPolicy,
    quiet_period_seconds: u64,
    wake_after_seconds: u64,
    status_revision: u64,
    current_epoch: u64,
    fleet_snapshot: crate::pty::fleet_state::PtyFleetSnapshot,
    arm_deadline: Option<tokio::time::Instant>,
    last_outcome: &Option<SuspendOutcome>,
    detail: &Option<String>,
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

    let status = IdleSuspendStatusV1 {
        version: 1,
        status_revision,
        state,
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
        timestamp_ms: IdleSuspendStatusV1::now_ms(),
    };
    if let Some(sink) = event_sink {
        sink.send_idle_suspend_changed(status_revision);
    }
    let _ = tx.send(status);
}

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
) -> CoordinatorTimingResult {
    let cur_quiet = *quiet_period_seconds;
    let cur_wake = *wake_after_seconds;

    if let Err(e) = validate_timing_pair(cmd.quiet_period_seconds, cmd.wake_after_seconds) {
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
        if let Err(e) = store.persist_timing_pair(cmd.quiet_period_seconds, cmd.wake_after_seconds)
        {
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
    *status_revision = status_revision.wrapping_add(1);

    if *state == CoordinatorState::Armed {
        *arm_deadline = None;
        *armed_generation = None;
        *state = CoordinatorState::Watching;

        let snap = pty_manager.fleet_snapshot();
        if snap.is_quiescent() && epoch_ready && startup_policy.enabled {
            *state = CoordinatorState::Armed;
            *arm_deadline =
                Some(tokio::time::Instant::now() + Duration::from_secs(cmd.quiet_period_seconds));
            *armed_generation = Some(snap.generation);
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
    snapshot: crate::pty::fleet_state::PtyFleetSnapshot,
    state: &mut CoordinatorState,
    seen_non_quiescent: &mut bool,
    epoch_ready: &mut bool,
    current_epoch: &mut u64,
    arm_deadline: &mut Option<tokio::time::Instant>,
    armed_generation: &mut Option<u64>,
    status_revision: &mut u64,
    startup_policy: &StartupIdleSuspendPolicy,
    quiet_period_seconds: u64,
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
        } else if Some(snapshot.generation) != *armed_generation {
            *arm_deadline = None;
            *armed_generation = None;
            *state = CoordinatorState::Watching;
            *status_revision = status_revision.wrapping_add(1);
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
    }
}

fn handle_deadline(
    state: &mut CoordinatorState,
    epoch_ready: &mut bool,
    current_epoch: u64,
    expected_gen: u64,
    arm_deadline: &mut Option<tokio::time::Instant>,
    armed_generation: &mut Option<u64>,
    status_revision: &mut u64,
    last_outcome: &Option<SuspendOutcome>,
    detail: &Option<String>,
    pty_manager: &PtySessionManager,
    wake_after_seconds: u64,
    quiet_period_seconds: u64,
    status_tx: &watch::Sender<IdleSuspendStatusV1>,
    startup_policy: &StartupIdleSuspendPolicy,
    event_sink: &Arc<dyn crate::pty::EventSink>,
) -> bool {
    *arm_deadline = None;
    *armed_generation = None;
    *state = CoordinatorState::FinalCheck;
    *status_revision = status_revision.wrapping_add(1);

    match pty_manager.try_claim_handoff(expected_gen) {
        Ok(_claim) => {
            *state = CoordinatorState::HandedOff;
            *status_revision = status_revision.wrapping_add(1);
            let event_sink_ref = event_sink.as_ref();
            publish_status(
                status_tx,
                Some(event_sink_ref),
                *state,
                startup_policy,
                quiet_period_seconds,
                wake_after_seconds,
                *status_revision,
                current_epoch,
                pty_manager.fleet_snapshot(),
                None,
                last_outcome,
                detail,
            );
            true
        }
        Err(_) => {
            *state = CoordinatorState::Watching;
            *epoch_ready = false;
            *status_revision = status_revision.wrapping_add(1);
            let event_sink_ref = event_sink.as_ref();
            publish_status(
                status_tx,
                Some(event_sink_ref),
                *state,
                startup_policy,
                quiet_period_seconds,
                wake_after_seconds,
                *status_revision,
                current_epoch,
                pty_manager.fleet_snapshot(),
                None,
                last_outcome,
                detail,
            );
            false
        }
    }
}

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
    *status_revision = status_revision.wrapping_add(1);
    let event_sink_ref = event_sink.as_ref();
    publish_status(
        status_tx,
        Some(event_sink_ref),
        *state,
        startup_policy,
        quiet_period_seconds,
        wake_after_seconds,
        *status_revision,
        current_epoch,
        pty_manager.fleet_snapshot(),
        None,
        last_outcome,
        detail,
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
) -> (
    CoordinatorForceSuspendResult,
    Option<BoxFuture<'static, SuspendOutcome>>,
    Option<ManualAuditRecord>,
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
            );
        }
    };

    if let Err(e) = validate_suspend_wake_seconds(cmd.wake_after_seconds) {
        let snapshot = pty_manager.fleet_snapshot();
        let request_id = format!("manual-{}", uuid::Uuid::new_v4());
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
        );
    }

    let request_id = format!("manual-{}", uuid::Uuid::new_v4());

    if *state == CoordinatorState::HandedOff
        || pty_manager.fleet_snapshot().handoff_active
        || in_flight_suspend_active
    {
        let snapshot = pty_manager.fleet_snapshot();
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
                ManualAuditResult::RejectedHandoffInProgress,
            ) {
                let _ = audit.record_manual_event(&rec);
            }
        }
        return (
            CoordinatorForceSuspendResult::HandoffInProgress,
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
                request_id,
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
        return (
            CoordinatorForceSuspendResult::CapabilityUnavailable(
                "Privileged helper capability probe failed or executor is unavailable".into(),
            ),
            None,
            None,
        );
    }

    let snapshot = pty_manager.fleet_snapshot();
    let is_active = !snapshot.is_quiescent();

    if is_active && !cmd.force {
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
                ManualAuditResult::RejectedConfirmationRequired,
            ) {
                let _ = audit.record_manual_event(&rec);
            }
        }
        return (
            CoordinatorForceSuspendResult::ActiveFleetRequiresConfirmation {
                fleet_snapshot: snapshot,
            },
            None,
            None,
        );
    }

    let effective_force = is_active && cmd.force;

    // Durable actor admission audit before claiming
    if let Some(audit) = server_audit {
        let attempt_rec = match ManualAuditRecord::new(
            actor.clone(),
            request_id.clone(),
            cmd.wake_after_seconds,
            cmd.force,
            effective_force,
            snapshot.generation,
            snapshot.live_count,
            snapshot.creating_count,
            snapshot.restart_pending_count,
            ManualAuditResult::Attempted,
        ) {
            Ok(r) => r,
            Err(e) => {
                return (
                    CoordinatorForceSuspendResult::AuditFailed(e.to_string()),
                    None,
                    None,
                );
            }
        };
        if let Err(e) = audit.record_manual_event(&attempt_rec) {
            return (
                CoordinatorForceSuspendResult::AuditFailed(e.to_string()),
                None,
                None,
            );
        }
    }

    let claim_res = if effective_force {
        pty_manager.try_claim_forced_handoff(snapshot.generation)
    } else {
        pty_manager.try_claim_handoff(snapshot.generation)
    };

    match claim_res {
        Ok(_claim) => {
            let accepted_snapshot = pty_manager.fleet_snapshot();
            let accepted_rec = ManualAuditRecord::new(
                actor.clone(),
                request_id.clone(),
                cmd.wake_after_seconds,
                cmd.force,
                effective_force,
                accepted_snapshot.generation,
                accepted_snapshot.live_count,
                accepted_snapshot.creating_count,
                accepted_snapshot.restart_pending_count,
                ManualAuditResult::Accepted,
            );
            if let (Some(audit), Ok(rec)) = (server_audit, &accepted_rec) {
                let _ = audit.record_manual_event(rec);
            }

            // Cancel any automatic arming
            *arm_deadline = None;
            *armed_generation = None;

            *state = CoordinatorState::HandedOff;
            *status_revision = status_revision.wrapping_add(1);

            let req = SuspendWithRtcWakeRequest {
                request_id: request_id.clone(),
                wake_after_seconds: cmd.wake_after_seconds,
            };
            let exec = Arc::clone(executor);
            let fut = Box::pin(async move {
                exec.execute_suspend(req).await
            });

            (
                CoordinatorForceSuspendResult::Accepted {
                    request_id,
                    status_revision: *status_revision,
                    fleet_snapshot: accepted_snapshot,
                },
                Some(fut),
                accepted_rec.ok(),
            )
        }
        Err(err) => {
            let latest_snapshot = pty_manager.fleet_snapshot();
            match err {
                HandoffClaimError::GenerationMismatch { expected, actual } => {
                    if let Some(audit) = server_audit {
                        if let Ok(rec) = ManualAuditRecord::new(
                            actor.clone(),
                            request_id,
                            cmd.wake_after_seconds,
                            cmd.force,
                            effective_force,
                            latest_snapshot.generation,
                            latest_snapshot.live_count,
                            latest_snapshot.creating_count,
                            latest_snapshot.restart_pending_count,
                            ManualAuditResult::RejectedConflict,
                        ) {
                            let _ = audit.record_manual_event(&rec);
                        }
                    }
                    (
                        CoordinatorForceSuspendResult::GenerationConflict {
                            expected,
                            actual,
                            fleet_snapshot: latest_snapshot,
                        },
                        None,
                        None,
                    )
                }
                HandoffClaimError::NotQuiescent => {
                    if let Some(audit) = server_audit {
                        if let Ok(rec) = ManualAuditRecord::new(
                            actor.clone(),
                            request_id,
                            cmd.wake_after_seconds,
                            cmd.force,
                            effective_force,
                            latest_snapshot.generation,
                            latest_snapshot.live_count,
                            latest_snapshot.creating_count,
                            latest_snapshot.restart_pending_count,
                            ManualAuditResult::RejectedConfirmationRequired,
                        ) {
                            let _ = audit.record_manual_event(&rec);
                        }
                    }
                    (
                        CoordinatorForceSuspendResult::ActiveFleetRequiresConfirmation {
                            fleet_snapshot: latest_snapshot,
                        },
                        None,
                        None,
                    )
                }
                HandoffClaimError::HandoffAlreadyActive => {
                    if let Some(audit) = server_audit {
                        if let Ok(rec) = ManualAuditRecord::new(
                            actor.clone(),
                            request_id,
                            cmd.wake_after_seconds,
                            cmd.force,
                            effective_force,
                            latest_snapshot.generation,
                            latest_snapshot.live_count,
                            latest_snapshot.creating_count,
                            latest_snapshot.restart_pending_count,
                            ManualAuditResult::RejectedHandoffInProgress,
                        ) {
                            let _ = audit.record_manual_event(&rec);
                        }
                    }
                    (CoordinatorForceSuspendResult::HandoffInProgress, None, None)
                }
                HandoffClaimError::Closing | HandoffClaimError::Disposing => {
                    if let Some(audit) = server_audit {
                        if let Ok(rec) = ManualAuditRecord::new(
                            actor.clone(),
                            request_id,
                            cmd.wake_after_seconds,
                            cmd.force,
                            effective_force,
                            latest_snapshot.generation,
                            latest_snapshot.live_count,
                            latest_snapshot.creating_count,
                            latest_snapshot.restart_pending_count,
                            ManualAuditResult::RejectedShuttingDown,
                        ) {
                            let _ = audit.record_manual_event(&rec);
                        }
                    }
                    (CoordinatorForceSuspendResult::ShuttingDown, None, None)
                }
            }
        }
    }
}
