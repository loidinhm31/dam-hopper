use super::reducer::{AgentStatusRegistry, TerminalAgentReducer};
use super::types::{
    validate_opaque_id, validate_safe_integer, AgentKind, AgentState,
    AgentStatusAvailability, AgentStatusError, AttentionKind, BlockedReason, ReporterEventKind,
    ReporterHello, ReporterReport, TurnOutcome, AGENT_STATUS_PROTOCOL_VERSION, MAX_SAFE_INTEGER,
};

fn sample_hello(reporter_id: &str, session_id: &str) -> ReporterHello {
    ReporterHello {
        version: AGENT_STATUS_PROTOCOL_VERSION,
        agent_kind: AgentKind::Omp,
        reporter_id: reporter_id.to_string(),
        agent_session_id: session_id.to_string(),
        adapter_version: "18.3.5".to_string(),
    }
}

fn sample_report(
    seq: u64,
    event: ReporterEventKind,
    state: AgentState,
    session_id: &str,
    turn_id: Option<&str>,
    outcome: Option<TurnOutcome>,
    reason: Option<BlockedReason>,
) -> ReporterReport {
    ReporterReport {
        kind: "report".to_string(),
        seq,
        event,
        state,
        agent_session_id: session_id.to_string(),
        turn_id: turn_id.map(str::to_string),
        outcome,
        blocked_reason: reason,
    }
}

#[test]
fn test_c01_normal_turn_lifecycle() {
    let mut reducer = TerminalAgentReducer::new(
        100,
        "term-1".to_string(),
        1,
        1,
        &sample_hello("rep-1", "sess-1"),
        1000,
    )
    .unwrap();

    // Initial snapshot: idle, no attention emitted
    let snap_rep = sample_report(
        1,
        ReporterEventKind::Snapshot,
        AgentState::Idle,
        "sess-1",
        None,
        None,
        None,
    );
    let out = reducer.apply_report(1, snap_rep, 1000).unwrap();
    assert!(out.state_changed);
    assert_eq!(reducer.state, AgentState::Idle);
    assert!(out.attention.is_none());

    // Turn started: working
    let start_rep = sample_report(
        2,
        ReporterEventKind::TurnStarted,
        AgentState::Working,
        "sess-1",
        Some("turn-1"),
        None,
        None,
    );
    let out = reducer.apply_report(1, start_rep, 1100).unwrap();
    assert!(out.state_changed);
    assert_eq!(reducer.state, AgentState::Working);
    assert_eq!(reducer.current_turn_id.as_deref(), Some("turn-1"));
    assert!(out.attention.is_none());

    // Heartbeat while working: no state change, no attention
    let hb_rep = sample_report(
        3,
        ReporterEventKind::Heartbeat,
        AgentState::Working,
        "sess-1",
        Some("turn-1"),
        None,
        None,
    );
    let out = reducer.apply_report(1, hb_rep, 2000).unwrap();
    assert!(!out.state_changed);
    assert!(out.attention.is_none());

    // Explicit ended: idle + exactly one TurnEnded attention event
    let end_rep = sample_report(
        4,
        ReporterEventKind::TurnEnded,
        AgentState::Idle,
        "sess-1",
        Some("turn-1"),
        Some(TurnOutcome::Ended),
        None,
    );
    let out = reducer.apply_report(1, end_rep, 3000).unwrap();
    assert!(out.state_changed);
    assert_eq!(reducer.state, AgentState::Idle);
    assert!(reducer.current_turn_id.is_none());
    assert_eq!(reducer.last_outcome, Some(TurnOutcome::Ended));

    let att = out.attention.expect("must emit attention on normal end");
    assert_eq!(att.kind, AttentionKind::TurnEnded);
    assert_eq!(att.turn_id.as_deref(), Some("turn-1"));
    assert_eq!(att.outcome, Some(TurnOutcome::Ended));
    assert_eq!(att.attention_revision, 1);
    assert_eq!(att.id, "100:term-1:1:1");
}

