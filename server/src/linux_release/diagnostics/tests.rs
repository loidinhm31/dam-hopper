use std::collections::BTreeMap;
use std::fs::File;
use std::io::Write;
use tempfile::tempdir;

use crate::diagnostics::DiagnosticEvent;
use crate::idle_suspend::audit::HelperAuditRecord;
use crate::idle_suspend::server_audit::{ManualAuditRecord, ManualAuditResult, ServerAuditRecord};

use super::collector::assemble_bundle;
use super::correlation::analyze_correlations;
use super::file_sources::{
    read_backend_diagnostics, read_helper_audit, read_server_audit, read_server_events,
    scan_bounded_jsonl_file,
};
use super::model::*;
use super::redaction::{
    map_helper_detail_to_code, project_diagnostic_event, project_helper_audit,
    project_server_audit, validate_safe_executable_identity, RESTRICTED_DETAIL_OMITTED,
};

#[test]
fn test_bundle_model_serialization_and_deny_unknown_fields() {
    let bundle = DiagnosticBundleV1 {
        bundle_schema_version: 1,
        bundle_id: "00000000-0000-4000-8000-000000000001".to_string(),
        generated_at_ms: 1_700_000_000_000,
        collector_version: "0.3.0".to_string(),
        request: BundleRequestV1 {
            window_start_ms: 1_699_996_400_000,
            window_end_ms: 1_700_000_000_000,
            effective_scope: "all".to_string(),
        },
        completeness: HistoricalCompleteness {
            status: CompletenessStatus::Complete,
            reasons: Vec::new(),
        },
        bounds: BoundsV1::default(),
        host: HostMetadataV1 {
            boot_id: Some("00000000-0000-4000-8000-000000000002".to_string()),
            target_role: Some("server".to_string()),
            euid: 0,
            is_root: true,
            kernel_version: Some("6.8.0".to_string()),
            os_release: Some("Fedora 44".to_string()),
        },
        idle_status: SourceEnvelope::empty(
            CollectionStatus::Available,
            Historicity::Latest,
            Applicability::Applicable,
            false,
            SourceCoverage::new(1_699_996_400_000, 1_700_000_000_000),
        ),
        events: SourceEnvelope::empty(
            CollectionStatus::Available,
            Historicity::Historical,
            Applicability::Applicable,
            true,
            SourceCoverage::new(1_699_996_400_000, 1_700_000_000_000),
        ),
        server_audit: SourceEnvelope::empty(
            CollectionStatus::Available,
            Historicity::Historical,
            Applicability::Applicable,
            true,
            SourceCoverage::new(1_699_996_400_000, 1_700_000_000_000),
        ),
        helper_audit: SourceEnvelope::empty(
            CollectionStatus::Available,
            Historicity::Historical,
            Applicability::Applicable,
            true,
            SourceCoverage::new(1_699_996_400_000, 1_700_000_000_000),
        ),
        diagnostic_events: SourceEnvelope::empty(
            CollectionStatus::Available,
            Historicity::Historical,
            Applicability::Applicable,
            true,
            SourceCoverage::new(1_699_996_400_000, 1_700_000_000_000),
        ),
        journald: SourceEnvelope::empty(
            CollectionStatus::Available,
            Historicity::Historical,
            Applicability::Applicable,
            true,
            SourceCoverage::new(1_699_996_400_000, 1_700_000_000_000),
        ),
        systemd: SourceEnvelope::empty(
            CollectionStatus::Available,
            Historicity::Historical,
            Applicability::Applicable,
            true,
            SourceCoverage::new(1_699_996_400_000, 1_700_000_000_000),
        ),
        current_host_probes: SourceEnvelope::empty(
            CollectionStatus::Available,
            Historicity::NonHistorical,
            Applicability::Applicable,
            false,
            SourceCoverage::new(1_699_996_400_000, 1_700_000_000_000),
        ),
        correlations: CorrelationsV1::default(),
        privacy: PrivacyManifestV1::default(),
        errors: Vec::new(),
    };

    let serialized = serde_json::to_string_pretty(&bundle).expect("serialize bundle");
    assert!(serialized.contains("\"bundleSchemaVersion\": 1"));
    assert!(serialized.contains("\"bundleId\": \"00000000-0000-4000-8000-000000000001\""));
    assert!(serialized.contains("\"serverAudit\""));
    assert!(serialized.contains("\"helperAudit\""));

    let deserialized: DiagnosticBundleV1 =
        serde_json::from_str(&serialized).expect("deserialize bundle");
    assert_eq!(deserialized.bundle_id, bundle.bundle_id);

    // Verify deny_unknown_fields
    let mut val: serde_json::Value = serde_json::from_str(&serialized).unwrap();
    val.as_object_mut()
        .unwrap()
        .insert("unexpectedField".to_string(), serde_json::json!("value"));
    let invalid_json = serde_json::to_string(&val).unwrap();
    let err = serde_json::from_str::<DiagnosticBundleV1>(&invalid_json);
    assert!(err.is_err(), "unknown field must be rejected");
}

