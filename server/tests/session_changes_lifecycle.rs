use dam_hopper_server::session_changes::binding::get_retained_session_list;
use dam_hopper_server::session_changes::store::{
    SessionChangesKey, SessionChangesRecord, SessionChangesService,
};
use dam_hopper_server::session_changes::types::*;
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

#[tokio::test]
async fn test_terminal_metadata_retention_and_removal() {
    let service = Arc::new(SessionChangesService::new().unwrap());

    let key = SessionChangesKey {
        terminal_id: "term-123".into(),
        terminal_incarnation: "1".into(),
        omp_session_id: "omp-session-abc".into(),
        root_id: ".".into(),
    };

    let record = SessionChangesRecord {
        registration_id: "reg-1".into(),
        baseline_id: Some("base-1".into()),
        activation_nonce: Some("nonce-1".into()),
        activation_receipt_id: Some("rcpt-1".into()),
        captured_at_ms: Some(1700000000000),
        prepared_at: Some(Instant::now()),
        prepared_ttl_ms: 15000,
        origin: Some(Origin::SessionStart),
        state: StatusState::Ready,
        acknowledgment: Acknowledgment::Received,
        baseline_inventory: None,
        baseline_coverage: Some(Coverage {
            state: CoverageState::Complete,
            inventory_complete: true,
            absence_proof_complete: true,
            provenance_entries: 10,
            eligible_entries: 10,
            captured_entries: 10,
            omitted_entries: None,
            raw_bytes: 500,
            reasons: Vec::new(),
        }),
        comparison: None,
        current_revision_manifest: None,
        comparison_revision: 0,
        reason: None,
        original_failed: false,
        active_from_now: None,
        recent_turn_ids: BTreeSet::new(),
        last_settled_turn_id: None,
        dirty_settled_hint: false,
        canonical_root: PathBuf::from("/tmp/repo"),
    };

    {
        let mut recs = service.records.lock();
        recs.insert(key.clone(), record);
    }

    // 1. Terminal exited (process exit / dead status): record remains in service!
    let retained_list = get_retained_session_list(&service, "term-123", "1").unwrap();
    assert_eq!(retained_list.sessions.len(), 1);
    assert_eq!(retained_list.sessions[0].omp_session_id, "omp-session-abc");
    assert_eq!(retained_list.sessions[0].state, StatusState::Ready);

    // 2. Querying different incarnation returns empty list
    let empty_list = get_retained_session_list(&service, "term-123", "2").unwrap();
    assert_eq!(empty_list.sessions.len(), 0);

    // 3. Invalid incarnation returns IncarnationMismatch
    let err = get_retained_session_list(&service, "term-123", "01");
    assert_eq!(err.unwrap_err(), ErrorCode::IncarnationMismatch);

    // 4. Actual metadata removal (TTL sweep / explicit remove_with_expected) releases the record
    service.remove_terminal_records("term-123", "1");

    let after_remove = get_retained_session_list(&service, "term-123", "1").unwrap();
    assert_eq!(after_remove.sessions.len(), 0);
}
