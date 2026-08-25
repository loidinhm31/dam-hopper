use crate::telemetry::types::{
    CodexModel, CodexVersion, SafeIdentifier, TokenCounterSemantic, MAX_DURATION_MS,
    MAX_TIMESTAMP_UTC_MS, MAX_TOKEN_COMPONENT,
};
use opentelemetry_proto::tonic::collector::logs::v1::ExportLogsServiceRequest;
use opentelemetry_proto::tonic::common::v1::{any_value::Value, KeyValue};
use opentelemetry_proto::tonic::logs::v1::LogRecord;
use prost::Message;
use thiserror::Error;

const MAX_OTLP_REQUEST_BYTES: usize = 1024 * 1024;
const CODEX_SSE_EVENT: &str = "codex.sse_event";
const RESPONSE_COMPLETED: &str = "response.completed";
const MAX_RESOURCE_LOGS: usize = 32;
const MAX_SCOPE_LOGS: usize = 64;
const MAX_RECORDS: usize = 1_000;
const MAX_ATTRIBUTES: usize = 64;
const MAX_ATTRIBUTE_STRING_BYTES: usize = 128;
const BASELINE_CODEX_VERSION: &str = "0.145.0";

#[derive(Debug, Error)]
pub enum DecodeError {
    #[error("OTLP request exceeds the configured byte limit")]
    TooLarge,
    #[error("invalid OTLP protobuf")]
    InvalidProtobuf,
    #[error("OTLP request exceeds record limits")]
    TooManyRecords,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenCoverage {
    Full,
    Partial,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimestampStatus {
    Missing,
    Valid,
    Invalid,
}

#[derive(Debug, PartialEq, Eq)]
pub struct DecodedCodexUsage {
    pub occurred_at_utc_ms: Option<i64>,
    pub timestamp_status: TimestampStatus,
    /// A bounded OTLP trace/span identity used only as HMAC input for admitted
    /// events. It is never persisted or returned to callers.
    pub source_identity: Option<Vec<u8>>,
    pub conversation_id: Option<SafeIdentifier>,
    pub model: Option<CodexModel>,
    pub source_version: Option<CodexVersion>,
    pub input_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub duration_ms: Option<u64>,
    /// The baseline fixture proves delta semantics. Newer versions retain the
    /// same semantic only while their allowlisted fields keep this shape.
    pub counter_semantic: TokenCounterSemantic,
    /// Version evidence is not an admission boundary. The receiver reports a
    /// bounded health signal instead of exposing the source value as a label.
    pub unverified_version: bool,
    pub token_coverage: TokenCoverage,
}

pub fn decode_response_completed(bytes: &[u8]) -> Result<Vec<DecodedCodexUsage>, DecodeError> {
    if bytes.len() > MAX_OTLP_REQUEST_BYTES {
        return Err(DecodeError::TooLarge);
    }
    let request =
        ExportLogsServiceRequest::decode(bytes).map_err(|_| DecodeError::InvalidProtobuf)?;
    if request.resource_logs.len() > MAX_RESOURCE_LOGS {
        return Err(DecodeError::TooManyRecords);
    }
    let mut usage = Vec::new();
    let mut records = 0usize;
    for resource_logs in request.resource_logs {
        if resource_logs
            .resource
            .as_ref()
            .is_some_and(|resource| resource.attributes.len() > MAX_ATTRIBUTES)
            || resource_logs.scope_logs.len() > MAX_SCOPE_LOGS
        {
            return Err(DecodeError::TooManyRecords);
        }
        let source_version = resource_logs
            .resource
            .as_ref()
            .and_then(|resource| string_attribute(&resource.attributes, "service.version"))
            .and_then(safe_version);
        for scope_logs in resource_logs.scope_logs {
            for record in scope_logs.log_records {
                records += 1;
                if records > MAX_RECORDS || record.attributes.len() > MAX_ATTRIBUTES {
                    return Err(DecodeError::TooManyRecords);
                }
                if is_response_completed(&record) {
                    let event_version = string_attribute(&record.attributes, "service.version")
                        .and_then(safe_version);
                    let version_disagrees = matches!(
                        (&source_version, &event_version),
                        (Some(resource), Some(event)) if resource != event
                    );
                    let record_version = source_version.clone().or(event_version);
                    let unverified_version = version_disagrees
                        || record_version.as_ref().is_none_or(|version| {
                            String::from(version.clone()) != BASELINE_CODEX_VERSION
                        });
                    if let Some(decoded) =
                        decode_record(&record, record_version, unverified_version)
                    {
                        usage.push(decoded);
                    }
                }
            }
        }
    }
    Ok(usage)
}

fn is_response_completed(record: &LogRecord) -> bool {
    string_attribute(&record.attributes, "event.name") == Some(CODEX_SSE_EVENT)
        && string_attribute(&record.attributes, "event.kind") == Some(RESPONSE_COMPLETED)
}

fn decode_record(
    record: &LogRecord,
    source_version: Option<CodexVersion>,
    unverified_version: bool,
) -> Option<DecodedCodexUsage> {
    let (milliseconds, timestamp_status) = timestamp_millis(record);
    let input_tokens = numeric_attribute(&record.attributes, "input_token_count");
    let cached_input_tokens = numeric_attribute(&record.attributes, "cached_token_count");
    let output_tokens = numeric_attribute(&record.attributes, "output_token_count");
    let reasoning_tokens = numeric_attribute(&record.attributes, "reasoning_token_count");
    let duration_ms = numeric_attribute(&record.attributes, "duration_ms")
        .filter(|value| *value <= MAX_DURATION_MS);
    Some(DecodedCodexUsage {
        occurred_at_utc_ms: milliseconds,
        timestamp_status,
        source_identity: source_identity(record),
        conversation_id: string_attribute(&record.attributes, "conversation.id")
            .and_then(safe_identifier),
        model: string_attribute(&record.attributes, "model").and_then(safe_model),
        source_version,
        input_tokens,
        cached_input_tokens,
        output_tokens,
        reasoning_tokens,
        duration_ms,
        counter_semantic: TokenCounterSemantic::Delta,
        unverified_version,
        token_coverage: token_coverage(
            input_tokens,
            cached_input_tokens,
            output_tokens,
            reasoning_tokens,
        ),
    })
}

fn token_coverage(
    input_tokens: Option<u64>,
    cached_input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
) -> TokenCoverage {
    let components = [
        input_tokens,
        cached_input_tokens,
        output_tokens,
        reasoning_tokens,
    ];
    let available = components.iter().filter(|value| value.is_some()).count();
    match available {
        0 => TokenCoverage::Unavailable,
        4 => TokenCoverage::Full,
        _ => TokenCoverage::Partial,
    }
}

fn timestamp_millis(record: &LogRecord) -> (Option<i64>, TimestampStatus) {
    let nanos = if record.time_unix_nano > 0 {
        Some(record.time_unix_nano)
    } else if record.observed_time_unix_nano > 0 {
        Some(record.observed_time_unix_nano)
    } else {
        None
    };
    if let Some(nanos) = nanos {
        return match bounded_nanos_to_millis(nanos) {
            Some(milliseconds) => (Some(milliseconds), TimestampStatus::Valid),
            None => (None, TimestampStatus::Invalid),
        };
    }

    let Some(attribute) = record
        .attributes
        .iter()
        .find(|attribute| attribute.key == "event.timestamp")
    else {
        return (None, TimestampStatus::Missing);
    };
    let Some(Value::StringValue(value)) = attribute
        .value
        .as_ref()
        .and_then(|value| value.value.as_ref())
    else {
        return (None, TimestampStatus::Invalid);
    };
    if value.len() > MAX_ATTRIBUTE_STRING_BYTES {
        return (None, TimestampStatus::Invalid);
    }
    match chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .and_then(|timestamp| bounded_timestamp(timestamp.timestamp_millis()))
    {
        Some(milliseconds) => (Some(milliseconds), TimestampStatus::Valid),
        None => (None, TimestampStatus::Invalid),
    }
}

fn bounded_nanos_to_millis(nanos: u64) -> Option<i64> {
    bounded_timestamp((nanos / 1_000_000).try_into().ok()?)
}

fn bounded_timestamp(milliseconds: i64) -> Option<i64> {
    (milliseconds > 0 && milliseconds <= MAX_TIMESTAMP_UTC_MS).then_some(milliseconds)
}

fn source_identity(record: &LogRecord) -> Option<Vec<u8>> {
    let valid_trace = record.trace_id.len() == 16 && record.trace_id.iter().any(|byte| *byte != 0);
    let valid_span = record.span_id.len() == 8 && record.span_id.iter().any(|byte| *byte != 0);
    if !valid_trace || !valid_span {
        return None;
    }

    let mut identity = Vec::with_capacity(26);
    identity.push(b't');
    identity.extend_from_slice(&record.trace_id);
    identity.push(b's');
    identity.extend_from_slice(&record.span_id);
    Some(identity)
}

fn safe_identifier(value: &str) -> Option<SafeIdentifier> {
    SafeIdentifier::new(value).ok()
}

fn safe_model(value: &str) -> Option<CodexModel> {
    CodexModel::new(value).ok()
}

fn safe_version(value: &str) -> Option<CodexVersion> {
    CodexVersion::new(value).ok()
}

fn string_attribute<'a>(attributes: &'a [KeyValue], wanted: &str) -> Option<&'a str> {
    attributes.iter().find_map(|attribute| match attribute {
        KeyValue {
            key,
            value: Some(value),
            ..
        } if key == wanted => match value.value.as_ref() {
            Some(Value::StringValue(value)) if value.len() <= MAX_ATTRIBUTE_STRING_BYTES => {
                Some(value.as_str())
            }
            _ => None,
        },
        _ => None,
    })
}

