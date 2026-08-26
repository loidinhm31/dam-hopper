use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use tokio::sync::{Mutex, Semaphore};
use uuid::Uuid;

use crate::system::{AvailabilityState, HostResourceSnapshotV1};

use super::{
    approval::{ApprovalStore, ApprovedIntent},
    audit::{ActionAuditStore, AuditRecord},
    helper_client::{HelperOutcome, SharedExecutor, UnavailableExecutor},
    types::{
        ActionCapabilitiesResponse, ActionExecution, ActionIntentRequest, ExecutionState,
        HostAction, HostActionError, IntentChallenge,
    },
};

const MAX_SAMPLE_AGE: Duration = Duration::from_secs(30);
const REAUTH_WINDOW: Duration = Duration::from_secs(5 * 60);
const CACHE_COOLDOWN: Duration = Duration::from_secs(15 * 60);
const EXECUTION_RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1_000;
const MAX_EXECUTIONS: usize = 1_024;

#[derive(Clone)]
struct StoredExecution {
    actor: String,
    execution: ActionExecution,
}

#[derive(Clone)]
pub struct HostActionService {
    approvals: Arc<Mutex<ApprovalStore>>,
    executions: Arc<Mutex<HashMap<String, StoredExecution>>>,
    queue: Arc<Semaphore>,
    execution_gate: Arc<Mutex<()>>,
    executor: SharedExecutor,
    audit: ActionAuditStore,
    failures: Arc<Mutex<HashMap<String, VecDeque<Instant>>>>,
    cache_cooldown_until: Arc<Mutex<Option<Instant>>>,
}

impl HostActionService {
    pub fn new(config_dir: PathBuf) -> Self {
        Self::with_executor(config_dir, Arc::new(UnavailableExecutor))
    }

    pub fn capabilities(&self, no_auth: bool, has_database: bool) -> ActionCapabilitiesResponse {
        let reason = if no_auth {
            "noAuth"
        } else if !has_database {
            "reauthUnavailable"
        } else {
            "helperNotEnrolled"
        };
        ActionCapabilitiesResponse {
            available: false,
            reason: reason.into(),
            actions: vec!["dropCleanCaches", "terminateSameUserProcess"],
        }
    }

    pub async fn create_intent(
        &self,
        actor: &str,
        request: ActionIntentRequest,
        snapshot: HostResourceSnapshotV1,
    ) -> Result<IntentChallenge, HostActionError> {
        request.validate()?;
        validate_snapshot(&snapshot, &request)?;
        self.approvals
            .lock()
            .await
            .create(actor.into(), request, now_ms())
    }

    pub async fn approve(
        &self,
        actor: &str,
        intent_id: &str,
        nonce: &str,
    ) -> Result<(String, u64), HostActionError> {
        self.approvals
            .lock()
            .await
            .approve(actor, intent_id, nonce, now_ms())
    }