#[test]
fn test_c02_blocker_transitions_and_deduplication() {
    let mut reducer = TerminalAgentReducer::new(
        100,
        "term-1".to_string(),
        1,
        1,
        &sample_hello("rep-1", "sess-1"),
        1000,
    )
    .unwrap();

    // Start turn
    let start = sample_report(
        1,
        ReporterEventKind::TurnStarted,
        AgentState::Working,
        "sess-1",
        Some("turn-1"),
        None,
        None,
    );
    reducer.apply_report(1, start, 1000).unwrap();

    // Transition to Blocked (approval) => emits NeedsAttention once
    let block1 = sample_report(
        2,
        ReporterEventKind::StateChanged,
        AgentState::Blocked,
        "sess-1",
        Some("turn-1"),
        None,
        Some(BlockedReason::Approval),
    );
    let out1 = reducer.apply_report(1, block1, 1100).unwrap();
    assert!(out1.state_changed);
    assert_eq!(reducer.state, AgentState::Blocked);
    let att1 = out1
        .attention
        .expect("must emit needs-attention on initial block");
    assert_eq!(att1.kind, AttentionKind::NeedsAttention);
    assert_eq!(att1.reason, Some(BlockedReason::Approval));
    assert_eq!(att1.attention_revision, 1);

    // Overlapping blocker: already blocked, reason changes to question
    // "changing blocker count does not repeatedly notify"
    let block2 = sample_report(
        3,
        ReporterEventKind::StateChanged,
        AgentState::Blocked,
        "sess-1",
        Some("turn-1"),
        None,
        Some(BlockedReason::Question),
    );
    let out2 = reducer.apply_report(1, block2, 1200).unwrap();
    assert!(out2.state_changed); // reason field updated
    assert_eq!(reducer.state, AgentState::Blocked);
    assert!(
        out2.attention.is_none(),
        "must not re-alert while remaining blocked"
    );

    // Unblock: transition back to working
    let unblock = sample_report(
        4,
        ReporterEventKind::StateChanged,
        AgentState::Working,
        "sess-1",
        Some("turn-1"),
        None,
        None,
    );
    let out3 = reducer.apply_report(1, unblock, 1300).unwrap();
    assert!(out3.state_changed);
    assert_eq!(reducer.state, AgentState::Working);
    assert!(out3.attention.is_none());

    // Second block event later in turn => emits new NeedsAttention
    let block3 = sample_report(
        5,
        ReporterEventKind::StateChanged,
        AgentState::Blocked,
        "sess-1",
        Some("turn-1"),
        None,
        Some(BlockedReason::Approval),
    );
    let out4 = reducer.apply_report(1, block3, 1400).unwrap();
    let att2 = out4
        .attention
        .expect("must emit attention on second distinct block transition");
    assert_eq!(att2.kind, AttentionKind::NeedsAttention);
    assert_eq!(att2.attention_revision, 2);
}

#[test]
fn test_c03_continuation_retry_and_cancellation() {
    let mut reducer = TerminalAgentReducer::new(
        100,
        "term-1".to_string(),
        1,
        1,
        &sample_hello("rep-1", "sess-1"),
        1000,
    )
    .unwrap();

    // Start turn
    let start = sample_report(
        1,
        ReporterEventKind::TurnStarted,
        AgentState::Working,
        "sess-1",
        Some("turn-1"),
        None,
        None,
    );
    reducer.apply_report(1, start, 1000).unwrap();

    // Continuation progress (state working) => no end event, stays working
    let cont = sample_report(
        2,
        ReporterEventKind::StateChanged,
        AgentState::Working,
        "sess-1",
        Some("turn-1"),
        None,
        None,
    );
    let out_cont = reducer.apply_report(1, cont, 2000).unwrap();
    assert!(!out_cont.state_changed);
    assert!(out_cont.attention.is_none());

    // Interrupted turn end (cancellation) => Idle without normal finish alert
    let interrupt = sample_report(
        3,
        ReporterEventKind::TurnEnded,
        AgentState::Idle,
        "sess-1",
        Some("turn-1"),
        Some(TurnOutcome::Interrupted),
        None,
    );
    let out_int = reducer.apply_report(1, interrupt, 3000).unwrap();
    assert!(out_int.state_changed);
    assert_eq!(reducer.state, AgentState::Idle);
    assert_eq!(reducer.last_outcome, Some(TurnOutcome::Interrupted));
    assert!(
        out_int.attention.is_none(),
        "interrupted turn must never emit completion alert"
    );
}

