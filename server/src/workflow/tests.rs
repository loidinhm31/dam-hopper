use crate::config::RestartPolicy;
use crate::persistence::SessionStore;
use crate::pty::session::SessionType;
use crate::pty::SessionMeta;
use crate::workflow::model::*;
use crate::workflow::store::WorkflowStore;
use std::collections::HashMap;
use tempfile::NamedTempFile;
use uuid::Uuid;

fn create_test_store() -> (NamedTempFile, WorkflowStore, SessionStore) {
    let tmp = NamedTempFile::new().unwrap();
    let session_store = SessionStore::open(tmp.path()).unwrap();
    let wf_store = WorkflowStore::new(session_store.connection());
    (tmp, wf_store, session_store)
}

// ---------------------------------------------------------------------------
// Step 3.1: Unit Tests for Domain Models, Enums, and Transitions
// ---------------------------------------------------------------------------

#[test]
fn test_item_kind_enums() {
    assert_eq!(ItemKind::Plan.as_str(), "plan");
    assert_eq!(ItemKind::Phase.as_str(), "phase");
    assert_eq!(ItemKind::Task.as_str(), "task");

    assert_eq!("plan".parse::<ItemKind>().unwrap(), ItemKind::Plan);
    assert_eq!("phase".parse::<ItemKind>().unwrap(), ItemKind::Phase);
    assert_eq!("task".parse::<ItemKind>().unwrap(), ItemKind::Task);
    assert!("invalid".parse::<ItemKind>().is_err());

    let json = serde_json::to_string(&ItemKind::Plan).unwrap();
    assert_eq!(json, "\"plan\"");
    let de: ItemKind = serde_json::from_str(&json).unwrap();
    assert_eq!(de, ItemKind::Plan);
}

#[test]
fn test_item_status_transitions() {
    // Valid transitions
    assert!(validate_item_transition(ItemStatus::Backlog, ItemStatus::Next).is_ok());
    assert!(validate_item_transition(ItemStatus::Backlog, ItemStatus::InProgress).is_ok());
    assert!(validate_item_transition(ItemStatus::Backlog, ItemStatus::Canceled).is_ok());
    assert!(validate_item_transition(ItemStatus::Next, ItemStatus::InProgress).is_ok());
    assert!(validate_item_transition(ItemStatus::InProgress, ItemStatus::Blocked).is_ok());
    assert!(validate_item_transition(ItemStatus::InProgress, ItemStatus::Done).is_ok());
    assert!(validate_item_transition(ItemStatus::InProgress, ItemStatus::Canceled).is_ok());
    assert!(validate_item_transition(ItemStatus::Blocked, ItemStatus::InProgress).is_ok());
    assert!(validate_item_transition(ItemStatus::Blocked, ItemStatus::Canceled).is_ok());
    assert!(validate_item_transition(ItemStatus::Done, ItemStatus::InProgress).is_ok()); // Reopen
    assert!(validate_item_transition(ItemStatus::Canceled, ItemStatus::InProgress).is_ok()); // Reopen
    assert!(validate_item_transition(ItemStatus::InProgress, ItemStatus::InProgress).is_ok()); // Idempotent self

    // Invalid transitions
    assert!(validate_item_transition(ItemStatus::Backlog, ItemStatus::Done).is_err());
    assert!(validate_item_transition(ItemStatus::Blocked, ItemStatus::Done).is_err());
    assert!(validate_item_transition(ItemStatus::Done, ItemStatus::Blocked).is_err());
    assert!(validate_item_transition(ItemStatus::Done, ItemStatus::Backlog).is_err());
}

#[test]
fn test_session_status_transitions() {
    assert!(validate_session_transition(SessionStatus::Running, SessionStatus::Ended).is_ok());
    assert!(validate_session_transition(SessionStatus::Running, SessionStatus::Abandoned).is_ok());
    assert!(validate_session_transition(SessionStatus::Running, SessionStatus::Running).is_ok());
    assert!(validate_session_transition(SessionStatus::Ended, SessionStatus::Ended).is_ok());
    assert!(validate_session_transition(SessionStatus::Abandoned, SessionStatus::Abandoned).is_ok());

    // Terminal invariant: ended or abandoned sessions cannot transition to running
    assert!(validate_session_transition(SessionStatus::Ended, SessionStatus::Running).is_err());
    assert!(validate_session_transition(SessionStatus::Abandoned, SessionStatus::Running).is_err());
    assert!(validate_session_transition(SessionStatus::Ended, SessionStatus::Abandoned).is_err());
}

