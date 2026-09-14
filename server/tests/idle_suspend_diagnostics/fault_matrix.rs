use tempfile::tempdir;

use dam_hopper_server::linux_release::diagnostics::{
    collector::{collect_diagnostic_bundle, CollectorAdapters},
    model::{CollectionStatus, CompletenessStatus},
};

use super::fakes::{setup_test_layout, TestClock, TestEuid, TestHostCommandRunner, TestIdleStatusClient, TestProbeReader};

#[tokio::test]
async fn test_fault_matrix_malformed_middle_and_tail_recovery() {
    let tmp = tempdir().unwrap();
    let layout = setup_test_layout(tmp.path(), "server");

    let valid_event_1 = serde_json::json!({
        "eventSchemaVersion": 1,
        "timestampMs": 1726243200000u64,
        "bootId": "00000000-0000-4000-8000-000000000001",
        "producerInstanceId": "00000000-0000-4000-8000-000000000002",
        "producerSequence": 1,
        "eventType": "coordinatorStarted",
        "correlationId": null,
        "mode": null,
        "data": {
            "automaticPolicy": "emptyFleet",
            "quietPeriodSeconds": 300,
            "wakeAfterSeconds": 600,
            "timingRevision": 1,
            "statusRevision": 1
        }
    });

    let valid_event_3 = serde_json::json!({
        "eventSchemaVersion": 1,
        "timestampMs": 1726243205000u64,
        "bootId": "00000000-0000-4000-8000-000000000001",
        "producerInstanceId": "00000000-0000-4000-8000-000000000002",
        "producerSequence": 2,
        "eventType": "attemptStarted",
        "correlationId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "mode": "automatic",
        "data": {
            "fleetGeneration": 1,
            "activityRevision": null,
            "timingRevision": 1,
            "statusRevision": 1,
            "wakeAfterSeconds": 600
        }
    });

    let corrupt_content = format!(
        "{}\n{{\"eventSchemaVersion\":1,\"corrupt_middle\":true\n{}\n{{\"partial_tail\":",
        valid_event_1, valid_event_3
    );
    std::fs::write(&layout.server_events_path(), corrupt_content).unwrap();

    let adapters = CollectorAdapters {
        clock: TestClock(1726243210000),
        euid: TestEuid(0),
        command_runner: TestHostCommandRunner::default(),
        api_client: TestIdleStatusClient::default(),
        probe_reader: TestProbeReader::default(),
    };

    let bundle = collect_diagnostic_bundle(&layout, &adapters).await;

    assert_eq!(bundle.events.collection_status, CollectionStatus::Malformed);
    assert_eq!(bundle.events.record_count, 2);
    assert_eq!(bundle.events.records.len(), 2);
    assert_eq!(bundle.completeness.status, CompletenessStatus::Partial);
    let reasons_str = bundle.completeness.reasons.join("; ");
    assert!(reasons_str.contains("serverEvents") || reasons_str.contains("malformed"));
}

#[tokio::test]
async fn test_fault_matrix_unknown_schema_version_and_sequence_gaps() {
    let tmp = tempdir().unwrap();
    let layout = setup_test_layout(tmp.path(), "server");

    let event_seq_1 = serde_json::json!({
        "eventSchemaVersion": 1,
        "timestampMs": 1726243200000u64,
        "bootId": "00000000-0000-4000-8000-000000000001",
        "producerInstanceId": "00000000-0000-4000-8000-000000000002",
        "producerSequence": 1,
        "eventType": "coordinatorStarted",
        "correlationId": null,
        "mode": null,
        "data": {
            "automaticPolicy": "emptyFleet",
            "quietPeriodSeconds": 300,
            "wakeAfterSeconds": 600,
            "timingRevision": 1,
            "statusRevision": 1
        }
    });

    let event_seq_2_bad_ver = serde_json::json!({
        "eventSchemaVersion": 999,
        "timestampMs": 1726243201000u64,
        "bootId": "00000000-0000-4000-8000-000000000001",
        "producerInstanceId": "00000000-0000-4000-8000-000000000002",
        "producerSequence": 2,
        "eventType": "coordinatorStarted",
        "correlationId": null,
        "mode": null,
        "data": {
            "automaticPolicy": "emptyFleet",
            "quietPeriodSeconds": 300,
            "wakeAfterSeconds": 600,
            "timingRevision": 1,
            "statusRevision": 1
        }
    });

    let event_seq_5 = serde_json::json!({
        "eventSchemaVersion": 1,
        "timestampMs": 1726243205000u64,
        "bootId": "00000000-0000-4000-8000-000000000001",
        "producerInstanceId": "00000000-0000-4000-8000-000000000002",
        "producerSequence": 5,
        "eventType": "attemptStarted",
        "correlationId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "mode": "automatic",
        "data": {
            "fleetGeneration": 1,
            "activityRevision": null,
            "timingRevision": 1,
            "statusRevision": 1,
            "wakeAfterSeconds": 600
        }
    });

    let content = format!("{}\n{}\n{}\n", event_seq_1, event_seq_2_bad_ver, event_seq_5);
    std::fs::write(&layout.server_events_path(), content).unwrap();

    let adapters = CollectorAdapters {
        clock: TestClock(1726243210000),
        euid: TestEuid(0),
        command_runner: TestHostCommandRunner::default(),
        api_client: TestIdleStatusClient::default(),
        probe_reader: TestProbeReader::default(),
    };

    let bundle = collect_diagnostic_bundle(&layout, &adapters).await;

    assert_eq!(bundle.events.collection_status, CollectionStatus::Malformed);
    assert_eq!(bundle.events.record_count, 2);
    assert_eq!(bundle.completeness.status, CompletenessStatus::Partial);
}