#[test]
fn test_bounded_file_reader_empty_missing_symlink_not_regular() {
    let dir = tempdir().unwrap();

    // 1. Missing file
    let missing_path = dir.path().join("nonexistent.jsonl");
    let scan_missing = scan_bounded_jsonl_file("test", &missing_path);
    assert_eq!(scan_missing.status, CollectionStatus::Missing);
    assert_eq!(scan_missing.errors[0].code, "fileMissing");

    // 2. Empty file
    let empty_path = dir.path().join("empty.jsonl");
    File::create(&empty_path).unwrap();
    let scan_empty = scan_bounded_jsonl_file("test", &empty_path);
    assert_eq!(scan_empty.status, CollectionStatus::Available);
    assert_eq!(scan_empty.byte_count, 0);
    assert_eq!(scan_empty.lines.len(), 0);

    // 3. Symlink rejected
    #[cfg(unix)]
    {
        let target_path = dir.path().join("target.jsonl");
        File::create(&target_path).unwrap();
        let symlink_path = dir.path().join("symlink.jsonl");
        std::os::unix::fs::symlink(&target_path, &symlink_path).unwrap();

        let scan_symlink = scan_bounded_jsonl_file("test", &symlink_path);
        assert_eq!(scan_symlink.status, CollectionStatus::Unsupported);
        assert_eq!(scan_symlink.errors[0].code, "unsupportedSymlink");
    }

    // 4. Directory is not a regular file
    let sub_dir = dir.path().join("subdir");
    std::fs::create_dir(&sub_dir).unwrap();
    let scan_dir = scan_bounded_jsonl_file("test", &sub_dir);
    assert_eq!(scan_dir.status, CollectionStatus::Unsupported);
    assert_eq!(scan_dir.errors[0].code, "notRegularFile");
}

#[test]
fn test_bounded_file_reader_line_cap_and_malformed() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("events.jsonl");
    let mut f = File::create(&path).unwrap();

    // Line 1: valid line
    writeln!(f, "{{\"valid\": 1}}").unwrap();
    // Line 2: line exceeding 16 KiB
    let huge_line = "a".repeat(17 * 1024);
    writeln!(f, "{}", huge_line).unwrap();
    // Line 3: valid line
    writeln!(f, "{{\"valid\": 2}}").unwrap();
    // Line 4: partial tail without newline
    write!(f, "{{\"partial\": 3}}").unwrap();

    let scan = scan_bounded_jsonl_file("test", &path);
    assert_eq!(scan.status, CollectionStatus::Malformed);
    assert!(scan.malformed_count >= 2);
    assert_eq!(scan.lines.len(), 3); // line 1, line 3, and partial tail
    assert!(scan.errors.iter().any(|e| e.code == "lineExceedsCap"));
    assert!(scan.errors.iter().any(|e| e.code == "partialTail"));
}

#[test]
fn test_safe_executable_identity_validation() {
    assert_eq!(
        validate_safe_executable_identity("dam-hopper"),
        Some("dam-hopper".to_string())
    );
    assert_eq!(
        validate_safe_executable_identity("/usr/bin/dam-hopper-manager"),
        Some("/usr/bin/dam-hopper-manager".to_string())
    );
    assert_eq!(
        validate_safe_executable_identity("service-worker_1.0+beta@host"),
        Some("service-worker_1.0+beta@host".to_string())
    );

    // Generic interpreters rejected
    assert_eq!(validate_safe_executable_identity("bash"), None);
    assert_eq!(validate_safe_executable_identity("sh"), None);
    assert_eq!(validate_safe_executable_identity("python3"), None);
    assert_eq!(validate_safe_executable_identity("/bin/sh"), None);
    assert_eq!(validate_safe_executable_identity("/usr/bin/python"), None);
    assert_eq!(validate_safe_executable_identity("node"), None);

    // Path traversal / shell metacharacters rejected
    assert_eq!(validate_safe_executable_identity("../bin/daemon"), None);
    assert_eq!(validate_safe_executable_identity("/usr/bin/../bin"), None);
    assert_eq!(validate_safe_executable_identity("/trailing/"), None);
    assert_eq!(validate_safe_executable_identity("/double//slash"), None);
    assert_eq!(validate_safe_executable_identity("has space"), None);
    assert_eq!(validate_safe_executable_identity("evil;rm -rf"), None);
    assert_eq!(validate_safe_executable_identity("eval$(whoami)"), None);
    assert_eq!(validate_safe_executable_identity(""), None);
}

