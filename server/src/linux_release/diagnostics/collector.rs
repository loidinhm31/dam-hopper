
use super::correlation::analyze_correlations;
use super::model::{
    BoundsV1, BundleRequestV1, CollectionStatus, CompletenessStatus,
    DiagnosticBundleV1, HistoricalCompleteness, HostMetadataV1, PrivacyManifestV1,
    ProjectedCurrentHostProbes, ProjectedDiagnosticEvent, ProjectedHelperAudit,
    ProjectedJournalEntry, ProjectedServerAudit, ProjectedServerEvent, ProjectedSystemdStatus,
    SourceEnvelope, TypedCollectionError, DEFAULT_WINDOW_DURATION_MS,
    DIAGNOSTIC_BUNDLE_SCHEMA_VERSION, MAX_FINAL_BUNDLE_BYTES,
};

pub fn evaluate_historical_completeness(
    host: &HostMetadataV1,
    events: &SourceEnvelope<Vec<ProjectedServerEvent>>,
    server_audit: &SourceEnvelope<Vec<ProjectedServerAudit>>,
    helper_audit: &SourceEnvelope<Vec<ProjectedHelperAudit>>,
    diagnostic_events: &SourceEnvelope<Vec<ProjectedDiagnosticEvent>>,
    journald: &SourceEnvelope<Vec<ProjectedJournalEntry>>,
    systemd: &SourceEnvelope<ProjectedSystemdStatus>,
    correlations: &super::model::CorrelationsV1,
) -> HistoricalCompleteness {
    let mut reasons = Vec::new();

    let is_web = host
        .target_role
        .as_deref()
        .map(|r| r.eq_ignore_ascii_case("web"))
        .unwrap_or(false);

    let is_server_or_both = host
        .target_role
        .as_deref()
        .map(|r| r.eq_ignore_ascii_case("server") || r.eq_ignore_ascii_case("both"))
        .unwrap_or(false);

    if !is_server_or_both && !is_web {
        reasons.push("unknownHostRole".to_string());
    }

    let check_source = |name: &str,
                        status: CollectionStatus,
                        required: bool,
                        malformed: usize,
                        truncated: bool,
                        retention_limited: bool,
                        coverage_unknown: Option<&str>,
                        reasons: &mut Vec<String>| {
        if !required {
            return;
        }
        if status != CollectionStatus::Available {
            reasons.push(format!("{name}:statusNotAvailable:{status:?}"));
        }
        if malformed > 0 {
            reasons.push(format!("{name}:malformedRecords:{malformed}"));
        }
        if truncated {
            reasons.push(format!("{name}:truncated"));
        }
        if retention_limited {
            reasons.push(format!("{name}:retentionLimited"));
        }
        if let Some(reason) = coverage_unknown {
            reasons.push(format!("{name}:coverageUnknown:{reason}"));
        }
    };

    check_source(
        "serverEvents",
        events.collection_status,
        events.required_for_historical_completeness,
        events.malformed_count,
        events.truncated,
        events.retention_limited,
        events.coverage.coverage_unknown.as_deref(),
        &mut reasons,
    );

    check_source(
        "serverAudit",
        server_audit.collection_status,
        server_audit.required_for_historical_completeness,
        server_audit.malformed_count,
        server_audit.truncated,
        server_audit.retention_limited,
        server_audit.coverage.coverage_unknown.as_deref(),
        &mut reasons,
    );

    check_source(
        "helperAudit",
        helper_audit.collection_status,
        helper_audit.required_for_historical_completeness,
        helper_audit.malformed_count,
        helper_audit.truncated,
        helper_audit.retention_limited,
        helper_audit.coverage.coverage_unknown.as_deref(),
        &mut reasons,
    );

    check_source(
        "diagnosticEvents",
        diagnostic_events.collection_status,
        diagnostic_events.required_for_historical_completeness,
        diagnostic_events.malformed_count,
        diagnostic_events.truncated,
        diagnostic_events.retention_limited,
        diagnostic_events.coverage.coverage_unknown.as_deref(),
        &mut reasons,
    );

    check_source(
        "journald",
        journald.collection_status,
        journald.required_for_historical_completeness,
        journald.malformed_count,
        journald.truncated,
        journald.retention_limited,
        journald.coverage.coverage_unknown.as_deref(),
        &mut reasons,
    );

    check_source(
        "systemd",
        systemd.collection_status,
        systemd.required_for_historical_completeness,
        systemd.malformed_count,
        systemd.truncated,
        systemd.retention_limited,
        systemd.coverage.coverage_unknown.as_deref(),
        &mut reasons,
    );

    if !correlations.sequence_gaps.is_empty() {
        reasons.push(format!(
            "sequenceGapsDetected:{}",
            correlations.sequence_gaps.len()
        ));
    }

    for boundary in &correlations.restart_boundaries {
        if !boundary.unclosed_attempt_ids.is_empty() {
            reasons.push(format!(
                "restartWithUnclosedAttempts:{}",
                boundary.unclosed_attempt_ids.len()
            ));
        }
    }

    let status = if reasons.is_empty() {
        CompletenessStatus::Complete
    } else {
        CompletenessStatus::Partial
    };

    HistoricalCompleteness { status, reasons }
}

