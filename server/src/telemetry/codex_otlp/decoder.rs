use crate::telemetry::types::{CodexModel, CodexVersion, SafeIdentifier};
use opentelemetry_proto::tonic::collector::logs::v1::ExportLogsServiceRequest;
use opentelemetry_proto::tonic::common::v1::{any_value::Value, KeyValue};
use opentelemetry_proto::tonic::logs::v1::LogRecord;
use prost::Message;
use thiserror::Error;

const MAX_OTLP_REQUEST_BYTES: usize = 1024 * 1024;
const CODEX_SSE_EVENT: &str = "codex.sse_event";
const RESPONSE_COMPLETED: &str = "response.completed";

#[derive(Debug, Error)]
pub enum DecodeError {
    #[error("OTLP request exceeds the configured byte limit")]
    TooLarge,
    #[error("invalid OTLP protobuf")]
    InvalidProtobuf,
}

#[derive(Debug, PartialEq, Eq)]
pub struct DecodedCodexUsage {
    pub occurred_at_utc_ms: Option<i64>,
    pub conversation_id: Option<SafeIdentifier>,
    pub model: Option<CodexModel>,
    pub source_version: Option<CodexVersion>,
    pub input_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
}

pub fn decode_response_completed(bytes: &[u8]) -> Result<Vec<DecodedCodexUsage>, DecodeError> {
    if bytes.len() > MAX_OTLP_REQUEST_BYTES {
        return Err(DecodeError::TooLarge);
    }
    let request =
        ExportLogsServiceRequest::decode(bytes).map_err(|_| DecodeError::InvalidProtobuf)?;
    let mut usage = Vec::new();
    for resource_logs in request.resource_logs {
        let source_version = resource_logs
            .resource
            .as_ref()
            .and_then(|resource| string_attribute(&resource.attributes, "service.version"))
            .and_then(safe_version);
        for scope_logs in resource_logs.scope_logs {
            for record in scope_logs.log_records {
                if is_response_completed(&record) {
                    if let Some(decoded) = decode_record(&record, source_version.clone()) {
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
) -> Option<DecodedCodexUsage> {
    let milliseconds = timestamp_millis(record);
    Some(DecodedCodexUsage {
        occurred_at_utc_ms: milliseconds,
        conversation_id: string_attribute(&record.attributes, "conversation.id")
            .and_then(safe_identifier),
        model: string_attribute(&record.attributes, "model").and_then(safe_model),
        source_version,
        input_tokens: numeric_attribute(&record.attributes, "input_token_count"),
        cached_input_tokens: numeric_attribute(&record.attributes, "cached_token_count"),
        output_tokens: numeric_attribute(&record.attributes, "output_token_count"),
        reasoning_tokens: numeric_attribute(&record.attributes, "reasoning_token_count"),
    })
}

fn timestamp_millis(record: &LogRecord) -> Option<i64> {
    let milliseconds = record.time_unix_nano / 1_000_000;
    if milliseconds > 0 && milliseconds <= i64::MAX as u64 {
        return Some(milliseconds as i64);
    }
    chrono::DateTime::parse_from_rfc3339(string_attribute(&record.attributes, "event.timestamp")?)
        .ok()
        .map(|timestamp| timestamp.timestamp_millis())
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
            Some(Value::StringValue(value)) => Some(value.as_str()),
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
            Some(Value::IntValue(value)) if *value >= 0 => Some(*value as u64),
            Some(Value::StringValue(value)) => value.parse().ok(),
            _ => None,
        },
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::decode_response_completed;
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
        assert!(crate::telemetry::types::CodexModel::new("fixture-secret").is_err());
    }
}
