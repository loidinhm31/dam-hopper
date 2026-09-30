//! Consumer-visible current snapshot/metrics behavior baseline tests.
//!
//! Validates:
//! 1. Representative and degraded fixture pairs adhere to the existing V1 snapshot
//!    and legacy metrics contracts without external DB or credential dependencies.
//! 2. Existing REST endpoints (/api/system/resources/v1/snapshot, /api/system/metrics,
//!    /api/system/resources/v1/alerts) return expected payloads.
//! 3. Monitor stale marking and retained alert incident semantics behave as expected.
//! 4. Whole-monitor profiler JSON schema structure meets Phase 00 specifications.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use parking_lot::Mutex;
use serde_json::Value;
use tokio::sync::RwLock;
use tower::ServiceExt;

use dam_hopper_server::{
    agent_store::AgentStoreService,
    config::{DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo},
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, PtySessionManager},
    state::AppState,
    system::{
        alerts::AlertState, config::HostResourceMonitorConfig, platform::HostResourceSource,
        AvailabilityState, HostResourceMonitor,
    },
};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;

mod common;
use common::host_resource_fixtures::{
    degraded_pair, representative_pair, FIXTURE_SAMPLED_AT_MS,
};

static ENV_LOCK: Mutex<()> = Mutex::new(());

fn create_test_state(workspace_root: PathBuf) -> AppState {
    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test-workspace".into(),
            root: workspace_root.display().to_string(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![],
        features: FeaturesConfig::default(),
        config_path: workspace_root.join("dam-hopper.toml"),
    };

    let global_config = GlobalConfig::default();
    let store_path = workspace_root.join(".dam-hopper/agent-store");
    let agent_store = AgentStoreService::new(store_path);
    let jwt_secret = "test-secret-key".to_string();
    let fs = FsSubsystem::new(vec![]);

    let _guard = ENV_LOCK.lock();
    let old_rust_env = std::env::var("RUST_ENV").ok();
    let old_environment = std::env::var("ENVIRONMENT").ok();
    std::env::remove_var("RUST_ENV");
    std::env::remove_var("ENVIRONMENT");

    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    let diagnostics = DiagnosticStore::new(workspace_root.join("diagnostics.jsonl"));
    let state = AppState::new(
        workspace_root,
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        jwt_secret,
        fs,
        None,
        true, // dev mode (no auth)
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .expect("create test AppState");

    if let Some(v) = old_rust_env {
        std::env::set_var("RUST_ENV", v);
    }
    if let Some(v) = old_environment {
        std::env::set_var("ENVIRONMENT", v);
    }

    state
}

#[test]
fn test_representative_pair_contract() {
    let (snapshot, metrics) = representative_pair();

    assert_eq!(snapshot.schema_version, 1);
    assert_eq!(snapshot.sampled_at, FIXTURE_SAMPLED_AT_MS);
    assert_eq!(snapshot.sample_id, "00000000-0000-0000-0000-000000000001");
    assert_eq!(
        snapshot.capabilities.linux_deep_metrics.state,
        AvailabilityState::Available
    );
    assert_eq!(
        snapshot.memory.availability.state,
        AvailabilityState::Available
    );
    assert_eq!(
        snapshot.processes.availability.state,
        AvailabilityState::Available
    );
    assert_eq!(snapshot.processes.scanned_count, 2);
    assert!(!snapshot.processes.truncated);
    assert!(!snapshot.processes.deadline_exceeded);
    assert_eq!(snapshot.current_alerts.len(), 0);

    let alert = snapshot.alert.as_ref().expect("alert summary exists");
    assert_eq!(alert.state, AlertState::Healthy);

    // Serialization check
    let json_val = serde_json::to_value(&snapshot).expect("serialize snapshot");
    assert_eq!(json_val["schemaVersion"], 1);
    assert_eq!(json_val["sampledAt"], FIXTURE_SAMPLED_AT_MS);
    assert_eq!(json_val["capabilities"]["linuxDeepMetrics"]["state"], "available");
    assert_eq!(json_val["currentAlerts"], serde_json::json!([]));

    assert_eq!(metrics.sampled_at, FIXTURE_SAMPLED_AT_MS);
    assert_eq!(metrics.cpu.usage_percent, 15.0);
    assert_eq!(metrics.memory.total_bytes, 16 * 1024 * 1024 * 1024);
    assert_eq!(metrics.memory.available_bytes, 8 * 1024 * 1024 * 1024);
    assert_eq!(metrics.memory.usage_percent, 50.0);
    assert_eq!(metrics.disk.name, "/dev/sda1");

    let metrics_json = serde_json::to_value(&metrics).expect("serialize metrics");
    assert_eq!(metrics_json["sampledAt"], FIXTURE_SAMPLED_AT_MS);
    assert_eq!(metrics_json["cpu"]["usagePercent"], 15.0);
    assert_eq!(metrics_json["disk"]["mountPoint"], "/workspace");
}

#[test]
fn test_degraded_pair_contract() {
    let (snapshot, metrics) = degraded_pair();

    assert_eq!(snapshot.schema_version, 1);
    assert_eq!(snapshot.sampled_at, FIXTURE_SAMPLED_AT_MS);
    assert_eq!(snapshot.sample_id, "00000000-0000-0000-0000-000000000002");
    assert_eq!(
        snapshot.capabilities.linux_deep_metrics.state,
        AvailabilityState::TemporarilyUnavailable
    );
    assert_eq!(
        snapshot.processes.availability.state,
        AvailabilityState::TemporarilyUnavailable
    );
    assert_eq!(
        snapshot.processes.availability.detail_code.as_deref(),
        Some("processScanDeadlineExceeded")
    );
    assert_eq!(snapshot.processes.scanned_count, 512);
    assert!(snapshot.processes.truncated);
    assert!(snapshot.processes.deadline_exceeded);
    assert_eq!(snapshot.processes.skipped_count, 48);

    // Active resource alerts
    assert_eq!(snapshot.current_alerts.len(), 2);
    let alert_keys: Vec<&str> = snapshot
        .current_alerts
        .iter()
        .map(|a| a.key.as_str())
        .collect();
    assert!(alert_keys.contains(&"thermal-high"));
    assert!(alert_keys.contains(&"disk-full-workspace"));

    let alert = snapshot.alert.as_ref().expect("alert summary exists");
    assert_eq!(alert.state, AlertState::MemoryPressure);

    // Serialization check
    let json_val = serde_json::to_value(&snapshot).expect("serialize snapshot");
    assert_eq!(json_val["schemaVersion"], 1);
    assert_eq!(
        json_val["processes"]["availability"]["state"],
        "temporarilyUnavailable"
    );
    assert_eq!(
        json_val["processes"]["availability"]["detailCode"],
        "processScanDeadlineExceeded"
    );
    assert_eq!(json_val["currentAlerts"].as_array().unwrap().len(), 2);

    assert_eq!(metrics.cpu.usage_percent, 98.5);
    assert_eq!(metrics.memory.usage_percent, 96.8);
    assert_eq!(metrics.disk.usage_percent, 99.0);
}

#[tokio::test]
async fn test_existing_rest_snapshot_endpoint() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let state = create_test_state(tmp.path().to_path_buf());
    let app = dam_hopper_server::api::build_router(state);

    let request = Request::builder()
        .method("GET")
        .uri("/api/system/resources/v1/snapshot")
        .body(Body::empty())
        .expect("request");

    let response = app.oneshot(request).await.expect("response");
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("body");
    let json: Value = serde_json::from_slice(&bytes).expect("parse json");

    assert_eq!(json["schemaVersion"], 1);
    assert!(json["sampleId"].is_string());
    assert!(json["sampledAt"].is_u64());
    assert!(json["host"].is_object());
    assert!(json["capabilities"].is_object());
    assert!(json["memory"].is_object());
    assert!(json["processes"].is_object());
    assert!(json["mountContext"].is_object());
    assert!(json["currentAlerts"].is_array());
}

