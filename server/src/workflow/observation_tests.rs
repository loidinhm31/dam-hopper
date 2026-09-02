use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::mpsc::sync_channel;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::Connection;

use crate::pty::{NoopEventSink, PtyCreateOpts, PtySessionManager};
use crate::workflow::enums::{
    ItemKind, ItemStatus, ResourceLinkType, ResourceObservedState, SessionStatus, WorkflowSource,
};
use crate::workflow::model::{WorkflowItem, WorkflowResourceLink, WorkflowSession};
use crate::workflow::observation::{
    process_observation, start_observation_worker, BoundedObservationRecorder,
    WorkflowObservation, WorkflowObservationRecorder,
};
use crate::workflow::reconcile::reconcile_startup_terminal_links;
use crate::workflow::store::session::get_session;
use crate::workflow::store::WorkflowStore;
fn setup_test_db() -> (WorkflowStore, String) {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch(include_str!(
        "../persistence/migrations/010_workflow_tracking.sql"
    ))
    .expect("apply migration");
    let store = WorkflowStore::new(Arc::new(Mutex::new(conn)));
    let ws = store
        .get_or_create_workspace("test-locator", "test-ws", 1000)
        .expect("workspace");
    (store, ws.id)
}

fn create_plan_and_session(
    store: &WorkflowStore,
    workspace_id: &str,
    session_id: &str,
    project_name: &str,
    worktree_path: Option<&str>,
) -> (WorkflowItem, WorkflowSession) {
    let now = 1000u64;
    let plan = WorkflowItem {
        id: format!("plan-{}", session_id),
        workspace_id: workspace_id.to_string(),
        project_name: project_name.to_string(),
        worktree_path: worktree_path.map(String::from),
        parent_id: None,
        kind: ItemKind::Plan,
        title: "Test Plan".to_string(),
        summary: None,
        status: ItemStatus::InProgress,
        sort_order: 0,
        source: WorkflowSource::Manual,
        created_at: now,
        updated_at: now,
        completed_at: None,
        archived_at: None,
    };
    store.create_item(&plan, None).expect("create plan");

    let session = WorkflowSession {
        id: session_id.to_string(),
        workspace_id: workspace_id.to_string(),
        project_name: project_name.to_string(),
        worktree_path: worktree_path.map(String::from),
        item_id: Some(plan.id.clone()),
        status: SessionStatus::Running,
        started_at: now,
        ended_at: None,
        source: WorkflowSource::Manual,
        created_at: now,
        updated_at: now,
    };
    store.start_session(&session, None, None).expect("start session");

    (plan, session)
}

fn link_terminal(
    store: &WorkflowStore,
    session_id: &str,
    external_id: &str,
    incarnation: u64,
) -> WorkflowResourceLink {
    let now = 1000u64;
    let link = WorkflowResourceLink {
        id: format!("link-{}", external_id),
        session_id: session_id.to_string(),
        resource_type: ResourceLinkType::Terminal,
        external_id: external_id.to_string(),
        incarnation: Some(incarnation),
        harness_label: None,
        run_id: None,
        observed_state: ResourceObservedState::Attached,
        suggested_end_time: None,
        first_seen_at: now,
        last_seen_at: now,
        link_source: WorkflowSource::Manual,
        created_at: now,
        updated_at: now,
    };
    let created = store.link_resource(&link, None).expect("link resource");
    created
}
fn assert_manual_session_fields(
    store: &WorkflowStore,
    workspace_id: &str,
    session_id: &str,
    status: SessionStatus,
    started_at: u64,
    ended_at: Option<u64>,
) {
    let conn = store.lock().unwrap();
    let loaded = get_session(&conn, session_id, workspace_id)
        .unwrap()
        .expect("manual session");
    assert_eq!(loaded.status, status);
    assert_eq!(loaded.started_at, started_at);
    assert_eq!(loaded.ended_at, ended_at);
}