#[test]
fn test_hierarchy_validation() {
    // Plan: no parent
    assert!(validate_item_hierarchy(ItemKind::Plan, None).is_ok());
    assert!(validate_item_hierarchy(ItemKind::Plan, Some(ItemKind::Plan)).is_err());
    assert!(validate_item_hierarchy(ItemKind::Plan, Some(ItemKind::Phase)).is_err());

    // Phase: MUST have Plan parent
    assert!(validate_item_hierarchy(ItemKind::Phase, Some(ItemKind::Plan)).is_ok());
    assert!(validate_item_hierarchy(ItemKind::Phase, None).is_err());
    assert!(validate_item_hierarchy(ItemKind::Phase, Some(ItemKind::Phase)).is_err());
    assert!(validate_item_hierarchy(ItemKind::Phase, Some(ItemKind::Task)).is_err());

    // Task: standalone (None), under Plan, or under Phase
    assert!(validate_item_hierarchy(ItemKind::Task, None).is_ok());
    assert!(validate_item_hierarchy(ItemKind::Task, Some(ItemKind::Plan)).is_ok());
    assert!(validate_item_hierarchy(ItemKind::Task, Some(ItemKind::Phase)).is_ok());
    assert!(validate_item_hierarchy(ItemKind::Task, Some(ItemKind::Task)).is_err()); // Depth rule
}

#[test]
fn test_string_and_timestamp_validations() {
    assert!(validate_title("Valid Title").is_ok());
    assert!(validate_title("   ").is_err());
    assert!(validate_title(&"a".repeat(201)).is_err());
    assert!(validate_title(&"a".repeat(200)).is_ok());

    assert!(validate_note_body("Valid note").is_ok());
    assert!(validate_note_body("   ").is_err());
    assert!(validate_note_body(&"a".repeat(8193)).is_err());
    assert!(validate_note_body(&"a".repeat(8192)).is_ok());

    assert!(validate_external_id("term-123").is_ok());
    assert!(validate_external_id("").is_err());

    assert!(validate_timestamps(1000, Some(2000)).is_ok());
    assert!(validate_timestamps(2000, Some(1000)).is_err());
    assert!(validate_timestamps(1000, None).is_ok());
}

// ---------------------------------------------------------------------------
// Step 3.2: Migration 010 and Existing 009 Data Preservation
// ---------------------------------------------------------------------------

#[test]
fn test_migration_010_and_data_preservation() {
    let tmp = NamedTempFile::new().unwrap();

    // 1. First open: runs initial + migrations 001..010
    {
        let store = SessionStore::open(tmp.path()).unwrap();
        let meta = SessionMeta {
            id: "session-001".to_string(),
            incarnation: 1,
            project: Some("project-a".to_string()),
            command: "bash".to_string(),
            cwd: "/tmp".to_string(),
            worktree_path: None,
            name: Some("Main Terminal".to_string()),
            session_type: SessionType::Shell,
            alive: true,
            exit_code: None,
            started_at: 1000,
            restart_count: 0,
            last_exit_at: None,
            restart_policy: RestartPolicy::Never,
            target_unavailable: false,
        };
        store
            .save_session_for_incarnation(&meta, 1, &HashMap::new(), 80, 24, 5)
            .unwrap();
        store
            .save_buffer_for_incarnation("session-001", 1, b"hello scrollback", 16)
            .unwrap();
    }

    // 2. Reopen: should idempotently apply migration 010 and preserve terminal session + buffer
    {
        let store = SessionStore::open(tmp.path()).unwrap();
        let sessions = store.load_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].meta.id, "session-001");
        assert_eq!(sessions[0].meta.name.as_deref(), Some("Main Terminal"));

        let (buf, total) = store.load_buffer("session-001").unwrap().unwrap();
        assert_eq!(buf, b"hello scrollback");
        assert_eq!(total, 16);

        // Verify workflow tables exist
        let wf_store = WorkflowStore::new(store.connection());
        let ws = wf_store
            .get_or_create_workspace("/path/to/dam-hopper.toml", "My Workspace", 1000)
            .unwrap();
        assert_eq!(ws.name, "My Workspace");
    }

    // 3. Third open: idempotent reopen
    {
        let store = SessionStore::open(tmp.path()).unwrap();
        let wf_store = WorkflowStore::new(store.connection());
        let ws = wf_store
            .get_workspace_by_locator("/path/to/dam-hopper.toml")
            .unwrap()
            .unwrap();
        assert_eq!(ws.name, "My Workspace");
    }
}