#[test]
fn test_privacy_projection_server_audit_and_helper_detail() {
    // 1. Server audit actor is omitted
    let manual_record = ManualAuditRecord::new(
        "secret-operator-admin".to_string(),
        "00000000-0000-4000-8000-000000000001".to_string(),
        120,
        true,
        true,
        1,
        0,
        0,
        0,
        ManualAuditResult::Accepted,
    )
    .unwrap();

    let projected_audit = project_server_audit(ServerAuditRecord::Manual(manual_record)).unwrap();
    assert!(projected_audit.actor_present);
    assert_eq!(projected_audit.correlation_id, Some("00000000-0000-4000-8000-000000000001".to_string()));

    let serialized_audit = serde_json::to_string(&projected_audit).unwrap();
    assert!(!serialized_audit.contains("secret-operator-admin"));

    // 2. Helper audit detail mapped to closed code
    let mut helper_record = HelperAuditRecord::new_intent(
        "00000000-0000-4000-8000-000000000001",
        120,
        1000,
        1000,
    );
    helper_record.detail = Some("Internal sensitive stack trace with password=foo and inhibitor error".to_string());
    let projected_helper = project_helper_audit(helper_record).unwrap();
    assert_eq!(
        projected_helper.detail_code,
        Some("inhibitorPresent".to_string())
    );

    let serialized_helper = serde_json::to_string(&projected_helper).unwrap();
    assert!(!serialized_helper.contains("password=foo"));

    // Unknown detail becomes restrictedDetailOmitted
    assert_eq!(
        map_helper_detail_to_code(Some("Unrecognized proprietary message"), None),
        Some(RESTRICTED_DETAIL_OMITTED.to_string())
    );

    // 3. DiagnosticEvent terminal exclusion and secret redaction
    let term_event = DiagnosticEvent {
        timestamp_ms: 1000,
        level: "INFO".to_string(),
        source: "terminal_scrollback".to_string(),
        message: "user ran cmd".to_string(),
        fields: BTreeMap::new(),
    };
    assert!(project_diagnostic_event(term_event).is_none());

    let backend_event = DiagnosticEvent {
        timestamp_ms: 1000,
        level: "INFO".to_string(),
        source: "api_service".to_string(),
        message: "Authorization: Bearer secret-token-123456 password=hunter2".to_string(),
        fields: BTreeMap::from([("api_key".to_string(), "supersecret".to_string())]),
    };
    let projected_event = project_diagnostic_event(backend_event).unwrap();
    assert!(!projected_event.message.contains("secret-token-123456"));
    assert!(!projected_event.message.contains("hunter2"));
    assert_eq!(projected_event.fields["api_key"], "[REDACTED]");
}

