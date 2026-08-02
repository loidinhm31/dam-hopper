use std::sync::Arc;

use crate::telemetry::{
    AgentUsageEvent, CodexCorrelationRegistry, CodexVersion, CorrelationQuality, TelemetryKeyRing,
    TELEMETRY_SCHEMA_VERSION, TERMINAL_HMAC_DOMAIN,
};

use super::decoder::DecodedCodexUsage;

const AGENT_DEDUPE_DOMAIN: &[u8] = b"codex-usage:v1";
const CONVERSATION_DOMAIN: &[u8] = b"codex-conversation:v1";

/// Converts a decoder result directly into a persistence-safe event. No raw
/// OTLP values escape this boundary; conversation IDs are immediately HMACed.
pub fn normalize(
    decoded: DecodedCodexUsage,
    keys: &Arc<TelemetryKeyRing>,
    correlation: &CodexCorrelationRegistry,
    received_at_utc_ms: i64,
) -> Option<AgentUsageEvent> {
    let source_version = decoded
        .source_version
        .clone()
        .unwrap_or_else(CodexVersion::unknown);
    let source_timestamp = decoded.occurred_at_utc_ms;
    let occurred_at_utc_ms = source_timestamp.unwrap_or(received_at_utc_ms);
    if occurred_at_utc_ms <= 0 || !has_trustworthy_tokens(&decoded) {
        return None;
    }
    let conversation_fingerprint = decoded
        .conversation_id
        .as_ref()
        .map(|id| keys.digest(CONVERSATION_DOMAIN, &[id.as_str().as_bytes()]));
    let source_version_text = source_version_string(&source_version);
    let model = decoded
        .model
        .as_ref()
        .map(|value| String::from(value.clone()))
        .unwrap_or_default();
    // A missing source timestamp must not turn a transport retry into a new
    // event. Persist the receive timestamp for coverage while fingerprinting a
    // stable zero marker for an absent source timestamp.
    let occurred = source_timestamp.unwrap_or_default().to_be_bytes();
    let input = token_component_fingerprint(decoded.input_tokens);
    let cached = token_component_fingerprint(decoded.cached_input_tokens);
    let output = token_component_fingerprint(decoded.output_tokens);
    let reasoning = token_component_fingerprint(decoded.reasoning_tokens);
    let id = keys.digest(
        AGENT_DEDUPE_DOMAIN,
        &[
            source_version_text.as_bytes(),
            &occurred,
            decoded
                .conversation_id
                .as_ref()
                .map_or(b"".as_slice(), |id| id.as_str().as_bytes()),
            model.as_bytes(),
            &input,
            &cached,
            &output,
            &reasoning,
        ],
    );
    let terminal_run_id = decoded
        .run_marker
        .as_ref()
        .and_then(|marker| correlation.resolve(marker, received_at_utc_ms));
    let terminal_fingerprint = terminal_run_id.map(|run_id| {
        keys.digest(
            TERMINAL_HMAC_DOMAIN,
            &[run_id.0.as_hyphenated().to_string().as_bytes()],
        )
    });
    Some(AgentUsageEvent {
        schema_version: TELEMETRY_SCHEMA_VERSION,
        id,
        occurred_at_utc_ms,
        conversation_fingerprint,
        terminal_fingerprint,
        model: decoded.model,
        source_version,
        correlation_quality: terminal_run_id
            .is_some()
            .then_some(CorrelationQuality::Exact)
            .unwrap_or(CorrelationQuality::Unattributed),
        counter_semantic: decoded.counter_semantic,
        duration_ms: decoded.duration_ms,
        input_tokens: decoded.input_tokens,
        cached_input_tokens: decoded.cached_input_tokens,
        output_tokens: decoded.output_tokens,
        reasoning_tokens: decoded.reasoning_tokens,
    })
}

fn token_component_fingerprint(value: Option<u64>) -> [u8; 9] {
    let mut component = [0; 9];
    if let Some(value) = value {
        component[0] = 1;
        component[1..].copy_from_slice(&value.to_be_bytes());
    }
    component
}

fn source_version_string(value: &CodexVersion) -> String {
    String::from(value.clone())
}