// ---------------------------------------------------------------------------
// Step 3.3: Store CRUD, Hierarchy, Invariants & Idempotency
// ---------------------------------------------------------------------------

#[test]
fn test_item_crud_and_hierarchy_invariants() {
    let (_tmp, store, _ss) = create_test_store();
    let ws = store
        .get_or_create_workspace("/config/dam-hopper.toml", "WS", 1000)
        .unwrap();

    // 1. Create a Plan
    let plan = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "backend".to_string(),
        worktree_path: None,
        parent_id: None,
        kind: ItemKind::Plan,
        title: "Auth Redesign Plan".to_string(),
        summary: Some("Refactor authentication".to_string()),
        status: ItemStatus::InProgress,
        sort_order: 1,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: None,
        archived_at: None,
    };
    let created_plan = store.create_item(&plan, None).unwrap();
    assert_eq!(created_plan.title, "Auth Redesign Plan");

    // 2. Reject Phase without Plan parent
    let orphan_phase = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "backend".to_string(),
        worktree_path: None,
        parent_id: None,
        kind: ItemKind::Phase,
        title: "Phase 1: DB".to_string(),
        summary: None,
        status: ItemStatus::Backlog,
        sort_order: 1,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: None,
        archived_at: None,
    };
    assert!(store.create_item(&orphan_phase, None).is_err());

    // 3. Create Phase with Plan parent
    let phase = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "backend".to_string(),
        worktree_path: None,
        parent_id: Some(created_plan.id.clone()),
        kind: ItemKind::Phase,
        title: "Phase 1: DB Models".to_string(),
        summary: None,
        status: ItemStatus::Backlog,
        sort_order: 1,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: None,
        archived_at: None,
    };
    let created_phase = store.create_item(&phase, None).unwrap();

    // 4. Create Task under Phase
    let task = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "backend".to_string(),
        worktree_path: None,
        parent_id: Some(created_phase.id.clone()),
        kind: ItemKind::Task,
        title: "Add user table migration".to_string(),
        summary: None,
        status: ItemStatus::Backlog,
        sort_order: 1,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: None,
        archived_at: None,
    };
    let created_task = store.create_item(&task, None).unwrap();

    // 5. Reject Task under Task (exceeds depth)
    let nested_task = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "backend".to_string(),
        worktree_path: None,
        parent_id: Some(created_task.id.clone()),
        kind: ItemKind::Task,
        title: "Sub-task".to_string(),
        summary: None,
        status: ItemStatus::Backlog,
        sort_order: 1,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: None,
        archived_at: None,
    };
    assert!(store.create_item(&nested_task, None).is_err());

    // 6. Create standalone Task (no parent)
    let standalone = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "backend".to_string(),
        worktree_path: None,
        parent_id: None,
        kind: ItemKind::Task,
        title: "Quick hotfix".to_string(),
        summary: None,
        status: ItemStatus::Backlog,
        sort_order: 1,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: None,
        archived_at: None,
    };
    let created_standalone = store.create_item(&standalone, None).unwrap();
    assert!(created_standalone.parent_id.is_none());

    // 7. Update item status to Done and verify completed_at
    let updated = store
        .update_item(
            &created_task.id,
            &ws.id,
            None,
            None,
            Some(ItemStatus::InProgress),
            None,
            None,
            2000,
            None,
        )
        .unwrap();
    assert_eq!(updated.status, ItemStatus::InProgress);
    assert_eq!(updated.completed_at, None);

    let done = store
        .update_item(
            &created_task.id,
            &ws.id,
            None,
            None,
            Some(ItemStatus::Done),
            None,
            None,
            3000,
            None,
        )
        .unwrap();
    assert_eq!(done.status, ItemStatus::Done);
    assert_eq!(done.completed_at, Some(3000));
}