    pub async fn submit(
        &self,
        actor: &str,
        intent_id: &str,
        token: &str,
    ) -> Result<ActionExecution, HostActionError> {
        let intent = self
            .approvals
            .lock()
            .await
            .consume(actor, intent_id, token)?;
        let cache_reserved = matches!(intent.action, HostAction::DropCleanCaches);
        if cache_reserved {
            if let Err(error) = self.reserve_cache_cooldown().await {
                self.audit_record(
                    &intent,
                    None,
                    ExecutionState::Denied,
                    Some("cacheCooldown".into()),
                    None,
                )
                .await?;
                return Err(error);
            }
        }
        let permit = match self.queue.clone().try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => {
                let audit = self
                    .audit_record(
                        &intent,
                        None,
                        ExecutionState::Denied,
                        Some("queueFull".into()),
                        None,
                    )
                    .await;
                if cache_reserved {
                    self.release_cache_cooldown().await;
                }
                audit?;
                return Err(HostActionError::QueueFull);
            }
        };
        let now = now_ms();
        let execution = ActionExecution {
            execution_id: Uuid::new_v4().to_string(),
            state: ExecutionState::Queued,
            code: None,
            created_at: now,
            updated_at: now,
        };
        if let Err(error) = self
            .audit_record(
                &intent,
                Some(&execution),
                ExecutionState::Queued,
                None,
                None,
            )
            .await
        {
            if cache_reserved {
                self.release_cache_cooldown().await;
            }
            return Err(error);
        }
        insert_execution(&self.executions, intent.actor.clone(), execution.clone()).await;
        tokio::spawn(run_execution(
            permit,
            Arc::clone(&self.execution_gate),
            Arc::clone(&self.executions),
            self.executor.clone(),
            self.audit.clone(),
            intent,
            execution.execution_id.clone(),
        ));
        Ok(execution)
    }

    pub async fn execution(&self, id: &str) -> Option<ActionExecution> {
        let mut executions = self.executions.lock().await;
        prune_executions(&mut executions);
        executions.get(id).map(|item| item.execution.clone())
    }

    pub async fn execution_for_actor(&self, actor: &str, id: &str) -> Option<ActionExecution> {
        let mut executions = self.executions.lock().await;
        prune_executions(&mut executions);
        executions
            .get(id)
            .filter(|item| item.actor == actor)
            .map(|item| item.execution.clone())
    }

    #[cfg(test)]
    pub(crate) fn audit(&self) -> &ActionAuditStore {
        &self.audit
    }

    pub async fn audit_for_actor(
        &self,
        actor: String,
        cursor: Option<String>,
        limit: usize,
    ) -> Result<super::audit::ActionAuditPage, HostActionError> {
        let audit = self.audit.clone();
        tokio::task::spawn_blocking(move || {
            audit.list_for_actor(Some(&actor), cursor.as_deref(), limit)
        })
        .await
        .map_err(|_| HostActionError::AuditUnavailable)?
        .map_err(|_| HostActionError::AuditUnavailable)
    }

    pub async fn check_reauth_allowed(
        &self,
        actor: &str,
        ip: Option<&str>,
    ) -> Result<(), HostActionError> {
        let mut failures = self.failures.lock().await;
        let keys = [
            format!("actor:{actor}"),
            format!("ip:{}", ip.unwrap_or("unknown")),
        ];
        for key in &keys {
            prune(failures.entry(key.clone()).or_default());
        }
        if keys.iter().any(|key| {
            failures
                .get(key)
                .is_some_and(|attempts| attempts.len() >= 5)
        }) {
            Err(HostActionError::RateLimited)
        } else {
            Ok(())
        }
    }

    pub async fn record_reauth_failure(&self, actor: &str, ip: Option<&str>) {
        let mut failures = self.failures.lock().await;
        for key in [
            format!("actor:{actor}"),
            format!("ip:{}", ip.unwrap_or("unknown")),
        ] {
            let attempts = failures.entry(key).or_default();
            prune(attempts);
            attempts.push_back(Instant::now());
        }
    }

    async fn reserve_cache_cooldown(&self) -> Result<(), HostActionError> {
        let mut cooldown = self.cache_cooldown_until.lock().await;
        if cooldown.is_some_and(|until| until > Instant::now()) {
            return Err(HostActionError::Cooldown);
        }
        *cooldown = Some(Instant::now() + CACHE_COOLDOWN);
        Ok(())
    }

    async fn release_cache_cooldown(&self) {
        *self.cache_cooldown_until.lock().await = None;
    }

    async fn audit_record(
        &self,
        intent: &ApprovedIntent,
        execution: Option<&ActionExecution>,
        state: ExecutionState,
        code: Option<String>,
        receipt_id: Option<String>,
    ) -> Result<(), HostActionError> {
        append_record(
            self.audit.clone(),
            audit_record(intent, execution, state, code, receipt_id),
        )
        .await
    }

    fn with_executor(config_dir: PathBuf, executor: SharedExecutor) -> Self {
        Self {
            approvals: Arc::new(Mutex::new(ApprovalStore::default())),
            executions: Arc::new(Mutex::new(HashMap::new())),
            queue: Arc::new(Semaphore::new(8)),
            execution_gate: Arc::new(Mutex::new(())),
            executor,
            audit: ActionAuditStore::new(config_dir.join("host-actions.jsonl")),
            failures: Arc::new(Mutex::new(HashMap::new())),
            cache_cooldown_until: Arc::new(Mutex::new(None)),
        }
    }

    #[cfg(test)]
    pub(crate) fn for_tests(config_dir: PathBuf, executor: SharedExecutor) -> Self {
        Self::with_executor(config_dir, executor)
    }

    #[cfg(test)]
    pub async fn expire_approvals_for_tests(&self) {
        self.approvals.lock().await.expire_all_for_tests();
    }
}

