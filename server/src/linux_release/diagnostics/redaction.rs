use std::collections::BTreeMap;
use crate::diagnostics::{redact_diagnostic_fields, redact_diagnostic_text, DiagnosticEvent};
use crate::idle_suspend::audit::{HelperAuditRecord, HelperAuditRecordType};
use crate::idle_suspend::event::{
    validate_canonical_uuid, validate_canonical_uuid_v4, IdleSuspendEventEnvelopeV1,
};
use crate::idle_suspend::protocol::SuspendOutcome;
use crate::idle_suspend::server_audit::{ManualAuditResult, ServerAuditRecord, TimingAuditResult};
use super::model::{
    ProjectedDiagnosticEvent, ProjectedHelperAudit, ProjectedServerAudit, ProjectedServerEvent,
    MAX_REDACTED_STRING_BYTES,
};

pub const RESTRICTED_DETAIL_OMITTED: &str = "restrictedDetailOmitted";

pub fn sanitize_bounded_string(input: &str, max_bytes: usize) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if ch.is_control() && ch != '\n' && ch != '\t' {
            continue;
        }
        if out.len() + ch.len_utf8() > max_bytes {
            break;
        }
        out.push(ch);
    }
    out
}

pub fn validate_safe_executable_identity(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 256 {
        return None;
    }

    if trimmed.contains('\0')
        || trimmed.contains('*')
        || trimmed.contains('?')
        || trimmed.contains('[')
        || trimmed.contains(']')
        || trimmed.contains('{')
        || trimmed.contains('}')
        || trimmed.contains('$')
        || trimmed.contains('&')
        || trimmed.contains('|')
        || trimmed.contains(';')
        || trimmed.contains('<')
        || trimmed.contains('>')
        || trimmed.contains('\\')
        || trimmed.contains('"')
        || trimmed.contains('\'')
        || trimmed.contains('`')
        || trimmed.contains("//")
    {
        return None;
    }

    let is_absolute = trimmed.starts_with('/');
    let parts: Vec<&str> = if is_absolute {
        trimmed.split('/').skip(1).collect()
    } else {
        trimmed.split('/').collect()
    };

    if parts.is_empty() || (!is_absolute && parts.len() > 1) {
        return None;
    }

    if is_absolute && trimmed.ends_with('/') {
        return None;
    }

    for part in &parts {
        if part.is_empty() || *part == "." || *part == ".." {
            return None;
        }
        for b in part.bytes() {
            let is_valid = b.is_ascii_alphanumeric()
                || b == b'_'
                || b == b'-'
                || b == b'.'
                || b == b'+'
                || b == b'@';
            if !is_valid {
                return None;
            }
        }
    }

    let basename = *parts.last()?;
    let generic_interpreters = [
        "sh", "bash", "dash", "zsh", "python", "python3", "node", "ruby", "perl", "php", "env",
        "sudo",
    ];
    if generic_interpreters.contains(&basename) {
        return None;
    }

    Some(trimmed.to_string())
}

pub fn map_helper_detail_to_code(detail: Option<&str>, outcome: Option<&SuspendOutcome>) -> Option<String> {
    if let Some(detail) = detail {
        let lower = detail.to_ascii_lowercase();
        if lower.contains("resumed successfully") || lower.contains("resumed") {
            return Some("resumedSuccessfully".to_string());
        }
        if lower.contains("inhibitor") {
            return Some("inhibitorPresent".to_string());
        }
        if lower.contains("capability") || lower.contains("unsupported") {
            return Some("capabilityUnsupported".to_string());
        }
        if lower.contains("rtc busy") {
            return Some("rtcBusy".to_string());
        }
        if lower.contains("rtc programming") || lower.contains("rtc") {
            return Some("rtcProgrammingFailed".to_string());
        }
        if lower.contains("suspend failed") {
            return Some("suspendFailed".to_string());
        }
        if lower.contains("suspend returned") {
            return Some("suspendReturned".to_string());
        }
        if lower.contains("active fleet") || lower.contains("fleet active") {
            return Some("rejectedFleetActive".to_string());
        }
        return Some(RESTRICTED_DETAIL_OMITTED.to_string());
    }

    if let Some(outcome) = outcome {
        match outcome {
            SuspendOutcome::ResumedSuccessfully { .. } => Some("resumedSuccessfully".to_string()),
            SuspendOutcome::RejectedFleetActive { .. } => Some("rejectedFleetActive".to_string()),
            SuspendOutcome::BlockedByInhibitor { .. } => Some("inhibitorPresent".to_string()),
            SuspendOutcome::UnsupportedCapability { .. } => Some("capabilityUnsupported".to_string()),
            SuspendOutcome::ExecutionFailed { ref error, .. } => {
                let lower = error.to_ascii_lowercase();
                if lower.contains("rtc") {
                    Some("rtcProgrammingFailed".to_string())
                } else if lower.contains("suspend") {
                    Some("suspendFailed".to_string())
                } else {
                    Some(RESTRICTED_DETAIL_OMITTED.to_string())
                }
            }
        }
    } else {
        None
    }
}