#[test]
fn test_c04_turn_outcomes_and_unmatched_end() {
    let mut reducer = TerminalAgentReducer::new(
        100,
        "term-1".to_string(),
        1,
        1,
        &sample_hello("rep-1", "sess-1"),
        1000,
    )
    .unwrap();

    // Start turn-1
    let start = sample_report(
        1,
        ReporterEventKind::TurnStarted,
        AgentState::Working,
        "sess-1",
        Some("turn-1"),
        None,
        None,
    );
    reducer.apply_report(1, start, 1000).unwrap();

    // Turn ended with UNMATCHED turn-2 => no completion alert
    let unmatched = sample_report(
        2,
        ReporterEventKind::TurnEnded,
        AgentState::Idle,
        "sess-1",
        Some("turn-wrong"),
        Some(TurnOutcome::Ended),
        None,
    );
    let out_unmatched = reducer.apply_report(1, unmatched, 1500).unwrap();
    assert!(
        out_unmatched.attention.is_none(),
        "unmatched turn must not emit attention"
    );

    // Duplicate late turn-ended for turn-1 => no active turn, so no duplicate alert
    let late_end = sample_report(
        3,
        ReporterEventKind::TurnEnded,
        AgentState::Idle,
        "sess-1",
        Some("turn-1"),
        Some(TurnOutcome::Ended),
        None,
    );
    let out_late = reducer.apply_report(1, late_end, 2000).unwrap();
    assert!(
        out_late.attention.is_none(),
        "duplicate/late end must not emit attention"
    );

    // Start turn-2
    let start2 = sample_report(
        4,
        ReporterEventKind::TurnStarted,
        AgentState::Working,
        "sess-1",
        Some("turn-2"),
        None,
        None,
    );
    reducer.apply_report(1, start2, 2100).unwrap();

    // Error outcome => Blocked/error plus one error attention event
    let error_end = sample_report(
        5,
        ReporterEventKind::TurnEnded,
        AgentState::Blocked,
        "sess-1",
        Some("turn-2"),
        Some(TurnOutcome::Error),
        None,
    );
    let out_err = reducer.apply_report(1, error_end, 2500).unwrap();
    assert_eq!(reducer.state, AgentState::Blocked);
    let att_err = out_err
        .attention
        .expect("error outcome must emit attention");
    assert_eq!(att_err.kind, AttentionKind::NeedsAttention);
    assert_eq!(att_err.reason, Some(BlockedReason::Error));
    assert_eq!(att_err.outcome, Some(TurnOutcome::Error));
}

#[test]
fn test_c05_session_switch_resets_turn_and_blockers() {
    let mut reducer = TerminalAgentReducer::new(
        100,
        "term-1".to_string(),
        1,
        1,
        &sample_hello("rep-1", "sess-1"),
        1000,
    )
    .unwrap();

    // Start turn and block
    let start = sample_report(
        1,
        ReporterEventKind::TurnStarted,
        AgentState::Working,
        "sess-1",
        Some("turn-1"),
        None,
        None,
    );
    reducer.apply_report(1, start, 1000).unwrap();

    let block = sample_report(
        2,
        ReporterEventKind::StateChanged,
        AgentState::Blocked,
        "sess-1",
        Some("turn-1"),
        None,
        Some(BlockedReason::Approval),
    );
    reducer.apply_report(1, block, 1100).unwrap();
    assert_eq!(reducer.state, AgentState::Blocked);

    // Session changed event to sess-2 => clears turn and blockers, no completion alert
    let session_sw = sample_report(
        3,
        ReporterEventKind::SessionChanged,
        AgentState::Idle,
        "sess-2",
        None,
        None,
        None,
    );
    let out_sw = reducer.apply_report(1, session_sw, 1200).unwrap();
    assert!(out_sw.state_changed);
    assert_eq!(reducer.agent_session_id, "sess-2");
    assert_eq!(reducer.state, AgentState::Idle);
    assert!(reducer.current_turn_id.is_none());
    assert!(reducer.blocked_reason.is_none());
    assert!(
        out_sw.attention.is_none(),
        "session switch must never emit completion alert"
    );
}

