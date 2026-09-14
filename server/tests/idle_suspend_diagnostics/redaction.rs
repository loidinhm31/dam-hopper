use tempfile::tempdir;

use dam_hopper_server::idle_suspend::audit::HelperAuditRecord;
use dam_hopper_server::linux_release::diagnostics::collector::{collect_diagnostic_bundle, CollectorAdapters};

use super::fakes::{setup_test_layout, TestClock, TestEuid, TestHostCommandRunner, TestIdleStatusClient, TestProbeReader};

#[tokio::test]
async fn test_fault_matrix_redaction_corpus_exclusion() {
    let tmp = tempdir().unwrap();
    let layout = setup_test_layout(tmp.path(), "server");

    let forbidden_jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0";
    let forbidden_bearer = "Bearer token-secret-xyz-987";
    let forbidden_cookie = "damhopper-auth=super-secret-session-cookie-val";
    let forbidden_pass = "topsecretpassphrase123";
    let forbidden_ansi = "\x1b[31mCriticalRedAlert\x1b[0m";

    let mut helper_rec = HelperAuditRecord::new_intent(
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        600,
        1234,
        1000,
    );
    helper_rec.timestamp_epoch_ms = 1726243200000;
    helper_rec.timestamp_ms = Some(1726243200000);
    helper_rec.detail = Some(format!("Error with {forbidden_jwt} and {forbidden_bearer} and {forbidden_pass}"));
    std::fs::write(&layout.helper_audit_path(), format!("{}\n", serde_json::to_string(&helper_rec).unwrap())).unwrap();

    let diag_rec = serde_json::json!({
        "timestampMs": 1726243200000u64,
        "level": "INFO",
        "target": "server::auth",
        "message": format!("User authenticated with {forbidden_cookie} and {forbidden_ansi}"),
        "properties": {
            "token": forbidden_jwt,
            "pass": forbidden_pass
        }
    });
    std::fs::write(&layout.backend_diagnostics_path(), format!("{}\n", diag_rec)).unwrap();

    let adapters = CollectorAdapters {
        clock: TestClock(1726243210000),
        euid: TestEuid(0),
        command_runner: TestHostCommandRunner::default(),
        api_client: TestIdleStatusClient::default(),
        probe_reader: TestProbeReader::default(),
    };

    let bundle = collect_diagnostic_bundle(&layout, &adapters).await;
    let serialized_bundle_bytes = serde_json::to_vec(&bundle).expect("serialize bundle");
    let serialized_str = String::from_utf8_lossy(&serialized_bundle_bytes);

    assert!(!serialized_str.contains(forbidden_jwt), "Must not contain JWT secret");
    assert!(!serialized_str.contains(forbidden_bearer), "Must not contain bearer token");
    assert!(!serialized_str.contains(forbidden_cookie), "Must not contain auth cookie");
    assert!(!serialized_str.contains(forbidden_pass), "Must not contain passphrase");
    assert!(!serialized_str.contains(forbidden_ansi), "Must not contain raw ANSI terminal escapes");
}