#[test]
fn test_cross_project_parent_rejection() {
    let (_tmp, store, _ss) = create_test_store();
    let ws = store
        .get_or_create_workspace("/config/dam-hopper.toml", "WS", 1000)
        .unwrap();

    let plan_p1 = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "project-1".to_string(),
        worktree_path: None,
        parent_id: None,
        kind: ItemKind::Plan,
        title: "Plan P1".to_string(),
        summary: None,
        status: ItemStatus::InProgress,
        sort_order: 1,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: None,
        archived_at: None,
    };
    store.create_item(&plan_p1, None).unwrap();

    // Phase belonging to project-2 referencing Plan from project-1 MUST fail
    let phase_p2 = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "project-2".to_string(),
        worktree_path: None,
        parent_id: Some(plan_p1.id.clone()),
        kind: ItemKind::Phase,
        title: "Phase P2".to_string(),
        summary: None,
        status: ItemStatus::Backlog,
        sort_order: 1,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: None,
        archived_at: None,
    };
    assert!(store.create_item(&phase_p2, None).is_err());
}

#[test]
fn test_duplicate_request_id_idempotency() {
    let (_tmp, store, _ss) = create_test_store();
    let ws = store
        .get_or_create_workspace("/config/dam-hopper.toml", "WS", 1000)
        .unwrap();

    let item_id = Uuid::new_v4().to_string();
    let request_id = Uuid::new_v4().to_string();

    let item = WorkflowItem {
        id: item_id.clone(),
        workspace_id: ws.id.clone(),
        project_name: "core".to_string(),
        worktree_path: None,
        parent_id: None,
        kind: ItemKind::Plan,
        title: "Plan Idempotency".to_string(),
        summary: None,
        status: ItemStatus::InProgress,
        sort_order: 1,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: None,
        archived_at: None,
    };

    let event = WorkflowEvent {
        id: request_id.clone(),
        workspace_id: ws.id.clone(),
        event_type: WorkflowEventType::ItemCreated,
        source: WorkflowSource::Manual,
        project_name: Some("core".to_string()),
        worktree_path: None,
        item_id: Some(item_id.clone()),
        session_id: None,
        occurred_at: 1000,
        recorded_at: 1000,
        payload_json: None,
        expires_at: None,
    };

    // First call creates item & records event
    let created1 = store.create_item(&item, Some(&event)).unwrap();
    assert_eq!(created1.id, item_id);

    // Second call with same request_id/event is idempotent and returns existing item without error
    let created2 = store.create_item(&item, Some(&event)).unwrap();
    assert_eq!(created2.id, item_id);

    // Event count must be exactly 1
    let events = store.list_events_keyset(&ws.id, None, None, 10).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].id, request_id);
}

#[test]
fn test_overlapping_manual_sessions() {
    let (_tmp, store, _ss) = create_test_store();
    let ws = store
        .get_or_create_workspace("/config/dam-hopper.toml", "WS", 1000)
        .unwrap();

    let sess1 = WorkflowSession {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "frontend".to_string(),
        worktree_path: None,
        item_id: None,
        status: SessionStatus::Running,
        started_at: 1000,
        ended_at: None,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
    };

    let sess2 = WorkflowSession {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "backend".to_string(),
        worktree_path: None,
        item_id: None,
        status: SessionStatus::Running,
        started_at: 1050,
        ended_at: None,
        source: WorkflowSource::Manual,
        created_at: 1050,
        updated_at: 1050,
    };

    store.start_session(&sess1, None, None).unwrap();
    store.start_session(&sess2, None, None).unwrap();

    let active = store.list_active_sessions(&ws.id, None, 10).unwrap();
    assert_eq!(active.len(), 2);
}