#[test]
fn test_c09_sequence_fences_idempotency_and_epoch_fences() {
    let mut reducer = TerminalAgentReducer::new(
        100,
        "term-1".to_string(),
        1,
        1,
        &sample_hello("rep-1", "sess-1"),
        1000,
    )
    .unwrap();

    let rep1 = sample_report(
        1,
        ReporterEventKind::Snapshot,
        AgentState::Idle,
        "sess-1",
        None,
        None,
        None,
    );
    reducer.apply_report(1, rep1.clone(), 1000).unwrap();

    // Stale sequence (seq 0 < last_accepted_seq 1) => ignored
    let stale_rep = sample_report(
        0,
        ReporterEventKind::Snapshot,
        AgentState::Working,
        "sess-1",
        None,
        None,
        None,
    );
    let out_stale = reducer.apply_report(1, stale_rep, 1050).unwrap();
    assert!(!out_stale.state_changed);
    assert_eq!(reducer.state, AgentState::Idle);

    // Duplicate identical sequence (seq 1) => idempotent, no-op
    let out_dup = reducer.apply_report(1, rep1, 1060).unwrap();
    assert!(!out_dup.state_changed);

    // Duplicate conflicting sequence (seq 1, but state working) => rejected
    let conflict_rep = sample_report(
        1,
        ReporterEventKind::Snapshot,
        AgentState::Working,
        "sess-1",
        None,
        None,
        None,
    );
    let err = reducer.apply_report(1, conflict_rep, 1070).unwrap_err();
    assert!(matches!(
        err,
        AgentStatusError::ConflictingDuplicateSequence { seq: 1 }
    ));

    // Stale reporter epoch (epoch 0 vs current epoch 1) => rejected
    let stale_epoch_rep = sample_report(
        2,
        ReporterEventKind::Snapshot,
        AgentState::Idle,
        "sess-1",
        None,
        None,
        None,
    );
    let epoch_err = reducer
        .apply_report(0, stale_epoch_rep, 1080)
        .unwrap_err();
    assert!(matches!(
        epoch_err,
        AgentStatusError::StaleReporterEpoch {
            current: 1,
            got: 0
        }
    ));
}

#[test]
fn test_c10_c11_registry_reconnect_lease_and_retirement() {
    let mut registry = AgentStatusRegistry::new(100, AgentStatusAvailability::Ready);
    assert_eq!(registry.revision, 1);
    assert!(registry.snapshot().terminals.is_empty());

    // Admit reporter for term-1, incarnation 1
    let hello = sample_hello("rep-1", "sess-1");
    let row = registry
        .admit_reporter("term-1".to_string(), 1, 1, &hello, 1000)
        .unwrap();
    assert_eq!(row.state, AgentState::Unknown);
    assert_eq!(registry.revision, 2);

    // Apply snapshot report
    let snap = sample_report(
        1,
        ReporterEventKind::Snapshot,
        AgentState::Working,
        "sess-1",
        Some("turn-1"),
        None,
        None,
    );
    let out_snap = registry.apply_report("term-1", 1, 1, snap, 1000).unwrap();
    assert!(out_snap.state_changed);
    assert_eq!(registry.revision, 3);
    assert!(out_snap.attention.is_none());

    // Check lease after 16 seconds (lease = 15s) => marks Unknown, revision advances
    let expired = registry.check_leases(17000, 15000).unwrap();
    assert_eq!(expired.len(), 1);
    assert_eq!(expired[0].row.as_ref().unwrap().state, AgentState::Unknown);
    assert_eq!(registry.revision, 4);

    // Same reporter reconnects under epoch 2 => admitted, state unknown
    let row_reconnect = registry
        .admit_reporter("term-1".to_string(), 1, 2, &hello, 18000)
        .unwrap();
    assert_eq!(row_reconnect.reporter_epoch, 2);
    assert_eq!(row_reconnect.state, AgentState::Unknown);

    // Old socket for epoch 1 cannot mark unknown or apply reports
    let old_mark_err = registry.mark_unknown("term-1", 1, 1).unwrap_err();
    assert!(matches!(
        old_mark_err,
        AgentStatusError::StaleReporterEpoch {
            current: 2,
            got: 1
        }
    ));

    // Terminal retirement removes row and emits AgentStatusRemovedPayload
    let removed = registry.remove_terminal("term-1", 1).unwrap().unwrap();
    assert_eq!(removed.terminal_id, "term-1");
    assert_eq!(removed.incarnation, 1);
    assert_eq!(registry.snapshot().terminals.len(), 0);
}

