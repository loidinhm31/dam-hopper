use std::process::ExitCode;
use crate::linux_release::constants::{API_SERVICE_UNIT, HELPER_SERVICE_UNIT};
use crate::linux_release::layout::Layout;
use super::correlation::analyze_correlations;
use super::file_sources::{
    read_backend_diagnostics, read_helper_audit, read_server_audit, read_server_events,
};
use super::host_commands::{
    parse_inhibitors, parse_journal_entries, parse_unit_status, HostCommand, HostCommandRunner,
    ProductionHostCommandRunner,
};
use super::host_probes::{
    query_current_host_probes, CurrentHostProbeReader, ProductionCurrentHostProbeReader,
};
use super::local_api::{
    query_local_idle_status, LocalIdleStatusClient, ProductionLocalIdleStatusClient,
};
use super::output::write_diagnostic_bundle;
use super::model::{
    Applicability, BoundsV1, BundleRequestV1, CollectionStatus, CompletenessStatus,
    DiagnosticBundleV1, HistoricalCompleteness, Historicity, HostMetadataV1, PrivacyManifestV1,
    ProjectedCurrentHostProbes, ProjectedDiagnosticEvent, ProjectedHelperAudit,
    ProjectedJournalEntry, ProjectedServerAudit, ProjectedServerEvent, ProjectedSystemdStatus,
    SourceCoverage, SourceEnvelope, TypedCollectionError, DEFAULT_WINDOW_DURATION_MS,
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

/// Clock seam for deterministic testing.
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> u64;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }
}

/// EUID provider seam for deterministic testing.
pub trait EuidProvider: Send + Sync {
    fn get_euid(&self) -> u32;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemEuidProvider;

impl EuidProvider for SystemEuidProvider {
    fn get_euid(&self) -> u32 {
        crate::linux_release::privilege::current_euid()
    }
}

/// Typed collection adapters encapsulating all environment seams.
pub struct CollectorAdapters<
    C: Clock = SystemClock,
    E: EuidProvider = SystemEuidProvider,
    H: HostCommandRunner = ProductionHostCommandRunner,
    A: LocalIdleStatusClient = ProductionLocalIdleStatusClient,
    P: CurrentHostProbeReader = ProductionCurrentHostProbeReader,
> {
    pub clock: C,
    pub euid: E,
    pub command_runner: H,
    pub api_client: A,
    pub probe_reader: P,
}

impl Default for CollectorAdapters {
    fn default() -> Self {
        Self {
            clock: SystemClock,
            euid: SystemEuidProvider,
            command_runner: ProductionHostCommandRunner,
            api_client: ProductionLocalIdleStatusClient,
            probe_reader: ProductionCurrentHostProbeReader,
        }
    }
}

/// Execute full diagnostic bundle collection across all local sources.
pub async fn collect_diagnostic_bundle<C, E, H, A, P>(
    layout: &Layout,
    adapters: &CollectorAdapters<C, E, H, A, P>,
) -> DiagnosticBundleV1
where
    C: Clock,
    E: EuidProvider,
    H: HostCommandRunner,
    A: LocalIdleStatusClient,
    P: CurrentHostProbeReader,
{
    let generated_at_ms = adapters.clock.now_ms();
    let window_start_ms = generated_at_ms.saturating_sub(DEFAULT_WINDOW_DURATION_MS);
    let coverage = SourceCoverage::new(window_start_ms, generated_at_ms);
    let bundle_id = uuid::Uuid::new_v4().to_string();
    let euid = adapters.euid.get_euid();
    let is_root = euid == 0;

    // Load role from layout.host_config_path()
    let host_config = crate::linux_release::load_host_config(&layout.host_config_path()).ok().flatten();
    let (target_role_str, applicability) = match host_config {
        Some(cfg) => {
            let role = cfg.role;
            let role_str = role.to_string();
            let app = if role.includes_server() {
                Applicability::Applicable
            } else {
                Applicability::NotApplicable
            };
            (Some(role_str), app)
        }
        None => (None, Applicability::Unknown),
    };

    // Host metadata
    let boot_id = std::fs::read_to_string(layout.boot_id_path())
        .ok()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty());

    let kernel_version = std::fs::read_to_string("/proc/sys/kernel/osrelease")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let os_release = std::fs::read_to_string("/etc/os-release")
        .ok()
        .and_then(|text| {
            for line in text.lines() {
                if let Some(val) = line.strip_prefix("PRETTY_NAME=") {
                    return Some(val.trim_matches('"').trim().to_string());
                }
            }
            text.lines().next().map(|s| s.trim().to_string())
        })
        .filter(|s| !s.is_empty());

    let host = HostMetadataV1 {
        boot_id,
        target_role: target_role_str,
        euid,
        is_root,
        kernel_version,
        os_release,
    };

