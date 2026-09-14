//! Transactional activity sampler for configured-agent idle suspend.
//!
//! Runs exactly one cooperative background worker owning `ProcessDiscovery` and `TcpObserver`.
//! Executes process and TCP observation transactionally, compares raw terminal output across
//! and within samples using a dedicated prior-accepted-end map, and emits verified observation
//! results and opaque final admission tickets.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::{Condvar, Mutex};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::idle_suspend::activity::process::{
    LinuxProcSource, ProcessDiscovery, ProcessSource,
};
use crate::idle_suspend::activity::tcp::{
    LinuxSocketDiagnostics, NetworkChange, SocketDiagnosticsSource, TcpObserver,
};
use crate::idle_suspend::activity::{
    ActivityUnavailable, ActivityUnavailableReason, FailureContext,
    ProcessChange, MAX_MANAGED_ROOTS_LIMIT,
};
use crate::idle_suspend::status::{ActivityMeasurementState, ActivityObservationReason};
use crate::idle_suspend::policy::{AgentExecutableSet, IdleSuspendAutomaticPolicy};
use crate::pty::activity::{
    ProcessIdentity, TerminalIdentity, SATURATED_COUNTER_SENTINEL,
};
use crate::pty::manager::PtySessionManager;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Standard scheduled sampling cadence (2 seconds).
pub(crate) const SAMPLE_CADENCE: Duration = Duration::from_secs(2);

/// Monotonic per-request acceptance deadline duration from issue time (1 second).
pub(crate) const SAMPLE_ACCEPTANCE_TIMEOUT: Duration = Duration::from_secs(1);

/// Maximum accepted observation age (5 seconds).
pub(crate) const MAX_ACCEPTED_OBSERVATION_AGE: Duration = Duration::from_secs(5);

// ---------------------------------------------------------------------------
// Request and kind types
// ---------------------------------------------------------------------------

/// Category of activity sample request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SampleKind {
    /// Normal recurring 2-second background sample.
    Scheduled,
    /// Fresh, asynchronous sample requested at the expiration of an idle countdown.
    Final,
    /// Sample requested immediately following resume or manual handoff release.
    Recovery,
}

/// Request sent to the activity sampler worker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SampleRequest {
    pub(crate) request_id: u64,
    pub(crate) kind: SampleKind,
    pub(crate) issued_at: Instant,
    pub(crate) deadline: Instant,
    pub(crate) eligibility_deadline: Instant,
    pub(crate) activity_revision: u64,
    pub(crate) epoch_activity_revision: u64,
    pub(crate) timing_revision: u64,
}

impl SampleRequest {
    pub(crate) fn new(
        request_id: u64,
        kind: SampleKind,
        activity_revision: u64,
        epoch_activity_revision: u64,
        timing_revision: u64,
        eligibility_deadline: Instant,
    ) -> Self {
        let issued_at = Instant::now();
        let deadline = issued_at + SAMPLE_ACCEPTANCE_TIMEOUT;
        Self {
            request_id,
            kind,
            issued_at,
            deadline,
            eligibility_deadline,
            activity_revision,
            epoch_activity_revision,
            timing_revision,
        }
    }
}

// ---------------------------------------------------------------------------
// Measurement states and observation reasons
// ---------------------------------------------------------------------------

impl From<ActivityUnavailableReason> for ActivityObservationReason {
    fn from(r: ActivityUnavailableReason) -> Self {
        match r {
            ActivityUnavailableReason::ProcAccess => Self::ProcAccess,
            ActivityUnavailableReason::ScanLimit => Self::ScanLimit,
            ActivityUnavailableReason::ScanTimeout => Self::ScanTimeout,
            ActivityUnavailableReason::SocketDiagnostics => Self::SocketDiagnostics,
            ActivityUnavailableReason::UnsupportedTransport => Self::UnsupportedTransport,
            ActivityUnavailableReason::NamespaceMismatch => Self::NamespaceMismatch,
            ActivityUnavailableReason::StaleObservation => Self::StaleObservation,
            ActivityUnavailableReason::IdentityUncertain => Self::IdentityUncertain,
            ActivityUnavailableReason::CounterOverflow => Self::CounterOverflow,
            ActivityUnavailableReason::Reconciling => Self::Reconciling,
        }
    }
}

/// Specific category of genuine qualifying activity observed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum QualifyingActivityKind {
    Input,
    Output,
    Network,
    AgentChanged,
    ManagedLifecycle,
}

/// Qualitative delta from previous committed baseline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActivityDelta {
    /// No change in process identity, network bytes, or raw output.
    Unchanged,
    /// First sample or post-invalidation recovery sample establishing baseline.
    BaselineEstablished,
    /// Genuine activity that resets quiet countdown and advances epoch revision.
    Genuine(QualifyingActivityKind),
}

// ---------------------------------------------------------------------------
// Monitored output fences and observation outcomes
// ---------------------------------------------------------------------------

/// Checkpoint fence capturing a terminal's exact incarnation, raw sequence Arc, and accepted sequence.
#[derive(Clone)]
pub(crate) struct MonitoredOutputFence {
    pub(crate) terminal: TerminalIdentity,
    pub(crate) output_sequence: Arc<AtomicU64>,
    pub(crate) accepted_sequence: u64,
}

impl std::fmt::Debug for MonitoredOutputFence {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MonitoredOutputFence")
            .field("terminal", &self.terminal)
            .field("accepted_sequence", &self.accepted_sequence)
            .finish()
    }
}

