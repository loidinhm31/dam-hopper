use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::{debug, warn};

use crate::diagnostics::DiagnosticStore;
use crate::workflow::enums::{
    ResourceLinkType, ResourceObservedState, WorkflowEventType, WorkflowSource,
};
use crate::workflow::model::WorkflowEvent;
use crate::workflow::store::event::record_event_tx;
use crate::workflow::store::session::{find_links_by_external_id_tx, get_session_by_id_tx};
use crate::workflow::store::{WorkflowStore, WorkflowStoreError};
use crate::workflow::DEFAULT_EVENT_RETENTION_DAYS;

const MAX_DIAGNOSTIC_DURATION_MS: u128 = 60_000;
const MAX_DIAGNOSTIC_COUNT: usize = 1_000;

fn bounded_count(count: usize) -> String {
    count.min(MAX_DIAGNOSTIC_COUNT).to_string()
}

fn observation_result(obs: &WorkflowObservation) -> &'static str {
    match obs {
        WorkflowObservation::TerminalCreated { .. }
        | WorkflowObservation::TerminalRestarted { .. } => "attached",
        WorkflowObservation::TerminalExitPendingRestart { .. } => "stale",
        WorkflowObservation::TerminalFinalExit { exit_code, .. } => {
            if *exit_code == Some(0) {
                "exited"
            } else {
                "crashed"
            }
        }
        WorkflowObservation::TerminalRemoved { .. } => "detached",
    }
}

fn record_observation_diagnostic(
    diagnostics: &DiagnosticStore,
    obs: &WorkflowObservation,
    result: &Result<usize, WorkflowStoreError>,
    started: Instant,
) {
    let (outcome, availability) = match result {
        Ok(_) => ("ok", "available"),
        Err(_) => ("error", "unavailable"),
    };
    let count = result.as_ref().ok().copied().unwrap_or_default();
    diagnostics.record_terminal_event(
        "workflow",
        "workflow.observation",
        std::collections::BTreeMap::from([
            ("operation".to_string(), "observation".to_string()),
            ("observation_kind".to_string(), obs.action_str().to_string()),
            ("result".to_string(), observation_result(obs).to_string()),
            ("outcome".to_string(), outcome.to_string()),
            (
                "duration_ms".to_string(),
                started.elapsed().as_millis().min(MAX_DIAGNOSTIC_DURATION_MS).to_string(),
            ),
            ("row_count".to_string(), bounded_count(count)),
            ("event_count".to_string(), bounded_count(count)),
            ("count".to_string(), bounded_count(count)),
            ("store_availability".to_string(), availability.to_string()),
        ]),
    );
}

/// Current timestamp in milliseconds since Unix epoch.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Closed observation enum for terminal lifecycle events.
/// Strictly limited to metadata: session ID, incarnation, project, worktree target,
/// server timestamp, exit code, and restart count. Excludes command, cwd, env, and output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum WorkflowObservation {
    TerminalCreated {
        session_id: String,
        incarnation: u64,
        project: Option<String>,
        worktree_path: Option<PathBuf>,
        observed_at: u64,
    },
    TerminalExitPendingRestart {
        session_id: String,
        incarnation: u64,
        exit_code: Option<i32>,
        restart_count: u32,
        restart_in_ms: Option<u64>,
        observed_at: u64,
    },
    TerminalRestarted {
        session_id: String,
        incarnation: u64,
        restart_count: u32,
        previous_exit_code: Option<i32>,
        observed_at: u64,
    },
    TerminalFinalExit {
        session_id: String,
        incarnation: u64,
        exit_code: Option<i32>,
        restart_count: u32,
        observed_at: u64,
    },
    TerminalRemoved {
        session_id: String,
        incarnation: Option<u64>,
        observed_at: u64,
    },
}

impl WorkflowObservation {
    pub fn session_id(&self) -> &str {
        match self {
            Self::TerminalCreated { session_id, .. } => session_id,
            Self::TerminalExitPendingRestart { session_id, .. } => session_id,
            Self::TerminalRestarted { session_id, .. } => session_id,
            Self::TerminalFinalExit { session_id, .. } => session_id,
            Self::TerminalRemoved { session_id, .. } => session_id,
        }
    }