    // 1. Idle status via local API
    let idle_status = query_local_idle_status(
        &adapters.api_client,
        &layout.api_token_path(),
        applicability,
        coverage.clone(),
    )
    .await;

    // 2. Server events
    let mut events = if applicability == Applicability::NotApplicable {
        SourceEnvelope::empty(
            CollectionStatus::NotApplicable,
            Historicity::Historical,
            Applicability::NotApplicable,
            false,
            coverage.clone(),
        )
    } else {
        read_server_events(&layout.server_events_path(), window_start_ms, generated_at_ms, true)
    };
    if applicability == Applicability::Unknown {
        events.applicability = Applicability::Unknown;
    }

    // 3. Server audit
    let mut server_audit = if applicability == Applicability::NotApplicable {
        SourceEnvelope::empty(
            CollectionStatus::NotApplicable,
            Historicity::Historical,
            Applicability::NotApplicable,
            false,
            coverage.clone(),
        )
    } else {
        read_server_audit(&layout.api_audit_path(), window_start_ms, generated_at_ms, true)
    };
    if applicability == Applicability::Unknown {
        server_audit.applicability = Applicability::Unknown;
    }

    // 4. Helper audit
    let mut helper_audit = if applicability == Applicability::NotApplicable {
        SourceEnvelope::empty(
            CollectionStatus::NotApplicable,
            Historicity::Historical,
            Applicability::NotApplicable,
            false,
            coverage.clone(),
        )
    } else if !is_root {
        let mut env = SourceEnvelope::empty(
            CollectionStatus::PermissionDenied,
            Historicity::Historical,
            applicability,
            true,
            coverage.clone(),
        );
        env.errors.push(TypedCollectionError::new(
            "helperAudit",
            "permissionDenied",
            "helper audit requires root privileges",
        ));
        env
    } else {
        read_helper_audit(&layout.helper_audit_path(), window_start_ms, generated_at_ms, true)
    };
    if applicability == Applicability::Unknown {
        helper_audit.applicability = Applicability::Unknown;
    }

    // 5. Backend diagnostics
    let mut diagnostic_events = if applicability == Applicability::NotApplicable {
        SourceEnvelope::empty(
            CollectionStatus::NotApplicable,
            Historicity::Historical,
            Applicability::NotApplicable,
            false,
            coverage.clone(),
        )
    } else {
        read_backend_diagnostics(
            &layout.backend_diagnostics_path(),
            window_start_ms,
            generated_at_ms,
            true,
        )
    };
    if applicability == Applicability::Unknown {
        diagnostic_events.applicability = Applicability::Unknown;
    }

    // 6. Journald
    let journald = if applicability == Applicability::NotApplicable {
        SourceEnvelope::empty(
            CollectionStatus::NotApplicable,
            Historicity::Historical,
            Applicability::NotApplicable,
            false,
            coverage.clone(),
        )
    } else {
        collect_journald(
            &adapters.command_runner,
            window_start_ms,
            applicability,
            coverage.clone(),
        )
        .await
    };

    // 7. Systemd
    let systemd = if applicability == Applicability::NotApplicable {
        SourceEnvelope::empty(
            CollectionStatus::NotApplicable,
            Historicity::Historical,
            Applicability::NotApplicable,
            false,
            coverage.clone(),
        )
    } else {
        collect_systemd(&adapters.command_runner, applicability, coverage.clone()).await
    };

    // 8. Host probes
    let inhibitor_probe = if applicability == Applicability::NotApplicable {
        None
    } else {
        match adapters.command_runner.run(&HostCommand::ListInhibitors).await {
            Ok(out) => Some(parse_inhibitors(&out.stdout)),
            Err(_) => None,
        }
    };

    let current_host_probes = query_current_host_probes(
        &adapters.probe_reader,
        layout,
        applicability,
        inhibitor_probe,
        coverage,
    )
    .await;

    let collector_version = env!("CARGO_PKG_VERSION").to_string();
    let all_errors = Vec::new();

    assemble_bundle(
        bundle_id,
        generated_at_ms,
        collector_version,
        host,
        idle_status,
        events,
        server_audit,
        helper_audit,
        diagnostic_events,
        journald,
        systemd,
        current_host_probes,
        all_errors,
    )
}