/// Result of an individual activity observation pass.
#[derive(Clone, Debug)]
#[allow(dead_code)]
pub(crate) struct ActivityObservation {
    pub(crate) observation_sequence: u64,
    pub(crate) completed_at: Instant,
    pub(crate) measurement_state: ActivityMeasurementState,
    pub(crate) reason: Option<ActivityObservationReason>,
    pub(crate) delta: ActivityDelta,
    pub(crate) fleet_generation: u64,
    pub(crate) input_revision: u64,
    pub(crate) output_checkpoints: Vec<MonitoredOutputFence>,
    pub(crate) recognized_agent_count: Option<usize>,
    pub(crate) monitored_terminal_count: Option<usize>,
    pub(crate) last_qualifying_activity_at: Option<Instant>,
    pub(crate) activity_revision: u64,
    pub(crate) epoch_activity_revision: u64,
    pub(crate) failure_context: Option<FailureContext>,
    pub(crate) failure_reason: Option<ActivityUnavailableReason>,
}

impl ActivityObservation {
    pub(crate) fn is_available(&self) -> bool {
        self.measurement_state == ActivityMeasurementState::Available
    }
}

// ---------------------------------------------------------------------------
// Opaque claim ticket and admission verification
// ---------------------------------------------------------------------------

/// Private opaque ticket minted for successful Final samples.
#[derive(Clone)]
pub(crate) struct ActivityClaimTicket {
    pub(crate) request_id: u64,
    pub(crate) observation_sequence: u64,
    pub(crate) completed_at: Instant,
    pub(crate) activity_revision: u64,
    pub(crate) epoch_activity_revision: u64,
    pub(crate) timing_revision: u64,
    pub(crate) fleet_generation: u64,
    pub(crate) input_revision: u64,
    pub(crate) roots: Vec<(TerminalIdentity, ProcessIdentity)>,
    pub(crate) output_fences: Vec<MonitoredOutputFence>,
    pub(crate) eligibility_deadline: Instant,
}

impl std::fmt::Debug for ActivityClaimTicket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ActivityClaimTicket")
            .field("request_id", &self.request_id)
            .field("observation_sequence", &self.observation_sequence)
            .field("activity_revision", &self.activity_revision)
            .field("epoch_activity_revision", &self.epoch_activity_revision)
            .field("timing_revision", &self.timing_revision)
            .field("fleet_generation", &self.fleet_generation)
            .field("input_revision", &self.input_revision)
            .finish()
    }
}

/// Admission request presented to `PtySessionManager::try_claim_agent_activity_handoff`.
pub(crate) struct AgentActivityAdmission<'a> {
    pub(crate) ticket: &'a ActivityClaimTicket,
    pub(crate) automatic_policy: IdleSuspendAutomaticPolicy,
    pub(crate) automatic_enabled: bool,
    pub(crate) accepted_request_id: u64,
    pub(crate) accepted_activity_revision: u64,
    pub(crate) accepted_epoch_activity_revision: u64,
    pub(crate) accepted_timing_revision: u64,
    pub(crate) now: Instant,
}

/// Result delivered from the activity sampler worker to the coordinator.
#[derive(Clone, Debug)]
pub(crate) struct ActivitySamplerResult {
    pub(crate) request: SampleRequest,
    pub(crate) observation: ActivityObservation,
    pub(crate) ticket: Option<ActivityClaimTicket>,
}

// ---------------------------------------------------------------------------
// Worker Mailbox and Cooperative Scheduling
// ---------------------------------------------------------------------------

struct SamplerMailbox {
    pending: Option<SampleRequest>,
    shutdown: bool,
}

struct SharedState {
    mailbox: Mutex<SamplerMailbox>,
    condvar: Condvar,
    cancel_running: AtomicBool,
}

// ---------------------------------------------------------------------------
// Transactional sampler worker
// ---------------------------------------------------------------------------

struct Worker<P: Send + 'static, T: Send + 'static> {
    shared: Arc<SharedState>,
    pty_manager: Arc<PtySessionManager>,
    agent_executables: Arc<AgentExecutableSet>,
    process_discovery: ProcessDiscovery<P>,
    tcp_observer: TcpObserver<T>,
    prior_accepted_end_map: HashMap<(TerminalIdentity, usize), u64>,
    observation_sequence: u64,
    activity_revision: u64,
    epoch_activity_revision: u64,
    last_input_revision: u64,
    last_input_at: Option<Instant>,
    last_qualifying_activity_at: Option<Instant>,
    result_tx: mpsc::Sender<ActivitySamplerResult>,
}

impl<P: ProcessSource + Send + 'static, T: SocketDiagnosticsSource + Send + 'static> Worker<P, T> {
    fn run(mut self) {
        loop {
            let req = {
                let mut guard = self.shared.mailbox.lock();
                while guard.pending.is_none() && !guard.shutdown {
                    self.shared.condvar.wait(&mut guard);
                }
                if guard.shutdown {
                    break;
                }
                let req = guard.pending.take().unwrap();
                self.shared.cancel_running.store(false, Ordering::Relaxed);
                req
            };

            let result = self.execute_request(req);
            if self.result_tx.blocking_send(result).is_err() {
                // Coordinator receiver dropped; terminate worker
                break;
            }
        }
    }

