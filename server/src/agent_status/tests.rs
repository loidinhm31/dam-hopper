use super::hook_ingress::{validate_hook_envelope, TokenRateLimiter};
use super::reducer::{AgentStatusRegistry, TerminalAgentReducer};
use super::types::{
    validate_opaque_id, validate_safe_integer, AgentKind, AgentObservationSource, AgentState,
    AgentStatusAvailability, AgentStatusError, AttentionKind, BlockedReason, PrivateHookEnvelope,
    ReporterEventKind, ReporterHello, ReporterReport, TurnOutcome, AGENT_STATUS_PROTOCOL_VERSION,
    DEFAULT_LEASE_MS, MAX_SAFE_INTEGER,
};
use crate::pty::activity::ProcessIdentity;

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
fn sample_hook_envelope(
    event_id: &str,
    event: &str,
    session_id: &str,
    turn_id: Option<&str>,
    agent_kind: AgentKind,
) -> PrivateHookEnvelope {
    let root = ProcessIdentity {
        pid: 1234,
        start_ticks: 5678,
    };
    PrivateHookEnvelope {
        version: AGENT_STATUS_PROTOCOL_VERSION,
        agent_kind,
        adapter_version: "1.0.0".to_string(),
        event_id: event_id.to_string(),
        event: event.to_string(),
        agent_session_id: session_id.to_string(),
        turn_id: turn_id.map(str::to_string),
        tool_call_id: None,
        reason: None,
        notification_type: None,
        root_process: root,
        process_ancestry: vec![root],
    }
}