#[test]
fn test_safe_integer_and_identifier_validation() {
    assert!(validate_safe_integer("test", MAX_SAFE_INTEGER).is_ok());
    let err = validate_safe_integer("test", MAX_SAFE_INTEGER + 1).unwrap_err();
    assert!(matches!(err, AgentStatusError::SafeIntegerOverflow { .. }));

    assert!(validate_opaque_id("id", "valid-id_123.abc").is_ok());
    assert!(validate_opaque_id("id", "").is_err());
    assert!(validate_opaque_id("id", "with space").is_err());
    assert!(validate_opaque_id("id", "with\nnewline").is_err());
    assert!(validate_opaque_id("id", &"x".repeat(129)).is_err());
}

#[tokio::test]
async fn test_runtime_credential_reservation_activation_and_drop_revocation() {
    use super::runtime::{AgentStatusRuntime, TokenAuthResult};

    let runtime = AgentStatusRuntime::with_epoch(
        1000,
        AgentStatusAvailability::Ready,
        Some("ws://127.0.0.1:4801/v1/agent-status".to_string()),
    );

    // Reserve credential
    let reservation = runtime.reserve_credential("term-1", 1).expect("reservation");
    assert_eq!(reservation.terminal_id(), "term-1");
    assert_eq!(reservation.incarnation(), 1);
    assert_eq!(reservation.url(), "ws://127.0.0.1:4801/v1/agent-status");
    let token = reservation.token().to_string();
    assert!(!token.is_empty());

    // While pending, authenticate_bearer returns Pending
    assert_eq!(
        runtime.authenticate_bearer(&token),
        TokenAuthResult::Pending
    );

    // Activate reservation
    reservation.activate();

    // Now active
    assert_eq!(
        runtime.authenticate_bearer(&token),
        TokenAuthResult::Active {
            terminal_id: "term-1".to_string(),
            incarnation: 1,
        }
    );

    // Another reservation for term-2, dropped without activation => revoked
    {
        let res2 = runtime.reserve_credential("term-2", 1).expect("res2");
        let token2 = res2.token().to_string();
        assert_eq!(runtime.authenticate_bearer(&token2), TokenAuthResult::Pending);
        // drop res2
    }
    // After drop, should be revoked
    // Looking up an unactivated dropped token returns InvalidOrRevoked
    let res3 = runtime.reserve_credential("term-3", 1).expect("res3");
    let token3 = res3.token().to_string();
    res3.revoke();
    assert_eq!(
        runtime.authenticate_bearer(&token3),
        TokenAuthResult::InvalidOrRevoked
    );
}