async fn run_execution(
    _queue_slot: tokio::sync::OwnedSemaphorePermit,
    gate: Arc<Mutex<()>>,
    executions: Arc<Mutex<HashMap<String, StoredExecution>>>,
    executor: SharedExecutor,
    audit: ActionAuditStore,
    intent: ApprovedIntent,
    execution_id: String,
) {
    let _active = gate.lock().await;
    update_state(&executions, &execution_id, ExecutionState::Executing, None).await;
    let current = execution_copy(&executions, &execution_id).await;
    if append_record(
        audit.clone(),
        audit_record(
            &intent,
            current.as_ref(),
            ExecutionState::Executing,
            None,
            None,
        ),
    )
    .await
    .is_err()
    {
        update_state(
            &executions,
            &execution_id,
            ExecutionState::Unknown,
            Some("auditUnavailable".into()),
        )
        .await;
        let current = execution_copy(&executions, &execution_id).await;
        let _ = append_record(
            audit,
            audit_record(
                &intent,
                current.as_ref(),
                ExecutionState::Unknown,
                Some("auditUnavailable".into()),
                None,
            ),
        )
        .await;
        return;
    }
    let dispatch = intent.clone();
    let result = tokio::task::spawn_blocking(move || executor.execute(&dispatch)).await;
    let (state, code, receipt) = match result {
        Ok(Ok(HelperOutcome::Succeeded(receipt))) => {
            (ExecutionState::Succeeded, receipt.code, receipt.receipt_id)
        }
        Ok(Ok(HelperOutcome::Denied(code))) => (ExecutionState::Denied, Some(code), None),
        Ok(Ok(HelperOutcome::Unknown(code))) => (ExecutionState::Unknown, Some(code), None),
        Ok(Err(error)) => (
            ExecutionState::Failed,
            Some(error_code(&error).into()),
            None,
        ),
        Err(_) => (
            ExecutionState::Unknown,
            Some("executionJoinFailed".into()),
            None,
        ),
    };
    update_state(&executions, &execution_id, state, code.clone()).await;
    let current = execution_copy(&executions, &execution_id).await;
    if append_record(
        audit.clone(),
        audit_record(&intent, current.as_ref(), state, code, receipt),
    )
    .await
    .is_err()
    {
        update_state(
            &executions,
            &execution_id,
            ExecutionState::Unknown,
            Some("auditUnavailable".into()),
        )
        .await;
        let current = execution_copy(&executions, &execution_id).await;
        if append_record(
            audit,
            audit_record(
                &intent,
                current.as_ref(),
                ExecutionState::Unknown,
                Some("auditUnavailable".into()),
                None,
            ),
        )
        .await
        .is_err()
        {
            tracing::error!(
                execution_id,
                "host action final audit could not be persisted"
            );
        }
    }
}

async fn update_state(
    executions: &Mutex<HashMap<String, StoredExecution>>,
    id: &str,
    state: ExecutionState,
    code: Option<String>,
) {
    if let Some(stored) = executions.lock().await.get_mut(id) {
        stored.execution.state = state;
        stored.execution.code = code;
        stored.execution.updated_at = now_ms();
    }
}

