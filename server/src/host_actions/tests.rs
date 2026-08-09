use std::{
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

use super::{
    helper_client::{HelperOutcome, HelperReceipt, HostActionExecutor},
    service::HostActionService,
    types::{ActionIntentRequest, ExecutionState, HostAction, HostActionError, ProcessTarget},
};

struct FakeExecutor(AtomicUsize);

struct BlockingExecutor {
    started: std::sync::mpsc::Sender<()>,
    release: std::sync::Mutex<std::sync::mpsc::Receiver<()>>,
}

enum OutcomeKind {
    Denied,
    Unknown,
}
struct OutcomeExecutor(OutcomeKind);

impl HostActionExecutor for FakeExecutor {
    fn execute(
        &self,
        _: &super::approval::ApprovedIntent,
    ) -> Result<HelperOutcome, HostActionError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(HelperOutcome::Succeeded(HelperReceipt {
            receipt_id: Some("helper-receipt".into()),
            code: None,
        }))
    }
}

impl HostActionExecutor for BlockingExecutor {
    fn execute(
        &self,
        _: &super::approval::ApprovedIntent,
    ) -> Result<HelperOutcome, HostActionError> {
        let _ = self.started.send(());
        let _ = self.release.lock().unwrap().recv();
        Ok(HelperOutcome::Succeeded(HelperReceipt {
            receipt_id: None,
            code: None,
        }))
    }
}

impl HostActionExecutor for OutcomeExecutor {
    fn execute(
        &self,
        _: &super::approval::ApprovedIntent,
    ) -> Result<HelperOutcome, HostActionError> {
        Ok(match self.0 {
            OutcomeKind::Denied => HelperOutcome::Denied("helperDenied".into()),
            OutcomeKind::Unknown => HelperOutcome::Unknown("helperIndeterminate".into()),
        })
    }
}

fn snapshot() -> crate::system::HostResourceSnapshotV1 {
    let mut snapshot =
        crate::system::HostResourceSnapshotV1::unavailable(now_ms(), Path::new("/tmp"));
    snapshot.action_capabilities.availability =
        crate::system::Availability::available(snapshot.sampled_at);
    snapshot
}

fn cache_request(snapshot: &crate::system::HostResourceSnapshotV1) -> ActionIntentRequest {
    ActionIntentRequest {
        action: HostAction::DropCleanCaches,
        sample_id: snapshot.sample_id.clone(),
        alert_id: None,
        reason: Some("pressure evidence".into()),
    }
}

fn process_request(
    snapshot: &crate::system::HostResourceSnapshotV1,
    pid: u32,
) -> ActionIntentRequest {
    ActionIntentRequest {
        action: HostAction::TerminateSameUserProcess {
            target: ProcessTarget {
                boot_id: "boot-a".into(),
                pid,
                start_time_ticks: u64::from(pid),
                uid: 1000,
                name: "worker".into(),
            },
        },
        sample_id: snapshot.sample_id.clone(),
        alert_id: None,
        reason: None,
    }
}

fn process_snapshot(pid: u32) -> crate::system::HostResourceSnapshotV1 {
    let mut snapshot = snapshot();
    snapshot.host.boot_id = Some("boot-a".into());
    snapshot
        .processes
        .processes
        .push(crate::system::ProcessMemory {
            pid,
            start_ticks: Some(u64::from(pid)),
            uid: Some(1000),
            name: "worker".into(),
            command_summary: None,
            rss_bytes: None,
            anon_rss_bytes: None,
            file_rss_bytes: None,
            shmem_rss_bytes: None,
            pss_bytes: None,
            availability: crate::system::Availability::available(snapshot.sampled_at),
        });
    snapshot
}

async fn approved(
    service: &HostActionService,
    actor: &str,
    snapshot: crate::system::HostResourceSnapshotV1,
) -> (String, String) {
    let challenge = service
        .create_intent(actor, cache_request(&snapshot), snapshot)
        .await
        .unwrap();
    let (token, _) = service
        .approve(actor, &challenge.intent_id, &challenge.challenge_nonce)
        .await
        .unwrap();
    (challenge.intent_id, token)
}

