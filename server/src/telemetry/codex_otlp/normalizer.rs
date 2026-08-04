use std::sync::Arc;

use crate::telemetry::{
    CodexUsageEvent, CodexVersion, SafeIdentifier, SourceQuality, TelemetryKeyRing, TokenQuality,
    MAX_DURATION_MS, MAX_TIMESTAMP_UTC_MS, MAX_TOKEN_COMPONENT, TELEMETRY_SCHEMA_VERSION,
};

use super::decoder::{DecodedCodexUsage, TimestampStatus};

const CODEX_DEDUPE_DOMAIN: &[u8] = b"codex-usage:v1";
const CODEX_SESSION_DOMAIN: &[u8] = b"codex-conversation:v1";

/// Converts a decoder result into a persistence-safe event. Raw OTLP values
/// never cross this boundary; the conversation identifier is HMACed and
/// missing token components remain explicit `None` values.
pub fn normalize(
    decoded: DecodedCodexUsage,
    keys: &Arc<TelemetryKeyRing>,
    received_at_utc_ms: i64,
) -> Option<CodexUsageEvent> {
    let source_version = decoded
        .source_version
        .clone()
        .unwrap_or_else(CodexVersion::unknown);
    let source_identity = decoded.source_identity.as_deref()?;
    let source_timestamp = match (decoded.timestamp_status, decoded.occurred_at_utc_ms) {
        (TimestampStatus::Invalid, _) | (TimestampStatus::Valid, None) => return None,
        (_, timestamp) => timestamp,
    };
    // Millisecond timestamps are not unique event identities. Without a
    // complete source identity, retries and distinct same-millisecond events
    // cannot be separated safely, so the record is not a durable fact.
    let occurred_at_utc_ms = source_timestamp.unwrap_or(received_at_utc_ms);
    if occurred_at_utc_ms <= 0 || occurred_at_utc_ms > MAX_TIMESTAMP_UTC_MS {
        return None;
    }

    let input_tokens = bounded_token(decoded.input_tokens);
    let cached_input_tokens = bounded_token(decoded.cached_input_tokens);
    let output_tokens = bounded_token(decoded.output_tokens);
    let reasoning_tokens = bounded_token(decoded.reasoning_tokens);
    let duration_ms = decoded
        .duration_ms
        .filter(|value| *value <= MAX_DURATION_MS);
    let token_quality = token_quality([
        input_tokens,
        cached_input_tokens,
        output_tokens,
        reasoning_tokens,
    ]);

    let session_fingerprint = decoded
        .conversation_id
        .as_ref()
        .map(|id| keys.digest(CODEX_SESSION_DOMAIN, &[id.as_str().as_bytes()]));
    let model = decoded
        .model
        .as_ref()
        .map(|value| String::from(value.clone()))
        .unwrap_or_default();
    let source_version_text = String::from(source_version.clone());
    let occurred = source_timestamp.unwrap_or_default().to_be_bytes();
    let input = token_component_fingerprint(input_tokens);
    let cached = token_component_fingerprint(cached_input_tokens);
    let output = token_component_fingerprint(output_tokens);
    let reasoning = token_component_fingerprint(reasoning_tokens);
    let duration = token_component_fingerprint(duration_ms);
    let id = keys.digest(
        CODEX_DEDUPE_DOMAIN,
        &[
            source_version_text.as_bytes(),
            &occurred,
            source_identity,
            decoded
                .conversation_id
                .as_ref()
                .map_or(b"".as_slice(), |id| id.as_str().as_bytes()),
            model.as_bytes(),
            &input,
            &cached,
            &output,
            &reasoning,
            &duration,
        ],
    );
    Some(CodexUsageEvent {
        schema_version: TELEMETRY_SCHEMA_VERSION,
        id,
        occurred_at_utc_ms,
        session_fingerprint,
        model: decoded.model,
        source_version,
        source_quality: if decoded.unverified_version {
            SourceQuality::Unverified
        } else {
            SourceQuality::Verified
        },
        status: SafeIdentifier::new("completed").expect("static status is safe"),
        counter_semantic: decoded.counter_semantic,
        duration_ms,
        token_quality,
        input_tokens,
        cached_input_tokens,
        output_tokens,
        reasoning_tokens,
    })
}