#[test]
fn test_session_and_observation_isolation() {
    let (_tmp, store, _ss) = create_test_store();
    let ws = store
        .get_or_create_workspace("/config/dam-hopper.toml", "WS", 1000)
        .unwrap();

    let session = WorkflowSession {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "frontend".to_string(),
        worktree_path: None,
        item_id: None,
        status: SessionStatus::Running,
        started_at: 1000,
        ended_at: None,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
    };

    let link = WorkflowResourceLink {
        id: Uuid::new_v4().to_string(),
        session_id: session.id.clone(),
        resource_type: ResourceLinkType::Terminal,
        external_id: "term-1".to_string(),
        incarnation: Some(1),
        harness_label: None,
        run_id: None,
        observed_state: ResourceObservedState::Attached,
        suggested_end_time: None,
        first_seen_at: 1000,
        last_seen_at: 1000,
        link_source: WorkflowSource::Terminal,
        created_at: 1000,
        updated_at: 1000,
    };

    store.start_session(&session, Some(&link), None).unwrap();

    // Observation event: terminal exits
    // INVARIANT: Observations MUST NOT change session status, started_at, or ended_at.
    let updated_link = store
        .update_resource_observation(
            &session.id,
            ResourceLinkType::Terminal,
            "term-1",
            ResourceObservedState::Exited,
            Some(5000), // suggested end time
            5000,       // observed at
            None,
        )
        .unwrap()
        .unwrap();

    assert_eq!(updated_link.observed_state, ResourceObservedState::Exited);
    assert_eq!(updated_link.suggested_end_time, Some(5000));

    // Session itself MUST STILL BE RUNNING with NO ended_at
    let sess_check = store.get_session(&session.id, &ws.id).unwrap().unwrap();
    assert_eq!(sess_check.status, SessionStatus::Running);
    assert_eq!(sess_check.started_at, 1000);
    assert_eq!(sess_check.ended_at, None);

    // Only explicit user mutation ends the session
    let manual_ended = store
        .update_session_status(
            &session.id,
            &ws.id,
            SessionStatus::Ended,
            Some(6000),
            6000,
            None,
        )
        .unwrap();
    assert_eq!(manual_ended.status, SessionStatus::Ended);
    assert_eq!(manual_ended.ended_at, Some(6000));
}

#[test]
fn test_notes_soft_deletion_and_purge() {
    let (_tmp, store, _ss) = create_test_store();
    let ws = store
        .get_or_create_workspace("/config/dam-hopper.toml", "WS", 1000)
        .unwrap();

    let plan = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "core".to_string(),
        worktree_path: None,
        parent_id: None,
        kind: ItemKind::Plan,
        title: "Main Plan".to_string(),
        summary: None,
        status: ItemStatus::InProgress,
        sort_order: 1,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: None,
        archived_at: None,
    };
    store.create_item(&plan, None).unwrap();

    let note = WorkflowNote {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        item_id: Some(plan.id.clone()),
        session_id: None,
        body: "Architecture note: use rusqlite".to_string(),
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        deleted_at: None,
    };
    store.create_note(&note, None).unwrap();

    let active_notes = store.list_notes_for_item(&plan.id, &ws.id, false).unwrap();
    assert_eq!(active_notes.len(), 1);

    // Soft delete at timestamp 2000
    store.soft_delete_note(&note.id, &ws.id, 2000, None).unwrap();

    let active_after = store.list_notes_for_item(&plan.id, &ws.id, false).unwrap();
    assert_eq!(active_after.len(), 0);

    let all_notes = store.list_notes_for_item(&plan.id, &ws.id, true).unwrap();
    assert_eq!(all_notes.len(), 1);
    assert_eq!(all_notes[0].deleted_at, Some(2000));

    // Purge deleted notes older than 2500
    let purged = store.purge_soft_deleted_notes(&ws.id, 2500, 100).unwrap();
    assert_eq!(purged, 1);

    let all_notes_after = store.list_notes_for_item(&plan.id, &ws.id, true).unwrap();
    assert_eq!(all_notes_after.len(), 0);
}