async fn collect_journald<H: HostCommandRunner>(
    runner: &H,
    window_start_ms: u64,
    applicability: Applicability,
    coverage: SourceCoverage,
) -> SourceEnvelope<Vec<ProjectedJournalEntry>> {
    let bounds = BoundsV1::default();
    let mut entries = Vec::new();
    let mut malformed_count = 0;
    let mut truncated = false;
    let mut errors = Vec::new();

    let api_cmd = HostCommand::JournalApi {
        since_ms: window_start_ms,
    };
    match runner.run(&api_cmd).await {
        Ok(out) => {
            let (e, m, t) = parse_journal_entries(API_SERVICE_UNIT, &out.stdout, &bounds);
            entries.extend(e);
            malformed_count += m;
            if t {
                truncated = true;
            }
        }
        Err(err) => {
            errors.push(TypedCollectionError::new(
                "journald",
                "apiJournalFailed",
                err.to_string(),
            ));
        }
    }

    let helper_cmd = HostCommand::JournalHelper {
        since_ms: window_start_ms,
    };
    match runner.run(&helper_cmd).await {
        Ok(out) => {
            let (e, m, t) = parse_journal_entries(HELPER_SERVICE_UNIT, &out.stdout, &bounds);
            entries.extend(e);
            malformed_count += m;
            if t {
                truncated = true;
            }
        }
        Err(err) => {
            errors.push(TypedCollectionError::new(
                "journald",
                "helperJournalFailed",
                err.to_string(),
            ));
        }
    }

    // Deterministic sort: (timestamp_ms, unit, boot_id, invocation_id)
    entries.sort_by(|a, b| {
        a.timestamp_ms
            .cmp(&b.timestamp_ms)
            .then_with(|| a.unit.cmp(&b.unit))
            .then_with(|| a.boot_id.cmp(&b.boot_id))
            .then_with(|| a.invocation_id.cmp(&b.invocation_id))
    });

    let status = if errors.len() == 2 {
        CollectionStatus::Missing
    } else if malformed_count > 0 {
        CollectionStatus::Malformed
    } else if truncated {
        CollectionStatus::Truncated
    } else {
        CollectionStatus::Available
    };

    let record_count = entries.len();
    SourceEnvelope {
        collection_status: status,
        historicity: Historicity::Historical,
        applicability,
        required_for_historical_completeness: true,
        record_count,
        byte_count: 0,
        malformed_count,
        truncated,
        retention_limited: false,
        rotation_suspected: false,
        drop_suspected: false,
        coverage,
        errors,
        records: entries,
    }
}

async fn collect_systemd<H: HostCommandRunner>(
    runner: &H,
    applicability: Applicability,
    coverage: SourceCoverage,
) -> SourceEnvelope<ProjectedSystemdStatus> {
    let mut errors = Vec::new();

    let api_unit = match runner.run(&HostCommand::ShowApiUnit).await {
        Ok(out) => parse_unit_status(API_SERVICE_UNIT, &out.stdout).ok(),
        Err(err) => {
            errors.push(TypedCollectionError::new(
                "systemd",
                "apiShowFailed",
                err.to_string(),
            ));
            None
        }
    };

    let helper_unit = match runner.run(&HostCommand::ShowHelperUnit).await {
        Ok(out) => parse_unit_status(HELPER_SERVICE_UNIT, &out.stdout).ok(),
        Err(err) => {
            errors.push(TypedCollectionError::new(
                "systemd",
                "helperShowFailed",
                err.to_string(),
            ));
            None
        }
    };

    let record_count = if api_unit.is_some() { 1 } else { 0 } + if helper_unit.is_some() { 1 } else { 0 };
    let status = if api_unit.is_none() && helper_unit.is_none() {
        CollectionStatus::Missing
    } else {
        CollectionStatus::Available
    };

    SourceEnvelope {
        collection_status: status,
        historicity: Historicity::Historical,
        applicability,
        required_for_historical_completeness: true,
        record_count,
        byte_count: 0,
        malformed_count: 0,
        truncated: false,
        retention_limited: false,
        rotation_suspected: false,
        drop_suspected: false,
        coverage,
        errors,
        records: ProjectedSystemdStatus {
            api_unit,
            helper_unit,
        },
    }
}

/// Run full diagnostic command, write atomic bundle, print path to stdout, and return 0/2/1 exit code.
pub async fn run_diagnose<C, E, H, A, P>(
    layout: &Layout,
    adapters: &CollectorAdapters<C, E, H, A, P>,
) -> ExitCode
where
    C: Clock,
    E: EuidProvider,
    H: HostCommandRunner,
    A: LocalIdleStatusClient,
    P: CurrentHostProbeReader,
{
    let bundle = collect_diagnostic_bundle(layout, adapters).await;
    let json_bytes = match serde_json::to_vec(&bundle) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("diagnose error: failed to serialize diagnostic bundle: {e}");
            return ExitCode::from(1);
        }
    };

    let euid = adapters.euid.get_euid();
    let target_path = match write_diagnostic_bundle(
        layout,
        &bundle.bundle_id,
        bundle.generated_at_ms,
        &json_bytes,
        euid,
    ) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("diagnose error: failed to write diagnostic bundle: {e}");
            return ExitCode::from(1);
        }
    };

    // Stdout is exactly one absolute path plus newline
    println!("{}", target_path.display());

    match bundle.completeness.status {
        CompletenessStatus::Complete => ExitCode::from(0),
        CompletenessStatus::Partial => ExitCode::from(2),
    }
}
