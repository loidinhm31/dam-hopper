use std::collections::BTreeMap;
use serde::{Deserialize, Serialize};

pub const DIAGNOSTIC_BUNDLE_SCHEMA_VERSION: u32 = 1;
pub const IDLE_SUSPEND_EVENT_SCHEMA_VERSION: u32 = 1;
pub const HELPER_AUDIT_SCHEMA_VERSION: u32 = 2;
pub const HELPER_PROTOCOL_VERSION: u32 = 1;

pub const MAX_ACCEPTED_RECORDS_PER_SOURCE: usize = 10_000;
pub const MAX_FINAL_BUNDLE_BYTES: usize = 8_388_608; // 8 MiB
pub const MAX_JSONL_LINE_BYTES: usize = 16_384; // 16 KiB
pub const MAX_FILE_SCAN_BYTES: usize = 16_777_216; // 16 MiB
pub const MAX_COMMAND_STDOUT_BYTES: usize = 2_097_152; // 2 MiB
pub const MAX_API_BODY_BYTES: usize = 262_144; // 256 KiB
pub const MAX_REDACTED_STRING_BYTES: usize = 512;
pub const MAX_SOURCE_ERRORS: usize = 256;
pub const MAX_WARNING_EXAMPLES: usize = 32;
pub const MAX_RECORD_ARRAY_ITEMS: usize = 10_000;
pub const MAX_SERIALIZED_STRING_BYTES: usize = 512;
pub const MAX_NESTED_DTO_DEPTH: usize = 8;
pub const DEFAULT_WINDOW_DURATION_MS: u64 = 3_600_000; // 60 minutes
pub const COMMAND_DEADLINE_SECONDS: u64 = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CollectionStatus {
    Available,
    Missing,
    PermissionDenied,
    AuthRequired,
    Malformed,
    Truncated,
    RetentionLimited,
    NotApplicable,
    Unsupported,
    IoError,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Historicity {
    Historical,
    Latest,
    NonHistorical,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Applicability {
    Applicable,
    NotApplicable,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompletenessStatus {
    Complete,
    Partial,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceCoverage {
    pub requested_start_ms: u64,
    pub requested_end_ms: u64,
    pub proven_start_ms: Option<u64>,
    pub proven_end_ms: Option<u64>,
    pub coverage_unknown: Option<String>,
}

impl SourceCoverage {
    pub fn new(requested_start_ms: u64, requested_end_ms: u64) -> Self {
        Self {
            requested_start_ms,
            requested_end_ms,
            proven_start_ms: None,
            proven_end_ms: None,
            coverage_unknown: None,
        }
    }

    pub fn with_unknown(requested_start_ms: u64, requested_end_ms: u64, reason: impl Into<String>) -> Self {
        Self {
            requested_start_ms,
            requested_end_ms,
            proven_start_ms: None,
            proven_end_ms: None,
            coverage_unknown: Some(reason.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypedCollectionError {
    pub source: String,
    pub code: String,
    pub message: String,
}

impl TypedCollectionError {
    pub fn new(source: impl Into<String>, code: impl Into<String>, message: impl Into<String>) -> Self {
        let mut msg = message.into();
        if msg.len() > MAX_REDACTED_STRING_BYTES {
            msg.truncate(MAX_REDACTED_STRING_BYTES);
        }
        Self {
            source: source.into(),
            code: code.into(),
            message: msg,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceEnvelope<T> {
    pub collection_status: CollectionStatus,
    pub historicity: Historicity,
    pub applicability: Applicability,
    pub required_for_historical_completeness: bool,
    pub record_count: usize,
    pub byte_count: usize,
    pub malformed_count: usize,
    pub truncated: bool,
    pub retention_limited: bool,
    pub rotation_suspected: bool,
    pub drop_suspected: bool,
    pub coverage: SourceCoverage,
    pub errors: Vec<TypedCollectionError>,
    pub records: T,
}

impl<T: Default> SourceEnvelope<T> {
    pub fn empty(
        status: CollectionStatus,
        historicity: Historicity,
        applicability: Applicability,
        required: bool,
        coverage: SourceCoverage,
    ) -> Self {
        Self {
            collection_status: status,
            historicity,
            applicability,
            required_for_historical_completeness: required,
            record_count: 0,
            byte_count: 0,
            malformed_count: 0,
            truncated: false,
            retention_limited: false,
            rotation_suspected: false,
            drop_suspected: false,
            coverage,
            errors: Vec::new(),
            records: T::default(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundsV1 {
    pub max_records_per_source: usize,
    pub max_final_bundle_bytes: usize,
    pub max_jsonl_line_bytes: usize,
    pub max_file_scan_bytes: usize,
    pub max_command_stdout_bytes: usize,
    pub max_api_body_bytes: usize,
    pub max_redacted_string_bytes: usize,
    pub max_source_errors: usize,
    pub max_warning_examples: usize,
    pub max_record_array_items: usize,
    pub max_serialized_string_bytes: usize,
    pub max_nested_dto_depth: usize,
    pub command_deadline_seconds: u64,
    pub truncated: bool,
}

impl Default for BoundsV1 {
    fn default() -> Self {
        Self {
            max_records_per_source: MAX_ACCEPTED_RECORDS_PER_SOURCE,
            max_final_bundle_bytes: MAX_FINAL_BUNDLE_BYTES,
            max_jsonl_line_bytes: MAX_JSONL_LINE_BYTES,
            max_file_scan_bytes: MAX_FILE_SCAN_BYTES,
            max_command_stdout_bytes: MAX_COMMAND_STDOUT_BYTES,
            max_api_body_bytes: MAX_API_BODY_BYTES,
            max_redacted_string_bytes: MAX_REDACTED_STRING_BYTES,
            max_source_errors: MAX_SOURCE_ERRORS,
            max_warning_examples: MAX_WARNING_EXAMPLES,
            max_record_array_items: MAX_RECORD_ARRAY_ITEMS,
            max_serialized_string_bytes: MAX_SERIALIZED_STRING_BYTES,
            max_nested_dto_depth: MAX_NESTED_DTO_DEPTH,
            command_deadline_seconds: COMMAND_DEADLINE_SECONDS,
            truncated: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalCompleteness {
    pub status: CompletenessStatus,
    pub reasons: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleRequestV1 {
    pub window_start_ms: u64,
    pub window_end_ms: u64,
    pub effective_scope: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostMetadataV1 {
    pub boot_id: Option<String>,
    pub target_role: Option<String>,
    pub euid: u32,
    pub is_root: bool,
    pub kernel_version: Option<String>,
    pub os_release: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyManifestV1 {
    pub redaction_policy_version: u32,
    pub excluded_categories: Vec<String>,
}

impl Default for PrivacyManifestV1 {
    fn default() -> Self {
        Self {
            redaction_policy_version: 1,
            excluded_categories: vec![
                "tokensAndCredentials".to_string(),
                "processArgvAndEnvironment".to_string(),
                "terminalAndPtyBytes".to_string(),
                "rawIpcAndHelperFrames".to_string(),
                "socketAndIpAddresses".to_string(),
                "inhibitorIdentity".to_string(),
                "journalMessageText".to_string(),
                "unboundedStderr".to_string(),
                "serverAuditActors".to_string(),
            ],
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrelatedRecordRefV1 {
    pub source: String,
    pub source_offset: usize,
    pub timestamp_ms: u64,
    pub producer_instance_id: Option<String>,
    pub producer_sequence: Option<u64>,
    pub event_type_or_record_type: String,
    pub correlation_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrelationChainV1 {
    pub correlation_id: String,
    pub mode: Option<String>,
    pub started_at_ms: Option<u64>,
    pub ended_at_ms: Option<u64>,
    pub terminal_reason_code: Option<String>,
    pub outcome_code: Option<String>,
    pub is_open: bool,
    pub record_count: usize,
    pub records: Vec<CorrelatedRecordRefV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceGapV1 {
    pub producer_instance_id: String,
    pub boot_id: Option<String>,
    pub expected_sequence: u64,
    pub actual_sequence: u64,
    pub gap_size: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestartBoundaryV1 {
    pub timestamp_ms: u64,
    pub producer_instance_id: String,
    pub boot_id: Option<String>,
    pub unclosed_attempt_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CorrelationsV1 {
    pub chains: Vec<CorrelationChainV1>,
    pub orphans: Vec<CorrelatedRecordRefV1>,
    pub sequence_gaps: Vec<SequenceGapV1>,
    pub restart_boundaries: Vec<RestartBoundaryV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedServerEvent {
    pub event_schema_version: u32,
    pub timestamp_ms: u64,
    pub boot_id: String,
    pub producer_instance_id: String,
    pub producer_sequence: u64,
    pub event_type: String,
    pub correlation_id: Option<String>,
    pub mode: Option<String>,
    pub data: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedServerAudit {
    pub timestamp_ms: u64,
    pub audit_type: String,
    pub action: String,
    pub correlation_id: Option<String>,
    pub actor_present: bool,
    pub result: String,
    pub reason_code: Option<String>,
    pub wake_after_seconds: Option<u64>,
    pub details: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedHelperAudit {
    pub audit_schema_version: u32,
    pub timestamp_ms: u64,
    pub record_type: String,
    pub boot_id: Option<String>,
    pub producer_instance_id: Option<String>,
    pub producer_sequence: Option<u64>,
    pub request_id: Option<String>,
    pub protocol_version: Option<u32>,
    pub peer_pid: Option<u32>,
    pub peer_uid: Option<u32>,
    pub wake_seconds: Option<u64>,
    pub reason_code: Option<String>,
    pub outcome_code: Option<String>,
    pub detail_code: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedDiagnosticEvent {
    pub timestamp_ms: u64,
    pub level: String,
    pub source: String,
    pub message: String,
    #[serde(default)]
    pub fields: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedJournalEntry {
    pub timestamp_ms: u64,
    pub unit: String,
    pub priority: Option<u32>,
    pub boot_id: Option<String>,
    pub invocation_id: Option<String>,
    pub code_or_result: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UnitStatusV1 {
    pub unit_name: String,
    pub load_state: String,
    pub active_state: String,
    pub sub_state: String,
    pub main_pid: Option<u32>,
    pub exec_main_status: Option<i32>,
    pub invocation_id: Option<String>,
    pub active_enter_timestamp_ms: Option<u64>,
    pub inactive_exit_timestamp_ms: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedSystemdStatus {
    pub api_unit: Option<UnitStatusV1>,
    pub helper_unit: Option<UnitStatusV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RtcWakealarmProbeV1 {
    pub supported: bool,
    pub wakealarm_time: Option<u64>,
    pub now_time: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActiveInhibitorProbeV1 {
    pub count: usize,
    pub delay_inhibited: bool,
    pub block_inhibited: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedCurrentHostProbes {
    pub rtc_wakealarm: Option<RtcWakealarmProbeV1>,
    pub suspend_capabilities: Option<Vec<String>>,
    pub active_inhibitors: Option<ActiveInhibitorProbeV1>,
    pub qualified_executables: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct DiagnosticBundleV1 {
    pub bundle_schema_version: u32,
    pub bundle_id: String,
    pub generated_at_ms: u64,
    pub collector_version: String,
    pub request: BundleRequestV1,
    pub completeness: HistoricalCompleteness,
    pub bounds: BoundsV1,
    pub host: HostMetadataV1,
    pub idle_status: SourceEnvelope<Option<serde_json::Value>>,
    pub events: SourceEnvelope<Vec<ProjectedServerEvent>>,
    pub server_audit: SourceEnvelope<Vec<ProjectedServerAudit>>,
    pub helper_audit: SourceEnvelope<Vec<ProjectedHelperAudit>>,
    pub diagnostic_events: SourceEnvelope<Vec<ProjectedDiagnosticEvent>>,
    pub journald: SourceEnvelope<Vec<ProjectedJournalEntry>>,
    pub systemd: SourceEnvelope<ProjectedSystemdStatus>,
    pub current_host_probes: SourceEnvelope<ProjectedCurrentHostProbes>,
    pub correlations: CorrelationsV1,
    pub privacy: PrivacyManifestV1,
    pub errors: Vec<TypedCollectionError>,
}