#[test]
fn test_exact_uuid_correlation_chains_and_gaps() {
    let corr_id = "00000000-0000-4000-8000-000000000001".to_string();
    let prod_id = "00000000-0000-4000-8000-000000000002".to_string();
    let boot_id = "00000000-0000-4000-8000-000000000003".to_string();

    let ev1 = ProjectedServerEvent {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: boot_id.clone(),
        producer_instance_id: prod_id.clone(),
        producer_sequence: 1,
        event_type: "coordinatorStarted".to_string(),
        correlation_id: None,
        mode: None,
        data: serde_json::json!({}),
    };

    let ev2 = ProjectedServerEvent {
        event_schema_version: 1,
        timestamp_ms: 1010,
        boot_id: boot_id.clone(),
        producer_instance_id: prod_id.clone(),
        producer_sequence: 2,
        event_type: "attemptStarted".to_string(),
        correlation_id: Some(corr_id.clone()),
        mode: Some("automatic".to_string()),
        data: serde_json::json!({"wakeAfterSeconds": 120}),
    };

    // Notice sequence gap: sequence jumps from 2 to 5!
    let ev3 = ProjectedServerEvent {
        event_schema_version: 1,
        timestamp_ms: 1020,
        boot_id: boot_id.clone(),
        producer_instance_id: prod_id.clone(),
        producer_sequence: 5,
        event_type: "terminalRejected".to_string(),
        correlation_id: Some(corr_id.clone()),
        mode: Some("automatic".to_string()),
        data: serde_json::json!({"reasonCode": "activeFleet"}),
    };

    let helper = ProjectedHelperAudit {
        audit_schema_version: 2,
        timestamp_ms: 1015,
        record_type: "acceptedIntent".to_string(),
        boot_id: Some(boot_id.clone()),
        producer_instance_id: Some(prod_id.clone()),
        producer_sequence: Some(1),
        request_id: Some(corr_id.clone()),
        protocol_version: Some(1),
        peer_pid: Some(100),
        peer_uid: Some(100),
        wake_seconds: Some(120),
        reason_code: None,
        outcome_code: None,
        detail_code: None,
    };

    let correlations = analyze_correlations(&[ev1, ev2, ev3], &[], &[helper]);

    assert_eq!(correlations.chains.len(), 1);
    let chain = &correlations.chains[0];
    assert_eq!(chain.correlation_id, corr_id);
    assert_eq!(chain.terminal_reason_code, Some("activeFleet".to_string()));
    assert!(!chain.is_open);
    assert_eq!(chain.record_count, 3); // attemptStarted, acceptedIntent, terminalRejected

    // Verify sequence gap detected
    assert_eq!(correlations.sequence_gaps.len(), 1);
    assert_eq!(correlations.sequence_gaps[0].gap_size, 2);
    assert_eq!(correlations.sequence_gaps[0].expected_sequence, 3);
    assert_eq!(correlations.sequence_gaps[0].actual_sequence, 5);
}

#[test]
fn test_restart_boundary_detection() {
    let corr_id = "00000000-0000-4000-8000-000000000001".to_string();
    let prod_id_1 = "00000000-0000-4000-8000-000000000002".to_string();
    let prod_id_2 = "00000000-0000-4000-8000-000000000003".to_string();
    let boot_id = "00000000-0000-4000-8000-000000000004".to_string();

    let ev1 = ProjectedServerEvent {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: boot_id.clone(),
        producer_instance_id: prod_id_1.clone(),
        producer_sequence: 1,
        event_type: "coordinatorStarted".to_string(),
        correlation_id: None,
        mode: None,
        data: serde_json::json!({}),
    };

    let ev2 = ProjectedServerEvent {
        event_schema_version: 1,
        timestamp_ms: 1010,
        boot_id: boot_id.clone(),
        producer_instance_id: prod_id_1.clone(),
        producer_sequence: 2,
        event_type: "attemptStarted".to_string(),
        correlation_id: Some(corr_id.clone()),
        mode: Some("automatic".to_string()),
        data: serde_json::json!({}),
    };

    // System restart: new coordinator started with prod_id_2 before corr_id closed!
    let ev3 = ProjectedServerEvent {
        event_schema_version: 1,
        timestamp_ms: 2000,
        boot_id: boot_id.clone(),
        producer_instance_id: prod_id_2.clone(),
        producer_sequence: 1,
        event_type: "coordinatorStarted".to_string(),
        correlation_id: None,
        mode: None,
        data: serde_json::json!({}),
    };

    let correlations = analyze_correlations(&[ev1, ev2, ev3], &[], &[]);
    assert_eq!(correlations.restart_boundaries.len(), 1);
    assert_eq!(
        correlations.restart_boundaries[0].unclosed_attempt_ids,
        vec![corr_id.clone()]
    );
    assert_eq!(
        correlations.restart_boundaries[0].producer_instance_id,
        prod_id_2
    );
}