    pub fn incarnation(&self) -> Option<u64> {
        match self {
            Self::TerminalCreated { incarnation, .. } => Some(*incarnation),
            Self::TerminalExitPendingRestart { incarnation, .. } => Some(*incarnation),
            Self::TerminalRestarted { incarnation, .. } => Some(*incarnation),
            Self::TerminalFinalExit { incarnation, .. } => Some(*incarnation),
            Self::TerminalRemoved { incarnation, .. } => *incarnation,
        }
    }

    pub fn observed_at(&self) -> u64 {
        match self {
            Self::TerminalCreated { observed_at, .. } => *observed_at,
            Self::TerminalExitPendingRestart { observed_at, .. } => *observed_at,
            Self::TerminalRestarted { observed_at, .. } => *observed_at,
            Self::TerminalFinalExit { observed_at, .. } => *observed_at,
            Self::TerminalRemoved { observed_at, .. } => *observed_at,
        }
    }

    pub fn action_str(&self) -> &'static str {
        match self {
            Self::TerminalCreated { .. } => "terminal_created",
            Self::TerminalExitPendingRestart { .. } => "terminal_restart_pending",
            Self::TerminalRestarted { .. } => "terminal_restarted",
            Self::TerminalFinalExit { .. } => "terminal_final_exit",
            Self::TerminalRemoved { .. } => "terminal_removed",
        }
    }

    pub fn to_payload_json(&self) -> String {
        match self {
            Self::TerminalCreated {
                session_id,
                incarnation,
                project,
                worktree_path,
                ..
            } => json!({
                "action": "terminal_created",
                "sessionId": session_id,
                "incarnation": incarnation,
                "project": project,
                "worktreePath": worktree_path.as_ref().map(|p| p.to_string_lossy()),
            })
            .to_string(),
            Self::TerminalExitPendingRestart {
                session_id,
                incarnation,
                exit_code,
                restart_count,
                restart_in_ms,
                ..
            } => json!({
                "action": "terminal_restart_pending",
                "sessionId": session_id,
                "incarnation": incarnation,
                "exitCode": exit_code,
                "restartCount": restart_count,
                "restartInMs": restart_in_ms,
            })
            .to_string(),
            Self::TerminalRestarted {
                session_id,
                incarnation,
                restart_count,
                previous_exit_code,
                ..
            } => json!({
                "action": "terminal_restarted",
                "sessionId": session_id,
                "incarnation": incarnation,
                "restartCount": restart_count,
                "previousExitCode": previous_exit_code,
            })
            .to_string(),
            Self::TerminalFinalExit {
                session_id,
                incarnation,
                exit_code,
                restart_count,
                ..
            } => json!({
                "action": "terminal_final_exit",
                "sessionId": session_id,
                "incarnation": incarnation,
                "exitCode": exit_code,
                "restartCount": restart_count,
            })
            .to_string(),
            Self::TerminalRemoved {
                session_id,
                incarnation,
                ..
            } => json!({
                "action": "terminal_removed",
                "sessionId": session_id,
                "incarnation": incarnation,
            })
            .to_string(),
        }
    }
}

/// Trait for recording observations from external systems (PTY lifecycle).
pub trait WorkflowObservationRecorder: Send + Sync + 'static {
    fn record(&self, observation: WorkflowObservation);
}

/// Default no-op recorder used in tests or when workflow tracking is inactive.
#[derive(Debug, Clone, Default)]
pub struct NoopWorkflowObservationRecorder;

impl WorkflowObservationRecorder for NoopWorkflowObservationRecorder {
    fn record(&self, _observation: WorkflowObservation) {}
}

/// Bounded non-blocking observation recorder backed by a sync_channel(256).
#[derive(Clone)]
pub struct BoundedObservationRecorder {
    sender: SyncSender<WorkflowObservation>,
    dropped_count: Arc<AtomicU64>,
    diagnostics: Option<DiagnosticStore>,
}

