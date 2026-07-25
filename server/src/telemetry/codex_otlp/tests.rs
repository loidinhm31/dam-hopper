use std::{sync::Arc, time::Duration};

use crate::{
    config::TelemetryCollectorConfig,
    telemetry::{
        worker::{TelemetryControl, TelemetryHandle, TelemetryWorker},
        SafeIdentifier, TelemetryCmd, TelemetryKeyRing, TelemetryStore,
    },
};
use opentelemetry_proto::tonic::{
    collector::logs::v1::ExportLogsServiceRequest,
    common::v1::{any_value::Value, AnyValue, KeyValue},
};
use prost::Message;

use super::{health::CollectorHealth, receiver::start_collector_at};

#[tokio::test]
async fn accepts_pinned_binary_once_and_rejects_invalid_requests() {
    let temp = tempfile::tempdir().unwrap();
    let store = Arc::new(TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap());
    let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("hmac")).unwrap());
    let (sender, receiver) = std::sync::mpsc::sync_channel(8);
    let worker = TelemetryWorker::new(receiver, store.clone())
        .spawn()
        .unwrap();
    let control = Arc::new(TelemetryControl::new(true, Vec::<String>::new()));
    let telemetry = TelemetryHandle::active(control.clone(), store.clone(), Some(sender.clone()))
        .with_hmac_keys(keys);
    let config = TelemetryCollectorConfig {
        enabled: true,
        host: "127.0.0.1".to_string(),
        port: 0,
    };
    let secret_path = temp.path().join("collector-token");
    let health = CollectorHealth::default();
    let collector = start_collector_at(&config, &telemetry, health.clone(), secret_path.clone())
        .await
        .unwrap();
    let endpoint = format!("http://{}/v1/logs", collector.address());
    let token = std::fs::read_to_string(secret_path).unwrap();
    let client = reqwest::Client::new();
    let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");

    assert_eq!(
        client
            .post(&endpoint)
            .body(fixture.to_vec())
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {token}"))
            .body(fixture.to_vec())
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::UNSUPPORTED_MEDIA_TYPE
    );
    for _ in 0..2 {
        let response = client
            .post(&endpoint)
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/x-protobuf")
            .body(fixture.to_vec())
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::ACCEPTED);
    }
    tokio::time::sleep(Duration::from_millis(350)).await;
    let connection = store.open_read().unwrap();
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM agent_usage_events", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        crate::telemetry::queries::health_value(&store, "collector_duplicates").unwrap(),
        1
    );
    assert!(!std::fs::read(store.path_for_tests())
        .unwrap()
        .windows(b"fixture-conversation".len())
        .any(|window| window == b"fixture-conversation"));

    let mut canary_request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
    canary_request.resource_logs[0].scope_logs[0].log_records[0]
        .attributes
        .extend([
            content_attribute("prompt", "prompt-canary"),
            content_attribute("response", "response-canary"),
            content_attribute("tool.content", "tool-canary"),
        ]);
    let response = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/x-protobuf")
        .body(canary_request.encode_to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::ACCEPTED);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let db = std::fs::read(store.path_for_tests()).unwrap();
    for canary in ["prompt-canary", "response-canary", "tool-canary"] {
        assert!(
            !db.windows(canary.len())
                .any(|window| window == canary.as_bytes()),
            "database retained {canary}"
        );
    }

    // Delete holds this admission gate before it drains and removes persisted
    // data. A request arriving after that state change must be a no-op.
    control.with_exclusive_admission(|| control.set_enabled(false));
    let paused = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/x-protobuf")
        .body(fixture.to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(paused.status(), reqwest::StatusCode::ACCEPTED);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM agent_usage_events", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );

    collector.stop().await;
    sender.send(TelemetryCmd::Shutdown).unwrap();
    worker.join().unwrap();
}