// ---------------------------------------------------------------------------
// Step 3.4: Overview Aggregation, Factual Progress, Pagination, and Purge
// ---------------------------------------------------------------------------

#[test]
fn test_overview_factual_progress() {
    let (_tmp, store, _ss) = create_test_store();
    let ws = store
        .get_or_create_workspace("/config/dam-hopper.toml", "WS", 1000)
        .unwrap();

    // Plan A: NO tasks -> progress MUST BE None (null)
    let plan_a = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "p1".to_string(),
        worktree_path: None,
        parent_id: None,
        kind: ItemKind::Plan,
        title: "Plan without tasks".to_string(),
        summary: None,
        status: ItemStatus::InProgress,
        sort_order: 1,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: None,
        archived_at: None,
    };
    store.create_item(&plan_a, None).unwrap();

    // Plan B: with Phase, 2 tasks (1 done, 1 in progress) + 1 direct task (done) -> 3 tasks total, 2 done
    let plan_b = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "p1".to_string(),
        worktree_path: None,
        parent_id: None,
        kind: ItemKind::Plan,
        title: "Plan with tasks".to_string(),
        summary: None,
        status: ItemStatus::InProgress,
        sort_order: 2,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: None,
        archived_at: None,
    };
    store.create_item(&plan_b, None).unwrap();

    let phase_b = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "p1".to_string(),
        worktree_path: None,
        parent_id: Some(plan_b.id.clone()),
        kind: ItemKind::Phase,
        title: "Phase B1".to_string(),
        summary: None,
        status: ItemStatus::InProgress,
        sort_order: 1,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: None,
        archived_at: None,
    };
    store.create_item(&phase_b, None).unwrap();

    let task_b1 = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "p1".to_string(),
        worktree_path: None,
        parent_id: Some(phase_b.id.clone()),
        kind: ItemKind::Task,
        title: "Task Done under Phase".to_string(),
        summary: None,
        status: ItemStatus::Done,
        sort_order: 1,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: Some(1000),
        archived_at: None,
    };
    store.create_item(&task_b1, None).unwrap();

    let task_b2 = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "p1".to_string(),
        worktree_path: None,
        parent_id: Some(phase_b.id.clone()),
        kind: ItemKind::Task,
        title: "Task Pending under Phase".to_string(),
        summary: None,
        status: ItemStatus::InProgress,
        sort_order: 2,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: None,
        archived_at: None,
    };
    store.create_item(&task_b2, None).unwrap();

    // Direct Task under Plan B
    let task_b3 = WorkflowItem {
        id: Uuid::new_v4().to_string(),
        workspace_id: ws.id.clone(),
        project_name: "p1".to_string(),
        worktree_path: None,
        parent_id: Some(plan_b.id.clone()),
        kind: ItemKind::Task,
        title: "Direct Plan Task Done".to_string(),
        summary: None,
        status: ItemStatus::Done,
        sort_order: 3,
        source: WorkflowSource::Manual,
        created_at: 1000,
        updated_at: 1000,
        completed_at: Some(1000),
        archived_at: None,
    };
    store.create_item(&task_b3, None).unwrap();

    let overview = store.get_overview(&ws.id, 2000, 10, 50, 10).unwrap();
    assert_eq!(overview.plans.len(), 2);

    let node_a = overview.plans.iter().find(|n| n.item.id == plan_a.id).unwrap();
    assert!(node_a.progress.is_none(), "Plan without tasks must have None progress");

    let node_b = overview.plans.iter().find(|n| n.item.id == plan_b.id).unwrap();
    assert_eq!(
        node_b.progress,
        Some(ItemProgress {
            total_tracked_tasks: 3,
            completed_tracked_tasks: 2,
        })
    );

    let phase_node = node_b.children.iter().find(|c| c.item.kind == ItemKind::Phase).unwrap();
    assert_eq!(
        phase_node.progress,
        Some(ItemProgress {
            total_tracked_tasks: 2,
            completed_tracked_tasks: 1,
        })
    );
}