impl BoundedObservationRecorder {
    pub fn new(sender: SyncSender<WorkflowObservation>) -> (Self, Arc<AtomicU64>) {
        Self::new_with_diagnostics(sender, None)
    }

    /// Build a recorder with optional diagnostics for deterministic queue-drop tests.
    pub fn new_with_diagnostics(
        sender: SyncSender<WorkflowObservation>,
        diagnostics: Option<DiagnosticStore>,
    ) -> (Self, Arc<AtomicU64>) {
        let dropped_count = Arc::new(AtomicU64::new(0));
        (
            Self {
                sender,
                dropped_count: dropped_count.clone(),
                diagnostics,
            },
            dropped_count,
        )
    }

    pub fn dropped_count(&self) -> u64 {
        self.dropped_count.load(Ordering::Relaxed)
    }
}

impl WorkflowObservationRecorder for BoundedObservationRecorder {
    fn record(&self, observation: WorkflowObservation) {
        if self.sender.try_send(observation).is_err() {
            self.dropped_count.fetch_add(1, Ordering::Relaxed);
            if let Some(diagnostics) = &self.diagnostics {
                diagnostics.record_terminal_event(
                    "workflow",
                    "workflow.observation_drop",
                    std::collections::BTreeMap::from([
                        ("operation".to_string(), "observation".to_string()),
                        ("observation_kind".to_string(), "terminal_lifecycle".to_string()),
                        ("result".to_string(), "dropped".to_string()),
                        ("outcome".to_string(), "queue_full".to_string()),
                        ("duration_ms".to_string(), "0".to_string()),
                        ("row_count".to_string(), "0".to_string()),
                        ("event_count".to_string(), "0".to_string()),
                        ("count".to_string(), "1".to_string()),
                        ("store_availability".to_string(), "unknown".to_string()),
                    ]),
                );
            }
            warn!("Workflow observation dropped or worker disconnected");
        }
    }
}

/// Starts the observation worker thread without diagnostic instrumentation.
pub fn start_observation_worker(
    store: WorkflowStore,
) -> (
    BoundedObservationRecorder,
    Arc<AtomicU64>,
    JoinHandle<()>,
) {
    start_observation_worker_internal(store, None)
}

/// Starts the observation worker with the shared bounded diagnostic store.
pub fn start_observation_worker_with_diagnostics(
    store: WorkflowStore,
    diagnostics: DiagnosticStore,
) -> (
    BoundedObservationRecorder,
    Arc<AtomicU64>,
    JoinHandle<()>,
) {
    start_observation_worker_internal(store, Some(diagnostics))
}

fn start_observation_worker_internal(
    store: WorkflowStore,
    diagnostics: Option<DiagnosticStore>,
) -> (
    BoundedObservationRecorder,
    Arc<AtomicU64>,
    JoinHandle<()>,
) {
    let (tx, rx) = sync_channel::<WorkflowObservation>(256);
    let (recorder, dropped) =
        BoundedObservationRecorder::new_with_diagnostics(tx, diagnostics.clone());
    let handle = std::thread::Builder::new()
        .name("workflow-observation-worker".to_string())
        .spawn(move || {
            run_observation_worker(store, rx, diagnostics);
        })
        .expect("failed to spawn workflow observation worker thread");
    (recorder, dropped, handle)
}

fn run_observation_worker(
    store: WorkflowStore,
    receiver: Receiver<WorkflowObservation>,
    diagnostics: Option<DiagnosticStore>,
) {
    while let Ok(obs) = receiver.recv() {
        let result = if let Some(diagnostics) = &diagnostics {
            process_observation_with_diagnostics(&store, &obs, diagnostics)
        } else {
            process_observation(&store, &obs)
        };
        if result.is_err() {
            warn!("Failed to process workflow observation");
        }
    }
    debug!("Workflow observation worker stopped");
}