    fn execute_request(&mut self, req: SampleRequest) -> ActivitySamplerResult {
        let now = Instant::now();
        if now >= req.deadline {
            return self.build_unavailable_result(
                req,
                ActivityUnavailableReason::ScanTimeout,
                FailureContext::default(),
                now,
            );
        }

        if self.shared.cancel_running.load(Ordering::Relaxed) {
            return self.build_unavailable_result(
                req,
                ActivityUnavailableReason::StaleObservation,
                FailureContext::default(),
                now,
            );
        }

        if req.kind == SampleKind::Recovery {
            self.process_discovery.invalidate();
            self.tcp_observer.invalidate();
        }

        let mut retry_count = 0;
        loop {
            match self.try_sample_once(&req) {
                Ok((observation, ticket)) => {
                    return ActivitySamplerResult {
                        request: req,
                        observation,
                        ticket,
                    };
                }
                Err(err) => {
                    if err.retryable_close_race && retry_count == 0 && Instant::now() < req.deadline {
                        retry_count += 1;
                        tracing::debug!("Retrying activity sample once after retryable close race");
                        continue;
                    }
                    return self.build_unavailable_result(
                        req,
                        err.reason,
                        err.context,
                        Instant::now(),
                    );
                }
            }
        }
    }

    fn try_sample_once(
        &mut self,
        req: &SampleRequest,
    ) -> Result<(ActivityObservation, Option<ActivityClaimTicket>), ActivityUnavailable> {
        let check_deadline = || -> Result<(), ActivityUnavailable> {
            if Instant::now() >= req.deadline {
                Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::ScanTimeout,
                ))
            } else if self.shared.cancel_running.load(Ordering::Relaxed) {
                Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::StaleObservation,
                ))
            } else {
                Ok(())
            }
        };

        check_deadline()?;

        // 1. Capture initial PTY snapshot under manager lock
        let pty_snapshot = self.pty_manager.capture_activity_snapshot();
        if !pty_snapshot.is_complete() {
            let reason = match &pty_snapshot.incomplete_reason {
                Some(crate::pty::activity::ActivityIncompleteReason::ScanLimitExceeded { .. }) => {
                    ActivityUnavailableReason::ScanLimit
                }
                Some(crate::pty::activity::ActivityIncompleteReason::CounterSaturated { .. }) => {
                    ActivityUnavailableReason::CounterOverflow
                }
                Some(crate::pty::activity::ActivityIncompleteReason::RevisionSaturated) => {
                    ActivityUnavailableReason::CounterOverflow
                }
                Some(crate::pty::activity::ActivityIncompleteReason::RootUnqualified { .. }) => {
                    ActivityUnavailableReason::IdentityUncertain
                }
                None => ActivityUnavailableReason::IdentityUncertain,
            };
            return Err(ActivityUnavailable::new(reason));
        }

        check_deadline()?;

        // 2. Prepare process discovery sample
        let prepared_process = self.process_discovery.prepare_sample(
            &pty_snapshot,
            &self.agent_executables,
            req.deadline,
        )?;

        check_deadline()?;

        // 3. Prepare TCP observation sample
        let prepared_tcp = match self
            .tcp_observer
            .prepare_sample(&prepared_process.sample().owned_sockets, req.deadline)
        {
            Ok(pt) => pt,
            Err(mut tcp_err) => {
                // Enrich failure context from uncommitted prepared process sample
                for inode_owner in &tcp_err.context.implicated_owned_inodes {
                    if tcp_err.context.processes.len() >= 32 {
                        break;
                    }
                    if let Some(evidence) = prepared_process
                        .sample()
                        .process_evidence
                        .iter()
                        .find(|pe| pe.process == inode_owner.representative_owner)
                    {
                        if !tcp_err.context.processes.iter().any(|p| p.process == evidence.process) {
                            tcp_err.context.processes.push(evidence.clone());
                        }
                    }
                }
                // Dropping prepared_process drops uncommitted process state
                return Err(tcp_err);
            }
        };

        check_deadline()?;

        // 4. Raw output checkpoint verification and delta detection
        let mut raw_output_delta = false;
        let mut next_prior_ends = HashMap::with_capacity(
            prepared_process.sample().monitored_terminals.len(),
        );

        for evidence in &prepared_process.sample().monitored_terminals {
            let sample_end_seq = evidence.output_sequence.load(Ordering::Acquire);
            if sample_end_seq >= SATURATED_COUNTER_SENTINEL
                || evidence.sample_start_sequence >= SATURATED_COUNTER_SENTINEL
            {
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::CounterOverflow,
                ));
            }
            if sample_end_seq < evidence.sample_start_sequence {
                return Err(ActivityUnavailable::new(
                    ActivityUnavailableReason::CounterOverflow,
                ));
            }

            let arc_key = (
                evidence.terminal.clone(),
                Arc::as_ptr(&evidence.output_sequence) as usize,
            );

            if let Some(&prior_end) = self.prior_accepted_end_map.get(&arc_key) {
                if evidence.sample_start_sequence < prior_end {
                    return Err(ActivityUnavailable::new(
                        ActivityUnavailableReason::CounterOverflow,
                    ));
                }
                if evidence.sample_start_sequence > prior_end
                    || sample_end_seq > evidence.sample_start_sequence
                {
                    raw_output_delta = true;
                }
            }
            next_prior_ends.insert(arc_key, sample_end_seq);
        }

        // 5. Recheck cancellation, monotonic deadline, and manager invalidations
        check_deadline()?;

        let post_snapshot = self.pty_manager.capture_activity_snapshot();
        if post_snapshot.fleet.generation != pty_snapshot.fleet.generation
            || post_snapshot.input_revision != pty_snapshot.input_revision
        {
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::StaleObservation,
            ));
        }

        // 6. Both preparations succeeded and fences are verified: Commit back-to-back
        let committed_process = self.process_discovery.commit_sample(prepared_process);
        let committed_tcp = self.tcp_observer.commit_sample(prepared_tcp);

        // Prune prior ends to currently monitored and bounded roots
        if next_prior_ends.len() > MAX_MANAGED_ROOTS_LIMIT {
            return Err(ActivityUnavailable::new(
                ActivityUnavailableReason::ScanLimit,
            ));
        }
        self.prior_accepted_end_map = next_prior_ends;

        let completed_at = Instant::now();
        self.observation_sequence = self
            .observation_sequence
            .checked_add(1)
            .expect("observation sequence overflow");

        // 7. Delta and genuine activity classification
        let input_delta = pty_snapshot.input_revision > self.last_input_revision
            || pty_snapshot.last_input_at > self.last_input_at;

        let lifecycle_busy = pty_snapshot.fleet.creating_count > 0
            || pty_snapshot.fleet.restart_pending_count > 0;

        let process_activity = committed_process.change == ProcessChange::Activity;
        let network_activity = committed_tcp.change == NetworkChange::Activity;

        let (delta, reason) = if input_delta {
            (
                ActivityDelta::Genuine(QualifyingActivityKind::Input),
                Some(ActivityObservationReason::RecentInput),
            )
        } else if raw_output_delta {
            (
                ActivityDelta::Genuine(QualifyingActivityKind::Output),
                Some(ActivityObservationReason::RecentOutput),
            )
        } else if network_activity {
            (
                ActivityDelta::Genuine(QualifyingActivityKind::Network),
                Some(ActivityObservationReason::RecentNetwork),
            )
        } else if process_activity {
            (
                ActivityDelta::Genuine(QualifyingActivityKind::AgentChanged),
                Some(ActivityObservationReason::AgentChanged),
            )
        } else if lifecycle_busy {
            (
                ActivityDelta::Genuine(QualifyingActivityKind::ManagedLifecycle),
                Some(ActivityObservationReason::LifecycleBusy),
            )
        } else if committed_process.change == ProcessChange::BaselineEstablished
            || committed_tcp.change == NetworkChange::BaselineEstablished
        {
            (ActivityDelta::BaselineEstablished, None)
        } else {
            (ActivityDelta::Unchanged, None)
        };

        // 8. Monotonic revision tracking
        match delta {
            ActivityDelta::Genuine(_) => {
                self.activity_revision = self
                    .activity_revision
                    .checked_add(1)
                    .expect("activity revision overflow");
                self.epoch_activity_revision = self
                    .epoch_activity_revision
                    .checked_add(1)
                    .expect("epoch activity revision overflow");
                self.last_qualifying_activity_at = Some(completed_at);
            }
            ActivityDelta::BaselineEstablished => {
                self.activity_revision = self
                    .activity_revision
                    .checked_add(1)
                    .expect("activity revision overflow");
            }
            ActivityDelta::Unchanged => {}
        }

        self.last_input_revision = pty_snapshot.input_revision;
        self.last_input_at = pty_snapshot.last_input_at;

        // 9. Build output fences
        let output_checkpoints: Vec<MonitoredOutputFence> = committed_process
            .monitored_terminals
            .iter()
            .map(|t| MonitoredOutputFence {
                terminal: t.terminal.clone(),
                output_sequence: Arc::clone(&t.output_sequence),
                accepted_sequence: t.output_sequence.load(Ordering::Acquire),
            })
            .collect();

        let observation = ActivityObservation {
            observation_sequence: self.observation_sequence,
            completed_at,
            measurement_state: ActivityMeasurementState::Available,
            reason,
            delta,
            fleet_generation: pty_snapshot.fleet.generation,
            input_revision: pty_snapshot.input_revision,
            output_checkpoints: output_checkpoints.clone(),
            recognized_agent_count: Some(committed_process.recognized_agent_count),
            monitored_terminal_count: Some(committed_process.monitored_terminal_count()),
            last_qualifying_activity_at: self.last_qualifying_activity_at,
            activity_revision: self.activity_revision,
            epoch_activity_revision: self.epoch_activity_revision,
            failure_context: None,
            failure_reason: None,
        };

        // 10. Mint opaque claim ticket for Final sample when available and quiet
        let ticket = if req.kind == SampleKind::Final && delta == ActivityDelta::Unchanged {
            let roots = pty_snapshot
                .roots
                .iter()
                .filter_map(|r| r.qualification.process_identity().map(|pid| (r.terminal.clone(), pid)))
                .collect();

            Some(ActivityClaimTicket {
                request_id: req.request_id,
                observation_sequence: self.observation_sequence,
                completed_at,
                activity_revision: self.activity_revision,
                epoch_activity_revision: self.epoch_activity_revision,
                timing_revision: req.timing_revision,
                fleet_generation: pty_snapshot.fleet.generation,
                input_revision: pty_snapshot.input_revision,
                roots,
                output_fences: output_checkpoints,
                eligibility_deadline: req.eligibility_deadline,
            })
        } else {
            None
        };

        Ok((observation, ticket))
    }

    fn build_unavailable_result(
        &mut self,
        req: SampleRequest,
        reason: ActivityUnavailableReason,
        failure_context: FailureContext,
        completed_at: Instant,
    ) -> ActivitySamplerResult {
        self.observation_sequence = self
            .observation_sequence
            .checked_add(1)
            .expect("observation sequence overflow");

        let pty_snapshot = self.pty_manager.capture_activity_snapshot();

        let observation = ActivityObservation {
            observation_sequence: self.observation_sequence,
            completed_at,
            measurement_state: ActivityMeasurementState::Unavailable,
            reason: Some(reason.into()),
            delta: ActivityDelta::Unchanged,
            fleet_generation: pty_snapshot.fleet.generation,
            input_revision: pty_snapshot.input_revision,
            output_checkpoints: Vec::new(),
            recognized_agent_count: None,
            monitored_terminal_count: None,
            last_qualifying_activity_at: self.last_qualifying_activity_at,
            activity_revision: self.activity_revision,
            epoch_activity_revision: self.epoch_activity_revision,
            failure_context: Some(failure_context),
            failure_reason: Some(reason),
        };

        ActivitySamplerResult {
            request: req,
            observation,
            ticket: None,
        }
    }
}