#[test]
fn test_terminal_created_observation_updates_link_without_touching_session() {
    let (store, ws_id) = setup_test_db();
    let (_plan, session) =
        create_plan_and_session(&store, &ws_id, "sess-1", "my-project", None);
    link_terminal(&store, &session.id, "term-1", 1);

    let obs = WorkflowObservation::TerminalCreated {
        session_id: "term-1".to_string(),
        incarnation: 2,
        project: Some("my-project".to_string()),
        worktree_path: None,
        observed_at: 2000,
    };
    let updated = process_observation(&store, &obs).expect("process observation");
    assert_eq!(updated, 1);

    // Verify link is Attached with new incarnation
    let links = store.get_links_for_session(&session.id).unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].observed_state, ResourceObservedState::Attached);
    assert_eq!(links[0].incarnation, Some(2));
    assert_eq!(links[0].suggested_end_time, None);
    assert_eq!(links[0].last_seen_at, 2000);

    assert_manual_session_fields(
        &store,
        &ws_id,
        &session.id,
        SessionStatus::Running,
        1000,
        None,
    );
}

#[test]
fn test_terminal_exit_pending_restart_observation() {
    let (store, ws_id) = setup_test_db();
    let (_plan, session) =
        create_plan_and_session(&store, &ws_id, "sess-restart", "my-project", None);
    link_terminal(&store, &session.id, "term-restart", 1);

    let obs = WorkflowObservation::TerminalExitPendingRestart {
        session_id: "term-restart".to_string(),
        incarnation: 1,
        exit_code: Some(1),
        restart_count: 0,
        restart_in_ms: Some(1000),
        observed_at: 3000,
    };
    let updated = process_observation(&store, &obs).expect("process observation");
    assert_eq!(updated, 1);

    let links = store.get_links_for_session(&session.id).unwrap();
    assert_eq!(links[0].observed_state, ResourceObservedState::Stale);
    assert_eq!(links[0].suggested_end_time, Some(3000));

    assert_manual_session_fields(
        &store,
        &ws_id,
        &session.id,
        SessionStatus::Running,
        1000,
        None,
    );
}

#[test]
fn test_terminal_restarted_observation() {
    let (store, ws_id) = setup_test_db();
    let (_plan, session) =
        create_plan_and_session(&store, &ws_id, "sess-restarted", "my-project", None);
    link_terminal(&store, &session.id, "term-restarted", 1);

    // First exit pending restart
    let obs_exit = WorkflowObservation::TerminalExitPendingRestart {
        session_id: "term-restarted".to_string(),
        incarnation: 1,
        exit_code: Some(1),
        restart_count: 0,
        restart_in_ms: Some(1000),
        observed_at: 3000,
    };
    process_observation(&store, &obs_exit).unwrap();

    // Now restarted with incarnation 2
    let obs_restarted = WorkflowObservation::TerminalRestarted {
        session_id: "term-restarted".to_string(),
        incarnation: 2,
        restart_count: 1,
        previous_exit_code: Some(1),
        observed_at: 4000,
    };
    process_observation(&store, &obs_restarted).unwrap();

    let links = store.get_links_for_session(&session.id).unwrap();
    assert_eq!(links[0].observed_state, ResourceObservedState::Attached);
    assert_eq!(links[0].incarnation, Some(2));
    assert_eq!(links[0].suggested_end_time, None);
    assert_eq!(links[0].last_seen_at, 4000);

    assert_manual_session_fields(
        &store,
        &ws_id,
        &session.id,
        SessionStatus::Running,
        1000,
        None,
    );
}