fn numeric_attribute(attributes: &[KeyValue], wanted: &str) -> Option<u64> {
    attributes.iter().find_map(|attribute| match attribute {
        KeyValue {
            key,
            value: Some(value),
            ..
        } if key == wanted => match value.value.as_ref() {
            Some(Value::IntValue(value)) if *value >= 0 => {
                (*value as u64 <= MAX_TOKEN_COMPONENT).then_some(*value as u64)
            }
            Some(Value::StringValue(value)) if value.len() <= MAX_ATTRIBUTE_STRING_BYTES => value
                .parse::<i64>()
                .ok()
                .filter(|value| *value >= 0)
                .map(|value| value as u64)
                .filter(|value| *value <= MAX_TOKEN_COMPONENT),
            _ => None,
        },
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::{decode_response_completed, TimestampStatus};
    use opentelemetry_proto::tonic::collector::logs::v1::ExportLogsServiceRequest;
    use opentelemetry_proto::tonic::common::v1::{any_value::Value, AnyValue, KeyValue};
    use prost::Message;

    #[test]
    fn decodes_the_sanitized_response_completed_fixture() {
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let decoded = decode_response_completed(fixture).unwrap();
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].input_tokens, Some(24_387));
        assert_eq!(decoded[0].output_tokens, Some(7));
        assert_eq!(decoded[0].cached_input_tokens, Some(0));
        assert_eq!(decoded[0].reasoning_tokens, Some(0));
        assert_eq!(
            decoded[0].counter_semantic,
            crate::telemetry::TokenCounterSemantic::Delta
        );
    }

    #[test]
    fn decodes_codex_0146_1_fixture_without_promoting_or_inventing_identity() {
        let fixture = include_bytes!("fixtures/codex-cli-0.146.1-response-completed.bin");
        let decoded = decode_response_completed(fixture).unwrap();
        assert_eq!(decoded.len(), 1);
        let event = &decoded[0];
        assert_eq!(
            event.source_version.clone().map(String::from),
            Some("0.146.1".to_string())
        );
        assert!(event.unverified_version);
        assert_eq!(event.timestamp_status, TimestampStatus::Valid);
        assert_eq!(event.occurred_at_utc_ms, Some(1_786_060_800_000));
        assert!(event.source_identity.is_none());
        assert_eq!(event.input_tokens, Some(24));
        assert_eq!(event.cached_input_tokens, Some(0));
        assert_eq!(event.output_tokens, Some(7));
        assert_eq!(event.reasoning_tokens, Some(0));
        assert_eq!(event.token_coverage, super::TokenCoverage::Full);
    }

    #[test]
    fn reads_optional_response_duration_without_affecting_token_coverage() {
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        request.resource_logs[0].scope_logs[0].log_records[0]
            .attributes
            .push(KeyValue {
                key: "duration_ms".to_string(),
                value: Some(AnyValue {
                    value: Some(Value::IntValue(1_250)),
                }),
                key_strindex: 0,
            });

        let decoded = decode_response_completed(&request.encode_to_vec()).unwrap();
        assert_eq!(decoded[0].duration_ms, Some(1_250));
        assert_eq!(decoded[0].token_coverage, super::TokenCoverage::Full);
    }

    #[test]
    fn ignores_unreasonably_large_response_durations() {
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        request.resource_logs[0].scope_logs[0].log_records[0]
            .attributes
            .push(KeyValue {
                key: "duration_ms".to_string(),
                value: Some(AnyValue {
                    value: Some(Value::IntValue(i64::MAX)),
                }),
                key_strindex: 0,
            });

        let decoded = decode_response_completed(&request.encode_to_vec()).unwrap();
        assert_eq!(decoded[0].duration_ms, None);
    }

    #[test]
    fn unknown_fields_do_not_prevent_known_event_decoding() {
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut bytes = fixture.to_vec();
        bytes.extend_from_slice(&[0xA0, 0x06, 0x01]);
        assert_eq!(decode_response_completed(&bytes).unwrap().len(), 1);
    }

    #[test]
    fn unknown_content_attribute_is_ignored_before_normalization() {
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        request.resource_logs[0].scope_logs[0].log_records[0]
            .attributes
            .push(KeyValue {
                key: "prompt".to_string(),
                value: Some(AnyValue {
                    value: Some(Value::StringValue("fixture-secret".to_string())),
                }),
                key_strindex: 0,
            });
        let decoded = decode_response_completed(&request.encode_to_vec()).unwrap();
        assert_eq!(decoded.len(), 1);
        assert!(crate::telemetry::types::CodexModel::new("fixture secret").is_err());
    }

    #[test]
    fn rejects_records_with_unbounded_attribute_work() {
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        let attributes = &mut request.resource_logs[0].scope_logs[0].log_records[0].attributes;
        for index in 0..64 {
            attributes.push(KeyValue {
                key: format!("ignored-{index}"),
                value: None,
                key_strindex: 0,
            });
        }
        assert!(matches!(
            decode_response_completed(&request.encode_to_vec()),
            Err(super::DecodeError::TooManyRecords)
        ));
    }

    #[test]
    fn accepts_a_newer_version_with_the_baseline_core_shape() {
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        request.resource_logs[0]
            .resource
            .as_mut()
            .unwrap()
            .attributes[0]
            .value = Some(AnyValue {
            value: Some(Value::StringValue("999.0.0".to_string())),
        });
        let decoded = decode_response_completed(&request.encode_to_vec()).unwrap();
        assert_eq!(decoded.len(), 1);
        assert!(decoded[0].unverified_version);
        assert_eq!(decoded[0].token_coverage, super::TokenCoverage::Full);
        assert_eq!(decoded[0].input_tokens, Some(24_387));
    }

    #[test]
    fn preserves_trustworthy_components_when_one_core_field_drifts() {
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        let attributes = &mut request.resource_logs[0].scope_logs[0].log_records[0].attributes;
        let output = attributes
            .iter_mut()
            .find(|attribute| attribute.key == "output_token_count")
            .unwrap();
        output.value = Some(AnyValue {
            value: Some(Value::StringValue("not-a-count".to_string())),
        });

        let decoded = decode_response_completed(&request.encode_to_vec()).unwrap();
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].input_tokens, Some(24_387));
        assert_eq!(decoded[0].output_tokens, None);
        assert_eq!(decoded[0].token_coverage, super::TokenCoverage::Partial);
    }

    #[test]
    fn marks_all_missing_or_invalid_components_unavailable_without_zeroes() {
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        for attribute in &mut request.resource_logs[0].scope_logs[0].log_records[0].attributes {
            if attribute.key.ends_with("token_count") {
                attribute.value = Some(AnyValue {
                    value: Some(Value::StringValue("not-a-count".to_string())),
                });
            }
        }

        let decoded = decode_response_completed(&request.encode_to_vec()).unwrap();
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].input_tokens, None);
        assert_eq!(decoded[0].output_tokens, None);
        assert_eq!(decoded[0].token_coverage, super::TokenCoverage::Unavailable);
    }

    #[test]
    fn fails_closed_for_values_that_overflow_sqlite_storage() {
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        let input = request.resource_logs[0].scope_logs[0].log_records[0]
            .attributes
            .iter_mut()
            .find(|attribute| attribute.key == "input_token_count")
            .unwrap();
        input.value = Some(AnyValue {
            value: Some(Value::StringValue("9223372036854775808".to_string())),
        });

        let decoded = decode_response_completed(&request.encode_to_vec()).unwrap();
        assert_eq!(decoded[0].input_tokens, None);
        assert_eq!(decoded[0].token_coverage, super::TokenCoverage::Partial);
    }

    #[test]
    fn resource_and_event_version_disagreement_is_safe_but_unverified() {
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        request.resource_logs[0].scope_logs[0].log_records[0]
            .attributes
            .push(KeyValue {
                key: "service.version".to_string(),
                value: Some(AnyValue {
                    value: Some(Value::StringValue("999.0.0".to_string())),
                }),
                key_strindex: 0,
            });

        let decoded = decode_response_completed(&request.encode_to_vec()).unwrap();
        assert_eq!(decoded.len(), 1);
        assert!(decoded[0].unverified_version);
        assert_eq!(
            decoded[0]
                .source_version
                .as_ref()
                .map(|version| String::from(version.clone())),
            Some("0.145.0".to_string())
        );
    }
}