#[tokio::test]
async fn admits_newer_core_shape_and_reports_only_bounded_compatibility_health() {
    let temp = tempfile::tempdir().unwrap();
    let store = Arc::new(TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap());
    let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("hmac")).unwrap());
    let (sender, receiver) = std::sync::mpsc::sync_channel(8);
    let worker = TelemetryWorker::new(receiver, store.clone())
        .spawn()
        .unwrap();
    let control = Arc::new(TelemetryControl::new(true, Vec::<String>::new()));
    let telemetry =
        TelemetryHandle::active(control, store.clone(), Some(sender.clone())).with_hmac_keys(keys);
    let config = TelemetryCollectorConfig {
        enabled: true,
        host: "127.0.0.1".to_string(),
        port: 0,
    };
    let secret_path = temp.path().join("collector-token");
    let health = CollectorHealth::default();
    let collector = start_collector_at(&config, &telemetry, health.clone(), secret_path.clone())
        .await
        .unwrap();
    let endpoint = format!("http://{}/v1/logs", collector.address());
    let token = std::fs::read_to_string(secret_path).unwrap();
    let fixture = include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin");
    let mut request = ExportLogsServiceRequest::decode(fixture.as_slice()).unwrap();
    let marker = SafeIdentifier::new("run-marker-safe").unwrap();
    telemetry
        .codex_correlation
        .register(marker.clone(), chrono::Utc::now().timestamp_millis());
    request.resource_logs[0]
        .resource
        .as_mut()
        .unwrap()
        .attributes[0]
        .value = Some(AnyValue {
        value: Some(Value::StringValue("999.0.0".to_string())),
    });
    request.resource_logs[0]
        .resource
        .as_mut()
        .unwrap()
        .attributes
        .push(content_attribute("dam_hopper.run_id", marker.as_str()));
    let output = request.resource_logs[0].scope_logs[0].log_records[0]
        .attributes
        .iter_mut()
        .find(|attribute| attribute.key == "output_token_count")
        .unwrap();
    output.value = Some(AnyValue {
        value: Some(Value::StringValue("invalid".to_string())),
    });

    let response = reqwest::Client::new()
        .post(&endpoint)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/x-protobuf")
        .body(request.encode_to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::ACCEPTED);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let connection = store.open_read().unwrap();
    let (input, output, correlation): (Option<i64>, Option<i64>, String) = connection
        .query_row(
            "SELECT input_tokens, output_tokens, correlation_quality FROM agent_usage_events",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(input, Some(24_387));
    assert_eq!(output, None);
    assert_eq!(correlation, "exact");
    assert!(
        !std::fs::read(store.path_for_tests())
            .unwrap()
            .windows(marker.as_str().len())
            .any(|window| window == marker.as_str().as_bytes()),
        "correlation marker must not be persisted"
    );
    let snapshot = health.snapshot();
    assert_eq!(snapshot.unverified_version, 1);
    assert_eq!(snapshot.core_schema_drift, 1);
    assert_eq!(snapshot.unavailable_token_coverage, 0);
    let health_json = serde_json::to_string(&snapshot).unwrap();
    assert!(!health_json.contains("999.0.0"));
    assert!(!health_json.contains("invalid"));

    collector.stop().await;
    sender.send(TelemetryCmd::Shutdown).unwrap();
    worker.join().unwrap();
}

#[tokio::test]
async fn returns_retryable_status_when_the_usage_queue_is_full() {
    let temp = tempfile::tempdir().unwrap();
    let store = Arc::new(TelemetryStore::open(&temp.path().join("telemetry.db")).unwrap());
    let keys = Arc::new(TelemetryKeyRing::load_or_create(temp.path().join("hmac")).unwrap());
    let (sender, _receiver) = std::sync::mpsc::sync_channel(0);
    let control = Arc::new(TelemetryControl::new(true, Vec::<String>::new()));
    let telemetry = TelemetryHandle::active(control, store, Some(sender)).with_hmac_keys(keys);
    let config = TelemetryCollectorConfig {
        enabled: true,
        host: "127.0.0.1".to_string(),
        port: 0,
    };
    let secret_path = temp.path().join("collector-token");
    let health = CollectorHealth::default();
    let collector = start_collector_at(&config, &telemetry, health.clone(), secret_path.clone())
        .await
        .unwrap();
    let endpoint = format!("http://{}/v1/logs", collector.address());
    let token = std::fs::read_to_string(secret_path).unwrap();

    let response = reqwest::Client::new()
        .post(&endpoint)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/x-protobuf")
        .body(include_bytes!("fixtures/codex-cli-0.145.0-response-completed.bin").to_vec())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(health.snapshot().dropped, 1);
    assert_eq!(health.snapshot().queued, 0);

    collector.stop().await;
}

fn content_attribute(key: &str, value: &str) -> KeyValue {
    KeyValue {
        key: key.to_string(),
        value: Some(AnyValue {
            value: Some(Value::StringValue(value.to_string())),
        }),
        key_strindex: 0,
    }
}