async fn insert_execution(
    executions: &Mutex<HashMap<String, StoredExecution>>,
    actor: String,
    execution: ActionExecution,
) {
    let mut executions = executions.lock().await;
    prune_executions(&mut executions);
    while executions.len() >= MAX_EXECUTIONS {
        let Some(oldest) = executions
            .iter()
            .min_by_key(|(_, item)| item.execution.updated_at)
            .map(|(id, _)| id.clone())
        else {
            break;
        };
        executions.remove(&oldest);
    }
    executions.insert(
        execution.execution_id.clone(),
        StoredExecution { actor, execution },
    );
}

async fn execution_copy(
    executions: &Mutex<HashMap<String, StoredExecution>>,
    id: &str,
) -> Option<ActionExecution> {
    executions
        .lock()
        .await
        .get(id)
        .map(|item| item.execution.clone())
}

fn prune_executions(executions: &mut HashMap<String, StoredExecution>) {
    let min_updated = now_ms().saturating_sub(EXECUTION_RETENTION_MS);
    executions.retain(|_, item| item.execution.updated_at >= min_updated);
}

async fn append_record(
    audit: ActionAuditStore,
    record: AuditRecord,
) -> Result<(), HostActionError> {
    tokio::task::spawn_blocking(move || audit.append(&record))
        .await
        .map_err(|_| HostActionError::AuditUnavailable)?
        .map_err(|_| HostActionError::AuditUnavailable)
}

fn validate_snapshot(
    snapshot: &HostResourceSnapshotV1,
    request: &ActionIntentRequest,
) -> Result<(), HostActionError> {
    if snapshot.sample_id != request.sample_id
        || snapshot.sampled_at == 0
        || now_ms().saturating_sub(snapshot.sampled_at) > MAX_SAMPLE_AGE.as_millis() as u64
    {
        return Err(HostActionError::StaleTarget);
    }
    if snapshot.action_capabilities.availability.state != AvailabilityState::Available {
        return Err(HostActionError::CapabilityUnavailable);
    }
    let valid = match &request.action {
        HostAction::DropCleanCaches => true,
        HostAction::TerminateSameUserProcess { target } => {
            snapshot.host.boot_id.as_deref() == Some(&target.boot_id)
                && snapshot.processes.processes.iter().any(|process| {
                    process.pid == target.pid
                        && process.start_ticks == Some(target.start_time_ticks)
                        && process.uid == Some(target.uid)
                        && process.name == target.name
                        && process.availability.state == AvailabilityState::Available
                })
        }
    };
    valid.then_some(()).ok_or(HostActionError::StaleTarget)
}

fn audit_record(
    intent: &ApprovedIntent,
    execution: Option<&ActionExecution>,
    state: ExecutionState,
    code: Option<String>,
    receipt_id: Option<String>,
) -> AuditRecord {
    AuditRecord {
        timestamp: now_ms(), actor: intent.actor.clone(), action: intent.action.kind().into(),
        target: intent.action.target().map(|target| serde_json::json!({"bootId": target.boot_id, "pid": target.pid, "startTimeTicks": target.start_time_ticks, "uid": target.uid, "name": target.name})),
        intent_id: intent.id.clone(), execution_id: execution.map(|item| item.execution_id.clone()), helper_receipt_id: receipt_id,
        state: format!("{state:?}").to_lowercase(), code, before_sample_id: Some(intent.sample_id.clone()), after_sample_id: None, alert_id: intent.alert_id.clone(),
    }
}

fn error_code(error: &HostActionError) -> &'static str {
    match error {
        HostActionError::Unavailable => "helperUnavailable",
        HostActionError::AuditUnavailable => "auditUnavailable",
        _ => "actionFailed",
    }
}

fn prune(attempts: &mut VecDeque<Instant>) {
    while attempts
        .front()
        .is_some_and(|time| time.elapsed() > REAUTH_WINDOW)
    {
        attempts.pop_front();
    }
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
