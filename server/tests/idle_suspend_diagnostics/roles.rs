use tempfile::tempdir;

use dam_hopper_server::linux_release::diagnostics::{
    collector::{collect_diagnostic_bundle, CollectorAdapters},
    model::{Applicability, CollectionStatus, CompletenessStatus},
};

use super::fakes::{setup_test_layout, TestClock, TestEuid, TestHostCommandRunner, TestIdleStatusClient, TestProbeReader};

#[tokio::test]
async fn test_fault_matrix_target_role_web_marks_sources_not_applicable() {
    let tmp = tempdir().unwrap();
    let layout = setup_test_layout(tmp.path(), "web");

    let adapters = CollectorAdapters {
        clock: TestClock(1726243210000),
        euid: TestEuid(0),
        command_runner: TestHostCommandRunner::default(),
        api_client: TestIdleStatusClient::default(),
        probe_reader: TestProbeReader::default(),
    };

    let bundle = collect_diagnostic_bundle(&layout, &adapters).await;

    assert_eq!(bundle.events.applicability, Applicability::NotApplicable);
    assert_eq!(bundle.server_audit.applicability, Applicability::NotApplicable);
    assert_eq!(bundle.helper_audit.applicability, Applicability::NotApplicable);
    assert_eq!(bundle.idle_status.applicability, Applicability::NotApplicable);

    assert_eq!(bundle.events.collection_status, CollectionStatus::NotApplicable);
    assert_eq!(bundle.server_audit.collection_status, CollectionStatus::NotApplicable);
    assert_eq!(bundle.helper_audit.collection_status, CollectionStatus::NotApplicable);
}

#[tokio::test]
async fn test_fault_matrix_local_api_auth_and_io_faults() {
    let tmp = tempdir().unwrap();
    let layout = setup_test_layout(tmp.path(), "server");

    let adapters_auth_err = CollectorAdapters {
        clock: TestClock(1726243210000),
        euid: TestEuid(0),
        command_runner: TestHostCommandRunner::default(),
        api_client: TestIdleStatusClient {
            status_code: Some(401),
            response: None,
            error: None,
        },
        probe_reader: TestProbeReader::default(),
    };

    let bundle_auth = collect_diagnostic_bundle(&layout, &adapters_auth_err).await;
    assert_eq!(bundle_auth.idle_status.collection_status, CollectionStatus::AuthRequired);

    let adapters_io_err = CollectorAdapters {
        clock: TestClock(1726243210000),
        euid: TestEuid(0),
        command_runner: TestHostCommandRunner::default(),
        api_client: TestIdleStatusClient {
            status_code: None,
            response: None,
            error: Some("connection refused".to_string()),
        },
        probe_reader: TestProbeReader::default(),
    };

    let bundle_io = collect_diagnostic_bundle(&layout, &adapters_io_err).await;
    assert_eq!(bundle_io.idle_status.collection_status, CollectionStatus::Missing);
}

#[tokio::test]
async fn test_fault_matrix_non_root_euid_marks_helper_permission_denied() {
    let tmp = tempdir().unwrap();
    let layout = setup_test_layout(tmp.path(), "server");

    let adapters = CollectorAdapters {
        clock: TestClock(1726243210000),
        euid: TestEuid(1000),
        command_runner: TestHostCommandRunner::default(),
        api_client: TestIdleStatusClient::default(),
        probe_reader: TestProbeReader::default(),
    };

    let bundle = collect_diagnostic_bundle(&layout, &adapters).await;

    assert_eq!(bundle.helper_audit.collection_status, CollectionStatus::PermissionDenied);
    assert_eq!(bundle.completeness.status, CompletenessStatus::Partial);
    assert!(!bundle.host.is_root);
    assert_eq!(bundle.host.euid, 1000);
}