fn bounded_token(value: Option<u64>) -> Option<u64> {
    value.filter(|value| *value <= MAX_TOKEN_COMPONENT)
}

fn token_quality(values: [Option<u64>; 4]) -> TokenQuality {
    match values.iter().filter(|value| value.is_some()).count() {
        0 => TokenQuality::Unavailable,
        4 => TokenQuality::Exact,
        _ => TokenQuality::Partial,
    }
}

fn token_component_fingerprint(value: Option<u64>) -> [u8; 9] {
    let mut component = [0; 9];
    if let Some(value) = value {
        component[0] = 1;
        component[1..].copy_from_slice(&value.to_be_bytes());
    }
    component
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::telemetry::{
        codex_otlp::decoder::{decode_response_completed, DecodedCodexUsage},
        SourceQuality, TelemetryKeyRing, TokenQuality, MAX_TIMESTAMP_UTC_MS,
    };
    use opentelemetry_proto::tonic::{
        collector::logs::v1::ExportLogsServiceRequest,
        common::v1::{any_value::Value, AnyValue, KeyValue},
    };
    use prost::Message;

    use super::normalize;

    fn with_source_identity(
        mut decoded: DecodedCodexUsage,
        trace: u8,
        span: u8,
    ) -> DecodedCodexUsage {
        let mut identity = Vec::with_capacity(26);
        identity.push(b't');
        identity.extend(std::iter::repeat_n(trace, 16));
        identity.push(b's');
        identity.extend(std::iter::repeat_n(span, 8));
        decoded.source_identity = Some(identity);
        decoded
    }

    #[test]
    fn hashes_session_and_generates_stable_replay_id() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let decoded = with_source_identity(
            decode_response_completed(include_bytes!(
                "fixtures/codex-cli-0.145.0-response-completed.bin"
            ))
            .unwrap()
            .pop()
            .unwrap(),
            1,
            2,
        );
        let first = normalize(decoded, &keys, 1).unwrap();
        let decoded = with_source_identity(
            decode_response_completed(include_bytes!(
                "fixtures/codex-cli-0.145.0-response-completed.bin"
            ))
            .unwrap()
            .pop()
            .unwrap(),
            1,
            2,
        );
        let second = normalize(decoded, &keys, 1).unwrap();
        assert_eq!(first.id, second.id);
        assert!(first.session_fingerprint.is_some());
        assert_eq!(first.source_quality, SourceQuality::Verified);
        assert_eq!(first.token_quality, TokenQuality::Exact);
    }

    #[test]
    fn keeps_valid_components_and_marks_missing_version_unverified() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        let resource = request.resource_logs[0].resource.as_mut().unwrap();
        resource
            .attributes
            .retain(|attribute| attribute.key != "service.version");
        let output = request.resource_logs[0].scope_logs[0].log_records[0]
            .attributes
            .iter_mut()
            .find(|attribute| attribute.key == "output_token_count")
            .unwrap();
        output.value = Some(AnyValue {
            value: Some(Value::StringValue("invalid".to_string())),
        });
        let decoded = with_source_identity(
            decode_response_completed(&request.encode_to_vec())
                .unwrap()
                .pop()
                .unwrap(),
            1,
            2,
        );
        let normalized = normalize(decoded, &keys, 1).unwrap();
        assert_eq!(String::from(normalized.source_version), "unknown");
        assert_eq!(normalized.input_tokens, Some(24_387));
        assert_eq!(normalized.output_tokens, None);
        assert_eq!(normalized.source_quality, SourceQuality::Unverified);
        assert_eq!(normalized.token_quality, TokenQuality::Partial);
    }

    #[test]
    fn persists_an_event_when_all_token_components_are_unavailable() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        for attribute in &mut request.resource_logs[0].scope_logs[0].log_records[0].attributes {
            if attribute.key.ends_with("token_count") {
                attribute.value = Some(AnyValue {
                    value: Some(Value::StringValue("invalid".to_string())),
                });
            }
        }
        let decoded = with_source_identity(
            decode_response_completed(&request.encode_to_vec())
                .unwrap()
                .pop()
                .unwrap(),
            1,
            2,
        );
        let event = normalize(decoded, &keys, 1).unwrap();
        assert_eq!(event.token_quality, TokenQuality::Unavailable);
        assert!(event.input_tokens.is_none());
    }

    #[test]
    fn uses_source_identity_for_timestampless_records() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        let record = &mut request.resource_logs[0].scope_logs[0].log_records[0];
        record.time_unix_nano = 0;
        record.observed_time_unix_nano = 0;
        record
            .attributes
            .retain(|attribute| attribute.key != "event.timestamp");
        record.trace_id = vec![1; 16];
        record.span_id = vec![2; 8];
        let first = normalize(
            decode_response_completed(&request.encode_to_vec())
                .unwrap()
                .pop()
                .unwrap(),
            &keys,
            10,
        )
        .unwrap();

        let record = &mut request.resource_logs[0].scope_logs[0].log_records[0];
        record.trace_id = vec![3; 16];
        record.span_id = vec![4; 8];
        let second = normalize(
            decode_response_completed(&request.encode_to_vec())
                .unwrap()
                .pop()
                .unwrap(),
            &keys,
            10,
        )
        .unwrap();
        assert_ne!(first.id, second.id);

        let record = &mut request.resource_logs[0].scope_logs[0].log_records[0];
        record.trace_id.clear();
        record.span_id.clear();
        let ambiguous = decode_response_completed(&request.encode_to_vec())
            .unwrap()
            .pop()
            .unwrap();
        assert!(normalize(ambiguous, &keys, 10).is_none());
    }

    #[test]
    fn timestamped_distinct_source_identity_does_not_collide() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut first_request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        let mut second_request = first_request.clone();
        first_request.resource_logs[0].scope_logs[0].log_records[0].trace_id = vec![1; 16];
        first_request.resource_logs[0].scope_logs[0].log_records[0].span_id = vec![2; 8];
        second_request.resource_logs[0].scope_logs[0].log_records[0].trace_id = vec![3; 16];
        second_request.resource_logs[0].scope_logs[0].log_records[0].span_id = vec![4; 8];

        let first = normalize(
            decode_response_completed(&first_request.encode_to_vec())
                .unwrap()
                .pop()
                .unwrap(),
            &keys,
            1,
        )
        .unwrap();
        let second = normalize(
            decode_response_completed(&second_request.encode_to_vec())
                .unwrap()
                .pop()
                .unwrap(),
            &keys,
            1,
        )
        .unwrap();
        assert_ne!(first.id, second.id);
    }

    #[test]
    fn rejects_timestamped_records_without_source_identity() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let decoded = decode_response_completed(include_bytes!(
            "fixtures/codex-cli-0.145.0-response-completed.bin"
        ))
        .unwrap()
        .pop()
        .unwrap();
        assert!(normalize(decoded, &keys, 1).is_none());
    }

    #[test]
    fn timestamped_retries_with_same_identity_are_stable() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        let record = &mut request.resource_logs[0].scope_logs[0].log_records[0];
        record.trace_id = vec![7; 16];
        record.span_id = vec![8; 8];
        let bytes = request.encode_to_vec();

        let first = normalize(
            decode_response_completed(&bytes).unwrap().pop().unwrap(),
            &keys,
            1,
        )
        .unwrap();
        let second = normalize(
            decode_response_completed(&bytes).unwrap().pop().unwrap(),
            &keys,
            1,
        )
        .unwrap();
        assert_eq!(first.id, second.id);
    }

    #[test]
    fn same_identity_with_changed_payload_is_a_new_event() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut first_request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        let mut second_request = first_request.clone();
        for request in [&mut first_request, &mut second_request] {
            let record = &mut request.resource_logs[0].scope_logs[0].log_records[0];
            record.trace_id = vec![9; 16];
            record.span_id = vec![10; 8];
        }
        let output = second_request.resource_logs[0].scope_logs[0].log_records[0]
            .attributes
            .iter_mut()
            .find(|attribute| attribute.key == "output_token_count")
            .unwrap();
        output.value = Some(AnyValue {
            value: Some(Value::IntValue(8)),
        });

        let first = normalize(
            decode_response_completed(&first_request.encode_to_vec())
                .unwrap()
                .pop()
                .unwrap(),
            &keys,
            1,
        )
        .unwrap();
        let second = normalize(
            decode_response_completed(&second_request.encode_to_vec())
                .unwrap()
                .pop()
                .unwrap(),
            &keys,
            1,
        )
        .unwrap();
        assert_ne!(first.id, second.id);
    }

    #[test]
    fn same_identity_with_changed_duration_is_a_new_event() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut first_request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        let mut second_request = first_request.clone();
        let mut zero_duration_request = first_request.clone();
        for request in [
            &mut first_request,
            &mut second_request,
            &mut zero_duration_request,
        ] {
            let record = &mut request.resource_logs[0].scope_logs[0].log_records[0];
            record.trace_id = vec![13; 16];
            record.span_id = vec![14; 8];
        }
        second_request.resource_logs[0].scope_logs[0].log_records[0]
            .attributes
            .push(KeyValue {
                key: "duration_ms".to_string(),
                value: Some(AnyValue {
                    value: Some(Value::IntValue(1_250)),
                }),
                key_strindex: 0,
            });
        zero_duration_request.resource_logs[0].scope_logs[0].log_records[0]
            .attributes
            .push(KeyValue {
                key: "duration_ms".to_string(),
                value: Some(AnyValue {
                    value: Some(Value::IntValue(0)),
                }),
                key_strindex: 0,
            });

        let first = normalize(
            decode_response_completed(&first_request.encode_to_vec())
                .unwrap()
                .pop()
                .unwrap(),
            &keys,
            1,
        )
        .unwrap();
        let zero_duration = normalize(
            decode_response_completed(&zero_duration_request.encode_to_vec())
                .unwrap()
                .pop()
                .unwrap(),
            &keys,
            1,
        )
        .unwrap();
        assert_ne!(first.id, zero_duration.id);
        let second = normalize(
            decode_response_completed(&second_request.encode_to_vec())
                .unwrap()
                .pop()
                .unwrap(),
            &keys,
            1,
        )
        .unwrap();
        assert_ne!(first.id, second.id);
    }

    #[test]
    fn rejects_invalid_otlp_timestamp_instead_of_using_receipt_time() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        let record = &mut request.resource_logs[0].scope_logs[0].log_records[0];
        record.time_unix_nano = 0;
        record.observed_time_unix_nano = 0;
        record.trace_id = vec![1; 16];
        record.span_id = vec![2; 8];
        record.attributes.push(KeyValue {
            key: "event.timestamp".to_string(),
            value: Some(AnyValue {
                value: Some(Value::StringValue("not-an-rfc3339-timestamp".to_string())),
            }),
            key_strindex: 0,
        });

        let decoded = decode_response_completed(&request.encode_to_vec())
            .unwrap()
            .pop()
            .unwrap();
        assert!(normalize(decoded, &keys, 1_234_567).is_none());
    }

    #[test]
    fn normalizer_does_not_admit_oversized_token_components() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let mut decoded = with_source_identity(
            decode_response_completed(include_bytes!(
                "fixtures/codex-cli-0.145.0-response-completed.bin"
            ))
            .unwrap()
            .pop()
            .unwrap(),
            1,
            2,
        );
        decoded.input_tokens = Some(crate::telemetry::MAX_TOKEN_COMPONENT + 1);

        let event = normalize(decoded, &keys, 1).unwrap();
        assert_eq!(event.input_tokens, None);
        assert_eq!(event.token_quality, TokenQuality::Partial);
    }

    #[test]
    fn rejects_timestamps_outside_the_supported_epoch_range() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let mut decoded = with_source_identity(
            decode_response_completed(include_bytes!(
                "fixtures/codex-cli-0.145.0-response-completed.bin"
            ))
            .unwrap()
            .pop()
            .unwrap(),
            1,
            2,
        );
        decoded.occurred_at_utc_ms = Some(MAX_TIMESTAMP_UTC_MS + 1);
        assert!(normalize(decoded, &keys, 1).is_none());
    }
}