pub fn project_server_event(envelope: IdleSuspendEventEnvelopeV1) -> Result<ProjectedServerEvent, String> {
    if envelope.event_schema_version != 1 {
        return Err(format!(
            "Unsupported event schema version: {}",
            envelope.event_schema_version
        ));
    }

    validate_canonical_uuid(&envelope.boot_id)
        .map_err(|e| format!("Invalid bootId UUID: {e}"))?;
    validate_canonical_uuid_v4(&envelope.producer_instance_id)
        .map_err(|e| format!("Invalid producerInstanceId UUID: {e}"))?;

    if let Some(ref corr_id) = envelope.correlation_id {
        validate_canonical_uuid_v4(corr_id)
            .map_err(|e| format!("Invalid correlationId UUID: {e}"))?;
    }

    let event_type_str = envelope.event_type.as_str().to_string();
    let mode_str = envelope.mode.map(|m| match m {
        crate::idle_suspend::event::IdleSuspendModeV1::Automatic => "automatic".to_string(),
        crate::idle_suspend::event::IdleSuspendModeV1::Manual => "manual".to_string(),
    });

    let data_val = serde_json::to_value(&envelope.data)
        .map_err(|e| format!("Failed to serialize event data: {e}"))?;

    Ok(ProjectedServerEvent {
        event_schema_version: envelope.event_schema_version,
        timestamp_ms: envelope.timestamp_ms,
        boot_id: envelope.boot_id,
        producer_instance_id: envelope.producer_instance_id,
        producer_sequence: envelope.producer_sequence,
        event_type: event_type_str,
        correlation_id: envelope.correlation_id,
        mode: mode_str,
        data: data_val,
    })
}

pub fn project_server_audit(record: ServerAuditRecord) -> Result<ProjectedServerAudit, String> {
    match record {
        ServerAuditRecord::Timing(t) => {
            let result_str = match t.result {
                TimingAuditResult::Admitted => "admitted",
                TimingAuditResult::Committed => "committed",
                TimingAuditResult::PersistenceFailed => "persistence_failed",
                TimingAuditResult::RejectedHandoffInProgress => "rejected_handoff_in_progress",
                TimingAuditResult::RejectedDisabled => "rejected_disabled",
                TimingAuditResult::RejectedInvalidInput => "rejected_invalid_input",
            };
            Ok(ProjectedServerAudit {
                timestamp_ms: t.timestamp_ms,
                audit_type: "timing".to_string(),
                action: "update_timing".to_string(),
                correlation_id: None,
                actor_present: !t.actor.is_empty(),
                result: result_str.to_string(),
                reason_code: None,
                wake_after_seconds: Some(t.requested_wake_after_seconds),
                details: Some(format!(
                    "requestedQuiet={},requestedWake={}",
                    t.requested_quiet_period_seconds, t.requested_wake_after_seconds
                )),
            })
        }
        ServerAuditRecord::Manual(m) => {
            let (result_str, reason_code) = match m.result {
                ManualAuditResult::Attempted => ("attempted", None),
                ManualAuditResult::Accepted => ("accepted", None),
                ManualAuditResult::RejectedConfirmationRequired => {
                    ("rejected", Some("confirmation_required"))
                }
                ManualAuditResult::RejectedConflict => ("rejected", Some("conflict")),
                ManualAuditResult::RejectedHandoffInProgress => {
                    ("rejected", Some("handoff_in_progress"))
                }
                ManualAuditResult::RejectedCapability => ("rejected", Some("capability_unsupported")),
                ManualAuditResult::RejectedShuttingDown => ("rejected", Some("shutting_down")),
                ManualAuditResult::RejectedValidation => ("rejected", Some("validation_failed")),
                ManualAuditResult::TerminalOutcome(ref outcome) => match outcome {
                    SuspendOutcome::ResumedSuccessfully { .. } => ("resumed_successfully", None),
                    SuspendOutcome::RejectedFleetActive { .. } => ("rejected", Some("fleet_active")),
                    SuspendOutcome::BlockedByInhibitor { .. } => ("rejected", Some("inhibitor_present")),
                    SuspendOutcome::UnsupportedCapability { .. } => {
                        ("rejected", Some("capability_unsupported"))
                    }
                    SuspendOutcome::ExecutionFailed { .. } => ("execution_failed", Some("execution_failed")),
                },
            };

            let corr_id = if validate_canonical_uuid_v4(&m.request_id).is_ok() {
                Some(m.request_id.clone())
            } else {
                None
            };

            Ok(ProjectedServerAudit {
                timestamp_ms: m.timestamp_ms,
                audit_type: "manual".to_string(),
                action: "force_suspend".to_string(),
                correlation_id: corr_id,
                actor_present: !m.actor.is_empty(),
                result: result_str.to_string(),
                reason_code: reason_code.map(ToString::to_string),
                wake_after_seconds: Some(m.wake_after_seconds),
                details: Some(format!(
                    "generation={},liveCount={},creatingCount={}",
                    m.generation, m.live_count, m.creating_count
                )),
            })
        }
    }
}