fn has_trustworthy_tokens(value: &DecodedCodexUsage) -> bool {
    [
        value.input_tokens,
        value.cached_input_tokens,
        value.output_tokens,
        value.reasoning_tokens,
    ]
    .into_iter()
    .flatten()
    .next()
    .is_some()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::telemetry::{
        codex_otlp::decoder::decode_response_completed, CodexCorrelationRegistry,
        CorrelationQuality, SafeIdentifier, TelemetryKeyRing,
    };
    use opentelemetry_proto::tonic::{
        collector::logs::v1::ExportLogsServiceRequest,
        common::v1::{any_value::Value, AnyValue, KeyValue},
    };
    use prost::Message;

    use super::normalize;

    #[test]
    fn hashes_conversation_and_generates_stable_replay_id() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let correlation = CodexCorrelationRegistry::default();
        let decoded = decode_response_completed(include_bytes!(
            "fixtures/codex-cli-0.145.0-response-completed.bin"
        ))
        .unwrap()
        .pop()
        .unwrap();
        let first = normalize(decoded, &keys, &correlation, 1).unwrap();
        let decoded = decode_response_completed(include_bytes!(
            "fixtures/codex-cli-0.145.0-response-completed.bin"
        ))
        .unwrap()
        .pop()
        .unwrap();
        let second = normalize(decoded, &keys, &correlation, 1).unwrap();
        assert_eq!(first.id, second.id);
        assert!(first.conversation_fingerprint.is_some());
        assert_eq!(
            first.correlation_quality,
            crate::telemetry::CorrelationQuality::Unattributed
        );
    }

    #[test]
    fn keeps_valid_components_and_uses_a_safe_missing_version_marker() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let correlation = CodexCorrelationRegistry::default();
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

        let decoded = decode_response_completed(&request.encode_to_vec())
            .unwrap()
            .pop()
            .unwrap();
        let normalized = normalize(decoded, &keys, &correlation, 1).unwrap();
        assert_eq!(String::from(normalized.source_version), "unknown");
        assert_eq!(normalized.input_tokens, Some(24_387));
        assert_eq!(normalized.output_tokens, None);
    }

    #[test]
    fn creates_no_usage_event_when_every_token_component_is_unavailable() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let correlation = CodexCorrelationRegistry::default();
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        for attribute in &mut request.resource_logs[0].scope_logs[0].log_records[0].attributes {
            if attribute.key.ends_with("token_count") {
                attribute.value = Some(AnyValue {
                    value: Some(Value::StringValue("invalid".to_string())),
                });
            }
        }

        let decoded = decode_response_completed(&request.encode_to_vec())
            .unwrap()
            .pop()
            .unwrap();
        assert!(normalize(decoded, &keys, &correlation, 1).is_none());
    }

    #[test]
    fn dedupe_fingerprint_distinguishes_missing_components_from_zeroes() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let correlation = CodexCorrelationRegistry::default();
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let full = decode_response_completed(fixture).unwrap().pop().unwrap();
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        let output = request.resource_logs[0].scope_logs[0].log_records[0]
            .attributes
            .iter_mut()
            .find(|attribute| attribute.key == "output_token_count")
            .unwrap();
        output.value = Some(AnyValue {
            value: Some(Value::StringValue("invalid".to_string())),
        });
        let partial = decode_response_completed(&request.encode_to_vec())
            .unwrap()
            .pop()
            .unwrap();

        let full = normalize(full, &keys, &correlation, 1).unwrap();
        let partial = normalize(partial, &keys, &correlation, 1).unwrap();
        assert_ne!(full.id, partial.id);
    }

    #[test]
    fn marks_only_a_registered_dam_hopper_marker_as_exact() {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("key")).unwrap());
        let correlation = CodexCorrelationRegistry::default();
        let marker = SafeIdentifier::new("codex-run-fixture").unwrap();
        correlation.register(
            marker.clone(),
            crate::telemetry::TerminalRunId(uuid::Uuid::new_v4()),
            1,
        );
        let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
        let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
        request.resource_logs[0]
            .resource
            .as_mut()
            .unwrap()
            .attributes
            .push(KeyValue {
                key: "dam_hopper.run_id".to_string(),
                value: Some(AnyValue {
                    value: Some(Value::StringValue(marker.as_str().to_string())),
                }),
                key_strindex: 0,
            });

        let decoded = decode_response_completed(&request.encode_to_vec())
            .unwrap()
            .pop()
            .unwrap();
        let normalized = normalize(decoded, &keys, &correlation, 1).unwrap();
        assert_eq!(normalized.correlation_quality, CorrelationQuality::Exact);
    }
}