#[test]
fn test_keyset_pagination_and_purge() {
    let (_tmp, store, _ss) = create_test_store();
    let ws = store
        .get_or_create_workspace("/config/dam-hopper.toml", "WS", 1000)
        .unwrap();

    // Record 5 events with timestamps 100..500
    for i in 1..=5 {
        let ev = WorkflowEvent {
            id: format!("event-{:03}", i),
            workspace_id: ws.id.clone(),
            event_type: WorkflowEventType::ItemCreated,
            source: WorkflowSource::Manual,
            project_name: Some("p".to_string()),
            worktree_path: None,
            item_id: None,
            session_id: None,
            occurred_at: i * 100,
            recorded_at: i * 100,
            payload_json: None,
            expires_at: Some(i * 100 + 1000), // expires at 1100..1500
        };
        store.record_event(&ev).unwrap();
    }

    // Page 1 (limit 2): should return event-005, event-004
    let page1 = store.list_events_keyset(&ws.id, None, None, 2).unwrap();
    assert_eq!(page1.len(), 2);
    assert_eq!(page1[0].id, "event-005");
    assert_eq!(page1[1].id, "event-004");

    // Page 2 (cursor after event-004): should return event-003, event-002
    let page2 = store
        .list_events_keyset(&ws.id, Some(page1[1].recorded_at), Some(&page1[1].id), 2)
        .unwrap();
    assert_eq!(page2.len(), 2);
    assert_eq!(page2[0].id, "event-003");
    assert_eq!(page2[1].id, "event-002");

    // Page 3: should return event-001
    let page3 = store
        .list_events_keyset(&ws.id, Some(page2[1].recorded_at), Some(&page2[1].id), 2)
        .unwrap();
    assert_eq!(page3.len(), 1);
    assert_eq!(page3[0].id, "event-001");

    // Purge events expired before timestamp 1350 (should delete event-001, event-002, event-003)
    let purged = store.purge_expired_events(&ws.id, 1350, 100).unwrap();
    assert_eq!(purged, 3);

    let remaining = store.list_events_keyset(&ws.id, None, None, 10).unwrap();
    assert_eq!(remaining.len(), 2);
    assert_eq!(remaining[0].id, "event-005");
    assert_eq!(remaining[1].id, "event-004");
}

#[test]
fn test_overview_caps_items_projects_and_sessions() {
    let (_tmp, store, _ss) = create_test_store();
    let ws = store
        .get_or_create_workspace("/config/capped.toml", "Capped", 1000)
        .unwrap();

    for (project_name, sort_order) in [("project-a", 1), ("project-b", 2)] {
        let plan = WorkflowItem {
            id: Uuid::new_v4().to_string(),
            workspace_id: ws.id.clone(),
            project_name: project_name.into(),
            worktree_path: None,
            parent_id: None,
            kind: ItemKind::Plan,
            title: format!("{project_name} plan"),
            summary: None,
            status: ItemStatus::Backlog,
            sort_order,
            source: WorkflowSource::Manual,
            created_at: 1000,
            updated_at: 1000,
            completed_at: None,
            archived_at: None,
        };
        store.create_item(&plan, None).unwrap();
    }

    for started_at in [1000, 2000] {
        let session = WorkflowSession {
            id: Uuid::new_v4().to_string(),
            workspace_id: ws.id.clone(),
            project_name: "backend".into(),
            worktree_path: None,
            item_id: None,
            status: SessionStatus::Running,
            started_at,
            ended_at: None,
            source: WorkflowSource::Manual,
            created_at: started_at,
            updated_at: started_at,
        };
        store.start_session(&session, None, None).unwrap();
    }

    let overview = store.get_overview(&ws.id, 3000, 1, 1, 1).unwrap();
    assert_eq!(overview.plans.len(), 1);
    assert_eq!(overview.projects.len(), 1);
    assert_eq!(overview.running_sessions.len(), 1);
    assert!(overview.truncated);
}