pub fn project_helper_audit(record: HelperAuditRecord) -> Result<ProjectedHelperAudit, String> {
    let record_type_str = match record.record_type {
        HelperAuditRecordType::AcceptedIntent => "acceptedIntent",
        HelperAuditRecordType::ExecutionCompleted => "executionCompleted",
        HelperAuditRecordType::ExecutionRejected => "executionRejected",
        HelperAuditRecordType::RequestRejected => "requestRejected",
        HelperAuditRecordType::CapabilityResult => "capabilityResult",
        HelperAuditRecordType::PreflightResult => "preflightResult",
        HelperAuditRecordType::RtcProgrammingResult => "rtcProgrammingResult",
        HelperAuditRecordType::SuspendInvoked => "suspendInvoked",
    };

    let ts = record.timestamp_ms.unwrap_or(record.timestamp_epoch_ms);

    if let Some(ref boot_id) = record.boot_id {
        validate_canonical_uuid(boot_id).map_err(|e| format!("Invalid bootId: {e}"))?;
    }
    if let Some(ref prod_id) = record.producer_instance_id {
        validate_canonical_uuid_v4(prod_id)
            .map_err(|e| format!("Invalid producerInstanceId: {e}"))?;
    }
    let req_id = record.request_id.filter(|id| validate_canonical_uuid_v4(id).is_ok());

    let reason_code = record.reason_code.map(|r| r.as_str().to_string());
    let outcome_code = record.outcome_code.map(|o| o.as_str().to_string());
    let detail_code = map_helper_detail_to_code(record.detail.as_deref(), record.outcome.as_ref());

    Ok(ProjectedHelperAudit {
        audit_schema_version: record.audit_schema_version,
        timestamp_ms: ts,
        record_type: record_type_str.to_string(),
        boot_id: record.boot_id,
        producer_instance_id: record.producer_instance_id,
        producer_sequence: record.producer_sequence,
        request_id: req_id,
        protocol_version: Some(record.protocol_version),
        peer_pid: Some(record.peer_pid),
        peer_uid: Some(record.peer_uid),
        wake_seconds: record.wake_after_seconds,
        reason_code,
        outcome_code,
        detail_code,
    })
}

pub fn project_diagnostic_event(event: DiagnosticEvent) -> Option<ProjectedDiagnosticEvent> {
    let lower_source = event.source.to_ascii_lowercase();
    if lower_source.contains("terminal")
        || lower_source.contains("pty")
        || lower_source.contains("scrollback")
    {
        return None;
    }

    let redacted_message = redact_diagnostic_text(&event.message);
    let bounded_message = sanitize_bounded_string(&redacted_message, MAX_REDACTED_STRING_BYTES);

    let redacted_fields = redact_diagnostic_fields(event.fields);
    let mut bounded_fields = BTreeMap::new();
    for (k, v) in redacted_fields.into_iter().take(32) {
        let clean_k = sanitize_bounded_string(&k, 64);
        let clean_v = sanitize_bounded_string(&v, MAX_REDACTED_STRING_BYTES);
        bounded_fields.insert(clean_k, clean_v);
    }

    Some(ProjectedDiagnosticEvent {
        timestamp_ms: event.timestamp_ms,
        level: sanitize_bounded_string(&event.level, 32),
        source: sanitize_bounded_string(&event.source, 64),
        message: bounded_message,
        fields: bounded_fields,
    })
}