/// Process a single terminal lifecycle observation inside a SQLite transaction.
/// CRITICAL: Updates resource links and activity events ONLY; NEVER changes manual session timestamps/status.
pub fn process_observation(
    store: &WorkflowStore,
    obs: &WorkflowObservation,
) -> Result<usize, WorkflowStoreError> {
    process_observation_inner(store, obs)
}

/// Process an observation and emit only fixed-cardinality diagnostics.
pub fn process_observation_with_diagnostics(
    store: &WorkflowStore,
    obs: &WorkflowObservation,
    diagnostics: &DiagnosticStore,
) -> Result<usize, WorkflowStoreError> {
    let started = Instant::now();
    let result = process_observation_inner(store, obs);
    record_observation_diagnostic(diagnostics, obs, &result, started);
    result
}

fn process_observation_inner(
    store: &WorkflowStore,
    obs: &WorkflowObservation,
) -> Result<usize, WorkflowStoreError> {
    let mut conn = store.lock()?;
    let tx = conn.transaction()?;
    let external_id = obs.session_id();
    let links = find_links_by_external_id_tx(&tx, ResourceLinkType::Terminal, external_id)?;
    if links.is_empty() {
        return Ok(0);
    }

    let obs_inc = obs.incarnation();
    let obs_time = obs.observed_at();
    let mut updated_count = 0;

    for link in &links {
        if let (Some(curr_inc), Some(incoming_inc)) = (link.incarnation, obs_inc) {
            if incoming_inc < curr_inc {
                debug!("Skipping out-of-order terminal observation with older incarnation");
                continue;
            }
        }

        let (new_state, new_incarnation, suggested_end_time) = match obs {
            WorkflowObservation::TerminalCreated { incarnation, .. } => {
                (ResourceObservedState::Attached, Some(*incarnation), None)
            }
            WorkflowObservation::TerminalExitPendingRestart { incarnation, .. } => {
                (
                    ResourceObservedState::Stale,
                    Some(*incarnation),
                    Some(obs_time),
                )
            }
            WorkflowObservation::TerminalRestarted { incarnation, .. } => {
                (ResourceObservedState::Attached, Some(*incarnation), None)
            }
            WorkflowObservation::TerminalFinalExit {
                incarnation,
                exit_code,
                ..
            } => {
                let state = if *exit_code == Some(0) {
                    ResourceObservedState::Exited
                } else {
                    ResourceObservedState::Crashed
                };
                (state, Some(*incarnation), Some(obs_time))
            }
            WorkflowObservation::TerminalRemoved { incarnation, .. } => (
                ResourceObservedState::Detached,
                incarnation.or(link.incarnation),
                Some(obs_time),
            ),
        };

        // Update resource link
        tx.execute(
            "UPDATE workflow_resource_links
             SET observed_state = ?1, incarnation = ?2, suggested_end_time = ?3, last_seen_at = ?4, updated_at = ?4
             WHERE id = ?5",
            params![
                new_state.as_str(),
                new_incarnation,
                suggested_end_time,
                obs_time,
                link.id,
            ],
        )?;

        // Find parent session to get workspace and target context for event
        if let Ok(Some(session)) = get_session_by_id_tx(&tx, &link.session_id) {
            let event_id = format!(
                "evt:obs:term:{}:{}:{}:{}",
                link.session_id,
                external_id,
                obs_inc.unwrap_or(0),
                obs.action_str()
            );
            let event = WorkflowEvent {
                id: event_id,
                workspace_id: session.workspace_id,
                event_type: WorkflowEventType::ResourceObserved,
                source: WorkflowSource::System,
                project_name: Some(session.project_name),
                worktree_path: session.worktree_path,
                item_id: session.item_id,
                session_id: Some(link.session_id.clone()),
                occurred_at: obs_time,
                recorded_at: obs_time,
                payload_json: Some(obs.to_payload_json()),
                expires_at: Some(
                    obs_time + (DEFAULT_EVENT_RETENTION_DAYS as u64) * 86_400_000,
                ),
            };
            record_event_tx(&tx, &event)?;
        }

        updated_count += 1;
    }

    tx.commit()?;
    Ok(updated_count)
}