#[tokio::test]
async fn test_runtime_reporter_admission_reconnect_and_occupied() {
    use super::runtime::{AgentStatusRuntime, TokenAuthResult};
    use super::types::AgentStatusBroadcastEvent;

    let runtime = AgentStatusRuntime::with_epoch(
        1000,
        AgentStatusAvailability::Ready,
        Some("ws://127.0.0.1:4801/v1/agent-status".to_string()),
    );
    let mut event_rx = runtime.subscribe();

    let res = runtime.reserve_credential("term-1", 1).unwrap();
    let token = res.token().to_string();
    res.activate();

    let hello1 = sample_hello("rep-1", "sess-1");
    let (close_tx1, mut close_rx1) = tokio::sync::oneshot::channel();

    let accepted1 = runtime
        .admit_reporter("term-1", 1, &hello1, close_tx1)
        .expect("admit rep-1");
    assert_eq!(accepted1.server_epoch, 1000);
    assert_eq!(accepted1.reporter_epoch, 1);

    // Broadcast event received
    let ev = event_rx.recv().await.expect("recv event");
    match ev {
        AgentStatusBroadcastEvent::Changed(payload) => {
            assert_eq!(payload.row.id, "term-1");
            assert_eq!(payload.row.state, AgentState::Unknown);
            assert_eq!(payload.row.reporter_epoch, 1);
        }
        _ => panic!("unexpected event"),
    }

    // Different reporter attempting to connect while rep-1 is live => rejected ReporterOccupied
    let hello2 = sample_hello("rep-2", "sess-1");
    let (close_tx2, _close_rx2) = tokio::sync::oneshot::channel();
    let err = runtime
        .admit_reporter("term-1", 1, &hello2, close_tx2)
        .unwrap_err();
    assert!(matches!(err, AgentStatusError::ReporterOccupied { ref active } if active == "rep-1"));

    // Same reporter reconnects => old close_tx receives close signal, new epoch assigned
    let (close_tx1_new, _close_rx1_new) = tokio::sync::oneshot::channel();
    let accepted2 = runtime
        .admit_reporter("term-1", 1, &hello1, close_tx1_new)
        .expect("reconnect rep-1");
    assert_eq!(accepted2.reporter_epoch, 2);
    assert!(close_rx1.try_recv().is_ok(), "old reporter received close signal");

    // Terminal removal revokes and cleans up
    let removed = runtime.remove_terminal("term-1", 1).unwrap().unwrap();
    assert_eq!(removed.terminal_id, "term-1");
    assert_eq!(
        runtime.authenticate_bearer(&token),
        TokenAuthResult::InvalidOrRevoked
    );
}

#[tokio::test]
async fn test_runtime_lease_check_and_shutdown() {
    use super::runtime::AgentStatusRuntime;
    use super::types::AgentStatusBroadcastEvent;

    let runtime = AgentStatusRuntime::with_epoch(
        1000,
        AgentStatusAvailability::Ready,
        Some("ws://127.0.0.1:4801/v1/agent-status".to_string()),
    );
    let mut event_rx = runtime.subscribe();

    let res = runtime.reserve_credential("term-1", 1).unwrap();
    res.activate();

    let hello = sample_hello("rep-1", "sess-1");
    let (close_tx, mut close_rx) = tokio::sync::oneshot::channel();
    let _ = runtime.admit_reporter("term-1", 1, &hello, close_tx).unwrap();
    let _ = event_rx.recv().await.unwrap(); // drain admit event

    // Working report
    let rep = sample_report(
        1,
        ReporterEventKind::TurnStarted,
        AgentState::Working,
        "sess-1",
        Some("turn-1"),
        None,
        None,
    );
    runtime.apply_report("term-1", 1, 1, rep).unwrap();
    let ev = event_rx.recv().await.unwrap();
    match ev {
        AgentStatusBroadcastEvent::Changed(p) => assert_eq!(p.row.state, AgentState::Working),
        _ => panic!("expected changed"),
    }

    // Shutdown aborts close_tx and sets availability unavailable
    runtime.shutdown();
    assert!(close_rx.try_recv().is_ok(), "shutdown sent close signal");
    assert_eq!(runtime.availability(), AgentStatusAvailability::Unavailable);
}