#[allow(clippy::too_many_arguments)]
pub fn assemble_bundle(
    bundle_id: String,
    generated_at_ms: u64,
    collector_version: String,
    host: HostMetadataV1,
    idle_status: SourceEnvelope<Option<serde_json::Value>>,
    events: SourceEnvelope<Vec<ProjectedServerEvent>>,
    server_audit: SourceEnvelope<Vec<ProjectedServerAudit>>,
    helper_audit: SourceEnvelope<Vec<ProjectedHelperAudit>>,
    diagnostic_events: SourceEnvelope<Vec<ProjectedDiagnosticEvent>>,
    journald: SourceEnvelope<Vec<ProjectedJournalEntry>>,
    systemd: SourceEnvelope<ProjectedSystemdStatus>,
    current_host_probes: SourceEnvelope<ProjectedCurrentHostProbes>,
    all_errors: Vec<TypedCollectionError>,
) -> DiagnosticBundleV1 {
    let window_start_ms = generated_at_ms.saturating_sub(DEFAULT_WINDOW_DURATION_MS);
    let request = BundleRequestV1 {
        window_start_ms,
        window_end_ms: generated_at_ms,
        effective_scope: "all".to_string(),
    };

    let bounds = BoundsV1::default();
    let privacy = PrivacyManifestV1::default();

    // 1. Initial correlation analysis
    let correlations = analyze_correlations(
        &events.records,
        &server_audit.records,
        &helper_audit.records,
    );

    // 2. Initial completeness
    let completeness = evaluate_historical_completeness(
        &host,
        &events,
        &server_audit,
        &helper_audit,
        &diagnostic_events,
        &journald,
        &systemd,
        &correlations,
    );

    let mut bundle = DiagnosticBundleV1 {
        bundle_schema_version: DIAGNOSTIC_BUNDLE_SCHEMA_VERSION,
        bundle_id,
        generated_at_ms,
        collector_version,
        request,
        completeness,
        bounds: bounds.clone(),
        host,
        idle_status,
        events,
        server_audit,
        helper_audit,
        diagnostic_events,
        journald,
        systemd,
        current_host_probes,
        correlations,
        privacy,
        errors: all_errors,
    };

    // 3. Enforce 8-MiB final bundle cap via whole-record eviction
    reduce_to_cap(&mut bundle);

    bundle
}

fn is_protected_server_endpoint(event_type: &str) -> bool {
    matches!(
        event_type,
        "attemptStarted"
            | "terminalRejected"
            | "reconciliationCompleted"
            | "helperRequestDispatched"
            | "helperOutcomeReceived"
    )
}

fn is_protected_helper_endpoint(record_type: &str) -> bool {
    matches!(
        record_type,
        "acceptedIntent" | "executionCompleted" | "executionRejected"
    )
}