#[test]
fn test_completeness_and_cap_reduction() {
    let host = HostMetadataV1 {
        boot_id: Some("00000000-0000-4000-8000-000000000001".to_string()),
        target_role: Some("server".to_string()),
        euid: 0,
        is_root: true,
        kernel_version: None,
        os_release: None,
    };

    let idle_status = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Latest,
        Applicability::Applicable,
        false,
        SourceCoverage::new(0, 1000),
    );

    let events = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );

    let server_audit = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );

    let helper_audit = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );

    let diagnostic_events = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );

    let journald = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );

    let systemd = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );

    let current_host_probes = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::NonHistorical,
        Applicability::Applicable,
        false,
        SourceCoverage::new(0, 1000),
    );

    // 1. Initial complete bundle
    let bundle = assemble_bundle(
        "00000000-0000-4000-8000-000000000001".to_string(),
        1000,
        "0.3.0".to_string(),
        host.clone(),
        idle_status.clone(),
        events.clone(),
        server_audit.clone(),
        helper_audit.clone(),
        diagnostic_events.clone(),
        journald.clone(),
        systemd.clone(),
        current_host_probes.clone(),
        Vec::new(),
    );
    assert_eq!(bundle.completeness.status, CompletenessStatus::Complete);
    assert!(bundle.completeness.reasons.is_empty());

    // 2. Missing required source makes completeness Partial
    let mut missing_events = events.clone();
    missing_events.collection_status = CollectionStatus::Missing;
    let partial_bundle = assemble_bundle(
        "00000000-0000-4000-8000-000000000001".to_string(),
        1000,
        "0.3.0".to_string(),
        host.clone(),
        idle_status.clone(),
        missing_events,
        server_audit.clone(),
        helper_audit.clone(),
        diagnostic_events.clone(),
        journald.clone(),
        systemd.clone(),
        current_host_probes.clone(),
        Vec::new(),
    );
    assert_eq!(partial_bundle.completeness.status, CompletenessStatus::Partial);
    assert!(partial_bundle.completeness.reasons.iter().any(|r| r.contains("serverEvents")));

    // 3. Role web makes idle sources not applicable and complete
    let mut web_host = host.clone();
    web_host.target_role = Some("web".to_string());
    let web_bundle = assemble_bundle(
        "00000000-0000-4000-8000-000000000001".to_string(),
        1000,
        "0.3.0".to_string(),
        web_host,
        idle_status,
        events,
        server_audit,
        helper_audit,
        diagnostic_events,
        journald,
        systemd,
        current_host_probes,
        Vec::new(),
    );
    assert_eq!(web_bundle.completeness.status, CompletenessStatus::Complete);
}

#[test]
fn test_source_adapters_decoding_and_coverage() {
    let dir = tempdir().unwrap();

    // 1. read_server_events
    let events_path = dir.path().join("events.jsonl");
    let mut f_ev = File::create(&events_path).unwrap();
    writeln!(
        f_ev,
        r#"{{"eventSchemaVersion":1,"timestampMs":1000,"bootId":"00000000-0000-4000-8000-000000000001","producerInstanceId":"00000000-0000-4000-8000-000000000002","producerSequence":1,"eventType":"coordinatorStarted","correlationId":null,"mode":null,"data":{{"automaticPolicy":"emptyFleet","quietPeriodSeconds":60,"wakeAfterSeconds":120,"timingRevision":1,"statusRevision":1}}}}"#
    )
    .unwrap();

    let ev_env = read_server_events(&events_path, 500, 1500, true);
    assert_eq!(ev_env.collection_status, CollectionStatus::Available);
    assert_eq!(ev_env.record_count, 1);
    assert_eq!(ev_env.records[0].event_type, "coordinatorStarted");
    assert_eq!(ev_env.coverage.proven_start_ms, Some(500));

    // 2. read_server_audit
    let audit_path = dir.path().join("audit.jsonl");
    let mut f_aud = File::create(&audit_path).unwrap();
    writeln!(
        f_aud,
        r#"{{"version":1,"timestampMs":1000,"actor":"admin","requestId":"00000000-0000-4000-8000-000000000003","wakeAfterSeconds":120,"requestedForce":true,"effectiveForce":true,"generation":1,"liveCount":0,"creatingCount":0,"restartPendingCount":0,"result":"accepted"}}"#
    )
    .unwrap();

    let aud_env = read_server_audit(&audit_path, 1000, 1500, true);
    assert_eq!(aud_env.collection_status, CollectionStatus::Available);
    assert_eq!(aud_env.record_count, 1);
    assert!(aud_env.records[0].actor_present);

    // 3. read_helper_audit
    let helper_path = dir.path().join("helper.jsonl");
    let mut f_hlp = File::create(&helper_path).unwrap();
    writeln!(
        f_hlp,
        r#"{{"auditSchemaVersion":2,"recordType":"acceptedIntent","requestId":"00000000-0000-4000-8000-000000000003","protocolVersion":1,"wakeAfterSeconds":120,"peerPid":1000,"peerUid":1000,"timestampEpochMs":1000,"timestampMs":1000,"bootId":"00000000-0000-4000-8000-000000000001","producerInstanceId":"00000000-0000-4000-8000-000000000002","producerSequence":1}}"#
    )
    .unwrap();

    let hlp_env = read_helper_audit(&helper_path, 1000, 1500, true);
    assert_eq!(hlp_env.collection_status, CollectionStatus::Available);
    assert_eq!(hlp_env.record_count, 1);
    assert_eq!(hlp_env.records[0].record_type, "acceptedIntent");

    // 4. read_backend_diagnostics
    let diag_path = dir.path().join("backend-log.jsonl");
    let mut f_diag = File::create(&diag_path).unwrap();
    writeln!(
        f_diag,
        r#"{{"timestampMs":1000,"level":"INFO","source":"idle_suspend","message":"coord started","fields":{{}}}}"#
    )
    .unwrap();

    let diag_env = read_backend_diagnostics(&diag_path, 500, 1500, true);
    assert_eq!(diag_env.collection_status, CollectionStatus::Available);
    assert_eq!(diag_env.record_count, 1);
    assert_eq!(diag_env.records[0].source, "idle_suspend");
}

