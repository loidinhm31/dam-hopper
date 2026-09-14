use std::io::Write;
use tempfile::tempdir;

use dam_hopper_server::idle_suspend::audit::HelperAuditRecord;
use dam_hopper_server::linux_release::diagnostics::{
    collector::{collect_diagnostic_bundle, CollectorAdapters},
    model::{CollectionStatus, MAX_ACCEPTED_RECORDS_PER_SOURCE},
};

use super::fakes::{setup_test_layout, TestClock, TestEuid, TestHostCommandRunner, TestIdleStatusClient, TestProbeReader};

#[tokio::test]
async fn test_fault_matrix_record_caps_and_bounds_enforcement() {
    let tmp = tempdir().unwrap();
    let layout = setup_test_layout(tmp.path(), "server");

    let mut file = std::fs::File::create(&layout.helper_audit_path()).unwrap();
    for i in 0..10_050 {
        let mut rec = HelperAuditRecord::new_intent(
            format!("dddddddd-dddd-4ddd-8ddd-{:012x}", i),
            600,
            1234,
            1000,
        );
        rec.timestamp_epoch_ms = 1726240000000 + (i as u64 * 10);
        rec.timestamp_ms = Some(rec.timestamp_epoch_ms);
        writeln!(file, "{}", serde_json::to_string(&rec).unwrap()).unwrap();
    }
    drop(file);

    let adapters = CollectorAdapters {
        clock: TestClock(1726243210000),
        euid: TestEuid(0),
        command_runner: TestHostCommandRunner::default(),
        api_client: TestIdleStatusClient::default(),
        probe_reader: TestProbeReader::default(),
    };

    let bundle = collect_diagnostic_bundle(&layout, &adapters).await;

    assert_eq!(bundle.helper_audit.records.len(), MAX_ACCEPTED_RECORDS_PER_SOURCE);
    assert_eq!(bundle.helper_audit.record_count, MAX_ACCEPTED_RECORDS_PER_SOURCE);
    assert!(bundle.helper_audit.truncated);
    assert_eq!(bundle.helper_audit.collection_status, CollectionStatus::Truncated);
}