#[test]
fn test_terminal_final_exit_clean_and_crashed() {
    let (store, ws_id) = setup_test_db();
    let (_plan, session1) =
        create_plan_and_session(&store, &ws_id, "sess-clean", "my-project", None);
    link_terminal(&store, &session1.id, "term-clean", 1);

    let (_plan2, session2) =
        create_plan_and_session(&store, &ws_id, "sess-crashed", "my-project", None);
    link_terminal(&store, &session2.id, "term-crashed", 1);

    // Clean exit (code 0)
    let obs_clean = WorkflowObservation::TerminalFinalExit {
        session_id: "term-clean".to_string(),
        incarnation: 1,
        exit_code: Some(0),
        restart_count: 0,
        observed_at: 5000,
    };
    process_observation(&store, &obs_clean).unwrap();
    let links1 = store.get_links_for_session(&session1.id).unwrap();
    assert_eq!(links1[0].observed_state, ResourceObservedState::Exited);
    assert_eq!(links1[0].suggested_end_time, Some(5000));

    // Crashed exit (code 137)
    let obs_crashed = WorkflowObservation::TerminalFinalExit {
        session_id: "term-crashed".to_string(),
        incarnation: 1,
        exit_code: Some(137),
        restart_count: 3,
        observed_at: 6000,
    };
    process_observation(&store, &obs_crashed).unwrap();
    let links2 = store.get_links_for_session(&session2.id).unwrap();
    assert_eq!(links2[0].observed_state, ResourceObservedState::Crashed);
    assert_eq!(links2[0].suggested_end_time, Some(6000));

    assert_manual_session_fields(
        &store,
        &ws_id,
        &session1.id,
        SessionStatus::Running,
        1000,
        None,
    );
    assert_manual_session_fields(
        &store,
        &ws_id,
        &session2.id,
        SessionStatus::Running,
        1000,
        None,
    );
}

#[test]
fn test_terminal_removed_observation() {
    let (store, ws_id) = setup_test_db();
    let (_plan, session) =
        create_plan_and_session(&store, &ws_id, "sess-removed", "my-project", None);
    link_terminal(&store, &session.id, "term-removed", 1);

    let obs = WorkflowObservation::TerminalRemoved {
        session_id: "term-removed".to_string(),
        incarnation: Some(1),
        observed_at: 7000,
    };
    process_observation(&store, &obs).unwrap();

    let links = store.get_links_for_session(&session.id).unwrap();
    assert_eq!(links[0].observed_state, ResourceObservedState::Detached);
    assert_eq!(links[0].suggested_end_time, Some(7000));

    assert_manual_session_fields(
        &store,
        &ws_id,
        &session.id,
        SessionStatus::Running,
        1000,
        None,
    );
}

#[test]
fn test_out_of_order_stale_incarnation_ignored() {
    let (store, ws_id) = setup_test_db();
    let (_plan, session) =
        create_plan_and_session(&store, &ws_id, "sess-ooo", "my-project", None);
    link_terminal(&store, &session.id, "term-ooo", 5);

    // Stale observation from incarnation 3 arrives late
    let stale_obs = WorkflowObservation::TerminalFinalExit {
        session_id: "term-ooo".to_string(),
        incarnation: 3,
        exit_code: Some(1),
        restart_count: 0,
        observed_at: 8000,
    };
    process_observation(&store, &stale_obs).unwrap();

    // Link must remain Attached with incarnation 5 (not overwritten)
    let links = store.get_links_for_session(&session.id).unwrap();
    assert_eq!(links[0].observed_state, ResourceObservedState::Attached);
    assert_eq!(links[0].incarnation, Some(5));
    assert_eq!(links[0].suggested_end_time, None);
    assert_manual_session_fields(
        &store,
        &ws_id,
        &session.id,
        SessionStatus::Running,
        1000,
        None,
    );
}

#[test]
fn test_observation_idempotency_duplicate_suppression() {
    let (store, ws_id) = setup_test_db();
    let (_plan, session) =
        create_plan_and_session(&store, &ws_id, "sess-idemp", "my-project", None);
    link_terminal(&store, &session.id, "term-idemp", 1);

    let obs = WorkflowObservation::TerminalFinalExit {
        session_id: "term-idemp".to_string(),
        incarnation: 1,
        exit_code: Some(0),
        restart_count: 0,
        observed_at: 9000,
    };

    // Process once
    process_observation(&store, &obs).unwrap();
    // Process again (replay/restart)
    process_observation(&store, &obs).unwrap();

    // Verify events: only 1 event recorded
    let conn = store.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT COUNT(*) FROM workflow_events WHERE session_id = ?1")
        .unwrap();
    let event_count: i64 = stmt.query_row([&session.id], |r| r.get(0)).unwrap();
    assert_eq!(event_count, 1);
    drop(stmt);
    drop(conn);
    assert_manual_session_fields(
        &store,
        &ws_id,
        &session.id,
        SessionStatus::Running,
        1000,
        None,
    );
}