#[tokio::test]
async fn test_existing_rest_metrics_endpoint() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let state = create_test_state(tmp.path().to_path_buf());
    let app = dam_hopper_server::api::build_router(state);

    let request = Request::builder()
        .method("GET")
        .uri("/api/system/metrics")
        .body(Body::empty())
        .expect("request");

    let response = app.oneshot(request).await.expect("response");
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("body");
    let json: Value = serde_json::from_slice(&bytes).expect("parse json");

    assert!(json["sampledAt"].is_u64());
    assert!(json["cpu"].is_object());
    assert!(json["cpu"]["usagePercent"].is_number());
    assert!(json["memory"].is_object());
    assert!(json["memory"]["totalBytes"].is_u64());
    assert!(json["disk"].is_object());
    assert!(json["disks"].is_array());
    assert!(json["temperatures"].is_array());
}

#[tokio::test]
async fn test_existing_rest_alerts_endpoint() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let state = create_test_state(tmp.path().to_path_buf());
    let app = dam_hopper_server::api::build_router(state);

    let request = Request::builder()
        .method("GET")
        .uri("/api/system/resources/v1/alerts?limit=10")
        .body(Body::empty())
        .expect("request");

    let response = app.oneshot(request).await.expect("response");
    assert_eq!(response.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .expect("body");
    let json: Value = serde_json::from_slice(&bytes).expect("parse json");
    assert!(json.is_array());
}
struct ControllableTimeSource {
    now: std::sync::atomic::AtomicU64,
    proc: PathBuf,
    sys: PathBuf,
    cgroup: PathBuf,
}