#[test]
fn test_eviction_cap_reduction_order() {
    let host = HostMetadataV1 {
        boot_id: Some("00000000-0000-4000-8000-000000000001".to_string()),
        target_role: Some("server".to_string()),
        euid: 0,
        is_root: true,
        kernel_version: None,
        os_release: None,
    };

    let idle_status = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Latest,
        Applicability::Applicable,
        false,
        SourceCoverage::new(0, 1000),
    );

    let mut events: SourceEnvelope<Vec<ProjectedServerEvent>> = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );
    // Add an endpoint and a non-endpoint
    events.records.push(ProjectedServerEvent {
        event_schema_version: 1,
        timestamp_ms: 100,
        boot_id: "00000000-0000-4000-8000-000000000001".to_string(),
        producer_instance_id: "00000000-0000-4000-8000-000000000002".to_string(),
        producer_sequence: 1,
        event_type: "attemptStarted".to_string(), // endpoint
        correlation_id: Some("00000000-0000-4000-8000-000000000003".to_string()),
        mode: Some("automatic".to_string()),
        data: serde_json::json!({}),
    });
    events.records.push(ProjectedServerEvent {
        event_schema_version: 1,
        timestamp_ms: 110,
        boot_id: "00000000-0000-4000-8000-000000000001".to_string(),
        producer_instance_id: "00000000-0000-4000-8000-000000000002".to_string(),
        producer_sequence: 2,
        event_type: "armStarted".to_string(), // non-endpoint
        correlation_id: Some("00000000-0000-4000-8000-000000000003".to_string()),
        mode: Some("automatic".to_string()),
        data: serde_json::json!({}),
    });
    events.record_count = events.records.len();

    let mut journald: SourceEnvelope<Vec<ProjectedJournalEntry>> = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );
    journald.records.push(ProjectedJournalEntry {
        timestamp_ms: 50,
        unit: "dam-hopper-api.service".to_string(),
        priority: Some(6),
        boot_id: None,
        invocation_id: None,
        code_or_result: None,
    });
    journald.record_count = journald.records.len();

    let server_audit = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );
    let helper_audit = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );
    let diagnostic_events = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );
    let systemd = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );
    let current_host_probes = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::NonHistorical,
        Applicability::Applicable,
        false,
        SourceCoverage::new(0, 1000),
    );

    let bundle = assemble_bundle(
        "00000000-0000-4000-8000-000000000001".to_string(),
        1000,
        "0.3.0".to_string(),
        host,
        idle_status,
        events,
        server_audit,
        helper_audit,
        diagnostic_events,
        journald,
        systemd,
        current_host_probes,
        Vec::new(),
    );

    assert!(bundle.events.records.len() >= 1);
}

#[test]
fn test_source_file_immutability() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("immutable.jsonl");
    let content = r#"{"eventSchemaVersion":1,"timestampMs":1000,"bootId":"00000000-0000-4000-8000-000000000001","producerInstanceId":"00000000-0000-4000-8000-000000000002","producerSequence":1,"eventType":"coordinatorStarted","correlationId":null,"mode":null,"data":{"automaticPolicy":"emptyFleet","quietPeriodSeconds":60,"wakeAfterSeconds":120,"timingRevision":1,"statusRevision":1}}"#;
    std::fs::write(&path, content).unwrap();

    let before_meta = std::fs::metadata(&path).unwrap();
    let before_bytes = std::fs::read(&path).unwrap();

    let _env = read_server_events(&path, 500, 1500, true);

    let after_meta = std::fs::metadata(&path).unwrap();
    let after_bytes = std::fs::read(&path).unwrap();

    assert_eq!(before_bytes, after_bytes);
    assert_eq!(before_meta.len(), after_meta.len());
    assert_eq!(before_meta.permissions(), after_meta.permissions());
}