#[test]
fn test_startup_reconciliation_live_and_dead_terminals() {
    let (store, ws_id) = setup_test_db();
    let (_plan1, session1) =
        create_plan_and_session(&store, &ws_id, "sess-live", "my-project", None);
    link_terminal(&store, &session1.id, "term-live", 1);

    let (_plan2, session2) =
        create_plan_and_session(&store, &ws_id, "sess-dead", "my-project", None);
    link_terminal(&store, &session2.id, "term-dead", 1);
    let live_terminals = vec![("term-live".to_string(), 2u64)];
    let (attached, detached) =
        reconcile_startup_terminal_links(&store, &live_terminals, 10_000).unwrap();
    assert_eq!(attached, 1);
    assert_eq!(detached, 1);

    let links1 = store.get_links_for_session(&session1.id).unwrap();
    assert_eq!(links1[0].observed_state, ResourceObservedState::Attached);
    assert_eq!(links1[0].incarnation, Some(2));
    assert_eq!(links1[0].suggested_end_time, None);

    let links2 = store.get_links_for_session(&session2.id).unwrap();
    assert_eq!(links2[0].observed_state, ResourceObservedState::Detached);
    assert_eq!(links2[0].suggested_end_time, Some(10_000));

    assert_manual_session_fields(
        &store,
        &ws_id,
        &session1.id,
        SessionStatus::Running,
        1000,
        None,
    );
    assert_manual_session_fields(
        &store,
        &ws_id,
        &session2.id,
        SessionStatus::Running,
        1000,
        None,
    );
}

#[test]
fn test_bounded_recorder_queue_overflow_never_blocks() {
    let (store, ws_id) = setup_test_db();
    let (_plan, session) =
        create_plan_and_session(&store, &ws_id, "sess-queue", "my-project", None);
    link_terminal(&store, &session.id, "obs-1", 1);

    let (tx, rx) = sync_channel::<WorkflowObservation>(2);
    let (recorder, dropped) = BoundedObservationRecorder::new(tx);
    let make_obs = |id: &str| WorkflowObservation::TerminalCreated {
        session_id: id.to_string(),
        incarnation: 1,
        project: None,
        worktree_path: None,
        observed_at: 1000,
    };

    recorder.record(make_obs("obs-1"));
    recorder.record(make_obs("obs-2"));
    // Third send exceeds capacity (2) — must not block or panic, drops gracefully
    recorder.record(make_obs("obs-3"));
    recorder.record(make_obs("obs-4"));

    assert_eq!(dropped.load(Ordering::Relaxed), 2);
    assert_eq!(recorder.dropped_count(), 2);

    // Receiver should have the first 2
    let o1 = rx.recv().unwrap();
    assert_eq!(o1.session_id(), "obs-1");
    let o2 = rx.recv().unwrap();
    process_observation(&store, &o1).unwrap();
    process_observation(&store, &o2).unwrap();
    assert_eq!(o2.session_id(), "obs-2");
    assert_manual_session_fields(
        &store,
        &ws_id,
        &session.id,
        SessionStatus::Running,
        1000,
        None,
    );
}

#[test]
fn test_exhausted_restart_observations_preserve_manual_session_fields() {
    let (store, ws_id) = setup_test_db();
    let (_plan, session) =
        create_plan_and_session(&store, &ws_id, "sess-exhausted", "my-project", None);
    link_terminal(&store, &session.id, "term-exhausted", 1);

    for observation in [
        WorkflowObservation::TerminalExitPendingRestart {
            session_id: "term-exhausted".to_string(),
            incarnation: 1,
            exit_code: Some(1),
            restart_count: 0,
            restart_in_ms: Some(1000),
            observed_at: 2_000,
        },
        WorkflowObservation::TerminalRestarted {
            session_id: "term-exhausted".to_string(),
            incarnation: 2,
            restart_count: 1,
            previous_exit_code: Some(1),
            observed_at: 3_000,
        },
        WorkflowObservation::TerminalExitPendingRestart {
            session_id: "term-exhausted".to_string(),
            incarnation: 2,
            exit_code: Some(1),
            restart_count: 1,
            restart_in_ms: Some(2000),
            observed_at: 4_000,
        },
        WorkflowObservation::TerminalFinalExit {
            session_id: "term-exhausted".to_string(),
            incarnation: 2,
            exit_code: Some(1),
            restart_count: 2,
            observed_at: 5_000,
        },
    ] {
        process_observation(&store, &observation).expect("process lifecycle observation");
    }

    let links = store.get_links_for_session(&session.id).unwrap();
    assert_eq!(links[0].observed_state, ResourceObservedState::Crashed);
    assert_eq!(links[0].incarnation, Some(2));
    assert_eq!(links[0].suggested_end_time, Some(5_000));
    assert_manual_session_fields(
        &store,
        &ws_id,
        &session.id,
        SessionStatus::Running,
        1000,
        None,
    );
}