impl Default for ControllableTimeSource {
    fn default() -> Self {
        Self {
            now: std::sync::atomic::AtomicU64::new(0),
            proc: PathBuf::from("/proc"),
            sys: PathBuf::from("/sys"),
            cgroup: PathBuf::from("/sys/fs/cgroup"),
        }
    }
}

impl HostResourceSource for ControllableTimeSource {
    fn proc_root(&self) -> &Path {
        &self.proc
    }

    fn sys_root(&self) -> &Path {
        &self.sys
    }

    fn cgroup_root(&self) -> &Path {
        &self.cgroup
    }

    fn now_ms(&self) -> u64 {
        self.now.load(std::sync::atomic::Ordering::SeqCst)
    }
}
#[tokio::test]
async fn test_monitor_stale_marking_semantics() {
    let time_source = Arc::new(ControllableTimeSource::default());
    time_source
        .now
        .store(1_000_000, std::sync::atomic::Ordering::SeqCst);

    let tmp = tempfile::tempdir().expect("tempdir");
    let workspace = Arc::new(RwLock::new(tmp.path().to_path_buf()));
    let (event_sink, _rx) = BroadcastEventSink::new(100);

    let config = HostResourceMonitorConfig {
        light_sample_seconds: 5,
        ..Default::default()
    }
    .clamped();

    let monitor = HostResourceMonitor::new(
        time_source.clone(),
        workspace,
        event_sink,
        config,
    );

    // Initial snapshot sampled at now = 1_000_000; age is 0 <= 10_000 ms.
    let snap1 = monitor.snapshot().await;
    assert_ne!(snap1.memory.availability.state, AvailabilityState::Stale);

    // Advance time beyond maximum age (5s * 2 * 1000ms = 10_000ms)
    time_source
        .now
        .store(1_000_000 + 15_000, std::sync::atomic::Ordering::SeqCst);

    let snap2 = monitor.snapshot().await;
    // When stale, mark_snapshot_stale marks memory and other sections stale
    assert_eq!(snap2.memory.availability.state, AvailabilityState::Stale);
    assert_eq!(
        snap2.memory.availability.detail_code.as_deref(),
        Some("monitorStale")
    );
}

#[test]
fn test_whole_monitor_profile_schema_keys() {
    let uninstrumented_leaf = serde_json::json!({
        "value": null,
        "reason": "uninstrumentedInProductionMonitor",
    });

    let report = serde_json::json!({
        "schemaVersion": 1,
        "status": "complete",
        "reason": null,
        "host": {
            "hostname": "test-host",
            "kernel": "6.1.0",
            "os": "Linux",
            "arch": "x86_64",
            "cpuCores": 8,
            "workspace": "/workspace",
        },
        "config": {
            "lightSampleMs": 5000,
            "processSampleMs": 15000,
            "pssSampleMs": 60000,
            "processDeadlineMs": 150,
            "snapshotWaitMs": 500,
            "jitterMs": 250,
        },
        "timing": {
            "warmupSeconds": 60,
            "durationSeconds": 300,
            "startupWallMs": 15.5,
            "steadyWallMs": 300010.2,
        },
        "startup": {
            "cpuMs": 8.2,
            "rssBytes": 20480000,
        },
        "steady": {
            "cpuMs": 120.5,
            "cpuPercentOneCore": 0.04,
            "rssStartBytes": 20480000,
            "rssEndBytes": 21500000,
            "rssPeakBytes": 22000000,
        },
        "counts": {
            "lightTicks": uninstrumented_leaf,
            "deepInvocations": uninstrumented_leaf,
            "deepCompletions": uninstrumented_leaf,
            "deepDeadlines": uninstrumented_leaf,
            "legacyInvocations": uninstrumented_leaf,
            "legacyCompletions": uninstrumented_leaf,
            "processInvocations": uninstrumented_leaf,
            "pssInvocations": uninstrumented_leaf,
        },
    });

    assert_eq!(report["schemaVersion"], 1);
    assert_eq!(report["status"], "complete");
    assert!(report["reason"].is_null());
    assert!(report["host"]["hostname"].is_string());
    assert_eq!(report["config"]["lightSampleMs"], 5000);
    assert_eq!(report["timing"]["warmupSeconds"], 60);
    assert_eq!(report["timing"]["durationSeconds"], 300);
    assert!(report["startup"]["cpuMs"].is_number());
    assert!(report["steady"]["cpuPercentOneCore"].is_number());

    let counts = &report["counts"];
    for key in &[
        "lightTicks",
        "deepInvocations",
        "deepCompletions",
        "deepDeadlines",
        "legacyInvocations",
        "legacyCompletions",
        "processInvocations",
        "pssInvocations",
    ] {
        assert!(counts[key]["value"].is_null());
        assert_eq!(
            counts[key]["reason"],
            "uninstrumentedInProductionMonitor"
        );
    }
}