#[test]
fn test_source_adapters_unknown_schema_and_invalid_uuid() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("invalid.jsonl");
    let mut f = File::create(&path).unwrap();

    // Line 1: unknown schema version
    writeln!(
        f,
        r#"{{"eventSchemaVersion":99,"timestampMs":1000,"bootId":"00000000-0000-4000-8000-000000000001","producerInstanceId":"00000000-0000-4000-8000-000000000002","producerSequence":1,"eventType":"coordinatorStarted","correlationId":null,"mode":null,"data":{{"automaticPolicy":"emptyFleet","quietPeriodSeconds":60,"wakeAfterSeconds":120,"timingRevision":1,"statusRevision":1}}}}"#
    )
    .unwrap();

    // Line 2: invalid boot ID (not UUID)
    writeln!(
        f,
        r#"{{"eventSchemaVersion":1,"timestampMs":1001,"bootId":"not-a-uuid","producerInstanceId":"00000000-0000-4000-8000-000000000002","producerSequence":2,"eventType":"coordinatorStarted","correlationId":null,"mode":null,"data":{{"automaticPolicy":"emptyFleet","quietPeriodSeconds":60,"wakeAfterSeconds":120,"timingRevision":1,"statusRevision":1}}}}"#
    )
    .unwrap();

    let env = read_server_events(&path, 500, 1500, true);
    assert_eq!(env.collection_status, CollectionStatus::Malformed);
    assert!(env.errors.iter().any(|e| e.message.contains("Invalid schema version")));
    assert!(env.errors.iter().any(|e| e.message.contains("Invalid UUID") || e.message.contains("Invalid bootId")));
}

#[test]
fn test_eviction_exceeding_max_bytes() {
    let host = HostMetadataV1 {
        boot_id: Some("00000000-0000-4000-8000-000000000001".to_string()),
        target_role: Some("server".to_string()),
        euid: 0,
        is_root: true,
        kernel_version: None,
        os_release: None,
    };

    let idle_status = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Latest,
        Applicability::Applicable,
        false,
        SourceCoverage::new(0, 1000),
    );

    let mut events: SourceEnvelope<Vec<ProjectedServerEvent>> = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );
    events.records.push(ProjectedServerEvent {
        event_schema_version: 1,
        timestamp_ms: 100,
        boot_id: "00000000-0000-4000-8000-000000000001".to_string(),
        producer_instance_id: "00000000-0000-4000-8000-000000000002".to_string(),
        producer_sequence: 1,
        event_type: "attemptStarted".to_string(),
        correlation_id: Some("00000000-0000-4000-8000-000000000003".to_string()),
        mode: Some("automatic".to_string()),
        data: serde_json::json!({}),
    });
    events.record_count = 1;

    let mut diagnostic_events: SourceEnvelope<Vec<ProjectedDiagnosticEvent>> = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );
    let large_field = "x".repeat(10_000);
    for i in 0..900 {
        let mut fields = BTreeMap::new();
        fields.insert("payload".to_string(), large_field.clone());
        diagnostic_events.records.push(ProjectedDiagnosticEvent {
            timestamp_ms: 100 + i as u64,
            level: "INFO".to_string(),
            source: "backend".to_string(),
            message: format!("large message {i}"),
            fields,
        });
    }
    diagnostic_events.record_count = diagnostic_events.records.len();

    let server_audit = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );
    let helper_audit = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );
    let journald = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );
    let systemd = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::Historical,
        Applicability::Applicable,
        true,
        SourceCoverage::new(0, 1000),
    );
    let current_host_probes = SourceEnvelope::empty(
        CollectionStatus::Available,
        Historicity::NonHistorical,
        Applicability::Applicable,
        false,
        SourceCoverage::new(0, 1000),
    );

    let bundle = assemble_bundle(
        "00000000-0000-4000-8000-000000000001".to_string(),
        1000,
        "0.3.0".to_string(),
        host,
        idle_status,
        events,
        server_audit,
        helper_audit,
        diagnostic_events,
        journald,
        systemd,
        current_host_probes,
        Vec::new(),
    );

    // Assert size is reduced to <= 8 MiB
    let serialized = serde_json::to_vec(&bundle).unwrap();
    assert!(serialized.len() <= MAX_FINAL_BUNDLE_BYTES);
    assert!(bundle.bounds.truncated);
    assert!(bundle.diagnostic_events.truncated);
    assert!(bundle.diagnostic_events.records.len() < 900);
    assert_eq!(bundle.events.records.len(), 1);
    assert_eq!(bundle.events.records[0].event_type, "attemptStarted");
}