#[test]
fn native_kind_cannot_enter_persistent_omp_report_protocol() {
    for kind in [AgentKind::Codex, AgentKind::Claude] {
        let mut hello = sample_hello("native-1", "session-1");
        hello.agent_kind = kind;
        let mut reducer =
            TerminalAgentReducer::new(42, "terminal-1".into(), 1, 1, &hello, 1000).unwrap();
        let row = reducer.to_row();
        assert_eq!(row.state, AgentState::Unknown);
        assert_eq!(row.source, super::types::AgentObservationSource::Hook);
        assert_eq!(row.expires_at_ms, None);

        let attempted_end = sample_report(
            1,
            ReporterEventKind::TurnEnded,
            AgentState::Idle,
            "session-1",
            Some("turn-1"),
            Some(TurnOutcome::Ended),
            None,
        );
        assert!(reducer.apply_report(1, attempted_end, 1100).is_err());
        assert_eq!(reducer.state, AgentState::Unknown);
        assert_eq!(reducer.attention_revision, 0);
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
    assert_eq!(reducer.to_row().observed_at_ms, Some(1100));
    assert_eq!(reducer.to_row().expires_at_ms, None);
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
    assert_eq!(reducer.to_row().observed_at_ms, Some(1100));

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
    let epoch_err = reducer.apply_report(0, stale_epoch_rep, 1080).unwrap_err();
    assert!(matches!(
        epoch_err,
        AgentStatusError::StaleReporterEpoch { current: 1, got: 0 }
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
        .admit_reporter("term-1".to_string(), 1, &hello, 1000)
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
        .admit_reporter("term-1".to_string(), 1, &hello, 18000)
        .unwrap();
    assert_eq!(row_reconnect.reporter_epoch, 2);
    assert_eq!(row_reconnect.state, AgentState::Unknown);

    // Old socket for epoch 1 cannot mark unknown or apply reports
    let old_mark_err = registry.mark_unknown("term-1", 1, 1).unwrap_err();
    assert!(matches!(
        old_mark_err,
        AgentStatusError::StaleReporterEpoch { current: 2, got: 1 }
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
    let reservation = runtime
        .reserve_credential("term-1", 1)
        .expect("reservation");
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
        assert_eq!(
            runtime.authenticate_bearer(&token2),
            TokenAuthResult::Pending
        );
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
        .admit_reporter("term-1", 1, &token, &hello1, close_tx1)
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
        .admit_reporter("term-1", 1, &token, &hello2, close_tx2)
        .unwrap_err();
    assert!(matches!(err, AgentStatusError::ReporterOccupied { ref active } if active == "rep-1"));

    // Same reporter reconnects => old close_tx receives close signal, new epoch assigned
    let (close_tx1_new, _close_rx1_new) = tokio::sync::oneshot::channel();
    let accepted2 = runtime
        .admit_reporter("term-1", 1, &token, &hello1, close_tx1_new)
        .expect("reconnect rep-1");
    assert_eq!(accepted2.reporter_epoch, 2);
    assert!(
        close_rx1.try_recv().is_ok(),
        "old reporter received close signal"
    );

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
    let token = res.token().to_string();
    res.activate();

    let hello = sample_hello("rep-1", "sess-1");
    let (close_tx, mut close_rx) = tokio::sync::oneshot::channel();
    let _ = runtime
        .admit_reporter("term-1", 1, &token, &hello, close_tx)
        .unwrap();
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

#[test]
fn test_native_hook_lifecycle_transitions() {
    let mut registry = AgentStatusRegistry::new(100, AgentStatusAvailability::Ready);

    // 1. SessionStart: baseline Unknown, no attention emitted
    let env_start = sample_hook_envelope("ev-1", "SessionStart", "sess-1", None, AgentKind::Codex);
    let out = registry.apply_hook("term-1", 1, &env_start, 1000).unwrap();
    assert!(out.state_changed);
    let row = out.row.unwrap();
    assert_eq!(row.state, AgentState::Unknown);
    assert_eq!(row.source, AgentObservationSource::Hook);
    assert!(out.attention.is_none());
    let wire = serde_json::to_value(&row).unwrap();
    assert!(wire.get("expiresAtMs").is_none());

    // 2. UserPromptSubmit: Working transition, observed_at set
    let env_submit = sample_hook_envelope(
        "ev-2",
        "UserPromptSubmit",
        "sess-1",
        Some("turn-1"),
        AgentKind::Codex,
    );
    let out = registry.apply_hook("term-1", 1, &env_submit, 1050).unwrap();
    assert!(out.state_changed);
    let row = out.row.unwrap();
    assert_eq!(row.state, AgentState::Working);
    assert_eq!(row.turn_id.as_deref(), Some("turn-1"));
    assert_eq!(row.observed_at_ms, Some(1050));
    assert_eq!(row.expires_at_ms, Some(1050 + DEFAULT_LEASE_MS));
    let wire = serde_json::to_value(&row).unwrap();
    assert_eq!(wire["expiresAtMs"], 1050 + DEFAULT_LEASE_MS);
    assert!(out.attention.is_none());

    // 3. Deduplication: duplicate event_id is a no-op
    let out_dupe = registry.apply_hook("term-1", 1, &env_submit, 1060).unwrap();
    assert!(!out_dupe.state_changed);
    assert!(out_dupe.attention.is_none());

    // 4. PreToolUse: remains Working
    let env_tool = sample_hook_envelope(
        "ev-3",
        "PreToolUse",
        "sess-1",
        Some("turn-1"),
        AgentKind::Codex,
    );
    let out = registry.apply_hook("term-1", 1, &env_tool, 1100).unwrap();
    let row = out.row.unwrap();
    assert_eq!(row.state, AgentState::Working);
    assert_eq!(row.expires_at_ms, Some(1100 + DEFAULT_LEASE_MS));
    assert!(!out.state_changed);
    assert!(out.attention.is_none());

    // 5. Stop: transitions to Unknown, strictly NO completion attention
    let env_stop = sample_hook_envelope("ev-5", "Stop", "sess-1", Some("turn-1"), AgentKind::Codex);
    let out = registry.apply_hook("term-1", 1, &env_stop, 1300).unwrap();
    assert!(out.state_changed);
    let row = out.row.unwrap();
    assert_eq!(row.state, AgentState::Unknown);
    assert!(serde_json::to_value(&row)
        .unwrap()
        .get("expiresAtMs")
        .is_none());
    assert!(
        out.attention.is_none(),
        "Stop must never emit completion attention"
    );

    // A different native root cannot claim the same terminal.
    let mut claude = sample_hook_envelope(
        "ev-6",
        "Notification",
        "sess-1",
        Some("turn-1"),
        AgentKind::Claude,
    );
    claude.notification_type = Some("permission_prompt".to_string());
    assert!(registry.apply_hook("term-1", 1, &claude, 1400).is_err());

    let mut claude_registry = AgentStatusRegistry::new(100, AgentStatusAvailability::Ready);
    let start = sample_hook_envelope(
        "ev-c1",
        "UserPromptSubmit",
        "claude-sess",
        Some("claude-turn"),
        AgentKind::Claude,
    );
    claude_registry
        .apply_hook("term-2", 1, &start, 1100)
        .unwrap();
    let mut notice = sample_hook_envelope(
        "ev-c2",
        "Notification",
        "claude-sess",
        Some("claude-turn"),
        AgentKind::Claude,
    );
    notice.notification_type = Some("permission_prompt".to_string());
    let out = claude_registry
        .apply_hook("term-2", 1, &notice, 1200)
        .unwrap();
    assert_eq!(out.row.unwrap().state, AgentState::Blocked);
    assert_eq!(out.attention.unwrap().reason, Some(BlockedReason::Approval));
}

#[tokio::test]
async fn test_native_hook_cannot_evict_live_omp() {
    use super::runtime::AgentStatusRuntime;

    let runtime = AgentStatusRuntime::with_epoch(
        100,
        AgentStatusAvailability::Ready,
        Some("ws://127.0.0.1:4801/v1/agent-status".to_string()),
    );

    let res = runtime.reserve_credential("term-1", 1).unwrap();
    let token = res.token().to_string();
    res.activate();

    let hello = sample_hello("omp-reporter-1", "omp-sess-1");
    let (close_tx, _close_rx) = tokio::sync::oneshot::channel();
    runtime
        .admit_reporter("term-1", 1, &token, &hello, close_tx)
        .unwrap();

    // Attempt native hook on terminal occupied by live OMP reporter
    let env = sample_hook_envelope(
        "ev-hook-1",
        "UserPromptSubmit",
        "native-sess-1",
        Some("t1"),
        AgentKind::Codex,
    );
    let res = runtime.apply_hook_event("term-1", 1, &env, 1000);
    assert!(res.is_err());
    match res {
        Err(AgentStatusError::AuthorityLost(msg)) => {
            assert!(msg.contains("live OMP"));
        }
        other => panic!("expected AuthorityLost, got {:?}", other),
    }
}

#[test]
fn test_native_hook_causal_correlation_retired_turns() {
    let mut registry = AgentStatusRegistry::new(100, AgentStatusAvailability::Ready);

    // Turn 1 starts
    let env_t1 = sample_hook_envelope(
        "ev-t1",
        "UserPromptSubmit",
        "sess-1",
        Some("turn-1"),
        AgentKind::Codex,
    );
    let out = registry.apply_hook("term-1", 1, &env_t1, 1000).unwrap();
    assert_eq!(out.row.unwrap().turn_id.as_deref(), Some("turn-1"));

    // A second opaque turn ID is ambiguous while the first is active.
    let env_t2 = sample_hook_envelope(
        "ev-t2",
        "UserPromptSubmit",
        "sess-1",
        Some("turn-2"),
        AgentKind::Codex,
    );
    let out = registry.apply_hook("term-1", 1, &env_t2, 1100).unwrap();
    assert_eq!(out.row.as_ref().unwrap().state, AgentState::Unknown);
    assert!(out.row.as_ref().unwrap().turn_id.is_none());
    assert!(out.attention.is_none());

    // The old callback cannot revive a retired turn.
    let env_late_stop = sample_hook_envelope(
        "ev-late-stop",
        "Stop",
        "sess-1",
        Some("turn-1"),
        AgentKind::Codex,
    );
    let out = registry
        .apply_hook("term-1", 1, &env_late_stop, 1200)
        .unwrap();
    assert!(!out.state_changed);
    assert_eq!(out.row.unwrap().state, AgentState::Unknown);
}

#[test]
fn test_native_uncorrelated_and_late_callbacks_cannot_change_newer_turn() {
    let mut registry = AgentStatusRegistry::new(100, AgentStatusAvailability::Ready);
    let next = sample_hook_envelope(
        "next",
        "UserPromptSubmit",
        "session",
        Some("new"),
        AgentKind::Codex,
    );
    registry.apply_hook("terminal", 1, &next, 200).unwrap();
    for (id, event, turn) in [
        ("late-interrupt", "Interrupt", Some("old")),
        ("unbound-stop", "Stop", None),
        ("unbound-tool", "PostToolUse", None),
        ("old-permission", "PermissionRequest", Some("old")),
        ("late-start", "SessionStart", None),
    ] {
        let hook = sample_hook_envelope(id, event, "session", turn, AgentKind::Codex);
        let result = registry.apply_hook("terminal", 1, &hook, 300).unwrap();
        assert!(!result.state_changed, "{event} must not settle newer turn");
        assert!(result.attention.is_none());
        let row = result.row.unwrap();
        assert_eq!(row.state, AgentState::Working);
        assert_eq!(row.turn_id.as_deref(), Some("new"));
        assert_eq!(row.expires_at_ms, Some(200 + DEFAULT_LEASE_MS));
    }

    let expired = registry
        .check_leases(200 + DEFAULT_LEASE_MS, DEFAULT_LEASE_MS)
        .unwrap();
    assert_eq!(expired.len(), 1);
    assert_eq!(expired[0].row.as_ref().unwrap().state, AgentState::Unknown);
    assert!(expired[0].attention.is_none());
}

#[test]
fn native_owner_retires_on_session_end_and_old_callbacks_cannot_reclaim() {
    let mut registry = AgentStatusRegistry::new(100, AgentStatusAvailability::Ready);
    let first = sample_hook_envelope(
        "first",
        "UserPromptSubmit",
        "session-1",
        Some("turn-1"),
        AgentKind::Codex,
    );
    registry.apply_hook("terminal", 1, &first, 100).unwrap();
    let ended = sample_hook_envelope("ended", "SessionEnd", "session-1", None, AgentKind::Codex);
    let row = registry
        .apply_hook("terminal", 1, &ended, 200)
        .unwrap()
        .row
        .unwrap();
    assert_eq!(row.state, AgentState::Unknown);
    assert!(row.expires_at_ms.is_none());

    let stale = sample_hook_envelope(
        "late",
        "UserPromptSubmit",
        "session-1",
        Some("turn-2"),
        AgentKind::Codex,
    );
    assert!(
        !registry
            .apply_hook("terminal", 1, &stale, 300)
            .unwrap()
            .state_changed
    );
    let mut next = sample_hook_envelope(
        "next",
        "UserPromptSubmit",
        "session-2",
        Some("turn-1"),
        AgentKind::Claude,
    );
    next.root_process = ProcessIdentity {
        pid: 4321,
        start_ticks: 8765,
    };
    next.process_ancestry = vec![next.root_process];
    let row = registry
        .apply_hook("terminal", 1, &next, 400)
        .unwrap()
        .row
        .unwrap();
    assert_eq!(row.agent_kind, AgentKind::Claude);
    assert_eq!(row.state, AgentState::Working);
    assert_eq!(row.agent_session_id, "session-2");
}

#[test]
fn test_token_rate_limiter_burst_and_exhaustion() {
    let mut limiter = TokenRateLimiter::new();

    // 40 tokens should be immediately available (burst 40)
    for _ in 0..40 {
        assert!(
            limiter.check_and_consume(),
            "expected burst token available"
        );
    }

    // 41st token should immediately fail without elapsed time
    assert!(
        !limiter.check_and_consume(),
        "expected rate limit exceeded on 41st request"
    );
}

#[test]
fn test_validate_hook_envelope() {
    let valid = sample_hook_envelope(
        "ev-valid",
        "UserPromptSubmit",
        "sess-1",
        Some("t1"),
        AgentKind::Codex,
    );
    assert!(validate_hook_envelope(&valid).is_ok());

    let mut invalid_kind = valid.clone();
    invalid_kind.agent_kind = AgentKind::Omp;
    assert!(validate_hook_envelope(&invalid_kind).is_err());

    let mut invalid_id = valid.clone();
    invalid_id.event_id = "".to_string();
    assert!(validate_hook_envelope(&invalid_id).is_err());
}

#[tokio::test]
async fn native_lease_renewal_publishes_freshness_without_duplicate_attention() {
    use super::runtime::AgentStatusRuntime;
    let runtime = AgentStatusRuntime::with_epoch(
        100,
        AgentStatusAvailability::Ready,
        Some("ws://127.0.0.1:4801/v1/agent-status".to_string()),
    );
    let reservation = runtime.reserve_credential("terminal", 1).unwrap();
    let root = crate::pty::activity::probe_process_identity(std::process::id()).unwrap();
    runtime.register_terminal_root("terminal", 1, root);
    reservation.activate();
    let mut subscriber = runtime.subscribe();
    let mut start = sample_hook_envelope(
        "first",
        "UserPromptSubmit",
        "session",
        Some("turn"),
        AgentKind::Codex,
    );
    start.process_ancestry.push(root);
    runtime
        .apply_hook_event("terminal", 1, &start, 1000)
        .unwrap();
    let first = subscriber.try_recv().unwrap();
    let mut renewed = sample_hook_envelope(
        "renewed",
        "PreToolUse",
        "session",
        Some("turn"),
        AgentKind::Codex,
    );
    renewed.process_ancestry.push(root);
    runtime
        .apply_hook_event("terminal", 1, &renewed, 2100)
        .unwrap();
    let second = subscriber.try_recv().unwrap();
    let (
        super::types::AgentStatusBroadcastEvent::Changed(initial),
        super::types::AgentStatusBroadcastEvent::Changed(refresh),
    ) = (first, second)
    else {
        panic!("expected two changed events");
    };
    assert_eq!(refresh.revision, initial.revision + 1);
    assert_eq!(refresh.row.expires_at_ms, Some(2100 + DEFAULT_LEASE_MS));
    assert!(refresh.attention.is_none());
}

#[test]
fn runtime_owner_generations_span_native_omp_and_reconnect() {
    use super::runtime::AgentStatusRuntime;
    let runtime = AgentStatusRuntime::with_epoch(
        100,
        AgentStatusAvailability::Ready,
        Some("ws://127.0.0.1:4801/v1/agent-status".to_string()),
    );
    let credential = runtime.reserve_credential("terminal", 1).unwrap();
    let token = credential.token().to_string();
    credential.activate();
    let native = sample_hook_envelope(
        "native",
        "UserPromptSubmit",
        "native-session",
        Some("turn"),
        AgentKind::Codex,
    );
    runtime.register_terminal_root("terminal", 1, native.root_process);
    let first = runtime
        .apply_hook_event("terminal", 1, &native, 100)
        .unwrap()
        .unwrap();
    let hello = sample_hello("omp", "omp-session");
    let (close_tx, mut close_rx) = tokio::sync::oneshot::channel();
    let omp = runtime
        .admit_reporter("terminal", 1, &token, &hello, close_tx)
        .unwrap();
    assert!(omp.reporter_epoch > first.reporter_epoch);
    assert_eq!(runtime.snapshot().terminals[0].agent_kind, AgentKind::Omp);

    let (close_tx, _) = tokio::sync::oneshot::channel();
    let reconnect = runtime
        .admit_reporter("terminal", 1, &token, &hello, close_tx)
        .unwrap();
    assert!(reconnect.reporter_epoch > omp.reporter_epoch);
    assert!(close_rx.try_recv().is_ok());
    runtime.mark_unknown_on_disconnect("terminal", 1, omp.reporter_epoch);
    assert!(runtime.has_live_omp_reporter("terminal", 1));
    assert!(runtime
        .apply_hook_event("terminal", 1, &native, 200)
        .is_err());

    runtime.mark_unknown_on_disconnect("terminal", 1, reconnect.reporter_epoch);
    let mut next = sample_hook_envelope(
        "next",
        "UserPromptSubmit",
        "next-session",
        Some("next-turn"),
        AgentKind::Claude,
    );
    next.root_process.pid += 1;
    next.process_ancestry.insert(0, next.root_process);
    let row = runtime
        .apply_hook_event("terminal", 1, &next, 300)
        .unwrap()
        .unwrap();
    assert!(row.reporter_epoch > reconnect.reporter_epoch);
    assert_eq!(row.state, AgentState::Working);
    runtime.mark_unknown_on_disconnect("terminal", 1, reconnect.reporter_epoch);
    assert_eq!(runtime.snapshot().terminals[0], row);
    // The evicted native process cannot reclaim the newer owner either.
    let mut old_native = native.clone();
    old_native.event_id = "old-native".to_string();
    let ignored = runtime.apply_hook_event("terminal", 1, &old_native, 400);
    assert!(ignored.is_err() || ignored.unwrap().unwrap() == row);
    assert_eq!(runtime.snapshot().terminals[0], row);
}

#[test]
fn native_quiet_gap_recovers_only_from_fresh_same_session_baseline() {
    let mut registry = AgentStatusRegistry::new(100, AgentStatusAvailability::Ready);
    let start = sample_hook_envelope(
        "start",
        "UserPromptSubmit",
        "session",
        Some("old-turn"),
        AgentKind::Claude,
    );
    let first = registry
        .apply_hook("terminal", 1, &start, 100)
        .unwrap()
        .row
        .unwrap();
    let mut blocked = sample_hook_envelope(
        "blocked",
        "Notification",
        "session",
        Some("old-turn"),
        AgentKind::Claude,
    );
    blocked.notification_type = Some("permission_prompt".to_string());
    assert!(registry
        .apply_hook("terminal", 1, &blocked, 200)
        .unwrap()
        .attention
        .is_some());
    let owner = registry.get_native_owner("terminal", 1);
    let expired = registry
        .check_leases(200 + DEFAULT_LEASE_MS, DEFAULT_LEASE_MS)
        .unwrap();
    let unknown = expired[0].row.clone().unwrap();
    assert_eq!(unknown.state, AgentState::Unknown);
    assert!(unknown.turn_id.is_none());
    assert!(unknown.reason.is_none());
    assert!(unknown.observed_at_ms.is_none());
    assert!(expired[0].attention.is_none());
    assert_eq!(registry.get_native_owner("terminal", 1), owner);

    for (id, event, session, turn) in [
        ("stale-tool", "PreToolUse", "session", Some("old-turn")),
        ("stale-blocked", "Notification", "session", Some("old-turn")),
        (
            "stale-prompt",
            "UserPromptSubmit",
            "session",
            Some("old-turn"),
        ),
        (
            "foreign-tool",
            "PreToolUse",
            "unestablished-session",
            Some("other"),
        ),
        ("foreign-end", "SessionEnd", "unestablished-session", None),
    ] {
        let mut stale = sample_hook_envelope(id, event, session, turn, AgentKind::Claude);
        stale.notification_type = Some("permission_prompt".to_string());
        let output = registry.apply_hook("terminal", 1, &stale, 16000).unwrap();
        assert!(
            !output.state_changed,
            "{event} must not revive expired evidence"
        );
        assert!(output.attention.is_none());
        assert_eq!(output.row.as_ref(), Some(&unknown));
    }
    let fresh = sample_hook_envelope(
        "fresh",
        "UserPromptSubmit",
        "session",
        Some("new-turn"),
        AgentKind::Claude,
    );
    let output = registry.apply_hook("terminal", 1, &fresh, 17000).unwrap();
    let recovered = output.row.unwrap();
    assert_eq!(recovered.state, AgentState::Working);
    assert_eq!(recovered.turn_id.as_deref(), Some("new-turn"));
    assert_eq!(recovered.reporter_epoch, first.reporter_epoch);
    assert_eq!(recovered.expires_at_ms, Some(17000 + DEFAULT_LEASE_MS));
    assert!(output.attention.is_none());

    let mut duplicate = fresh.clone();
    duplicate.event_id = "different-delivery-of-same-prompt".to_string();
    let output = registry
        .apply_hook("terminal", 1, &duplicate, 18000)
        .unwrap();
    assert!(!output.state_changed);
    assert_eq!(output.row.as_ref(), Some(&recovered));
    let delayed_session = sample_hook_envelope(
        "delayed-session",
        "SessionStart",
        "unestablished-session",
        None,
        AgentKind::Claude,
    );
    let output = registry
        .apply_hook("terminal", 1, &delayed_session, 19000)
        .unwrap();
    assert!(!output.state_changed);
    assert_eq!(output.row.as_ref(), Some(&recovered));
}

#[test]
fn native_gap_is_fenced_even_before_periodic_lease_check() {
    let mut registry = AgentStatusRegistry::new(100, AgentStatusAvailability::Ready);
    let start = sample_hook_envelope(
        "start",
        "UserPromptSubmit",
        "session",
        Some("old"),
        AgentKind::Codex,
    );
    registry.apply_hook("terminal", 1, &start, 100).unwrap();
    let stale = sample_hook_envelope(
        "late-tool",
        "PreToolUse",
        "session",
        Some("old"),
        AgentKind::Codex,
    );
    let expired = registry
        .apply_hook("terminal", 1, &stale, 100 + DEFAULT_LEASE_MS)
        .unwrap();
    assert_eq!(expired.row.unwrap().state, AgentState::Unknown);
    assert!(expired.attention.is_none());
    let fresh = sample_hook_envelope(
        "fresh",
        "UserPromptSubmit",
        "session",
        Some("new"),
        AgentKind::Codex,
    );
    let recovered = registry
        .apply_hook("terminal", 1, &fresh, 200 + DEFAULT_LEASE_MS)
        .unwrap();
    assert_eq!(recovered.row.unwrap().state, AgentState::Working);
}

#[test]
fn prior_exit_proof_cannot_replace_changed_root_or_generation() {
    let mut registry = AgentStatusRegistry::new(100, AgentStatusAvailability::Ready);
    let first = sample_hook_envelope(
        "first",
        "UserPromptSubmit",
        "first-session",
        Some("turn"),
        AgentKind::Codex,
    );
    registry.apply_hook("terminal", 1, &first, 100).unwrap();
    // Capture the same evidence runtime captures before its off-lock proc read.
    let proof = registry.get_native_owner("terminal", 1).unwrap();
    let mut second = sample_hook_envelope(
        "second",
        "UserPromptSubmit",
        "second-session",
        Some("turn"),
        AgentKind::Claude,
    );
    second.root_process.pid += 1;
    second.process_ancestry = vec![second.root_process];
    let second_row = registry
        .apply_hook_with_prior_exited("terminal", 1, &second, 200, Some(proof))
        .unwrap()
        .row
        .unwrap();
    assert!(second_row.reporter_epoch > proof.generation);
    let mut third = sample_hook_envelope(
        "third",
        "UserPromptSubmit",
        "third-session",
        Some("turn"),
        AgentKind::Codex,
    );
    third.root_process.pid += 2;
    third.process_ancestry = vec![third.root_process];
    assert!(matches!(
        registry.apply_hook_with_prior_exited("terminal", 1, &third, 300, Some(proof)),
        Err(AgentStatusError::AuthorityLost(_))
    ));
    assert_eq!(registry.get_row("terminal", 1).as_ref(), Some(&second_row));

    // ABA: even an identical process identity cannot reuse an older generation's proof.
    registry.remove_terminal("terminal", 1).unwrap();
    registry.apply_hook("terminal", 1, &first, 400).unwrap();
    let newer_owner = registry.get_native_owner("terminal", 1).unwrap();
    assert_eq!(newer_owner.root, proof.root);
    assert!(newer_owner.generation > proof.generation);
    let before = registry.snapshot();
    assert!(matches!(
        registry.apply_hook_with_prior_exited("terminal", 1, &third, 500, Some(proof)),
        Err(AgentStatusError::AuthorityLost(_))
    ));
    assert_eq!(registry.snapshot(), before);
}

#[test]
fn expired_omp_socket_cannot_restore_status_or_attention() {
    use super::runtime::AgentStatusRuntime;
    let runtime = AgentStatusRuntime::with_epoch(
        100,
        AgentStatusAvailability::Ready,
        Some("ws://127.0.0.1:4801/v1/agent-status".to_string()),
    );
    let credential = runtime.reserve_credential("terminal", 1).unwrap();
    let token = credential.token().to_string();
    credential.activate();
    let hello = sample_hello("omp", "session");
    let (close_tx, mut close_rx) = tokio::sync::oneshot::channel();
    let accepted = runtime
        .admit_reporter("terminal", 1, &token, &hello, close_tx)
        .unwrap();
    runtime
        .apply_report(
            "terminal",
            1,
            accepted.reporter_epoch,
            sample_report(
                1,
                ReporterEventKind::TurnStarted,
                AgentState::Working,
                "session",
                Some("turn"),
                None,
                None,
            ),
        )
        .unwrap();
    let queued = sample_report(
        2,
        ReporterEventKind::StateChanged,
        AgentState::Blocked,
        "session",
        Some("turn"),
        None,
        Some(BlockedReason::Approval),
    );
    runtime
        .check_leases_with_time(
            crate::pty::session::now_ms() + DEFAULT_LEASE_MS,
            DEFAULT_LEASE_MS,
        )
        .unwrap();
    assert!(close_rx.try_recv().is_ok());
    assert!(!runtime.has_live_omp_reporter("terminal", 1));
    let expired = runtime.snapshot();
    assert_eq!(expired.terminals[0].state, AgentState::Unknown);
    let mut subscriber = runtime.subscribe();
    assert!(runtime
        .apply_report("terminal", 1, accepted.reporter_epoch, queued.clone())
        .is_err());
    assert_eq!(runtime.snapshot(), expired);
    assert!(subscriber.try_recv().is_err());

    let (close_tx, _) = tokio::sync::oneshot::channel();
    let reconnected = runtime
        .admit_reporter("terminal", 1, &token, &hello, close_tx)
        .unwrap();
    assert!(reconnected.reporter_epoch > accepted.reporter_epoch);
    assert!(runtime
        .apply_report("terminal", 1, accepted.reporter_epoch, queued)
        .is_err());
    runtime
        .apply_report(
            "terminal",
            1,
            reconnected.reporter_epoch,
            sample_report(
                1,
                ReporterEventKind::Snapshot,
                AgentState::Idle,
                "session",
                None,
                None,
                None,
            ),
        )
        .unwrap();
    assert_eq!(runtime.snapshot().terminals[0].state, AgentState::Idle);
}

#[test]
fn omp_initial_unknown_lease_also_expires() {
    let mut registry = AgentStatusRegistry::new(100, AgentStatusAvailability::Ready);
    let row = registry
        .admit_reporter(
            "terminal".to_string(),
            1,
            &sample_hello("omp", "session"),
            100,
        )
        .unwrap();
    assert_eq!(row.state, AgentState::Unknown);
    let expired = registry
        .check_leases(100 + DEFAULT_LEASE_MS, DEFAULT_LEASE_MS)
        .unwrap();
    assert!(expired[0].state_changed);
    assert!(registry
        .apply_report(
            "terminal",
            1,
            row.reporter_epoch,
            sample_report(
                1,
                ReporterEventKind::Snapshot,
                AgentState::Working,
                "session",
                Some("turn"),
                None,
                None,
            ),
            200 + DEFAULT_LEASE_MS
        )
        .is_err());
    assert_eq!(
        registry.get_row("terminal", 1).unwrap().state,
        AgentState::Unknown
    );
}

#[test]
fn authenticated_handshake_cannot_admit_after_revoke_or_replacement() {
    use super::runtime::{AgentStatusRuntime, TokenAuthResult};
    let runtime = AgentStatusRuntime::with_epoch(
        100,
        AgentStatusAvailability::Ready,
        Some("ws://127.0.0.1:4801/v1/agent-status".to_string()),
    );
    let credential = runtime.reserve_credential("terminal", 1).unwrap();
    let original_token = credential.token().to_string();
    credential.activate();
    assert!(matches!(
        runtime.authenticate_bearer(&original_token),
        TokenAuthResult::Active { .. }
    ));
    // Replacement occurs after the HTTP handshake, before WebSocket hello admission.
    let replacement = runtime.reserve_credential("terminal", 1).unwrap();
    let replacement_token = replacement.token().to_string();
    replacement.activate();
    let hello = sample_hello("omp", "session");
    let (close_tx, _) = tokio::sync::oneshot::channel();
    assert!(matches!(
        runtime.admit_reporter("terminal", 1, &original_token, &hello, close_tx),
        Err(AgentStatusError::CapabilityRevoked)
    ));
    assert!(!runtime.has_live_omp_reporter("terminal", 1));
    assert!(runtime.snapshot().terminals.is_empty());

    let (close_tx, _) = tokio::sync::oneshot::channel();
    let accepted = runtime
        .admit_reporter("terminal", 1, &replacement_token, &hello, close_tx)
        .unwrap();
    runtime
        .apply_report(
            "terminal",
            1,
            accepted.reporter_epoch,
            sample_report(
                1,
                ReporterEventKind::TurnStarted,
                AgentState::Working,
                "session",
                Some("turn"),
                None,
                None,
            ),
        )
        .unwrap();
    assert!(matches!(
        runtime.authenticate_bearer(&replacement_token),
        TokenAuthResult::Active { .. }
    ));
    runtime.revoke_credential("terminal", 1);
    let revoked = runtime.snapshot();
    assert_eq!(revoked.terminals[0].state, AgentState::Unknown);
    let mut subscriber = runtime.subscribe();
    let (close_tx, _) = tokio::sync::oneshot::channel();
    assert!(matches!(
        runtime.admit_reporter("terminal", 1, &replacement_token, &hello, close_tx),
        Err(AgentStatusError::CapabilityRevoked)
    ));
    assert!(runtime
        .apply_report(
            "terminal",
            1,
            accepted.reporter_epoch,
            sample_report(
                2,
                ReporterEventKind::StateChanged,
                AgentState::Blocked,
                "session",
                Some("turn"),
                None,
                Some(BlockedReason::Approval),
            )
        )
        .is_err());
    assert_eq!(runtime.snapshot(), revoked);
    assert!(subscriber.try_recv().is_err());
    runtime.remove_terminal("terminal", 1).unwrap();
    let (close_tx, _) = tokio::sync::oneshot::channel();
    assert!(runtime
        .admit_reporter("terminal", 1, &replacement_token, &hello, close_tx)
        .is_err());
    assert!(runtime.snapshot().terminals.is_empty());
    assert!(runtime.reserve_credential("terminal", 1).is_none());
}

#[cfg(target_os = "linux")]
#[test]
fn runtime_live_native_root_recovers_after_expiry_but_not_revocation() {
    use super::runtime::AgentStatusRuntime;
    let runtime = AgentStatusRuntime::with_epoch(
        100,
        AgentStatusAvailability::Ready,
        Some("ws://127.0.0.1:4801/v1/agent-status".to_string()),
    );
    let credential = runtime.reserve_credential("terminal", 1).unwrap();
    let root = crate::pty::activity::probe_process_identity(std::process::id()).unwrap();
    runtime.register_terminal_root("terminal", 1, root);
    credential.activate();
    let mut hook = sample_hook_envelope(
        "start",
        "UserPromptSubmit",
        "session",
        Some("old"),
        AgentKind::Claude,
    );
    hook.root_process = root;
    hook.process_ancestry = vec![root];
    let first = runtime
        .apply_hook_event("terminal", 1, &hook, 100)
        .unwrap()
        .unwrap();
    hook.event_id = "permission-request".to_string();
    hook.event = "PermissionRequest".to_string();
    let candidate = runtime
        .apply_hook_event("terminal", 1, &hook, 200)
        .unwrap()
        .unwrap();
    assert_eq!(candidate.state, AgentState::Unknown);
    assert_eq!(candidate.turn_id.as_deref(), Some("old"));
    runtime
        .check_leases_with_time(200 + DEFAULT_LEASE_MS, DEFAULT_LEASE_MS)
        .unwrap();
    let expired = runtime.snapshot().terminals[0].clone();
    assert!(expired.turn_id.is_none());
    hook.event_id = "stale-progress".to_string();
    hook.event = "PreToolUse".to_string();
    assert_eq!(
        runtime
            .apply_hook_event("terminal", 1, &hook, 16000)
            .unwrap()
            .as_ref(),
        Some(&expired)
    );
    hook.event_id = "fresh".to_string();
    hook.event = "UserPromptSubmit".to_string();
    hook.turn_id = Some("new".to_string());
    let recovered = runtime
        .apply_hook_event("terminal", 1, &hook, 17000)
        .unwrap()
        .unwrap();
    assert_eq!(recovered.state, AgentState::Working);
    assert_eq!(recovered.reporter_epoch, first.reporter_epoch);
    assert_eq!(recovered.expires_at_ms, Some(17000 + DEFAULT_LEASE_MS));
    runtime.revoke_credential("terminal", 1);
    let revoked = runtime.snapshot();
    assert_eq!(revoked.terminals[0].state, AgentState::Unknown);
    hook.event_id = "post-revoke".to_string();
    hook.turn_id = Some("third".to_string());
    assert!(matches!(
        runtime.apply_hook_event("terminal", 1, &hook, 18000),
        Err(AgentStatusError::CapabilityRevoked)
    ));
    assert_eq!(runtime.snapshot(), revoked);
}

#[test]
fn omp_report_at_lease_deadline_cannot_renew_its_own_authority() {
    let mut reducer = TerminalAgentReducer::new(
        100,
        "terminal".to_string(),
        1,
        1,
        &sample_hello("omp", "session"),
        100,
    )
    .unwrap();
    reducer
        .apply_report(
            1,
            sample_report(
                1,
                ReporterEventKind::TurnStarted,
                AgentState::Working,
                "session",
                Some("turn"),
                None,
                None,
            ),
            100,
        )
        .unwrap();
    let before = reducer.clone();
    assert!(matches!(
        reducer.apply_report(
            1,
            sample_report(
                2,
                ReporterEventKind::StateChanged,
                AgentState::Blocked,
                "session",
                Some("turn"),
                None,
                Some(BlockedReason::Approval),
            ),
            100 + DEFAULT_LEASE_MS
        ),
        Err(AgentStatusError::AuthorityLost(_))
    ));
    assert_eq!(reducer, before);
    let expired = reducer
        .check_lease(100 + DEFAULT_LEASE_MS, DEFAULT_LEASE_MS)
        .unwrap();
    assert_eq!(expired.row.unwrap().state, AgentState::Unknown);
    assert!(expired.attention.is_none());
}

#[test]
fn omp_admission_rejects_a_superseded_terminal_incarnation() {
    use super::runtime::AgentStatusRuntime;
    let runtime = AgentStatusRuntime::with_epoch(
        100,
        AgentStatusAvailability::Ready,
        Some("ws://127.0.0.1:4801/v1/agent-status".to_string()),
    );
    let old = runtime.reserve_credential("terminal", 1).unwrap();
    let old_token = old.token().to_string();
    old.activate();
    let current = runtime.reserve_credential("terminal", 2).unwrap();
    let current_token = current.token().to_string();
    current.activate();
    let hello = sample_hello("omp", "session");
    let (close_tx, _) = tokio::sync::oneshot::channel();
    assert!(matches!(
        runtime.admit_reporter("terminal", 1, &old_token, &hello, close_tx),
        Err(AgentStatusError::CapabilityRevoked)
    ));
    let (close_tx, _) = tokio::sync::oneshot::channel();
    runtime
        .admit_reporter("terminal", 2, &current_token, &hello, close_tx)
        .unwrap();
    let snapshot = runtime.snapshot();
    assert_eq!(snapshot.terminals.len(), 1);
    assert_eq!(snapshot.terminals[0].incarnation, 2);
}