#[test]
fn test_manual_terminal_session_stale_observation_preserves_fields() {
    let (store, ws_id) = setup_test_db();
    let (_plan_ended, ended) =
        create_plan_and_session(&store, &ws_id, "sess-manual-ended", "my-project", None);
    store
        .update_session_status(
            &ended.id,
            &ws_id,
            SessionStatus::Ended,
            Some(2_000),
            3_000,
            None,
        )
        .unwrap();
    link_terminal(&store, &ended.id, "term-manual-ended", 1);

    let (_plan_abandoned, abandoned) =
        create_plan_and_session(&store, &ws_id, "sess-manual-abandoned", "my-project", None);
    store
        .update_session_status(
            &abandoned.id,
            &ws_id,
            SessionStatus::Abandoned,
            Some(3_000),
            4_000,
            None,
        )
        .unwrap();
    link_terminal(&store, &abandoned.id, "term-manual-abandoned", 1);

    for terminal_id in ["term-manual-ended", "term-manual-abandoned"] {
        let observation = WorkflowObservation::TerminalExitPendingRestart {
            session_id: terminal_id.to_string(),
            incarnation: 1,
            exit_code: Some(1),
            restart_count: 0,
            restart_in_ms: Some(1000),
            observed_at: 5_000,
        };
        process_observation(&store, &observation).expect("process stale observation");
    }

    assert_manual_session_fields(
        &store,
        &ws_id,
        &ended.id,
        SessionStatus::Ended,
        1000,
        Some(2_000),
    );
    assert_manual_session_fields(
        &store,
        &ws_id,
        &abandoned.id,
        SessionStatus::Abandoned,
        1000,
        Some(3_000),
    );
}

#[test]
fn test_observation_storage_failure_preserves_manual_session_and_link() {
    let (store, ws_id) = setup_test_db();
    let (_plan, session) =
        create_plan_and_session(&store, &ws_id, "sess-observation-fault", "my-project", None);
    link_terminal(&store, &session.id, "term-observation-fault", 1);

    store
        .lock()
        .unwrap()
        .execute_batch("DROP TABLE workflow_events")
        .unwrap();
    let observation = WorkflowObservation::TerminalFinalExit {
        session_id: "term-observation-fault".to_string(),
        incarnation: 1,
        exit_code: Some(0),
        restart_count: 0,
        observed_at: 6_000,
    };
    assert!(process_observation(&store, &observation).is_err());

    let links = store.get_links_for_session(&session.id).unwrap();
    assert_eq!(links[0].observed_state, ResourceObservedState::Attached);
    assert_eq!(links[0].incarnation, Some(1));
    assert_eq!(links[0].suggested_end_time, None);
    assert_manual_session_fields(
        &store,
        &ws_id,
        &session.id,
        SessionStatus::Running,
        1000,
        None,
    );
}

#[test]
fn test_reconciliation_storage_failure_preserves_manual_session_and_link() {
    let (store, ws_id) = setup_test_db();
    let (_plan, session) =
        create_plan_and_session(&store, &ws_id, "sess-reconcile-fault", "my-project", None);
    link_terminal(&store, &session.id, "term-reconcile-fault", 1);
    store
        .lock()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER fail_reconcile BEFORE UPDATE ON workflow_resource_links
             BEGIN SELECT RAISE(ABORT, 'injected reconciliation failure'); END;",
        )
        .unwrap();

    assert!(
        reconcile_startup_terminal_links(
            &store,
            &[("term-reconcile-fault".to_string(), 2)],
            7_000,
        )
        .is_err()
    );
    let links = store.get_links_for_session(&session.id).unwrap();
    assert_eq!(links[0].observed_state, ResourceObservedState::Attached);
    assert_eq!(links[0].incarnation, Some(1));
    assert_eq!(links[0].suggested_end_time, None);
    assert_manual_session_fields(
        &store,
        &ws_id,
        &session.id,
        SessionStatus::Running,
        1000,
        None,
    );
}