// ---------------------------------------------------------------------------
// ActivitySampler coordinator handle
// ---------------------------------------------------------------------------

/// Thread handle and control interface for the singleton activity sampler worker.
pub(crate) struct ActivitySampler {
    shared: Arc<SharedState>,
    worker_join: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl ActivitySampler {
    /// Create and launch a production sampler using Linux procfs and socket diagnostics.
    pub(crate) fn new(
        pty_manager: Arc<PtySessionManager>,
        agent_executables: Arc<AgentExecutableSet>,
        result_tx: mpsc::Sender<ActivitySamplerResult>,
    ) -> Self {
        Self::with_sources(
            pty_manager,
            agent_executables,
            result_tx,
            LinuxProcSource::new(),
            LinuxSocketDiagnostics::new(),
        )
    }

    /// Create and launch a sampler with custom proc and socket sources (e.g. for testing).
    pub(crate) fn with_sources<P: ProcessSource + Send + 'static, T: SocketDiagnosticsSource + Send + 'static>(
        pty_manager: Arc<PtySessionManager>,
        agent_executables: Arc<AgentExecutableSet>,
        result_tx: mpsc::Sender<ActivitySamplerResult>,
        process_source: P,
        diagnostics_source: T,
    ) -> Self {
        let shared = Arc::new(SharedState {
            mailbox: Mutex::new(SamplerMailbox {
                pending: None,
                shutdown: false,
            }),
            condvar: Condvar::new(),
            cancel_running: AtomicBool::new(false),
        });

        let worker = Worker {
            shared: Arc::clone(&shared),
            pty_manager,
            agent_executables,
            process_discovery: ProcessDiscovery::with_source(process_source),
            tcp_observer: TcpObserver::with_diagnostics(diagnostics_source),
            prior_accepted_end_map: HashMap::new(),
            observation_sequence: 0,
            activity_revision: 1,
            epoch_activity_revision: 1,
            last_input_revision: 0,
            last_input_at: None,
            last_qualifying_activity_at: None,
            result_tx,
        };

        let handle = std::thread::Builder::new()
            .name("idle-suspend-sampler".to_string())
            .spawn(move || worker.run())
            .expect("failed to spawn idle-suspend-sampler worker thread");

        Self {
            shared,
            worker_join: Mutex::new(Some(handle)),
        }
    }

    /// Post a recurring scheduled request.
    /// Drops/coalesces if an unhandled scheduled or final request is already queued.
    pub(crate) fn try_send_scheduled(&self, req: SampleRequest) -> bool {
        let mut guard = self.shared.mailbox.lock();
        if guard.shutdown {
            return false;
        }
        if guard.pending.is_some() {
            // Coalesce scheduled tick
            return false;
        }
        guard.pending = Some(req);
        self.shared.condvar.notify_one();
        true
    }

    /// Post a fresh Final sample request.
    /// Supersedes any queued scheduled request and marks in-flight sample cooperatively cancelled.
    pub(crate) fn send_final(&self, req: SampleRequest) -> bool {
        let mut guard = self.shared.mailbox.lock();
        if guard.shutdown {
            return false;
        }
        self.shared.cancel_running.store(true, Ordering::Relaxed);
        guard.pending = Some(req);
        self.shared.condvar.notify_one();
        true
    }

    #[allow(dead_code)]
    /// Post a recovery sample request (e.g. post-resume or post-handoff release).
    pub(crate) fn send_recovery(&self, req: SampleRequest) -> bool {
        let mut guard = self.shared.mailbox.lock();
        if guard.shutdown {
            return false;
        }
        self.shared.cancel_running.store(true, Ordering::Relaxed);
        guard.pending = Some(req);
        self.shared.condvar.notify_one();
        true
    }

    /// Cooperatively cancel any queued or in-flight sample request.
    pub(crate) fn cancel_current(&self) {
        self.shared.cancel_running.store(true, Ordering::Relaxed);
    }

    /// Signal shutdown, wake worker, and join the worker thread.
    pub(crate) fn shutdown_and_join(&self) {
        {
            let mut guard = self.shared.mailbox.lock();
            guard.shutdown = true;
            guard.pending = None;
            self.shared.cancel_running.store(true, Ordering::Relaxed);
            self.shared.condvar.notify_all();
        }
        let handle = self.worker_join.lock().take();
        if let Some(h) = handle {
            let _ = h.join();
        }
    }
}

impl Drop for ActivitySampler {
    fn drop(&mut self) {
        self.shutdown_and_join();
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicUsize;
    use crate::pty::NoopEventSink;
    use crate::config::schema::RestartPolicy;
    use crate::idle_suspend::activity::process::tests::MockProcessSource;
    use crate::idle_suspend::activity::tcp::tests::FakeDiagnosticsSource;
    use crate::idle_suspend::activity::tcp::SocketKey;
    use crate::idle_suspend::activity::tcp_info::TcpCounters;
    use crate::idle_suspend::activity::OwnedSocketSet;
    use crate::pty::manager::PtyCreateOpts;
    fn make_test_agent_set(names: &[&str]) -> Arc<AgentExecutableSet> {
        let strings: Vec<String> = names.iter().map(|n| n.to_string()).collect();
        Arc::new(AgentExecutableSet::from_strings(&strings).unwrap())
    }

    fn create_test_session(
        manager: &PtySessionManager,
        id: &str,
    ) -> (TerminalIdentity, ProcessIdentity) {
        let opts = PtyCreateOpts {
            id: id.to_string(),
            project: None,
            worktree_path: None,
            command: "/bin/sleep 60".to_string(),
            cwd: "/tmp".to_string(),
            env: HashMap::new(),
            rows: 24,
            cols: 80,
            restart_policy: RestartPolicy::Never,
            restart_max_retries: 0,
            name: None,
        };
        let meta = manager.create(opts).expect("create test session");
        let snap = manager.capture_activity_snapshot();
        let root = snap.roots.iter().find(|r| r.terminal.session_id == id).unwrap();
        let terminal = TerminalIdentity {
            session_id: id.to_string(),
            incarnation: meta.incarnation,
        };
        let pid = root.qualification.pid().unwrap_or(12345);
        let identity = root.qualification.process_identity().unwrap_or(ProcessIdentity {
            pid,
            start_ticks: 100,
        });
        (terminal, identity)
    }

    #[tokio::test]
    async fn test_sampler_worker_scheduled_and_final_ticket() {
        let manager = Arc::new(PtySessionManager::new(Arc::new(NoopEventSink)));
        let session_id = "test-session-1";
        let (terminal, identity) = create_test_session(&manager, session_id);

        let mut proc_source = MockProcessSource::new();
        proc_source.set_proc(
            identity.pid,
            1,
            PathBuf::from("/usr/bin/codex"),
            vec!["codex".to_string()],
            PathBuf::from("/tmp"),
            (1, 1),
            identity.start_ticks,
        );

        let diag_source = FakeDiagnosticsSource::default();
        let agents = make_test_agent_set(&["codex"]);
        let (result_tx, mut result_rx) = mpsc::channel(16);

        let sampler = ActivitySampler::with_sources(
            Arc::clone(&manager),
            agents,
            result_tx,
            proc_source,
            diag_source,
        );

        // 1. Initial Scheduled sample: establishes baseline
        let req1 = SampleRequest::new(1, SampleKind::Scheduled, 1, 1, 1, Instant::now());
        assert!(sampler.try_send_scheduled(req1));
        let res1 = result_rx.recv().await.expect("receive res1");
        assert_eq!(res1.request.request_id, 1);
        assert_eq!(res1.observation.measurement_state, ActivityMeasurementState::Available);
        assert_eq!(res1.observation.delta, ActivityDelta::BaselineEstablished);
        assert_eq!(res1.observation.recognized_agent_count, Some(1));
        assert_eq!(res1.observation.activity_revision, 2);
        assert_eq!(res1.observation.epoch_activity_revision, 1);
        assert!(res1.ticket.is_none());

        // 2. Second Scheduled sample with unchanged state
        let req2 = SampleRequest::new(2, SampleKind::Scheduled, 2, 1, 1, Instant::now());
        assert!(sampler.try_send_scheduled(req2));
        let res2 = result_rx.recv().await.expect("receive res2");
        assert_eq!(res2.request.request_id, 2);
        assert_eq!(res2.observation.measurement_state, ActivityMeasurementState::Available);
        assert_eq!(res2.observation.delta, ActivityDelta::Unchanged);
        assert_eq!(res2.observation.activity_revision, 2);
        assert_eq!(res2.observation.epoch_activity_revision, 1);
        assert!(res2.ticket.is_none());

        // 3. Final sample with unchanged state: mints claim ticket
        let req3 = SampleRequest::new(3, SampleKind::Final, 2, 1, 1, Instant::now());
        assert!(sampler.send_final(req3));
        let res3 = result_rx.recv().await.expect("receive res3");
        assert_eq!(res3.request.request_id, 3);
        assert_eq!(res3.observation.delta, ActivityDelta::Unchanged);
        assert!(res3.ticket.is_some());

        let ticket = res3.ticket.unwrap();
        assert_eq!(ticket.request_id, 3);
        assert_eq!(ticket.activity_revision, 2);
        assert_eq!(ticket.epoch_activity_revision, 1);
        assert_eq!(ticket.roots.len(), 1);
        assert_eq!(ticket.roots[0].0, terminal);

        sampler.shutdown_and_join();
        let _ = manager.kill(session_id);
    }

    #[tokio::test]
    async fn test_sampler_worker_raw_output_delta() {
        let manager = Arc::new(PtySessionManager::new(Arc::new(NoopEventSink)));
        let session_id = "test-session-2";
        let (_terminal, identity) = create_test_session(&manager, session_id);

        let mut proc_source = MockProcessSource::new();
        proc_source.set_proc(
            identity.pid,
            1,
            PathBuf::from("/usr/bin/codex"),
            vec!["codex".to_string()],
            PathBuf::from("/tmp"),
            (1, 1),
            identity.start_ticks,
        );

        let diag_source = FakeDiagnosticsSource::default();
        let agents = make_test_agent_set(&["codex"]);
        let (result_tx, mut result_rx) = mpsc::channel(16);

        let sampler = ActivitySampler::with_sources(
            Arc::clone(&manager),
            agents,
            result_tx,
            proc_source,
            diag_source,
        );

        // 1. Initial baseline
        let req1 = SampleRequest::new(1, SampleKind::Scheduled, 1, 1, 1, Instant::now());
        sampler.try_send_scheduled(req1);
        let _ = result_rx.recv().await.expect("res1");

        // 2. Advance raw output counter
        manager.test_set_raw_output_sequence(session_id, 42);

        // 3. Next sample detects raw output delta
        let req2 = SampleRequest::new(2, SampleKind::Scheduled, 2, 1, 1, Instant::now());
        sampler.try_send_scheduled(req2);
        let res2 = result_rx.recv().await.expect("res2");
        assert_eq!(
            res2.observation.delta,
            ActivityDelta::Genuine(QualifyingActivityKind::Output)
        );
        assert_eq!(
            res2.observation.reason,
            Some(ActivityObservationReason::RecentOutput)
        );
        assert_eq!(res2.observation.activity_revision, 3);
        assert_eq!(res2.observation.epoch_activity_revision, 2);

        sampler.shutdown_and_join();
        let _ = manager.kill(session_id);
    }

    #[tokio::test]
    async fn test_sampler_worker_counter_overflow() {
        let manager = Arc::new(PtySessionManager::new(Arc::new(NoopEventSink)));
        let session_id = "test-session-3";
        let (_terminal, identity) = create_test_session(&manager, session_id);

        let mut proc_source = MockProcessSource::new();
        proc_source.set_proc(
            identity.pid,
            1,
            PathBuf::from("/usr/bin/codex"),
            vec!["codex".to_string()],
            PathBuf::from("/tmp"),
            (1, 1),
            identity.start_ticks,
        );

        let diag_source = FakeDiagnosticsSource::default();
        let agents = make_test_agent_set(&["codex"]);
        let (result_tx, mut result_rx) = mpsc::channel(16);

        let sampler = ActivitySampler::with_sources(
            Arc::clone(&manager),
            agents,
            result_tx,
            proc_source,
            diag_source,
        );

        // Set saturated output counter
        manager.test_set_raw_output_sequence(session_id, SATURATED_COUNTER_SENTINEL);

        let req = SampleRequest::new(1, SampleKind::Scheduled, 1, 1, 1, Instant::now());
        sampler.try_send_scheduled(req);
        let res = result_rx.recv().await.expect("res");
        assert_eq!(
            res.observation.measurement_state,
            ActivityMeasurementState::Unavailable
        );
        assert_eq!(
            res.observation.reason,
            Some(ActivityObservationReason::CounterOverflow)
        );

        sampler.shutdown_and_join();
        let _ = manager.kill(session_id);
    }

    // Retryable diagnostics source that fails on attempt 1 and succeeds on attempt 2
    struct RetryableDiagnostics {
        attempt: AtomicUsize,
    }

    impl SocketDiagnosticsSource for RetryableDiagnostics {
        fn diagnose_sockets(
            &self,
            _owned_sockets: &OwnedSocketSet,
            _deadline: Instant,
        ) -> Result<HashMap<SocketKey, (TcpCounters, u64)>, ActivityUnavailable> {
            let count = self.attempt.fetch_add(1, Ordering::SeqCst);
            if count == 0 {
                Err(ActivityUnavailable::retryable(
                    ActivityUnavailableReason::SocketDiagnostics,
                ))
            } else {
                Ok(HashMap::new())
            }
        }
    }

    #[tokio::test]
    async fn test_sampler_worker_close_race_retry() {
        let manager = Arc::new(PtySessionManager::new(Arc::new(NoopEventSink)));
        let session_id = "test-session-4";
        let (_terminal, identity) = create_test_session(&manager, session_id);

        let mut proc_source = MockProcessSource::new();
        proc_source.set_proc(
            identity.pid,
            1,
            PathBuf::from("/usr/bin/codex"),
            vec!["codex".to_string()],
            PathBuf::from("/tmp"),
            (1, 1),
            identity.start_ticks,
        );

        let diag_source = RetryableDiagnostics {
            attempt: AtomicUsize::new(0),
        };
        let agents = make_test_agent_set(&["codex"]);
        let (result_tx, mut result_rx) = mpsc::channel(16);

        let sampler = ActivitySampler::with_sources(
            Arc::clone(&manager),
            agents,
            result_tx,
            proc_source,
            diag_source,
        );

        let req = SampleRequest::new(1, SampleKind::Scheduled, 1, 1, 1, Instant::now());
        sampler.try_send_scheduled(req);
        let res = result_rx.recv().await.expect("res");
        assert_eq!(
            res.observation.measurement_state,
            ActivityMeasurementState::Available
        );

        sampler.shutdown_and_join();
        let _ = manager.kill(session_id);
    }

    // Diagnostics source that always fails with implicated owned inodes
    struct FailingDiagnosticsWithInodes;

    impl SocketDiagnosticsSource for FailingDiagnosticsWithInodes {
        fn diagnose_sockets(
            &self,
            owned_sockets: &OwnedSocketSet,
            _deadline: Instant,
        ) -> Result<HashMap<SocketKey, (TcpCounters, u64)>, ActivityUnavailable> {
            let mut ctx = FailureContext::default();
            if let Some(first) = owned_sockets.inodes.first() {
                ctx.implicated_owned_inodes.push(first.clone());
            }
            Err(ActivityUnavailable::with_context(
                ActivityUnavailableReason::SocketDiagnostics,
                ctx,
            ))
        }
    }

    #[tokio::test]
    async fn test_sampler_worker_tcp_failure_enrichment() {
        let manager = Arc::new(PtySessionManager::new(Arc::new(NoopEventSink)));
        let session_id = "test-session-5";
        let (_terminal, identity) = create_test_session(&manager, session_id);

        let mut proc_source = MockProcessSource::new();
        proc_source.set_proc(
            identity.pid,
            1,
            PathBuf::from("/usr/bin/codex"),
            vec!["codex".to_string()],
            PathBuf::from("/tmp"),
            (1, 1),
            identity.start_ticks,
        );
        // Add socket to the process so owned_sockets contains an inode
        proc_source.add_socket(identity.pid, 3, 9999);

        let diag_source = FailingDiagnosticsWithInodes;
        let agents = make_test_agent_set(&["codex"]);
        let (result_tx, mut result_rx) = mpsc::channel(16);

        let sampler = ActivitySampler::with_sources(
            Arc::clone(&manager),
            agents,
            result_tx,
            proc_source,
            diag_source,
        );

        let req = SampleRequest::new(1, SampleKind::Scheduled, 1, 1, 1, Instant::now());
        sampler.try_send_scheduled(req);
        let res = result_rx.recv().await.expect("res");
        assert_eq!(
            res.observation.measurement_state,
            ActivityMeasurementState::Unavailable
        );
        assert_eq!(
            res.observation.reason,
            Some(ActivityObservationReason::SocketDiagnostics)
        );

        // Prove failure context was enriched from prepared process sample
        let ctx = res.observation.failure_context.expect("failure_context");
        assert!(!ctx.implicated_owned_inodes.is_empty());
        assert_eq!(ctx.implicated_owned_inodes[0].inode, 9999);
        assert_eq!(ctx.processes.len(), 1);
        assert_eq!(ctx.processes[0].process, identity);
        assert_eq!(ctx.processes[0].safe_executable_identity.as_deref(), Some("codex"));

        sampler.shutdown_and_join();
        let _ = manager.kill(session_id);
    }

    struct BarrierDiagnostics {
        entered_tx: std::sync::mpsc::Sender<()>,
        release_rx: Arc<std::sync::Mutex<std::sync::mpsc::Receiver<()>>>,
    }

    impl SocketDiagnosticsSource for BarrierDiagnostics {
        fn diagnose_sockets(
            &self,
            _owned_sockets: &OwnedSocketSet,
            _deadline: Instant,
        ) -> Result<HashMap<SocketKey, (TcpCounters, u64)>, ActivityUnavailable> {
            let _ = self.entered_tx.send(());
            let rx = self.release_rx.lock().unwrap();
            let _ = rx.recv();
            Ok(HashMap::new())
        }
    }

    #[tokio::test]
    async fn test_sampler_worker_cooperative_cancel() {
        let manager = Arc::new(PtySessionManager::new(Arc::new(NoopEventSink)));
        let session_id = "test-session-cancel";
        let (_terminal, identity) = create_test_session(&manager, session_id);

        let mut proc_source = MockProcessSource::new();
        proc_source.set_proc(
            identity.pid,
            1,
            PathBuf::from("/usr/bin/codex"),
            vec!["codex".to_string()],
            PathBuf::from("/tmp"),
            (1, 1),
            identity.start_ticks,
        );

        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let diag_source = BarrierDiagnostics {
            entered_tx,
            release_rx: Arc::new(std::sync::Mutex::new(release_rx)),
        };

        let agents = make_test_agent_set(&["codex"]);
        let (result_tx, mut result_rx) = mpsc::channel(16);

        let sampler = ActivitySampler::with_sources(
            Arc::clone(&manager),
            agents,
            result_tx,
            proc_source,
            diag_source,
        );

        let req = SampleRequest::new(1, SampleKind::Scheduled, 1, 1, 1, Instant::now());
        sampler.try_send_scheduled(req);

        // Wait until worker enters diagnose_sockets
        entered_rx.recv().expect("worker entered");

        // Cooperatively cancel while worker is in flight
        sampler.cancel_current();

        // Release worker
        release_tx.send(()).expect("release worker");

        let res = result_rx.recv().await.expect("res");
        assert_eq!(
            res.observation.measurement_state,
            ActivityMeasurementState::Unavailable
        );
        assert_eq!(
            res.observation.reason,
            Some(ActivityObservationReason::StaleObservation)
        );

        sampler.shutdown_and_join();
        let _ = manager.kill(session_id);
    }
    #[tokio::test]
    async fn test_sampler_worker_shutdown_and_join() {
        let manager = Arc::new(PtySessionManager::new(Arc::new(NoopEventSink)));
        let proc_source = MockProcessSource::new();
        let diag_source = FakeDiagnosticsSource::default();
        let agents = make_test_agent_set(&["codex"]);
        let (result_tx, _result_rx) = mpsc::channel(16);

        let sampler = ActivitySampler::with_sources(
            manager,
            agents,
            result_tx,
            proc_source,
            diag_source,
        );

        // Shutdown must join cleanly without deadlock
        sampler.shutdown_and_join();
    }
}