#[test]
fn test_bounded_file_reader_discard_line_without_unbounded_allocation() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("huge_line.jsonl");
    let mut f = File::create(&path).unwrap();

    // Line 1: 100 KiB of 'A' with no newline
    let huge_line = "A".repeat(100 * 1024);
    writeln!(f, "{huge_line}").unwrap();
    // Line 2: valid record
    writeln!(
        f,
        r#"{{"eventSchemaVersion":1,"timestampMs":1000,"bootId":"00000000-0000-4000-8000-000000000001","producerInstanceId":"00000000-0000-4000-8000-000000000002","producerSequence":1,"eventType":"coordinatorStarted","correlationId":null,"mode":null,"data":{{"automaticPolicy":"emptyFleet","quietPeriodSeconds":60,"wakeAfterSeconds":120,"timingRevision":1,"statusRevision":1}}}}"#
    )
    .unwrap();

    let env = read_server_events(&path, 500, 1500, true);
    assert_eq!(env.collection_status, CollectionStatus::Malformed);
    assert_eq!(env.record_count, 1);
    assert_eq!(env.malformed_count, 1);
    assert!(env.errors.iter().any(|e| e.code == "lineExceedsCap"));
    assert_eq!(env.records[0].event_type, "coordinatorStarted");
}

#[test]
fn test_orphan_helper_chain_without_attempt_started() {
    let corr_id = "00000000-0000-4000-8000-000000000001".to_string();
    let prod_id = "00000000-0000-4000-8000-000000000002".to_string();
    let boot_id = "00000000-0000-4000-8000-000000000003".to_string();

    // Multi-record helper chain with NO coordinator attemptStarted
    let h1 = ProjectedHelperAudit {
        audit_schema_version: 2,
        timestamp_ms: 1000,
        record_type: "acceptedIntent".to_string(),
        boot_id: Some(boot_id.clone()),
        producer_instance_id: Some(prod_id.clone()),
        producer_sequence: Some(1),
        request_id: Some(corr_id.clone()),
        protocol_version: Some(1),
        peer_pid: Some(100),
        peer_uid: Some(100),
        wake_seconds: Some(120),
        reason_code: None,
        outcome_code: None,
        detail_code: None,
    };
    let h2 = ProjectedHelperAudit {
        audit_schema_version: 2,
        timestamp_ms: 1010,
        record_type: "executionCompleted".to_string(),
        boot_id: Some(boot_id.clone()),
        producer_instance_id: Some(prod_id.clone()),
        producer_sequence: Some(2),
        request_id: Some(corr_id.clone()),
        protocol_version: Some(1),
        peer_pid: Some(100),
        peer_uid: Some(100),
        wake_seconds: Some(120),
        reason_code: None,
        outcome_code: Some("resumedSuccessfully".to_string()),
        detail_code: None,
    };

    let correlations = analyze_correlations(&[], &[], &[h1, h2]);
    // Must be classified as orphans, NOT valid chains!
    assert_eq!(correlations.chains.len(), 0);
    assert_eq!(correlations.orphans.len(), 2);
    assert!(correlations.orphans.iter().all(|o| o.correlation_id == Some(corr_id.clone())));
}

#[test]
fn test_duplicate_sequence_detection() {
    let prod_id = "00000000-0000-4000-8000-000000000002".to_string();
    let boot_id = "00000000-0000-4000-8000-000000000003".to_string();

    let ev1 = ProjectedServerEvent {
        event_schema_version: 1,
        timestamp_ms: 1000,
        boot_id: boot_id.clone(),
        producer_instance_id: prod_id.clone(),
        producer_sequence: 1,
        event_type: "coordinatorStarted".to_string(),
        correlation_id: None,
        mode: None,
        data: serde_json::json!({}),
    };
    // Duplicate sequence: 1 again!
    let ev2 = ProjectedServerEvent {
        event_schema_version: 1,
        timestamp_ms: 1010,
        boot_id: boot_id.clone(),
        producer_instance_id: prod_id.clone(),
        producer_sequence: 1,
        event_type: "coordinatorStarted".to_string(),
        correlation_id: None,
        mode: None,
        data: serde_json::json!({}),
    };

    let correlations = analyze_correlations(&[ev1, ev2], &[], &[]);
    assert_eq!(correlations.sequence_gaps.len(), 1);
    assert_eq!(correlations.sequence_gaps[0].actual_sequence, 1);
    assert_eq!(correlations.sequence_gaps[0].expected_sequence, 2);
    assert_eq!(correlations.sequence_gaps[0].gap_size, 0);
}