fn reduce_to_cap(bundle: &mut DiagnosticBundleV1) {
    let check_size = |b: &DiagnosticBundleV1| -> usize {
        serde_json::to_vec(b).map(|v| v.len()).unwrap_or(0)
    };

    let mut current_size = check_size(bundle);
    if current_size <= MAX_FINAL_BUNDLE_BYTES {
        return;
    }

    bundle.bounds.truncated = true;

    // Evict whole records in frozen priority order.
    // To prevent O(N^2) full-bundle serializations, drain estimated excess per record
    // and recheck bundle size only when accumulated evicted bytes >= excess.
    while current_size > MAX_FINAL_BUNDLE_BYTES {
        let mut excess = current_size - MAX_FINAL_BUNDLE_BYTES;
        let mut evicted_any = false;

        while excess > 0 {
            let (evicted, est_size) = evict_next_record(bundle);
            if !evicted {
                break;
            }
            evicted_any = true;
            excess = excess.saturating_sub(est_size);
        }

        if !evicted_any {
            break;
        }

        current_size = check_size(bundle);
    }

    // Recompute correlations after all reduction finishes
    bundle.correlations = analyze_correlations(
        &bundle.events.records,
        &bundle.server_audit.records,
        &bundle.helper_audit.records,
    );

    // Recompute completeness after all reduction finishes
    bundle.completeness = evaluate_historical_completeness(
        &bundle.host,
        &bundle.events,
        &bundle.server_audit,
        &bundle.helper_audit,
        &bundle.diagnostic_events,
        &bundle.journald,
        &bundle.systemd,
        &bundle.correlations,
    );
}

fn evict_next_record(bundle: &mut DiagnosticBundleV1) -> (bool, usize) {
    // 1. journald (ancillary)
    if !bundle.journald.records.is_empty() {
        let rec = bundle.journald.records.remove(0);
        bundle.journald.record_count = bundle.journald.records.len();
        bundle.journald.truncated = true;
        let est_size = serde_json::to_vec(&rec).map(|v| v.len() + 1).unwrap_or(64);
        return (true, est_size);
    }
    // 2. diagnostic_events (backend diagnostics)
    if !bundle.diagnostic_events.records.is_empty() {
        let rec = bundle.diagnostic_events.records.remove(0);
        bundle.diagnostic_events.record_count = bundle.diagnostic_events.records.len();
        bundle.diagnostic_events.truncated = true;
        let est_size = serde_json::to_vec(&rec).map(|v| v.len() + 1).unwrap_or(128);
        return (true, est_size);
    }
    // 3. server_audit (compatibility)
    if !bundle.server_audit.records.is_empty() {
        let rec = bundle.server_audit.records.remove(0);
        bundle.server_audit.record_count = bundle.server_audit.records.len();
        bundle.server_audit.truncated = true;
        let est_size = serde_json::to_vec(&rec).map(|v| v.len() + 1).unwrap_or(128);
        return (true, est_size);
    }
    // 4. events (non-endpoint)
    if let Some(pos) = bundle
        .events
        .records
        .iter()
        .position(|ev| !is_protected_server_endpoint(&ev.event_type))
    {
        let rec = bundle.events.records.remove(pos);
        bundle.events.record_count = bundle.events.records.len();
        bundle.events.truncated = true;
        let est_size = serde_json::to_vec(&rec).map(|v| v.len() + 1).unwrap_or(128);
        return (true, est_size);
    }
    // 5. helper_audit (non-endpoint)
    if let Some(pos) = bundle
        .helper_audit
        .records
        .iter()
        .position(|ha| !is_protected_helper_endpoint(&ha.record_type))
    {
        let rec = bundle.helper_audit.records.remove(pos);
        bundle.helper_audit.record_count = bundle.helper_audit.records.len();
        bundle.helper_audit.truncated = true;
        let est_size = serde_json::to_vec(&rec).map(|v| v.len() + 1).unwrap_or(128);
        return (true, est_size);
    }
    // 6. events (endpoints)
    if !bundle.events.records.is_empty() {
        let rec = bundle.events.records.remove(0);
        bundle.events.record_count = bundle.events.records.len();
        bundle.events.truncated = true;
        let est_size = serde_json::to_vec(&rec).map(|v| v.len() + 1).unwrap_or(128);
        return (true, est_size);
    }
    // 7. helper_audit (endpoints)
    if !bundle.helper_audit.records.is_empty() {
        let rec = bundle.helper_audit.records.remove(0);
        bundle.helper_audit.record_count = bundle.helper_audit.records.len();
        bundle.helper_audit.truncated = true;
        let est_size = serde_json::to_vec(&rec).map(|v| v.len() + 1).unwrap_or(128);
        return (true, est_size);
    }

    (false, 0)
}