#[tokio::test]
async fn approval_is_single_use_and_bound_to_its_actor() {
    let dir = tempfile::tempdir().unwrap();
    let executor = Arc::new(FakeExecutor(AtomicUsize::new(0)));
    let service = HostActionService::for_tests(dir.path().into(), executor.clone());
    let (intent_id, token) = approved(&service, "alice", snapshot()).await;

    assert_eq!(
        service
            .submit("bob", &intent_id, &token)
            .await
            .unwrap_err()
            .to_string(),
        "action approval is invalid or already consumed"
    );
    let execution = service.submit("alice", &intent_id, &token).await.unwrap();
    assert!(service.submit("alice", &intent_id, &token).await.is_err());
    wait_for_state(&service, &execution.execution_id, ExecutionState::Succeeded).await;
    assert_eq!(executor.0.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn expired_intents_and_altered_targets_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let service = HostActionService::for_tests(
        dir.path().into(),
        Arc::new(FakeExecutor(AtomicUsize::new(0))),
    );
    let snap = snapshot();
    let challenge = service
        .create_intent("alice", cache_request(&snap), snap.clone())
        .await
        .unwrap();
    service.expire_approvals_for_tests().await;
    assert!(matches!(
        service
            .approve("alice", &challenge.intent_id, &challenge.challenge_nonce)
            .await,
        Err(HostActionError::IntentExpired)
    ));

    let (intent_id, token) = approved(&service, "alice", snapshot()).await;
    service.expire_approvals_for_tests().await;
    assert!(matches!(
        service.submit("alice", &intent_id, &token).await,
        Err(HostActionError::IntentExpired)
    ));

    let mut target_snapshot = snapshot();
    target_snapshot.host.boot_id = Some("boot-a".into());
    target_snapshot
        .processes
        .processes
        .push(crate::system::ProcessMemory {
            pid: 21,
            start_ticks: Some(34),
            uid: Some(1000),
            name: "worker".into(),
            command_summary: None,
            rss_bytes: None,
            anon_rss_bytes: None,
            file_rss_bytes: None,
            shmem_rss_bytes: None,
            pss_bytes: None,
            availability: crate::system::Availability::available(target_snapshot.sampled_at),
        });
    let request = ActionIntentRequest {
        action: HostAction::TerminateSameUserProcess {
            target: ProcessTarget {
                boot_id: "boot-a".into(),
                pid: 21,
                start_time_ticks: 34,
                uid: 1000,
                name: "different".into(),
            },
        },
        sample_id: target_snapshot.sample_id.clone(),
        alert_id: None,
        reason: None,
    };
    assert!(matches!(
        service
            .create_intent("alice", request, target_snapshot)
            .await,
        Err(HostActionError::StaleTarget)
    ));
}

#[tokio::test]
async fn audit_failure_prevents_executor_dispatch() {
    let dir = tempfile::tempdir().unwrap();
    let blocked_parent = dir.path().join("not-a-directory");
    std::fs::write(&blocked_parent, "file").unwrap();
    let executor = Arc::new(FakeExecutor(AtomicUsize::new(0)));
    let service = HostActionService::for_tests(blocked_parent, executor.clone());
    let (intent_id, token) = approved(&service, "alice", snapshot()).await;

    assert!(matches!(
        service.submit("alice", &intent_id, &token).await,
        Err(HostActionError::AuditUnavailable)
    ));
    assert_eq!(executor.0.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn unavailable_executor_records_a_safe_failure() {
    let dir = tempfile::tempdir().unwrap();
    let service = HostActionService::new(dir.path().into());
    let (intent_id, token) = approved(&service, "alice", snapshot()).await;
    let execution = service.submit("alice", &intent_id, &token).await.unwrap();
    wait_for_state(&service, &execution.execution_id, ExecutionState::Failed).await;
    assert_eq!(
        service
            .execution(&execution.execution_id)
            .await
            .unwrap()
            .code
            .as_deref(),
        Some("helperUnavailable")
    );
    let audit = service.audit().list(None, 100).unwrap();
    assert!(audit
        .records
        .iter()
        .all(|record| !record.to_string().contains(&token)));
}

#[tokio::test]
async fn reauthentication_failures_are_bounded_per_actor_and_ip() {
    let dir = tempfile::tempdir().unwrap();
    let service = HostActionService::new(dir.path().into());
    for _ in 0..5 {
        service
            .record_reauth_failure("alice", Some("127.0.0.1"))
            .await;
    }
    assert!(matches!(
        service
            .check_reauth_allowed("alice", Some("127.0.0.1"))
            .await,
        Err(HostActionError::RateLimited)
    ));
    assert!(matches!(
        service
            .check_reauth_allowed("other", Some("127.0.0.1"))
            .await,
        Err(HostActionError::RateLimited)
    ));
}

#[tokio::test]
async fn cache_drop_cooldown_and_execution_reads_are_actor_scoped() {
    let dir = tempfile::tempdir().unwrap();
    let service = HostActionService::for_tests(
        dir.path().into(),
        Arc::new(FakeExecutor(AtomicUsize::new(0))),
    );
    let (intent_id, token) = approved(&service, "alice", snapshot()).await;
    let execution = service.submit("alice", &intent_id, &token).await.unwrap();
    wait_for_state(&service, &execution.execution_id, ExecutionState::Succeeded).await;
    assert!(service
        .execution_for_actor("bob", &execution.execution_id)
        .await
        .is_none());
    assert!(service
        .execution_for_actor("alice", &execution.execution_id)
        .await
        .is_some());
    assert!(service
        .audit_for_actor("bob".into(), None, 100)
        .await
        .unwrap()
        .records
        .is_empty());
    assert!(!service
        .audit_for_actor("alice".into(), None, 100)
        .await
        .unwrap()
        .records
        .is_empty());

    let (intent_id, token) = approved(&service, "alice", snapshot()).await;
    assert!(matches!(
        service.submit("alice", &intent_id, &token).await,
        Err(HostActionError::Cooldown)
    ));
    assert!(service
        .audit_for_actor("alice".into(), None, 100)
        .await
        .unwrap()
        .records
        .iter()
        .any(|record| record["state"] == "denied" && record["code"] == "cacheCooldown"));
}

#[tokio::test]
async fn unavailable_capabilities_and_full_queue_reject_new_actions() {
    let dir = tempfile::tempdir().unwrap();
    let (started_tx, _started_rx) = std::sync::mpsc::channel();
    let (_release_tx, release_rx) = std::sync::mpsc::channel();
    let service = HostActionService::for_tests(
        dir.path().into(),
        Arc::new(BlockingExecutor {
            started: started_tx,
            release: std::sync::Mutex::new(release_rx),
        }),
    );
    let unavailable =
        crate::system::HostResourceSnapshotV1::unavailable(now_ms(), Path::new("/tmp"));
    assert!(matches!(
        service
            .create_intent("alice", cache_request(&unavailable), unavailable)
            .await,
        Err(HostActionError::CapabilityUnavailable)
    ));

    for pid in 1..=8 {
        let snapshot = process_snapshot(pid);
        let challenge = service
            .create_intent("alice", process_request(&snapshot, pid), snapshot)
            .await
            .unwrap();
        let (token, _) = service
            .approve("alice", &challenge.intent_id, &challenge.challenge_nonce)
            .await
            .unwrap();
        service
            .submit("alice", &challenge.intent_id, &token)
            .await
            .unwrap();
    }
    let snapshot = process_snapshot(9);
    let challenge = service
        .create_intent("alice", process_request(&snapshot, 9), snapshot)
        .await
        .unwrap();
    let (token, _) = service
        .approve("alice", &challenge.intent_id, &challenge.challenge_nonce)
        .await
        .unwrap();
    assert!(matches!(
        service.submit("alice", &challenge.intent_id, &token).await,
        Err(HostActionError::QueueFull)
    ));
}

#[tokio::test]
async fn helper_denied_and_unknown_outcomes_are_preserved() {
    for (kind, expected_state, expected_code) in [
        (OutcomeKind::Denied, ExecutionState::Denied, "helperDenied"),
        (
            OutcomeKind::Unknown,
            ExecutionState::Unknown,
            "helperIndeterminate",
        ),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let service =
            HostActionService::for_tests(dir.path().into(), Arc::new(OutcomeExecutor(kind)));
        let (intent_id, token) = approved(&service, "alice", snapshot()).await;
        let execution = service.submit("alice", &intent_id, &token).await.unwrap();
        wait_for_state(&service, &execution.execution_id, expected_state).await;
        assert_eq!(
            service
                .execution(&execution.execution_id)
                .await
                .unwrap()
                .code
                .as_deref(),
            Some(expected_code)
        );
    }
}

#[tokio::test]
async fn intent_limits_are_enforced_per_actor_and_globally() {
    let dir = tempfile::tempdir().unwrap();
    let service = HostActionService::new(dir.path().into());
    for _ in 0..32 {
        let snap = snapshot();
        service
            .create_intent("alice", cache_request(&snap), snap)
            .await
            .unwrap();
    }
    let snap = snapshot();
    assert!(matches!(
        service
            .create_intent("alice", cache_request(&snap), snap)
            .await,
        Err(HostActionError::IntentLimit)
    ));
    for index in 0..224 {
        let snap = snapshot();
        service
            .create_intent(&format!("actor-{index}"), cache_request(&snap), snap)
            .await
            .unwrap();
    }
    let snap = snapshot();
    assert!(matches!(
        service
            .create_intent("final", cache_request(&snap), snap)
            .await,
        Err(HostActionError::IntentLimit)
    ));
}

#[tokio::test]
async fn final_audit_failure_surfaces_an_unknown_execution_state() {
    let dir = tempfile::tempdir().unwrap();
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let service = HostActionService::for_tests(
        dir.path().into(),
        Arc::new(BlockingExecutor {
            started: started_tx,
            release: std::sync::Mutex::new(release_rx),
        }),
    );
    let (intent_id, token) = approved(&service, "alice", snapshot()).await;
    let execution = service.submit("alice", &intent_id, &token).await.unwrap();
    tokio::task::spawn_blocking(move || started_rx.recv_timeout(Duration::from_secs(1)))
        .await
        .unwrap()
        .unwrap();
    let audit_path = dir.path().join("host-actions.jsonl");
    std::fs::remove_file(&audit_path).unwrap();
    std::fs::create_dir(&audit_path).unwrap();
    release_tx.send(()).unwrap();

    wait_for_state(&service, &execution.execution_id, ExecutionState::Unknown).await;
    assert_eq!(
        service
            .execution(&execution.execution_id)
            .await
            .unwrap()
            .code
            .as_deref(),
        Some("auditUnavailable")
    );
}

async fn wait_for_state(service: &HostActionService, execution_id: &str, state: ExecutionState) {
    for _ in 0..100 {
        if service
            .execution(execution_id)
            .await
            .is_some_and(|item| item.state == state)
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("execution did not reach {state:?}");
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