#[test]
fn test_direct_plan_session_manual_harness_link() {
    let (store, ws_id) = setup_test_db();
    let (_plan, session) =
        create_plan_and_session(&store, &ws_id, "sess-agent", "my-project", None);

    // Agent link with manual harness label and run ID attached to direct Plan session
    let agent_link = WorkflowResourceLink {
        id: "link-agent-1".to_string(),
        session_id: session.id.clone(),
        resource_type: ResourceLinkType::Agent,
        external_id: "agent-run-xyz-123".to_string(),
        incarnation: None,
        harness_label: Some("claude-code".to_string()),
        run_id: Some("run-456".to_string()),
        observed_state: ResourceObservedState::Attached,
        suggested_end_time: None,
        first_seen_at: 1000,
        last_seen_at: 1000,
        link_source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
    };

    store.link_resource(&agent_link, None).expect("link agent");

    let links = store.get_links_for_session(&session.id).unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].resource_type, ResourceLinkType::Agent);
    assert_eq!(links[0].harness_label.as_deref(), Some("claude-code"));
    assert_eq!(links[0].run_id.as_deref(), Some("run-456"));
    assert_eq!(links[0].observed_state, ResourceObservedState::Attached);

    // Ensure no child items or synthetic breakdown tasks were created
    let conn = store.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT COUNT(*) FROM workflow_items WHERE parent_id = ?1")
        .unwrap();
    let child_count: i64 = stmt.query_row([&_plan.id], |r| r.get(0)).unwrap();
    assert_eq!(child_count, 0);
}

#[tokio::test]
async fn test_pty_lifecycle_real_manager_observation_flow() {
    let (store, ws_id) = setup_test_db();
    let (_plan, session) =
        create_plan_and_session(&store, &ws_id, "sess-pty-e2e", "test-project", None);

    let (recorder, _dropped, _worker) = start_observation_worker(store.clone());
    let mgr = PtySessionManager::new(Arc::new(NoopEventSink));
    mgr.set_workflow_recorder(Arc::new(recorder));

    let meta = mgr
        .create(PtyCreateOpts {
            id: "terminal:wf-e2e".to_string(),
            project: Some("test-project".to_string()),
            command: "sleep 10".to_string(),
            cwd: "/tmp".to_string(),
            env: HashMap::new(),
            cols: 80,
            rows: 24,
            worktree_path: None,
            name: None,
            restart_policy: crate::config::schema::RestartPolicy::Never,
            restart_max_retries: 0,
        })
        .unwrap();

    // Link terminal to session
    link_terminal(&store, &session.id, &meta.id, meta.incarnation);

    // Allow worker to process created event
    tokio::time::sleep(Duration::from_millis(50)).await;
    let links = store.get_links_for_session(&session.id).unwrap();
    assert_eq!(links.len(), 1);
    assert_manual_session_fields(
        &store,
        &ws_id,
        &session.id,
        SessionStatus::Running,
        1000,
        None,
    );
    assert_eq!(links[0].observed_state, ResourceObservedState::Attached);

    // Remove terminal
    mgr.remove(&meta.id).unwrap();

    // Allow worker to process removed event
    tokio::time::sleep(Duration::from_millis(50)).await;
    let links = store.get_links_for_session(&session.id).unwrap();
    assert_eq!(links[0].observed_state, ResourceObservedState::Detached);
    assert!(links[0].suggested_end_time.is_some());

    assert_manual_session_fields(
        &store,
        &ws_id,
        &session.id,
        SessionStatus::Running,
        1000,
        None,
    );
    mgr.dispose().unwrap();
}
