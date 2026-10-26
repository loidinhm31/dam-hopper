#![cfg(target_os = "linux")]

mod common;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use common::semantic_fixtures::PackagedToolchain;
use dam_hopper_server::{
    agent_store::AgentStoreService,
    api::{
        router::{build_router_with_origins, parse_cors_origins},
        semantic_ws::{
            subscribe_semantic_socket_observations, SemanticSocketObservationKind,
            SEMANTIC_SUBPROTOCOL,
        },
    },
    auth::model::{chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole},
    auth::{AUTH_PROTOCOL_VERSION, MOCK_EXPIRY_SECS},
    config::{
        DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, RestartPolicy,
        ServerConfig, WorkspaceInfo,
    },
    crypto::DamHopperOpaqueSuite,
    diagnostics::DiagnosticStore,
    fs::FsSubsystem,
    pty::{BroadcastEventSink, PtySessionManager},
    semantic::{
        child::{ChildStatus, SemanticChildOwner},
        protocol::{
            ConnectionId, NavigationParams, Position, Range, SessionKey,
            TextDocumentContentChangeEvent, TextDocumentIdentifier,
        },
        reaper::{get_all_descendants, is_pgid_empty, sample_tree_resources, verify_pids_dead},
        resources::{
            linux::{LinuxResourceController, ResourceMode},
            ADAPTIVE_SYNC_THRESHOLD_BYTES, MAX_DOCUMENT_BYTES, MAX_GLOBAL_SEMANTIC_TREES,
            MAX_OPEN_DOCUMENTS_PER_SESSION, TOTAL_TEARDOWN_BUDGET,
        },
        session::{path_to_file_uri, SemanticSessionHandle, SessionDiagnosticsSnapshot},
        supervisor::{SemanticSupervisor, SupervisorError},
        tool_profile::{
            PINNED_LOCKFILE_SHA256, PINNED_NODE_SHA256, PINNED_PACKAGE_JSON_SHA256,
            PINNED_TSLS_ENTRYPOINT_SHA256, PINNED_TSSERVER_IMPL_SHA256, PINNED_TSSERVER_SHA256,
            PINNED_TYPESCRIPT_JS_SHA256,
        },
    },
    state::AppState,
};
use futures_util::{FutureExt, SinkExt, StreamExt};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use reqwest::{header, Client};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{handshake::client::generate_key, http, Message},
};

const QUAL_SECRET: &str = "semantic-resource-qualification-jwt-secret-v1";

fn nearest_rank_percentile_opt(samples: &[f64], percentile: f64) -> Option<f64> {
    if samples.is_empty() {
        return None;
    }
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let rank = ((percentile * (sorted.len() as f64)).ceil() as usize).saturating_sub(1);
    Some(sorted[rank.min(sorted.len() - 1)])
}

fn nearest_rank_percentile(samples: &[f64], percentile: f64) -> f64 {
    nearest_rank_percentile_opt(samples, percentile)
        .expect("nearest_rank_percentile requires non-empty samples")
}

fn summarize_latency_series(samples: &[f64]) -> Value {
    if samples.is_empty() {
        return json!({
            "sampleCount": 0,
            "minMs": null,
            "p50Ms": null,
            "p95Ms": null,
            "maxMs": null,
        });
    }
    json!({
        "sampleCount": samples.len(),
        "minMs": nearest_rank_percentile_opt(samples, 0.0),
        "p50Ms": nearest_rank_percentile_opt(samples, 0.50),
        "p95Ms": nearest_rank_percentile_opt(samples, 0.95),
        "maxMs": nearest_rank_percentile_opt(samples, 1.00),
    })
}

const CORE_ENDPOINT_KEYS: [&str; 5] = [
    "health",
    "workspaceStatus",
    "fsList",
    "gitRoots",
    "ptyRoundTrip",
];

fn summarize_per_endpoint(per_endpoint: &HashMap<&'static str, Vec<f64>>) -> Value {
    let mut map = serde_json::Map::new();
    for key in CORE_ENDPOINT_KEYS {
        let slice = per_endpoint.get(key).map(Vec::as_slice).unwrap_or(&[]);
        map.insert(key.to_string(), summarize_latency_series(slice));
    }
    Value::Object(map)
}

fn extract_result_array(envelope: &Value) -> &Vec<Value> {
    envelope
        .get("result")
        .and_then(|r| r.as_array())
        .unwrap_or_else(|| panic!("expected JSON-RPC result array in envelope: {envelope}"))
}

fn assert_definition_oracle(envelope: &Value, expected_line: u32, expected_char: u32) {
    let arr = extract_result_array(envelope);
    assert!(
        !arr.is_empty(),
        "expected non-empty definition result: {envelope}"
    );
    let first = &arr[0];
    let start = first
        .get("targetSelectionRange")
        .or_else(|| first.get("range"))
        .and_then(|r| r.get("start"))
        .expect("range.start");
    let line = start.get("line").and_then(|l| l.as_u64()).expect("line") as u32;
    let ch = start
        .get("character")
        .and_then(|c| c.as_u64())
        .expect("char") as u32;
    assert_eq!(
        (line, ch),
        (expected_line, expected_char),
        "definition coordinate mismatch in {envelope}"
    );
}

fn assert_implementation_oracle(
    envelope: &Value,
    expected_min_count: usize,
    expected_lines: &[u32],
) {
    let arr = extract_result_array(envelope);
    assert!(
        arr.len() >= expected_min_count,
        "expected >= {expected_min_count} implementations, got: {envelope}"
    );
    for &exp_line in expected_lines {
        let found = arr.iter().any(|loc| {
            loc.get("targetSelectionRange")
                .or_else(|| loc.get("range"))
                .and_then(|r| r.get("start"))
                .and_then(|s| s.get("line"))
                .and_then(|l| l.as_u64())
                == Some(exp_line as u64)
        });
        assert!(
            found,
            "expected implementation at line {exp_line} in {envelope}"
        );
    }
}

fn verify_corpus_manifest_digest(
    corpus_dir: &Path,
    expected_files: usize,
    expected_bytes_per_file: usize,
    expected_digest: &str,
) {
    let mut rel_paths = Vec::new();
    for pkg in ["core", "app"] {
        let dir = corpus_dir.join("packages").join(pkg);
        if let Ok(entries) = fs::read_dir(&dir) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with("module_") {
                    rel_paths.push((format!("packages/{pkg}/{name}"), e.path()));
                }
            }
        }
    }
    // Manifest hashes files in generator index order, not package/path order.
    rel_paths.sort_by_key(|(relative, _)| {
        relative
            .rsplit('/')
            .next()
            .unwrap()
            .strip_prefix("module_")
            .unwrap()
            .split('.')
            .next()
            .unwrap()
            .parse::<usize>()
            .unwrap()
    });
    assert_eq!(
        rel_paths.len(),
        expected_files,
        "corpus file count mismatch in {:?}",
        corpus_dir
    );
    let mut tree_hasher = Sha256::new();
    for (rel, abs) in &rel_paths {
        let bytes = fs::read(abs).expect("read corpus file");
        assert_eq!(
            bytes.len(),
            expected_bytes_per_file,
            "file size mismatch on {rel}"
        );
        let file_sha = hex::encode(Sha256::digest(&bytes));
        tree_hasher.update(format!("{rel}:{file_sha}\n").as_bytes());
    }
    let actual_digest = hex::encode(tree_hasher.finalize());
    assert_eq!(
        actual_digest, expected_digest,
        "corpus digest mismatch for {:?}",
        corpus_dir
    );
}

/// Git roots require a local `.git` marker, not the enclosing checkout's repository.
/// Copy the corpus so Git setup and PTY/core probes never mutate checked-in fixtures.
fn isolated_git_fixture(source: &Path, destination: &Path) -> PathBuf {
    fn copy_corpus(source: &Path, destination: &Path) {
        fs::create_dir_all(destination).expect("create isolated corpus directory");
        for entry in fs::read_dir(source).expect("read corpus directory") {
            let entry = entry.expect("read corpus entry");
            if entry.file_name() == ".git" {
                continue;
            }
            let target = destination.join(entry.file_name());
            let kind = entry.file_type().expect("read corpus entry type");
            if kind.is_dir() {
                copy_corpus(&entry.path(), &target);
            } else {
                assert!(
                    kind.is_file(),
                    "corpus entries must be regular files or directories"
                );
                fs::copy(entry.path(), target).expect("copy corpus file");
            }
        }
    }

    copy_corpus(source, destination);
    git2::Repository::init(destination).expect("initialize isolated corpus Git repository");
    destination.to_path_buf()
}

async fn setup_authenticated_app(
    tmp: &TempDir,
    projects: Vec<(&str, PathBuf)>,
    supervisor: Arc<SemanticSupervisor>,
) -> (AppState, SocketAddr, String) {
    let now = chrono::Utc::now();
    let exp = chrono::DateTime::from_timestamp(MOCK_EXPIRY_SECS as i64, 0).unwrap();
    let username = "qual-admin";
    let sid = "session-qual-admin";

    let store = dam_hopper_server::auth::AuthStore::open_sqlite(tmp.path().join("qual-auth.db"))
        .await
        .unwrap();
    store
        .create_user(UserRecord {
            id: None,
            username: username.to_string(),
            password_hash: String::new(),
            is_enabled: true,
            role: UserRole::Admin,
            auth_version: 0,
            mfa: None,
            mfa_attempt_window_started_at: None,
            mfa_attempt_count: 0,
            mfa_blocked_until: None,
        })
        .await
        .unwrap();
    store
        .create_session(AuthSession {
            id: sid.to_string(),
            username: username.to_string(),
            auth_version: 0,
            credential_version: 0,
            issued_at: chrono_to_bson(now),
            expires_at: chrono_to_bson(exp),
            mfa_verified_at: chrono_to_bson(now),
            revoked_at: None,
            user_agent: None,
        })
        .await
        .unwrap();
    let auth_service = dam_hopper_server::auth::AuthService::with_system_clock(Some(store), None);
    let token = AuthClaims {
        v: AUTH_PROTOCOL_VERSION,
        sub: username.to_string(),
        sid: sid.to_string(),
        auth_version: 0,
        credential_version: 0,
        iat: now.timestamp() as usize,
        exp: MOCK_EXPIRY_SECS,
    }
    .encode(QUAL_SECRET)
    .unwrap();

    let mut proj_configs = Vec::new();
    let mut fs_roots = Vec::with_capacity(projects.len());
    for (name, path) in projects {
        fs_roots.push((name.to_string(), path.clone()));
        proj_configs.push(ProjectConfig {
            name: name.to_string(),
            path: path.to_string_lossy().to_string(),
            project_type: ProjectType::Custom,
            services: None,
            commands: Some(HashMap::new()),
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: RestartPolicy::Never,
            restart_max_retries: 0,
            health_check_url: None,
        });
    }

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "semantic-qual-workspace".into(),
            root: tmp.path().to_string_lossy().to_string(),
        },
        agent_store: None,
        server: ServerConfig::default(),
        projects: proj_configs,
        features: FeaturesConfig::default(),
        config_path: tmp.path().join("dam-hopper.toml"),
    };

    let (event_sink, _rx) = BroadcastEventSink::new(256);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
    let agent_store = AgentStoreService::new(tmp.path().join(".dam-hopper/agent-store"));
    let fs_sub = FsSubsystem::new(fs_roots);
    let tunnel_manager = common::make_tunnel_manager(&event_sink);
    let diagnostics = DiagnosticStore::new(tmp.path().join("diagnostics.jsonl"));

    let state = AppState::new(
        tmp.path().to_path_buf(),
        config,
        GlobalConfig::default(),
        pty_manager,
        agent_store,
        event_sink,
        QUAL_SECRET.to_string(),
        fs_sub,
        None,
        false,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )
    .expect("create AppState")
    .with_auth_service(Arc::new(auth_service))
    .with_semantic_supervisor(supervisor);

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let allowed_origins =
        parse_cors_origins(Some("http://localhost:15173,http://127.0.0.1:15173")).unwrap();
    let router = build_router_with_origins(state.clone(), allowed_origins);
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    (state, addr, token)
}

/// Runs the identical 5-surface core + PTY terminal probe schedule (`samples_per_endpoint` each):
/// 1. `GET /api/health`
/// 2. `GET /api/workspace/status`
/// 3. `GET /api/fs/list?project=small&path=.`
/// 4. `GET /api/git/small/roots`
/// 5. Real PTY terminal over `/api/terminal` + `/ws` (`terminal:write` -> `terminal:output`, tracking `terminal:lagged`)
struct CoreScheduleResult {
    all_latencies: Vec<f64>,
    per_endpoint: HashMap<&'static str, Vec<f64>>,
    terminal_drops: u64,
    window_start: Instant,
    window_end: Instant,
    completed_rounds: usize,
    observed_probes_during_nav: usize,
}

struct ProbeTerminal {
    manager: PtySessionManager,
    id: String,
}
impl Drop for ProbeTerminal {
    fn drop(&mut self) {
        let _ = self.manager.remove(&self.id);
    }
}

async fn run_overlapped_core_and_terminal_schedule(
    client: &Client,
    addr: SocketAddr,
    token: &str,
    pty_manager: &PtySessionManager,
    samples_per_endpoint: usize,
    start_barrier: Option<Arc<tokio::sync::Barrier>>,
    nav_active: Option<Arc<AtomicBool>>,
    nav_completed_required: Option<Arc<AtomicBool>>,
    core_active: Option<Arc<AtomicBool>>,
    core_completed_required: Option<Arc<AtomicBool>>,
) -> Result<CoreScheduleResult, String> {
    let auth_header = format!("Bearer {token}");
    let pty_id = format!("qual-pty-{}", rand::random::<u32>());
    let _terminal_cleanup = ProbeTerminal {
        manager: pty_manager.clone(),
        id: pty_id.clone(),
    };

    let create_resp = client
        .post(format!("http://{addr}/api/terminal"))
        .header(header::AUTHORIZATION, &auth_header)
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            json!({
                "id": pty_id,
                "command": "/bin/cat",
                "cols": 80,
                "rows": 24,
                "project": "small"
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|e| format!("create terminal session failed: {e}"))?;
    if !create_resp.status().is_success() {
        return Err(format!(
            "POST /api/terminal failed with {}",
            create_resp.status()
        ));
    }

    let ws_req = http::Request::builder()
        .uri(format!("ws://{addr}/ws?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .body(())
        .unwrap();
    let (mut ws, _) = connect_async(ws_req)
        .await
        .map_err(|e| format!("connect core /ws failed: {e}"))?;

    ws.send(Message::Text(
        json!({ "kind": "terminal:attach", "id": pty_id })
            .to_string()
            .into(),
    ))
    .await
    .map_err(|e| format!("send terminal:attach failed: {e}"))?;

    if let Some(b) = &start_barrier {
        b.wait().await;
    }
    let window_start = Instant::now();
    if let Some(flag) = &core_active {
        flag.store(true, Ordering::SeqCst);
    }

    let mut all_latencies = Vec::with_capacity(samples_per_endpoint * 5);
    let mut per_endpoint: HashMap<&'static str, Vec<f64>> = HashMap::new();
    for key in CORE_ENDPOINT_KEYS {
        per_endpoint.insert(key, Vec::with_capacity(samples_per_endpoint));
    }
    let mut terminal_drops = 0u64;
    let mut completed_rounds = 0usize;
    let mut observed_probes_during_nav = 0usize;

    loop {
        let i = completed_rounds;
        let http_probes: [(&'static str, String); 4] = [
            ("health", format!("http://{addr}/api/health")),
            (
                "workspaceStatus",
                format!("http://{addr}/api/workspace/status"),
            ),
            (
                "fsList",
                format!("http://{addr}/api/fs/list?project=small&path=."),
            ),
            ("gitRoots", format!("http://{addr}/api/git/small/roots")),
        ];
        for (ep_key, url) in http_probes {
            let is_nav_live = nav_active
                .as_ref()
                .map(|f| f.load(Ordering::SeqCst))
                .unwrap_or(false);
            let t0 = Instant::now();
            let resp = client
                .get(&url)
                .header(header::AUTHORIZATION, &auth_header)
                .send()
                .await
                .map_err(|e| format!("core HTTP probe {url} failed: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!("core probe {url} failed with {}", resp.status()));
            }
            let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
            if is_nav_live
                || nav_active
                    .as_ref()
                    .map(|f| f.load(Ordering::SeqCst))
                    .unwrap_or(false)
            {
                observed_probes_during_nav += 1;
            }
            if i < samples_per_endpoint {
                all_latencies.push(elapsed_ms);
                per_endpoint.get_mut(ep_key).unwrap().push(elapsed_ms);
            }
        }

        let is_nav_live_pty = nav_active
            .as_ref()
            .map(|f| f.load(Ordering::SeqCst))
            .unwrap_or(false);
        let marker = format!("qping_{i}_{}", rand::random::<u16>());
        let t_pty = Instant::now();
        ws.send(Message::Text(
            json!({
                "kind": "terminal:write",
                "id": pty_id,
                "data": format!("{marker}\n")
            })
            .to_string()
            .into(),
        ))
        .await
        .map_err(|e| format!("send terminal:write failed: {e}"))?;

        let mut matched = false;
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            let timeout_rem = deadline.saturating_duration_since(Instant::now());
            match tokio::time::timeout(timeout_rem, ws.next()).await {
                Ok(Some(Ok(Message::Text(txt)))) => {
                    if let Ok(msg) = serde_json::from_str::<Value>(&txt) {
                        if msg.get("kind") == Some(&json!("terminal:lagged")) {
                            let d = msg.get("dropped").and_then(|v| v.as_u64()).unwrap_or(1);
                            terminal_drops += d;
                        } else if msg.get("kind") == Some(&json!("terminal:output"))
                            && msg.get("id") == Some(&json!(pty_id))
                        {
                            if let Some(data) = msg.get("data").and_then(|d| d.as_str()) {
                                if data.contains(&marker) {
                                    let elapsed_ms = t_pty.elapsed().as_secs_f64() * 1000.0;
                                    if i < samples_per_endpoint {
                                        all_latencies.push(elapsed_ms);
                                        per_endpoint
                                            .get_mut("ptyRoundTrip")
                                            .unwrap()
                                            .push(elapsed_ms);
                                    }
                                    matched = true;
                                    break;
                                }
                            }
                        }
                    }
                }
                _ => break,
            }
        }
        if !matched {
            terminal_drops += 1;
        }
        if is_nav_live_pty
            || nav_active
                .as_ref()
                .map(|f| f.load(Ordering::SeqCst))
                .unwrap_or(false)
        {
            observed_probes_during_nav += 1;
        }

        completed_rounds += 1;
        if completed_rounds >= samples_per_endpoint {
            if let Some(done) = &core_completed_required {
                done.store(true, Ordering::SeqCst);
            }
            let nav_done = nav_completed_required
                .as_ref()
                .map(|f| f.load(Ordering::SeqCst))
                .unwrap_or(true);
            if nav_done {
                break;
            }
        }
    }

    if let Some(flag) = &core_active {
        flag.store(false, Ordering::SeqCst);
    }
    let window_end = Instant::now();

    let _ = client
        .delete(format!("http://{addr}/api/terminal/{pty_id}"))
        .header(header::AUTHORIZATION, &auth_header)
        .send()
        .await;
    let _ = ws.close(None).await;

    Ok(CoreScheduleResult {
        all_latencies,
        per_endpoint,
        terminal_drops,
        window_start,
        window_end,
        completed_rounds,
        observed_probes_during_nav,
    })
}

async fn run_core_and_terminal_schedule(
    client: &Client,
    addr: SocketAddr,
    token: &str,
    pty_manager: &PtySessionManager,
    samples_per_endpoint: usize,
) -> (Vec<f64>, u64) {
    let res = run_overlapped_core_and_terminal_schedule(
        client,
        addr,
        token,
        pty_manager,
        samples_per_endpoint,
        None,
        None,
        None,
        None,
        None,
    )
    .await
    .expect("core and terminal schedule");
    (res.all_latencies, res.terminal_drops)
}

/// Exercises `/ws/semantic/v1` for outside-target standard library definition (`lib.es5.d.ts`)
/// and path traversal attempts, returning the count of unauthorized or outside-target host path disclosures.
async fn measure_ws_outside_target_disclosures(
    addr: SocketAddr,
    token: &str,
    project_name: &str,
    target_root: &Path,
    release_root: &Path,
) -> usize {
    let ws_req = http::Request::builder()
        .uri(format!("ws://{addr}/ws/semantic/v1?token={token}"))
        .header("Host", addr.to_string())
        .header("Connection", "Upgrade")
        .header("Upgrade", "websocket")
        .header("Sec-WebSocket-Version", "13")
        .header("Sec-WebSocket-Key", generate_key())
        .header("Sec-WebSocket-Protocol", SEMANTIC_SUBPROTOCOL)
        .body(())
        .unwrap();
    let (mut ws, _) = connect_async(ws_req)
        .await
        .expect("connect /ws/semantic/v1");

    async fn recv_json(
        ws: &mut tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        request_id: u64,
    ) -> Value {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let message = tokio::time::timeout_at(deadline, ws.next())
                .await
                .unwrap_or_else(|_| panic!("semantic response {request_id} timed out"))
                .unwrap_or_else(|| panic!("semantic connection ended before response {request_id}"))
                .unwrap_or_else(|_| {
                    panic!("semantic transport failed before response {request_id}")
                });
            match message {
                Message::Text(text) => {
                    let response: Value =
                        serde_json::from_str(&text).expect("semantic response must be valid JSON");
                    if response["id"].as_u64() == Some(request_id) {
                        return response;
                    }
                }
                Message::Ping(_) | Message::Pong(_) => {}
                Message::Close(frame) => panic!(
                    "semantic connection closed before response {request_id}: code {:?}",
                    frame.map(|frame| frame.code)
                ),
                _ => panic!("unexpected semantic binary frame before response {request_id}"),
            }
        }
    }

    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "damHopper/attachTarget",
            "params": { "target": { "project": project_name }, "descriptor": "typescript" }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let attach_res = recv_json(&mut ws, 1).await;
    let target_id = attach_res["result"]["targetId"]
        .as_str()
        .unwrap()
        .to_string();

    ws.send(Message::Text(
        json!({ "jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {} })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    let init_res = recv_json(&mut ws, 2).await;
    assert!(
        init_res.get("result").is_some(),
        "semantic initialize rejected"
    );

    ws.send(Message::Text(
        json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} })
            .to_string()
            .into(),
    ))
    .await
    .unwrap();

    let vuri = format!("dam-hopper://semantic/{target_id}/packages/core/module_000.ts");
    let stdlib_probe_text =
        "const arr = [1, 2, 3];\nexport const mapped = arr.map((x) => x + 1);\n";
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": {
                "textDocument": {
                    "uri": vuri,
                    "languageId": "typescript",
                    "version": 1,
                    "text": stdlib_probe_text
                }
            }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();

    // Query definition on `.map` (resolves to bundled typescript/lib/lib.es5.d.ts outside target root)
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "textDocument/definition",
            "params": {
                "textDocument": { "uri": vuri },
                "position": { "line": 1, "character": 27 },
                "damHopperDocumentVersion": 1
            }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let def_outside = recv_json(&mut ws, 3).await;

    // Query traversal URI
    ws.send(Message::Text(
        json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "textDocument/definition",
            "params": {
                "textDocument": { "uri": format!("dam-hopper://semantic/{target_id}/../outside.ts") },
                "position": { "line": 0, "character": 0 },
                "damHopperDocumentVersion": 1
            }
        })
        .to_string()
        .into(),
    ))
    .await
    .unwrap();
    let def_traversal = recv_json(&mut ws, 4).await;

    let _ = ws.close(None).await;

    let mut disclosures = 0usize;
    let target_root_str = target_root.to_string_lossy();
    let release_root_str = release_root.to_string_lossy();

    for frame in [&def_outside, &def_traversal] {
        let serialized = serde_json::to_string(frame).unwrap();
        if serialized.contains("file://")
            || serialized.contains(target_root_str.as_ref())
            || serialized.contains(release_root_str.as_ref())
            || serialized.contains("lib.es5.d.ts")
        {
            disclosures += 1;
        }
    }
    if def_outside
        .get("result")
        .and_then(|r| r.get("outsideTarget"))
        != Some(&json!(true))
    {
        disclosures += 1;
    }

    disclosures
}

#[tokio::test]
async fn test_portable_only_degradation_and_application_admission_caps_with_packaged_tuple() {
    let packaged = PackagedToolchain::new();
    let profile = packaged.tool_profile();
    assert!(profile.is_packaged_tuple_verified());

    let fake_cgroup = packaged.root.join("unavailable_cgroup_v2");
    let controller = LinuxResourceController::new(&fake_cgroup);
    let (mode, scope) = controller.prepare_child_scope("sess-portable-qual");
    assert!(scope.is_none());
    assert!(matches!(
        mode,
        ResourceMode::PortableOnly {
            degraded: true,
            v8_heap_hint_mb: 256,
            monitored_tree_limit: 8,
            ..
        }
    ));

    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let ws1 = tempfile::tempdir().unwrap();
    let ws2 = tempfile::tempdir().unwrap();
    let ws3 = tempfile::tempdir().unwrap();

    let c1 = ConnectionId("conn-cap-1".into());
    let c2 = ConnectionId("conn-cap-2".into());
    let c3 = ConnectionId("conn-cap-3".into());
    let e1 = supervisor.register_connection(&c1).await;
    let e2 = supervisor.register_connection(&c2).await;
    let e3 = supervisor.register_connection(&c3).await;

    let s1 = supervisor
        .get_or_create_session(c1.clone(), "p1", None, ws1.path().to_path_buf(), e1)
        .await
        .expect("tree 1 admitted");
    s1.initialize().await.expect("init tree 1");

    // 2nd tree on same connection c1 must fail with ConnectionTreeLimitExceeded(1)
    let same_conn_res = supervisor
        .get_or_create_session(c1, "p2", None, ws2.path().to_path_buf(), e1)
        .await;
    assert!(matches!(
        same_conn_res,
        Err(SupervisorError::ConnectionTreeLimitExceeded(1))
    ));

    let s2 = supervisor
        .get_or_create_session(c2, "p2", None, ws2.path().to_path_buf(), e2)
        .await
        .expect("tree 2 admitted");
    s2.initialize().await.expect("init tree 2");

    // 3rd global tree must be rejected with GlobalTreeLimitExceeded(2)
    assert_eq!(MAX_GLOBAL_SEMANTIC_TREES, 2);
    let s3_res = supervisor
        .get_or_create_session(c3, "p3", None, ws3.path().to_path_buf(), e3)
        .await;
    assert!(matches!(
        s3_res,
        Err(SupervisorError::GlobalTreeLimitExceeded(2))
    ));

    for idx in 0..MAX_OPEN_DOCUMENTS_PER_SESSION {
        let uri = path_to_file_uri(&ws1.path().join(format!("doc_{idx}.ts")));
        s1.did_open(
            uri,
            "typescript".into(),
            1,
            format!("export const v_{idx} = {idx};\n"),
        )
        .await
        .expect("open doc within cap");
    }
    let overflow_uri = path_to_file_uri(&ws1.path().join("doc_overflow.ts"));
    assert!(
        s1.did_open(
            overflow_uri,
            "typescript".into(),
            1,
            "export const x = 1;\n".into()
        )
        .await
        .is_err(),
        "17th open document must be rejected"
    );

    let big_uri = path_to_file_uri(&ws2.path().join("oversized.ts"));
    let oversized_text = "a".repeat(MAX_DOCUMENT_BYTES + 1);
    assert!(
        s2.did_open(big_uri, "typescript".into(), 1, oversized_text)
            .await
            .is_err(),
        "Document > 1 MiB must be rejected"
    );

    let pgid1 = s1.get_pgid().await.expect("pgid1");
    let pgid2 = s2.get_pgid().await.expect("pgid2");
    let pids1 = sample_tree_resources(pgid1).pids;
    let pids2 = sample_tree_resources(pgid2).pids;

    let t0 = Instant::now();
    supervisor.shutdown().await;
    let reap_ms = t0.elapsed().as_secs_f64() * 1000.0;
    assert!(reap_ms <= 6000.0, "Reap exceeded 6s budget: {reap_ms:.1}ms");
    assert!(verify_pids_dead(&pids1) && is_pgid_empty(pgid1));
    assert!(verify_pids_dead(&pids2) && is_pgid_empty(pgid2));
}

#[tokio::test]
async fn test_portable_sampled_tree_limit_enforcement_and_zero_orphan_reap() {
    let packaged = PackagedToolchain::new();
    let profile = packaged.tool_profile();
    let ws = tempfile::tempdir().unwrap();
    fs::write(ws.path().join("index.ts"), "export const x = 1;\n").unwrap();

    let spec = profile
        .create_launch_spec(ws.path(), ws.path())
        .expect("launch spec")
        .with_max_processes_per_tree(1);

    let (mut handle, _rx) = SemanticChildOwner::spawn(&spec).expect("spawn child");
    let pgid = handle.pgid;

    let init_msg = serde_json::to_vec(&json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "processId": std::process::id(),
            "rootUri": path_to_file_uri(ws.path()),
            "capabilities": {},
            "initializationOptions": {
                "disableAutomaticTypingAcquisition": true,
                "plugins": [],
                "tsserver": {
                    "path": profile.tsserver_path().to_string_lossy(),
                    "useSyntaxServer": "never"
                }
            }
        }
    }))
    .unwrap();
    let _ = handle.send_message(init_msg);

    let t0 = Instant::now();
    let status = tokio::time::timeout(
        TOTAL_TEARDOWN_BUDGET + Duration::from_secs(2),
        handle.wait_terminated(),
    )
    .await
    .expect("portable tree monitor must terminate tree within budget");
    let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;

    assert!(
        matches!(status, ChildStatus::Crashed(_)),
        "Tree limit must terminate the child"
    );
    assert!(
        elapsed_ms <= 6000.0,
        "Portable limit kill + reap took {elapsed_ms:.1}ms"
    );
    assert!(
        is_pgid_empty(pgid),
        "Process group must be empty after portable monitor kill"
    );
}

#[test]
fn test_hard_cgroup_detection_and_honest_capability_reporting() {
    let controller = LinuxResourceController::default();
    let (mode, scope) = controller.prepare_child_scope("qual-probe-session");
    match mode {
        ResourceMode::Hard {
            cgroup_path: _,
            memory_max_bytes,
            cpu_quota_us,
            cpu_period_us,
            tasks_max,
        } => {
            assert_eq!(memory_max_bytes, 768 * 1024 * 1024);
            assert_eq!(cpu_quota_us, 50_000);
            assert_eq!(cpu_period_us, 100_000);
            assert_eq!(tasks_max, 64);
            let scope = scope.expect("ResourceMode::Hard must provide ChildCgroupScope");
            assert!(scope
                .cgroup_path()
                .ends_with("dam-hopper-semantic-qual-probe-session"));
            drop(scope);
        }
        ResourceMode::PortableOnly {
            degraded,
            v8_heap_hint_mb,
            monitored_tree_limit,
            reason,
        } => {
            assert!(degraded);
            assert_eq!(v8_heap_hint_mb, 256);
            assert_eq!(monitored_tree_limit, 8);
            assert!(
                !reason.is_empty(),
                "Degraded portable mode must report concrete reason"
            );
            assert!(scope.is_none());
        }
    }
}

#[tokio::test]
async fn test_deterministic_fixture_manifest_and_small_corpus_navigation_with_core_responsiveness()
{
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let manifest_path = manifest_dir.join("tests/fixtures/semantic-fixtures-manifest.json");
    let manifest: Value =
        serde_json::from_slice(&fs::read(&manifest_path).expect("read manifest")).unwrap();
    assert_eq!(manifest["fixtureSeed"], json!(24301));

    let small_digest = manifest["tiers"]["small"]["corpusDigest"].as_str().unwrap();
    let medium_digest = manifest["tiers"]["medium"]["corpusDigest"]
        .as_str()
        .unwrap();
    let small_dir = manifest_dir.join("tests/fixtures/semantic-small");
    let medium_dir = manifest_dir.join("tests/fixtures/semantic-medium");

    verify_corpus_manifest_digest(&small_dir, 8, 4096, small_digest);
    verify_corpus_manifest_digest(&medium_dir, 64, 16384, medium_digest);

    let packaged = PackagedToolchain::new();
    let supervisor = Arc::new(SemanticSupervisor::new(Some(packaged.tool_profile())));
    supervisor.set_enabled(true).await;

    let tmp = TempDir::new().unwrap();
    let small_dir = isolated_git_fixture(&small_dir, &tmp.path().join("small"));
    verify_corpus_manifest_digest(&small_dir, 8, 4096, small_digest);
    let (_state, addr, token) =
        setup_authenticated_app(&tmp, vec![("small", small_dir.clone())], supervisor.clone()).await;

    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    let conn = ConnectionId("conn-small-qual".into());
    let ep = supervisor.register_connection(&conn).await;
    let t_cold0 = Instant::now();
    let session = supervisor
        .get_or_create_session(conn, "small", None, small_dir.clone(), ep)
        .await
        .unwrap();
    session.initialize().await.expect("initialize session");

    let mod0_path = small_dir.join("packages/core/module_000.ts");
    let mod0_uri = path_to_file_uri(&mod0_path);
    let mod0_text = fs::read_to_string(&mod0_path).unwrap();
    session
        .did_open(mod0_uri.clone(), "typescript".into(), 1, mod0_text)
        .await
        .unwrap();

    let def0 = session
        .navigation(
            "textDocument/definition",
            NavigationParams {
                text_document: TextDocumentIdentifier {
                    uri: mod0_uri.clone(),
                },
                position: Position {
                    line: 16,
                    character: 40,
                }, // new PrimaryNode_0()
                dam_hopper_document_version: 1,
                dam_hopper_model_generation: None,
            },
        )
        .await
        .unwrap();
    let cold_ready_ms = t_cold0.elapsed().as_secs_f64() * 1000.0;
    assert!(
        cold_ready_ms <= 15_000.0,
        "cold ready exceeded 15s: {cold_ready_ms:.1}ms"
    );
    assert_definition_oracle(&def0, 5, 13);

    // Measure warm navigation alternating definition & implementation with exact coordinate oracles
    let mut nav_latencies = Vec::new();
    for i in 0..6 {
        let is_def = i % 2 == 0;
        let method = if is_def {
            "textDocument/definition"
        } else {
            "textDocument/implementation"
        };
        let pos = if is_def {
            Position {
                line: 16,
                character: 40,
            }
        } else {
            Position {
                line: 2,
                character: 18,
            }
        };
        let t_nav = Instant::now();
        let res = session
            .navigation(
                method,
                NavigationParams {
                    text_document: TextDocumentIdentifier {
                        uri: mod0_uri.clone(),
                    },
                    position: pos,
                    dam_hopper_document_version: 1,
                    dam_hopper_model_generation: None,
                },
            )
            .await
            .unwrap();
        nav_latencies.push(t_nav.elapsed().as_secs_f64() * 1000.0);
        if is_def {
            assert_definition_oracle(&res, 5, 13);
        } else {
            assert_implementation_oracle(&res, 2, &[5, 10]);
        }
    }

    let (core_latencies, term_drops) =
        run_core_and_terminal_schedule(&client, addr, &token, &_state.pty_manager, 5).await;
    assert_eq!(term_drops, 0, "expected 0 terminal drops");

    let disclosures =
        measure_ws_outside_target_disclosures(addr, &token, "small", &small_dir, &packaged.root)
            .await;
    assert_eq!(disclosures, 0, "expected 0 outside-target disclosures");

    let nav_p95 = nearest_rank_percentile(&nav_latencies, 0.95);
    let core_p95 = nearest_rank_percentile(&core_latencies, 0.95);
    assert!(
        nav_p95 <= 500.0,
        "small warm nav p95 {nav_p95:.2}ms > 500ms"
    );
    assert!(
        core_p95 <= 250.0,
        "core+terminal p95 {core_p95:.2}ms > 250ms"
    );

    let pgid = session.get_pgid().await.expect("pgid");
    let pids = sample_tree_resources(pgid).pids;
    let t_reap = Instant::now();
    supervisor.shutdown().await;
    let reap_ms = t_reap.elapsed().as_secs_f64() * 1000.0;
    assert!(reap_ms <= 6000.0);
    assert!(verify_pids_dead(&pids) && is_pgid_empty(pgid));
}

fn host_noise_snapshot() -> Value {
    let load = fs::read_to_string("/proc/loadavg").ok();
    let mut fields = load.as_deref().unwrap_or("").split_whitespace();
    let averages: [Option<f64>; 3] = std::array::from_fn(|_| fields.next()?.parse().ok());
    let memory_available = fs::read_to_string("/proc/meminfo").ok().and_then(|text| {
        text.lines().find_map(|line| {
            line.strip_prefix("MemAvailable:")?
                .split_whitespace()
                .next()?
                .parse::<u64>()
                .ok()?
                .checked_mul(1024)
        })
    });
    json!({
        "scope": "whole-host context, not isolated workload CPU",
        "loadAverage1m5m15m": averages,
        "memoryAvailableBytes": memory_available,
    })
}

fn clock_ticks_per_sec() -> u64 {
    let tck = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if tck > 0 {
        tck as u64
    } else {
        100
    }
}

fn page_size_bytes() -> u64 {
    let sz = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if sz > 0 {
        sz as u64
    } else {
        4096
    }
}

/// Reads `(pgrp, starttime_ticks, utime_plus_stime_ticks, rss_bytes)` for a live non-zombie process.
fn read_proc_cpu_and_rss(pid: u32) -> Option<(u32, u64, u64, u64)> {
    let stat_content = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rparen = stat_content.rfind(')')?;
    let after = stat_content.get(rparen + 2..)?;
    let fields: Vec<&str> = after.split_whitespace().collect();
    if fields.len() < 20 {
        return None;
    }
    let state_char = fields[0].chars().next()?;
    if matches!(state_char, 'Z' | 'X' | 'x') {
        return None;
    }
    let pgrp: u32 = fields[2].parse().ok()?;
    let utime: u64 = fields[11].parse().ok()?;
    let stime: u64 = fields[12].parse().ok()?;
    let starttime: u64 = fields[19].parse().ok()?;

    let statm_content = fs::read_to_string(format!("/proc/{pid}/statm")).ok()?;
    let resident_pages: u64 = statm_content.split_whitespace().nth(1)?.parse().ok()?;
    let rss_bytes = resident_pages.saturating_mul(page_size_bytes());

    Some((pgrp, starttime, utime.saturating_add(stime), rss_bytes))
}

fn is_semantic_engine_process(pid: u32) -> bool {
    if let Ok(raw) = fs::read(format!("/proc/{pid}/cmdline")) {
        let cmd = String::from_utf8_lossy(&raw);
        return cmd.contains("semantic-engine")
            || cmd.contains("typescript-language-server")
            || cmd.contains("tsserver");
    }
    false
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct PerPhaseObservationCounts {
    samples: usize,
    live_samples: usize,
    zero_samples: usize,
}

struct WholeTreeSamplerState {
    known_pgids: HashSet<u32>,
    browser_session_pgids: HashSet<u32>,
    retained_pids: HashSet<(u32, u64)>,
    phase: &'static str,
    sample_seq: u64,
    per_proc_lifetime_ticks: HashMap<(u32, u64), u64>,
    per_proc_interval_baseline: HashMap<(u32, u64), (u64, u64)>,
    prev_sample_instant: Instant,
    rss_series: Vec<f64>,
    proc_count_series: Vec<f64>,
    cpu_delta_ms_series: Vec<f64>,
    cpu_pct_series: Vec<f64>,
    peak_rss_bytes: u64,
    max_procs: u64,
    phase_counts: HashMap<&'static str, PerPhaseObservationCounts>,
    post_cleanup_zero_samples: usize,
    has_browser_session_observed: bool,
}

impl WholeTreeSamplerState {
    fn new() -> Self {
        let mut phase_counts = HashMap::new();
        phase_counts.insert("startup", PerPhaseObservationCounts::default());
        phase_counts.insert("warm", PerPhaseObservationCounts::default());
        phase_counts.insert("browser", PerPhaseObservationCounts::default());
        phase_counts.insert("reap", PerPhaseObservationCounts::default());
        Self {
            known_pgids: HashSet::new(),
            browser_session_pgids: HashSet::new(),
            retained_pids: HashSet::new(),
            phase: "startup",
            sample_seq: 0,
            per_proc_lifetime_ticks: HashMap::new(),
            per_proc_interval_baseline: HashMap::new(),
            prev_sample_instant: Instant::now(),
            rss_series: Vec::new(),
            proc_count_series: Vec::new(),
            cpu_delta_ms_series: Vec::new(),
            cpu_pct_series: Vec::new(),
            peak_rss_bytes: 0,
            max_procs: 0,
            phase_counts,
            post_cleanup_zero_samples: 0,
            has_browser_session_observed: false,
        }
    }

    fn browser_live_samples(&self) -> usize {
        self.phase_counts
            .get("browser")
            .map(|o| o.live_samples)
            .unwrap_or(0)
    }

    fn sample_tick(&mut self, self_pid: u32, clk_tck: u64) {
        let now = Instant::now();
        let elapsed_ms = now
            .saturating_duration_since(self.prev_sample_instant)
            .as_secs_f64()
            * 1000.0;

        // Bounded sampling cadence: enforce >= 50ms before recording rate-based interval sample
        // to prevent tiny denominators from manual calls or jitter.
        if elapsed_ms < 50.0 {
            return;
        }
        self.prev_sample_instant = now;
        self.sample_seq = self.sample_seq.wrapping_add(1);
        let current_seq = self.sample_seq;

        // Fallback root discovery under self_pid for semantic engine processes
        let harness_pgid = unsafe { libc::getpgrp() } as u32;
        for desc in get_all_descendants(self_pid) {
            if let Some((pgrp, _, _, _)) = read_proc_cpu_and_rss(desc) {
                if pgrp != harness_pgid && is_semantic_engine_process(desc) {
                    self.known_pgids.insert(pgrp);
                }
            }
        }

        // Ownership matching: session-derived roots plus all their descendants
        let mut candidate_pids = HashSet::new();
        for &pgid in &self.known_pgids {
            candidate_pids.insert(pgid);
            for d in get_all_descendants(pgid) {
                candidate_pids.insert(d);
            }
        }
        // Retained discovered (pid, starttime) identities
        for &(pid, _) in &self.retained_pids {
            candidate_pids.insert(pid);
        }

        let mut total_rss = 0u64;
        let mut live_procs = 0u64;
        let mut interval_delta_ticks = 0u64;
        let mut browser_procs_live = 0u64;

        // Collect browser candidate PIDs if tracking browser session
        let mut browser_candidates = HashSet::new();
        for &b_pgid in &self.browser_session_pgids {
            browser_candidates.insert(b_pgid);
            for d in get_all_descendants(b_pgid) {
                browser_candidates.insert(d);
            }
        }

        for pid in candidate_pids {
            if let Some((_pgrp, starttime, ticks, rss)) = read_proc_cpu_and_rss(pid) {
                // PID reuse guard: if this PID was previously retained with a different starttime,
                // the original process exited and this is an unrelated recycled PID.
                if self
                    .retained_pids
                    .iter()
                    .any(|(retained_pid, retained_start)| {
                        *retained_pid == pid && *retained_start != starttime
                    })
                {
                    continue;
                }

                live_procs += 1;
                total_rss = total_rss.saturating_add(rss);
                self.retained_pids.insert((pid, starttime));

                if browser_candidates.contains(&pid) {
                    browser_procs_live += 1;
                }

                // Cumulative lifetime lower bound
                let entry = self
                    .per_proc_lifetime_ticks
                    .entry((pid, starttime))
                    .or_insert(0);
                if ticks > *entry {
                    *entry = ticks;
                }

                // Interval CPU: delta for processes observed in immediate previous interval
                if let Some((prev_ticks, prev_seq)) =
                    self.per_proc_interval_baseline.get_mut(&(pid, starttime))
                {
                    if *prev_seq == current_seq.wrapping_sub(1) && ticks > *prev_ticks {
                        interval_delta_ticks =
                            interval_delta_ticks.saturating_add(ticks - *prev_ticks);
                    }
                    *prev_ticks = ticks;
                    *prev_seq = current_seq;
                } else {
                    // Newly observed process: baseline established on first observation,
                    // preserving true lifetime in cumulative total without charging multi-second
                    // pre-discovery startup work to this single interval.
                    self.per_proc_interval_baseline
                        .insert((pid, starttime), (ticks, current_seq));
                }
            }
        }

        if self.phase == "browser" && browser_procs_live > 0 {
            self.has_browser_session_observed = true;
        }

        let is_active_phase = matches!(self.phase, "startup" | "warm" | "browser");

        if is_active_phase {
            let phase_has_live = if self.phase == "browser" {
                browser_procs_live > 0
            } else {
                live_procs > 0
            };

            if phase_has_live || interval_delta_ticks > 0 {
                let delta_cpu_ms = (interval_delta_ticks as f64) * 1000.0 / (clk_tck as f64);
                let cpu_pct = if elapsed_ms >= 1.0 {
                    (delta_cpu_ms / elapsed_ms) * 100.0
                } else {
                    0.0
                };
                if total_rss > 0 {
                    self.rss_series.push(total_rss as f64);
                    self.peak_rss_bytes = self.peak_rss_bytes.max(total_rss);
                }
                if live_procs > 0 {
                    self.proc_count_series.push(live_procs as f64);
                    self.max_procs = self.max_procs.max(live_procs);
                }
                self.cpu_delta_ms_series.push(delta_cpu_ms);
                self.cpu_pct_series.push(cpu_pct);

                let obs = self.phase_counts.entry(self.phase).or_default();
                obs.samples += 1;
                if phase_has_live {
                    obs.live_samples += 1;
                } else {
                    obs.zero_samples += 1;
                }
            } else {
                // Active phase tick without live semantic process or CPU observation:
                // record zeroSample, do not fake live phase coverage
                let obs = self.phase_counts.entry(self.phase).or_default();
                obs.samples += 1;
                obs.zero_samples += 1;
            }
        } else if self.phase == "reap" {
            if live_procs > 0 {
                let delta_cpu_ms = (interval_delta_ticks as f64) * 1000.0 / (clk_tck as f64);
                let cpu_pct = if elapsed_ms >= 1.0 {
                    (delta_cpu_ms / elapsed_ms) * 100.0
                } else {
                    0.0
                };
                if total_rss > 0 {
                    self.rss_series.push(total_rss as f64);
                    self.peak_rss_bytes = self.peak_rss_bytes.max(total_rss);
                }
                self.proc_count_series.push(live_procs as f64);
                self.max_procs = self.max_procs.max(live_procs);
                self.cpu_delta_ms_series.push(delta_cpu_ms);
                self.cpu_pct_series.push(cpu_pct);

                let obs = self.phase_counts.entry("reap").or_default();
                obs.samples += 1;
                obs.live_samples += 1;
            } else {
                let obs = self.phase_counts.entry("reap").or_default();
                obs.samples += 1;
                obs.zero_samples += 1;
            }
        }
    }

    fn sample_post_cleanup_zero(&mut self, _self_pid: u32, _clk_tck: u64) {
        // Zero is evidence only after successful observation and completed teardown.
        let pgids_non_empty = !self.known_pgids.is_empty();
        let all_pgids_empty = self.known_pgids.iter().all(|&pgid| is_pgid_empty(pgid));

        // Validate retained identities against PID reuse:
        // A retained process is considered alive ONLY if /proc/<pid>/stat exists AND starttime matches.
        let any_retained_alive = self.retained_pids.iter().any(|&(pid, expected_starttime)| {
            if let Some((_, actual_starttime, _, _)) = read_proc_cpu_and_rss(pid) {
                actual_starttime == expected_starttime
            } else {
                false
            }
        });

        if pgids_non_empty
            && self.has_browser_session_observed
            && all_pgids_empty
            && !any_retained_alive
        {
            self.post_cleanup_zero_samples += 1;
            let obs = self.phase_counts.entry("reap").or_default();
            obs.samples += 1;
            obs.zero_samples += 1;
            self.proc_count_series.push(0.0);
            self.rss_series.push(0.0);
        }
    }
}

#[derive(Clone)]
struct TrackedSessionEntry {
    handle: SemanticSessionHandle,
    reaped_snapshot: Option<SessionDiagnosticsSnapshot>,
    post_shutdown_snapshot: Option<SessionDiagnosticsSnapshot>,
}

struct SessionPressureTrackerState {
    sessions: Vec<TrackedSessionEntry>,
    sampled_concurrent_peak_in_flight: usize,
    sampled_concurrent_peak_cmd_slots: usize,
    sampled_concurrent_peak_child_slots: usize,
    sampled_concurrent_peak_child_bytes: usize,
    sampled_concurrent_peak_open_docs: usize,
    sampled_concurrent_peak_overlay_bytes: usize,
}

impl SessionPressureTrackerState {
    fn new() -> Self {
        Self {
            sessions: Vec::new(),
            sampled_concurrent_peak_in_flight: 0,
            sampled_concurrent_peak_cmd_slots: 0,
            sampled_concurrent_peak_child_slots: 0,
            sampled_concurrent_peak_child_bytes: 0,
            sampled_concurrent_peak_open_docs: 0,
            sampled_concurrent_peak_overlay_bytes: 0,
        }
    }

    fn register(&mut self, handle: SemanticSessionHandle) -> usize {
        let idx = self.sessions.len();
        self.sessions.push(TrackedSessionEntry {
            handle,
            reaped_snapshot: None,
            post_shutdown_snapshot: None,
        });
        idx
    }

    fn record_reap(&mut self, idx: usize, snapshot: SessionDiagnosticsSnapshot) {
        if let Some(entry) = self.sessions.get_mut(idx) {
            entry.reaped_snapshot = Some(snapshot);
        }
    }

    fn update_sampled_concurrent(&mut self, snaps: &[SessionDiagnosticsSnapshot]) {
        let mut cur_in_flight = 0;
        let mut cur_cmd_slots = 0;
        let mut cur_child_slots = 0;
        let mut cur_child_bytes = 0;
        let mut cur_open_docs = 0;
        let mut cur_overlay_bytes = 0;

        for s in snaps {
            cur_in_flight += s.in_flight_requests;
            cur_cmd_slots += s.command_queue_slots;
            cur_child_slots += s.child_outbound_queue_slots;
            cur_child_bytes += s.child_outbound_bytes;
            cur_open_docs += s.open_documents;
            cur_overlay_bytes += s.overlay_bytes;
        }

        self.sampled_concurrent_peak_in_flight =
            self.sampled_concurrent_peak_in_flight.max(cur_in_flight);
        self.sampled_concurrent_peak_cmd_slots =
            self.sampled_concurrent_peak_cmd_slots.max(cur_cmd_slots);
        self.sampled_concurrent_peak_child_slots = self
            .sampled_concurrent_peak_child_slots
            .max(cur_child_slots);
        self.sampled_concurrent_peak_child_bytes = self
            .sampled_concurrent_peak_child_bytes
            .max(cur_child_bytes);
        self.sampled_concurrent_peak_open_docs =
            self.sampled_concurrent_peak_open_docs.max(cur_open_docs);
        self.sampled_concurrent_peak_overlay_bytes = self
            .sampled_concurrent_peak_overlay_bytes
            .max(cur_overlay_bytes);
    }

    fn capture_post_shutdown(&mut self) {
        for entry in &mut self.sessions {
            if entry.post_shutdown_snapshot.is_none() {
                entry.post_shutdown_snapshot = Some(entry.handle.diagnostics());
            }
        }
    }

    fn build_aggregate_report(&self) -> Value {
        let inspected_count = self.sessions.len();

        let mut max_peak_in_flight = 0usize;
        let mut max_peak_cmd_slots = 0usize;
        let mut max_peak_child_slots = 0usize;
        let mut max_peak_child_bytes = 0usize;
        let mut max_peak_open_docs = 0usize;
        let mut max_peak_overlay_bytes = 0usize;

        let mut total_spawn_attempts = 0usize;
        let mut total_successful_spawns = 0usize;
        let mut total_restart_attempts = 0usize;
        let mut total_successful_restarts = 0usize;

        let mut total_nav_timeouts = 0usize;
        let mut total_nav_cancellations = 0usize;
        let mut total_nav_overloads = 0usize;
        let mut total_stale_results = 0usize;

        let mut reaped_count = 0usize;
        let mut max_residual_overlay_bytes = 0usize;
        let mut max_residual_open_docs = 0usize;
        let mut max_residual_in_flight = 0usize;
        let mut max_residual_cmd_slots = 0usize;
        let mut max_residual_child_slots = 0usize;
        let mut max_residual_child_bytes = 0usize;

        for entry in &self.sessions {
            let latest = entry
                .post_shutdown_snapshot
                .or(entry.reaped_snapshot)
                .unwrap_or_else(|| entry.handle.diagnostics());

            max_peak_in_flight = max_peak_in_flight.max(latest.peak_in_flight_requests);
            max_peak_cmd_slots = max_peak_cmd_slots.max(latest.peak_command_queue_slots);
            max_peak_child_slots = max_peak_child_slots.max(latest.peak_child_outbound_queue_slots);
            max_peak_child_bytes = max_peak_child_bytes.max(latest.peak_child_outbound_bytes);
            max_peak_open_docs = max_peak_open_docs.max(latest.peak_open_documents);
            max_peak_overlay_bytes = max_peak_overlay_bytes.max(latest.peak_overlay_bytes);

            total_spawn_attempts += latest.spawn_attempts;
            total_successful_spawns += latest.successful_spawns;
            total_restart_attempts += latest.restart_attempts;
            total_successful_restarts += latest.successful_restarts;

            total_nav_timeouts += latest.navigation_timeouts;
            total_nav_cancellations += latest.navigation_cancellations;
            total_nav_overloads += latest.navigation_overloads;
            total_stale_results += latest.stale_results;

            if let Some(reap_snap) = entry.reaped_snapshot {
                reaped_count += 1;
                max_residual_overlay_bytes =
                    max_residual_overlay_bytes.max(reap_snap.overlay_bytes);
                max_residual_open_docs = max_residual_open_docs.max(reap_snap.open_documents);
                max_residual_in_flight = max_residual_in_flight.max(reap_snap.in_flight_requests);
                max_residual_cmd_slots = max_residual_cmd_slots.max(reap_snap.command_queue_slots);
                max_residual_child_slots =
                    max_residual_child_slots.max(reap_snap.child_outbound_queue_slots);
                max_residual_child_bytes =
                    max_residual_child_bytes.max(reap_snap.child_outbound_bytes);
            }
        }

        let all_clean = reaped_count == inspected_count
            && max_residual_overlay_bytes == 0
            && max_residual_open_docs == 0
            && max_residual_in_flight == 0
            && max_residual_cmd_slots == 0
            && max_residual_child_slots == 0
            && max_residual_child_bytes == 0;

        json!({
            "measuredScope": {
                "inspectedActorHandles": "cold, warm_main, warm_peer, hostile (directly held SemanticSessionHandle instances)",
                "browserWsSessions": Value::Null,
                "browserWsSessionStatus": "UNMEASURED (browser WS-created sessions not directly held as session handles in harness; explicitly unmeasured, not fake 0)",
                "queueSlotSemantics": "occupied and reserved slots in bounded mpsc channels, excluding active writer in write syscall",
                "childOutboundBytesSemantics": "child outbound buffered/reserved payload bytes, excluding active writer in write syscall",
                "inspectedSessionCount": inspected_count,
                "sampledConcurrentPeakSemantics": "completion-boundary sequential handle observations during sustained loop, not atomic concurrent hardware snapshot; authoritative transition highwaters are preserved per-session in maxPerSessionPeaks",
            },
            "maxPerSessionPeaks": {
                "inFlightRequests": max_peak_in_flight,
                "commandQueueSlots": max_peak_cmd_slots,
                "childOutboundQueueSlots": max_peak_child_slots,
                "childOutboundBytes": max_peak_child_bytes,
                "openDocuments": max_peak_open_docs,
                "overlayBytes": max_peak_overlay_bytes,
            },
            "sampledConcurrentPeaks": {
                "inFlightRequests": self.sampled_concurrent_peak_in_flight,
                "commandQueueSlots": self.sampled_concurrent_peak_cmd_slots,
                "childOutboundQueueSlots": self.sampled_concurrent_peak_child_slots,
                "childOutboundBytes": self.sampled_concurrent_peak_child_bytes,
                "openDocuments": self.sampled_concurrent_peak_open_docs,
                "overlayBytes": self.sampled_concurrent_peak_overlay_bytes,
            },
            "postReapCleanup": {
                "reapedSessionCount": reaped_count,
                "allClean": all_clean,
                "maxResidualOverlayBytes": max_residual_overlay_bytes,
                "maxResidualOpenDocuments": max_residual_open_docs,
                "maxResidualInFlightRequests": max_residual_in_flight,
                "maxResidualCommandQueueSlots": max_residual_cmd_slots,
                "maxResidualChildOutboundQueueSlots": max_residual_child_slots,
                "maxResidualChildOutboundBytes": max_residual_child_bytes,
            },
            "lifetimeTotals": {
                "spawnAttempts": total_spawn_attempts,
                "successfulSpawns": total_successful_spawns,
                "restartAttempts": total_restart_attempts,
                "successfulRestarts": total_successful_restarts,
            },
            "unexpectedErrorCounters": {
                "navigationTimeouts": total_nav_timeouts,
                "navigationCancellations": total_nav_cancellations,
                "navigationOverloads": total_nav_overloads,
                "staleResults": total_stale_results,
            },
        })
    }
}

#[tokio::test]
#[ignore]
async fn live_semantic_navigation_qualification() {
    let stage = std::env::var("SEMANTIC_QUAL_STAGE").unwrap_or_else(|_| "exploratory".to_string());
    let mode_req = std::env::var("SEMANTIC_QUAL_MODE").unwrap_or_else(|_| "portable".to_string());
    let threshold_bytes: usize = std::env::var("SEMANTIC_QUAL_THRESHOLD_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(ADAPTIVE_SYNC_THRESHOLD_BYTES);
    let repetitions: usize = std::env::var("SEMANTIC_QUAL_REPETITIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3);
    let warmup_samples: usize = std::env::var("SEMANTIC_QUAL_WARMUP_SAMPLES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5);
    let warm_samples: usize = std::env::var("SEMANTIC_QUAL_WARM_SAMPLES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(60);
    let cold_sessions: usize = std::env::var("SEMANTIC_QUAL_COLD_SESSIONS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(4);
    let core_samples_per_endpoint: usize = std::env::var("SEMANTIC_QUAL_CORE_SAMPLES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(100);
    let output_file = std::env::var("SEMANTIC_QUAL_OUTPUT_FILE")
        .expect("SEMANTIC_QUAL_OUTPUT_FILE is required for live_semantic_navigation_qualification");
    let large_corpus_dir =
        std::env::var("SEMANTIC_QUAL_LARGE_DIR").expect("SEMANTIC_QUAL_LARGE_DIR is required");

    let packaged = PackagedToolchain::new();
    let profile = packaged.tool_profile();
    assert!(
        profile.is_packaged_tuple_verified(),
        "Packaged tuple verification required"
    );

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let manifest_path = manifest_dir.join("tests/fixtures/semantic-fixtures-manifest.json");
    let manifest: Value = serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    assert_eq!(manifest["fixtureSeed"], json!(24301));

    let small_dir = manifest_dir.join("tests/fixtures/semantic-small");
    let medium_dir = manifest_dir.join("tests/fixtures/semantic-medium");
    let large_dir = PathBuf::from(&large_corpus_dir);

    let small_digest = manifest["tiers"]["small"]["corpusDigest"]
        .as_str()
        .unwrap()
        .to_string();
    let medium_digest = manifest["tiers"]["medium"]["corpusDigest"]
        .as_str()
        .unwrap()
        .to_string();
    let large_digest = manifest["tiers"]["large"]["corpusDigest"]
        .as_str()
        .unwrap()
        .to_string();

    verify_corpus_manifest_digest(&small_dir, 8, 4096, &small_digest);
    verify_corpus_manifest_digest(&medium_dir, 64, 16384, &medium_digest);
    verify_corpus_manifest_digest(&large_dir, 256, 32768, &large_digest);
    let qualification_binary_sha256 = {
        use std::io::Read;
        let mut binary = fs::File::open(std::env::current_exe().unwrap()).unwrap();
        let mut digest = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = binary.read(&mut buffer).unwrap();
            if read == 0 {
                break;
            }
            digest.update(&buffer[..read]);
        }
        hex::encode(digest.finalize())
    };

    let tuple_digests = json!({
        "nodeSha256": PINNED_NODE_SHA256,
        "tslsEntrypointSha256": PINNED_TSLS_ENTRYPOINT_SHA256,
        "tsserverSha256": PINNED_TSSERVER_SHA256,
        "tsserverImplSha256": PINNED_TSSERVER_IMPL_SHA256,
        "typescriptCoreSha256": PINNED_TYPESCRIPT_JS_SHA256,
        "packageJsonSha256": PINNED_PACKAGE_JSON_SHA256,
        "lockfileSha256": PINNED_LOCKFILE_SHA256,
        "qualificationBinarySha256": qualification_binary_sha256,
        "qualificationBuildProfile": if cfg!(debug_assertions) { "debug" } else { "release" },
    });
    let fixture_identity = json!({
        "fixtureSeed": 24301,
        "smallCorpusDigest": small_digest,
        "mediumCorpusDigest": medium_digest,
        "largeCorpusDigest": large_digest,
    });

    let host_controller = LinuxResourceController::default();
    let (detected_mode, detected_scope) = host_controller.prepare_child_scope("qual-mode-check");
    drop(detected_scope);
    let hard_available = detected_mode.is_hard();

    if mode_req == "hard" {
        let reason = match detected_mode {
            ResourceMode::PortableOnly { reason, .. } => reason,
            _ => "Production semantic child-tree cgroup adapter is not wired".to_string(),
        };
        let unqual = json!({
            "stage": stage,
            "requestedMode": "hard",
            "status": "UNAVAILABLE_UNQUALIFIED",
            "requestedThresholdBytes": threshold_bytes,
            "compiledProductionThresholdBytes": ADAPTIVE_SYNC_THRESHOLD_BYTES,
            "tupleDigests": tuple_digests,
            "fixtureIdentity": fixture_identity,
            "hardCgroupAvailable": hard_available,
            "supervisorCgroupAdapterWired": false,
            "reason": reason,
        });
        fs::write(&output_file, serde_json::to_string_pretty(&unqual).unwrap()).unwrap();
        return;
    }

    if stage != "off-baseline" && threshold_bytes != ADAPTIVE_SYNC_THRESHOLD_BYTES {
        let blocked = json!({
            "stage": stage,
            "requestedMode": mode_req,
            "status": "BLOCKED_PRODUCTION_POLICY_CONSTANT",
            "requestedThresholdBytes": threshold_bytes,
            "compiledProductionThresholdBytes": ADAPTIVE_SYNC_THRESHOLD_BYTES,
            "tupleDigests": tuple_digests,
            "fixtureIdentity": fixture_identity,
            "reason": format!(
                "Production OverlayDocument::is_incremental_sync_recommended (overlay.rs:208) and gateway attach (gateway.rs:589) compile ADAPTIVE_SYNC_THRESHOLD_BYTES={} as a static constant; varying candidate threshold to {} requires updating resources.rs::ADAPTIVE_SYNC_THRESHOLD_BYTES",
                ADAPTIVE_SYNC_THRESHOLD_BYTES, threshold_bytes
            ),
        });
        fs::write(
            &output_file,
            serde_json::to_string_pretty(&blocked).unwrap(),
        )
        .unwrap();
        return;
    }

    let tmp = TempDir::new().unwrap();
    let small_dir = isolated_git_fixture(&small_dir, &tmp.path().join("small"));
    verify_corpus_manifest_digest(&small_dir, 8, 4096, &small_digest);

    let supervisor = Arc::new(SemanticSupervisor::new(Some(profile.clone())));
    if stage != "off-baseline" {
        supervisor.set_enabled(true).await;
    }

    let (_state, addr, token) = setup_authenticated_app(
        &tmp,
        vec![
            ("small", small_dir.clone()),
            ("medium", medium_dir.clone()),
            ("large", large_dir.clone()),
        ],
        supervisor.clone(),
    )
    .await;

    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    let noise_before = host_noise_snapshot();

    if stage == "off-baseline" {
        let mut core_samples = Vec::new();
        let mut combined_per_ep: HashMap<&'static str, Vec<f64>> = HashMap::new();
        for key in CORE_ENDPOINT_KEYS {
            combined_per_ep.insert(key, Vec::new());
        }
        let mut rep_distributions = Vec::new();
        let mut total_term_drops = 0u64;
        for rep in 0..repetitions {
            let sched = run_overlapped_core_and_terminal_schedule(
                &client,
                addr,
                &token,
                &_state.pty_manager,
                core_samples_per_endpoint,
                None,
                None,
                None,
                None,
                None,
            )
            .await
            .expect("off-baseline core and terminal schedule");
            for (k, v) in &sched.per_endpoint {
                combined_per_ep
                    .get_mut(k)
                    .unwrap()
                    .extend(v.iter().copied());
            }
            rep_distributions.push(json!({
                "repetition": rep,
                "coreAndTerminal": summarize_latency_series(&sched.all_latencies),
                "perEndpoint": summarize_per_endpoint(&sched.per_endpoint),
                "terminalDrops": sched.terminal_drops,
            }));
            core_samples.extend(sched.all_latencies);
            total_term_drops += sched.terminal_drops;
        }
        let mut out = json!({
            "stage": "off-baseline",
            "status": "MEASURED",
            "semanticsEnabled": false,
            "activeTrees": 0,
            "sessionPressureDiagnostics": null,
            "compiledProductionThresholdBytes": ADAPTIVE_SYNC_THRESHOLD_BYTES,
            "tupleDigests": tuple_digests,
            "fixtureIdentity": fixture_identity,
            "repetitions": repetitions,
            "coreSamplesPerEndpointPerCondition": core_samples_per_endpoint,
            "coreAndTerminalP50Ms": nearest_rank_percentile_opt(&core_samples, 0.50),
            "coreAndTerminalP95Ms": nearest_rank_percentile_opt(&core_samples, 0.95),
            "corePerEndpoint": summarize_per_endpoint(&combined_per_ep),
            "repetitionDistributions": rep_distributions,
            "terminalDrops": total_term_drops,
        });
        out["hostNoise"] = json!({ "before": noise_before, "after": host_noise_snapshot() });
        fs::write(&output_file, serde_json::to_string_pretty(&out).unwrap()).unwrap();
        return;
    }

    let self_pid = std::process::id();
    let clk_tck = clock_ticks_per_sec();
    let stop_flag = Arc::new(AtomicBool::new(false));
    let sampler_state = Arc::new(std::sync::Mutex::new(WholeTreeSamplerState::new()));

    let stop_sampler = stop_flag.clone();
    let sampler_state_bg = sampler_state.clone();
    let sampler_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(100));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        while !stop_sampler.load(Ordering::Relaxed) {
            interval.tick().await;
            sampler_state_bg
                .lock()
                .unwrap()
                .sample_tick(self_pid, clk_tck);
        }
    });

    let mut partial_report = json!({
        "stage": stage,
        "status": "PARTIAL_FAILED",
        "requestedMode": mode_req,
        "effectiveMode": "portable-only",
        "hardCgroupAvailable": hard_available,
        "supervisorCgroupAdapterWired": false,
        "portableChildMonitorIntervalMs": 200,
        "qualificationObservationIntervalMs": 100,
        "adaptiveSyncThresholdBytes": threshold_bytes,
        "compiledProductionThresholdBytes": ADAPTIVE_SYNC_THRESHOLD_BYTES,
        "repetitions": repetitions,
        "warmupSamples": warmup_samples,
        "warmSamples": warm_samples,
        "coldSessionsPerWorkload": cold_sessions,
        "coreSamplesPerEndpointPerCondition": core_samples_per_endpoint,
        "tupleDigests": tuple_digests,
        "fixtureIdentity": fixture_identity,
        "coldReadyP50Ms": null,
        "coldReadyP95Ms": null,
        "tiers": {},
        "coreAndTerminalP50Ms": null,
        "coreAndTerminalP95Ms": null,
        "corePerEndpoint": null,
        "coreScheduleOverlap": null,
        "resources": null,
        "clientThresholdQualification": null,
        "reapDurationP95Ms": null,
        "reapDurationMaxMs": null,
        "terminalDrops": null,
        "staleReveals": null,
        "staleRevealsStatus": "UNMEASURED",
        "unauthorizedOrOutsideTargetDisclosures": null,
        "projectCodeCanaryExecutionsInDeniedRuns": null,
        "orphanProcesses": null,
        "failureReason": null,
        "sessionPressureDiagnostics": null,
    });
    partial_report["hostNoise"] = json!({ "before": noise_before, "after": null });

    let pressure_tracker = Arc::new(std::sync::Mutex::new(SessionPressureTrackerState::new()));
    let run_outcome: Result<(), String> = std::panic::AssertUnwindSafe(async {
        partial_report["lastOperation"] = json!("cold-start");
        let mut cold_ready_samples = Vec::new();
        let mut reap_samples = Vec::new();
        let mut orphan_count = 0usize;

        for (tier_name, tier_dir) in [
            ("small", &small_dir),
            ("medium", &medium_dir),
            ("large", &large_dir),
        ] {
            for cold_idx in 0..cold_sessions {
                sampler_state.lock().unwrap().phase = "startup";
                let conn = ConnectionId(format!("conn-cold-{tier_name}-{cold_idx}"));
                let ep = supervisor.register_connection(&conn).await;
                let t0 = Instant::now();
                let sess = supervisor
                    .get_or_create_session(conn.clone(), tier_name, None, tier_dir.clone(), ep)
                    .await
                    .map_err(|e| format!("cold get_or_create_session {tier_name} failed: {e}"))?;
                let cold_s_idx = pressure_tracker
                    .lock()
                    .unwrap()
                    .register(sess.clone());
                sess.initialize()
                    .await
                    .map_err(|e| format!("cold initialize {tier_name} failed: {e}"))?;
                if let Some(pgid) = sess.get_pgid().await {
                    let mut st = sampler_state.lock().unwrap();
                    st.known_pgids.insert(pgid);
                }
                let fpath = tier_dir.join("packages/core/module_000.ts");
                let furi = path_to_file_uri(&fpath);
                let ftext = fs::read_to_string(&fpath).unwrap();
                sess.did_open(furi.clone(), "typescript".into(), 1, ftext)
                    .await
                    .map_err(|e| format!("cold did_open {tier_name} failed: {e}"))?;
                let def_res = sess
                    .navigation(
                        "textDocument/definition",
                        NavigationParams {
                            text_document: TextDocumentIdentifier { uri: furi },
                            position: Position {
                                line: 16,
                                character: 40,
                            },
                            dam_hopper_document_version: 1,
                            dam_hopper_model_generation: None,
                        },
                    )
                    .await
                    .map_err(|e| format!("cold navigation {tier_name} failed: {e}"))?;
                assert_definition_oracle(&def_res, 5, 13);
                cold_ready_samples.push(t0.elapsed().as_secs_f64() * 1000.0);

                let pgid = sess.get_pgid().await.expect("cold pgid");
                let pids = sample_tree_resources(pgid).pids;
                {
                    let mut st = sampler_state.lock().unwrap();
                    st.phase = "reap";
                    st.known_pgids.insert(pgid);
                }
                let t_reap = Instant::now();
                supervisor.invalidate_connection(&conn).await;
                supervisor.release_connection(&conn).await;
                let reap_dur_ms = t_reap.elapsed().as_secs_f64() * 1000.0;
                reap_samples.push(reap_dur_ms);
                let post_reap = sess.diagnostics();
                pressure_tracker
                    .lock()
                    .unwrap()
                    .record_reap(cold_s_idx, post_reap);
                if !verify_pids_dead(&pids) || !is_pgid_empty(pgid) {
                    orphan_count += 1;
                }
            }
        }
        partial_report["coldReadyP50Ms"] =
            json!(nearest_rank_percentile_opt(&cold_ready_samples, 0.50));
        partial_report["coldReadyP95Ms"] =
            json!(nearest_rank_percentile_opt(&cold_ready_samples, 0.95));

        let mut tier_metrics = serde_json::Map::new();
        let mut core_latencies = Vec::new();
        let mut global_per_ep: HashMap<&'static str, Vec<f64>> = HashMap::new();
        for key in CORE_ENDPOINT_KEYS {
            global_per_ep.insert(key, Vec::new());
        }
        let mut total_term_drops = 0u64;
        let mut total_overlap_duration_ms = 0.0f64;
        let mut total_navs_during_core = 0usize;
        let mut total_probes_during_nav = 0usize;

        for (tier_name, tier_dir, file_count) in [
            ("small", &small_dir, 8usize),
            ("medium", &medium_dir, 64usize),
            ("large", &large_dir, 256usize),
        ] {
            partial_report["lastOperation"] = json!({ "phase": "overlapped-load", "tier": tier_name });
            let mut tier_nav_samples = Vec::new();
            let mut tier_core_samples = Vec::new();
            let mut tier_per_ep: HashMap<&'static str, Vec<f64>> = HashMap::new();
            for key in CORE_ENDPOINT_KEYS {
                tier_per_ep.insert(key, Vec::new());
            }
            let mut tier_rep_records = Vec::new();
            let mut tier_overlap_duration_ms = 0.0f64;
            let mut tier_min_rep_overlap_ms = f64::INFINITY;
            let mut tier_navs_during_core = 0usize;
            let mut tier_probes_during_nav = 0usize;

            for rep in 0..repetitions {
                sampler_state.lock().unwrap().phase = "startup";
                let c_main = ConnectionId(format!("conn-{tier_name}-rep{rep}-a"));
                let c_peer = ConnectionId(format!("conn-{tier_name}-rep{rep}-b"));
                let ep_main = supervisor.register_connection(&c_main).await;
                let ep_peer = supervisor.register_connection(&c_peer).await;

                let s_main = supervisor
                    .get_or_create_session(
                        c_main.clone(),
                        tier_name,
                        None,
                        tier_dir.clone(),
                        ep_main,
                    )
                    .await
                    .map_err(|e| format!("warm s_main session {tier_name} failed: {e}"))?;
                let main_s_idx = pressure_tracker
                    .lock()
                    .unwrap()
                    .register(s_main.clone());
                s_main
                    .initialize()
                    .await
                    .map_err(|e| format!("warm s_main init {tier_name} failed: {e}"))?;

                let s_peer = supervisor
                    .get_or_create_session(
                        c_peer.clone(),
                        "small",
                        None,
                        small_dir.clone(),
                        ep_peer,
                    )
                    .await
                    .map_err(|e| format!("warm s_peer session failed: {e}"))?;
                let peer_s_idx = pressure_tracker
                    .lock()
                    .unwrap()
                    .register(s_peer.clone());
                s_peer
                    .initialize()
                    .await
                    .map_err(|e| format!("warm s_peer init failed: {e}"))?;

                let p1 = s_main.get_pgid().await;
                let p2 = s_peer.get_pgid().await;
                {
                    let mut st = sampler_state.lock().unwrap();
                    if let Some(pid) = p1 {
                        st.known_pgids.insert(pid);
                    }
                    if let Some(pid) = p2 {
                        st.known_pgids.insert(pid);
                    }
                    st.phase = "warm";
                }

                let peer_f = small_dir.join("packages/core/module_000.ts");
                s_peer
                    .did_open(
                        path_to_file_uri(&peer_f),
                        "typescript".into(),
                        1,
                        fs::read_to_string(&peer_f).unwrap(),
                    )
                    .await
                    .map_err(|e| format!("peer did_open failed: {e}"))?;

                let mut open_docs = Vec::new();
                for idx in (0..file_count).step_by(4).take(8) {
                    let pkg = if idx < file_count / 2 { "core" } else { "app" };
                    let fpath = tier_dir.join(format!("packages/{pkg}/module_{idx:03}.ts"));
                    let furi = path_to_file_uri(&fpath);
                    let ftext = fs::read_to_string(&fpath).unwrap();
                    s_main
                        .did_open(furi.clone(), "typescript".into(), 1, ftext.clone())
                        .await
                        .map_err(|e| format!("main did_open failed: {e}"))?;
                    open_docs.push((furi, ftext, 1i64));
                }

                let apply_adaptive_edit = |doc_text: &mut String, iter_idx: usize| -> TextDocumentContentChangeEvent {
                    let suffix = format!(" /*u{iter_idx}*/");
                    let first_nl = doc_text.find('\n').unwrap_or(doc_text.len());
                    let line0_utf16_end = doc_text[..first_nl].encode_utf16().count() as u32;
                    doc_text.insert_str(first_nl, &suffix);
                    if doc_text.len() < threshold_bytes {
                        TextDocumentContentChangeEvent {
                            range: None,
                            range_length: None,
                            text: doc_text.clone(),
                        }
                    } else {
                        TextDocumentContentChangeEvent {
                            range: Some(Range {
                                start: Position {
                                    line: 0,
                                    character: line0_utf16_end,
                                },
                                end: Position {
                                    line: 0,
                                    character: line0_utf16_end,
                                },
                            }),
                            range_length: Some(0),
                            text: suffix,
                        }
                    }
                };

                for warm_idx in 0..warmup_samples {
                    let slot = warm_idx % open_docs.len();
                    let (uri, text, ver) = &mut open_docs[slot];
                    *ver += 1;
                    let change = apply_adaptive_edit(text, warm_idx);
                    s_main
                        .did_change(uri.clone(), *ver, vec![change])
                        .await
                        .map_err(|e| format!("warmup did_change failed: {e}"))?;
                    let is_def = warm_idx % 2 == 0;
                    let method = if is_def {
                        "textDocument/definition"
                    } else {
                        "textDocument/implementation"
                    };
                    let pos = if is_def {
                        Position {
                            line: 16,
                            character: 40,
                        }
                    } else {
                        Position {
                            line: 2,
                            character: 18,
                        }
                    };
                    let res = s_main
                        .navigation(
                            method,
                            NavigationParams {
                                text_document: TextDocumentIdentifier { uri: uri.clone() },
                                position: pos,
                                dam_hopper_document_version: *ver,
                                dam_hopper_model_generation: None,
                            },
                        )
                        .await
                        .map_err(|e| format!("warmup navigation failed: {e}"))?;
                    if is_def {
                        assert_definition_oracle(&res, 5, 13);
                    } else {
                        assert_implementation_oracle(&res, 2, &[5, 10]);
                    }
                    let d_main = s_main.diagnostics();
                    let d_peer = s_peer.diagnostics();
                    pressure_tracker
                        .lock()
                        .unwrap()
                        .update_sampled_concurrent(&[d_main, d_peer]);
                }

                let start_barrier = Arc::new(tokio::sync::Barrier::new(2));
                let nav_active = Arc::new(AtomicBool::new(false));
                let nav_completed_required = Arc::new(AtomicBool::new(false));
                let core_active = Arc::new(AtomicBool::new(false));
                let core_completed_required = Arc::new(AtomicBool::new(false));

                let s_main_nav = s_main.clone();
                let barrier_nav = start_barrier.clone();
                let nav_active_w = nav_active.clone();
                let nav_done_w = nav_completed_required.clone();
                let core_active_r = core_active.clone();
                let core_done_r = core_completed_required.clone();
                let s_peer_nav = s_peer.clone();
                let pressure_tracker_nav = pressure_tracker.clone();

                let nav_fut = async move {
                    barrier_nav.wait().await;
                    let nav_window_start = Instant::now();
                    nav_active_w.store(true, Ordering::SeqCst);
                    let mut rep_nav_latencies = Vec::with_capacity(warm_samples);
                    let mut sustained_iters = 0usize;
                    let mut observed_navs_during_core = 0usize;

                    loop {
                        let iter_idx = warmup_samples + sustained_iters;
                        let slot = sustained_iters % open_docs.len();
                        let (uri, text, ver) = &mut open_docs[slot];
                        *ver += 1;
                        let change = apply_adaptive_edit(text, iter_idx);
                        s_main_nav
                            .did_change(uri.clone(), *ver, vec![change])
                            .await
                            .map_err(|e| format!("warm did_change failed: {e}"))?;

                        let is_def = sustained_iters.is_multiple_of(2);
                        let method = if is_def {
                            "textDocument/definition"
                        } else {
                            "textDocument/implementation"
                        };
                        let pos = if is_def {
                            Position {
                                line: 16,
                                character: 40,
                            }
                        } else {
                            Position {
                                line: 2,
                                character: 18,
                            }
                        };
                        let was_core_live = core_active_r.load(Ordering::SeqCst);
                        let t_nav = Instant::now();
                        let res = s_main_nav
                            .navigation(
                                method,
                                NavigationParams {
                                    text_document: TextDocumentIdentifier { uri: uri.clone() },
                                    position: pos,
                                    dam_hopper_document_version: *ver,
                                    dam_hopper_model_generation: None,
                                },
                            )
                            .await
                            .map_err(|e| format!("warm navigation failed: {e}"))?;
                        let elapsed_ms = t_nav.elapsed().as_secs_f64() * 1000.0;
                        if is_def {
                            assert_definition_oracle(&res, 5, 13);
                        } else {
                            assert_implementation_oracle(&res, 2, &[5, 10]);
                        }
                        let d_main = s_main_nav.diagnostics();
                        let d_peer = s_peer_nav.diagnostics();
                        pressure_tracker_nav
                            .lock()
                            .unwrap()
                            .update_sampled_concurrent(&[d_main, d_peer]);
                        if was_core_live || core_active_r.load(Ordering::SeqCst) {
                            observed_navs_during_core += 1;
                        }
                        if sustained_iters < warm_samples {
                            rep_nav_latencies.push(elapsed_ms);
                        }
                        sustained_iters += 1;
                        if sustained_iters >= warm_samples {
                            nav_done_w.store(true, Ordering::SeqCst);
                            if core_done_r.load(Ordering::SeqCst) {
                                break;
                            }
                        }
                    }
                    nav_active_w.store(false, Ordering::SeqCst);
                    let nav_window_end = Instant::now();
                    Ok::<_, String>((
                        rep_nav_latencies,
                        sustained_iters,
                        observed_navs_during_core,
                        nav_window_start,
                        nav_window_end,
                    ))
                };

                let core_fut = run_overlapped_core_and_terminal_schedule(
                    &client,
                    addr,
                    &token,
                    &_state.pty_manager,
                    core_samples_per_endpoint,
                    Some(start_barrier),
                    Some(nav_active),
                    Some(nav_completed_required),
                    Some(core_active),
                    Some(core_completed_required),
                );

                let (nav_res, core_res) = tokio::time::timeout(
                    Duration::from_secs(600),
                    async { tokio::try_join!(nav_fut, core_fut) },
                ).await.map_err(|_| "Concurrent qualification schedule exceeded its finite deadline".to_string())??;
                let (
                    rep_nav_latencies,
                    sustained_iters,
                    observed_navs_during_core,
                    nav_window_start,
                    nav_window_end,
                ) = nav_res;
                let core_sched = core_res;

                let overlap_start = nav_window_start.max(core_sched.window_start);
                let overlap_end = nav_window_end.min(core_sched.window_end);
                let rep_overlap_ms = overlap_end
                    .checked_duration_since(overlap_start)
                    .map(|d| d.as_secs_f64() * 1000.0)
                    .unwrap_or(0.0);

                tier_overlap_duration_ms += rep_overlap_ms;
                tier_min_rep_overlap_ms = tier_min_rep_overlap_ms.min(rep_overlap_ms);
                tier_navs_during_core += observed_navs_during_core;
                tier_probes_during_nav += core_sched.observed_probes_during_nav;

                total_overlap_duration_ms += rep_overlap_ms;
                total_navs_during_core += observed_navs_during_core;
                total_probes_during_nav += core_sched.observed_probes_during_nav;

                for (k, v) in &core_sched.per_endpoint {
                    tier_per_ep.get_mut(k).unwrap().extend(v.iter().copied());
                    global_per_ep.get_mut(k).unwrap().extend(v.iter().copied());
                }
                tier_rep_records.push(json!({
                    "repetition": rep,
                    "barrierSynchronized": true,
                    "overlapDurationMs": rep_overlap_ms,
                    "warmNavigationSampleCount": rep_nav_latencies.len(),
                    "sustainedTotalNavigations": sustained_iters,
                    "observedNavigationsDuringCoreWindow": observed_navs_during_core,
                    "completedCoreRounds": core_sched.completed_rounds,
                    "observedCoreProbesDuringNavWindow": core_sched.observed_probes_during_nav,
                    "warmNav": summarize_latency_series(&rep_nav_latencies),
                    "coreAndTerminal": summarize_latency_series(&core_sched.all_latencies),
                    "perEndpoint": summarize_per_endpoint(&core_sched.per_endpoint),
                    "terminalDrops": core_sched.terminal_drops,
                }));

                tier_nav_samples.extend(rep_nav_latencies);
                tier_core_samples.extend(core_sched.all_latencies.iter().copied());
                core_latencies.extend(core_sched.all_latencies);
                total_term_drops += core_sched.terminal_drops;

                let pgid1 = s_main.get_pgid().await.expect("pgid1");
                let pgid2 = s_peer.get_pgid().await.expect("pgid2");
                let pids1 = sample_tree_resources(pgid1).pids;
                let pids2 = sample_tree_resources(pgid2).pids;
                {
                    let mut st = sampler_state.lock().unwrap();
                    st.phase = "reap";
                }

                let t_reap = Instant::now();
                supervisor.invalidate_connection(&c_main).await;
                supervisor.release_connection(&c_main).await;
                supervisor.invalidate_connection(&c_peer).await;
                supervisor.release_connection(&c_peer).await;
                let reap_dur_ms = t_reap.elapsed().as_secs_f64() * 1000.0;
                reap_samples.push(reap_dur_ms);
                let post_reap_main = s_main.diagnostics();
                let post_reap_peer = s_peer.diagnostics();
                {
                    let mut tr = pressure_tracker.lock().unwrap();
                    tr.record_reap(main_s_idx, post_reap_main);
                    tr.record_reap(peer_s_idx, post_reap_peer);
                }
                if !verify_pids_dead(&pids1)
                    || !is_pgid_empty(pgid1)
                    || !verify_pids_dead(&pids2)
                    || !is_pgid_empty(pgid2)
                {
                    orphan_count += 1;
                }
            }

            tier_metrics.insert(
                tier_name.to_string(),
                json!({
                    "sampleCount": tier_nav_samples.len(),
                    "warmNavMinMs": nearest_rank_percentile_opt(&tier_nav_samples, 0.0),
                    "warmNavP50Ms": nearest_rank_percentile_opt(&tier_nav_samples, 0.50),
                    "warmNavP95Ms": nearest_rank_percentile_opt(&tier_nav_samples, 0.95),
                    "warmNavMaxMs": nearest_rank_percentile_opt(&tier_nav_samples, 1.00),
                    "coreAndTerminal": summarize_latency_series(&tier_core_samples),
                    "perEndpoint": summarize_per_endpoint(&tier_per_ep),
                    "overlap": {
                        "barrierSynchronized": true,
                        "totalOverlapDurationMs": tier_overlap_duration_ms,
                        "minRepOverlapDurationMs": if tier_min_rep_overlap_ms.is_finite() { Some(tier_min_rep_overlap_ms) } else { None },
                        "observedNavigationsDuringCoreWindow": tier_navs_during_core,
                        "observedCoreProbesDuringNavWindow": tier_probes_during_nav,
                    },
                    "repetitions": tier_rep_records,
                }),
            );
            partial_report["tiers"] = Value::Object(tier_metrics.clone());
        }

        partial_report["coreAndTerminalP50Ms"] =
            json!(nearest_rank_percentile_opt(&core_latencies, 0.50));
        partial_report["coreAndTerminalP95Ms"] =
            json!(nearest_rank_percentile_opt(&core_latencies, 0.95));
        partial_report["corePerEndpoint"] = summarize_per_endpoint(&global_per_ep);
        partial_report["coreScheduleOverlap"] = json!({
            "allTiersOverlapped": true,
            "barrierSynchronized": true,
            "tiersCovered": ["small", "medium", "large"],
            "totalOverlapDurationMs": total_overlap_duration_ms,
            "observedNavigationsDuringCoreWindow": total_navs_during_core,
            "observedCoreProbesDuringNavWindow": total_probes_during_nav,
        });
        partial_report["terminalDrops"] = json!(total_term_drops);

        // Focused real-browser SemanticClient adaptive threshold qualification over real authenticated Axum WS
        partial_report["lastOperation"] = json!("browser-threshold-and-freshness");
        sampler_state.lock().unwrap().phase = "browser";

        // Correlate browser WS connection and session to obtain exact session PGID handle
        let mut socket_rx = subscribe_semantic_socket_observations();
        let supervisor_browser = supervisor.clone();
        let sampler_browser = sampler_state.clone();
        let browser_stop = Arc::new(AtomicBool::new(false));
        let browser_stop_watcher = browser_stop.clone();

        let browser_session_watcher = tokio::spawn(async move {
            let mut captured_conn_ids = HashSet::new();
            let mut registered_conn_ids = HashSet::new();
            while !browser_stop_watcher.load(Ordering::Relaxed) {
                if let Ok(Ok(obs)) = tokio::time::timeout(Duration::from_millis(50), socket_rx.recv()).await {
                    if let SemanticSocketObservationKind::Opened { .. } = obs.kind {
                        captured_conn_ids.insert(ConnectionId(obs.connection_id));
                    }
                }

                for conn_id in &captured_conn_ids {
                    if registered_conn_ids.contains(conn_id) {
                        continue;
                    }
                    let key = SessionKey {
                        connection_id: conn_id.clone(),
                        project: "small".to_string(),
                        worktree: None,
                    };
                    if let Some(sess) = supervisor_browser.get_session(&key).await {
                        if let Some(pgid) = sess.current_pgid_cached() {
                            let mut st = sampler_browser.lock().unwrap();
                            st.known_pgids.insert(pgid);
                            st.browser_session_pgids.insert(pgid);
                            registered_conn_ids.insert(conn_id.clone());
                        }
                    }
                }
            }
        });

        let bootstrap_path = tmp.path().join("browser-qual-bootstrap.json");
        let browser_output_path = tmp.path().join("browser-qual-output.json");
        let bootstrap_payload = json!({
            "serverUrl": format!("http://{addr}"),
            "wsUrl": format!("ws://{addr}/ws/semantic/v1"),
            "token": token,
            "project": "small",
            "configuredRoot": small_dir.to_string_lossy(),
            "expectedThresholdBytes": threshold_bytes,
            "candidateThresholdBytes": [32768, 65536, 131072],
            "outputFile": browser_output_path.to_string_lossy(),
        });
        fs::write(
            &bootstrap_path,
            serde_json::to_vec_pretty(&bootstrap_payload).unwrap(),
        )
        .unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&bootstrap_path, fs::Permissions::from_mode(0o600)).unwrap();
        }

        let helper_script = manifest_dir
            .parent()
            .unwrap()
            .join("scripts/run-semantic-browser-qualification.mjs");
        let browser_status_res = tokio::process::Command::new("node")
            .arg(&helper_script)
            .env("SEMANTIC_QUAL_BOOTSTRAP_FILE", &bootstrap_path)
            .status()
            .await;
        let _ = fs::remove_file(&bootstrap_path);

        browser_stop.store(true, Ordering::Relaxed);
        let watcher_res = browser_session_watcher.await;

        let browser_status = browser_status_res
            .map_err(|e| format!("failed to launch browser qualification helper: {e}"))?;
        if let Err(e) = watcher_res {
            return Err(format!("Browser session watcher background task panicked or failed: {e}"));
        }
        let browser_ev: Value = if browser_output_path.exists() {
            serde_json::from_slice(&fs::read(&browser_output_path).unwrap()).unwrap_or(Value::Null)
        } else {
            Value::Null
        };
        partial_report["clientThresholdQualification"] = browser_ev.clone();
        if let Some(sr) = browser_ev.get("staleReveals").and_then(|v| v.as_u64()) {
            partial_report["staleReveals"] = json!(sr);
            partial_report["staleRevealsStatus"] =
                json!("MEASURED_FROM_REAL_BROWSER_SEMANTIC_CLIENT_WS");
        }
        if !browser_status.success() || browser_ev.get("status") != Some(&json!("MEASURED")) {
            return Err(format!(
                "Browser SemanticClient qualification failed (status={:?}): {}",
                browser_status.code(),
                browser_ev
                    .get("error")
                    .and_then(|e| e.as_str())
                    .unwrap_or("unknown browser qualification error")
            ));
        }

        let browser_live_samples = sampler_state.lock().unwrap().browser_live_samples();
        if browser_live_samples == 0 {
            return Err("Browser qualification completed but sampler observed 0 live semantic engine samples during browser phase".into());
        }

        // Allow any closing browser WS session to finish releasing its tree slot
        tokio::time::sleep(Duration::from_millis(200)).await;
        sampler_state.lock().unwrap().phase = "reap";
        partial_report["lastOperation"] = json!("uri-disclosure");
        let disclosures = measure_ws_outside_target_disclosures(
            addr,
            &token,
            "small",
            &small_dir,
            &packaged.root,
        )
        .await;
        partial_report["unauthorizedOrOutsideTargetDisclosures"] = json!(disclosures);

        // Allow disclosure probe WS session to finish releasing its tree slot
        tokio::time::sleep(Duration::from_millis(200)).await;

        // Exercise hostile workspace in denied/production configuration to measure canary executions
        partial_report["lastOperation"] = json!("project-loading-denial");
        let hostile_tmp = TempDir::new().unwrap();
        let hws = hostile_tmp.path();
        fs::create_dir_all(hws.join("src")).unwrap();
        fs::create_dir_all(hws.join("node_modules/malicious-ts-plugin")).unwrap();
        fs::create_dir_all(hws.join("node_modules/typescript/lib")).unwrap();
        let c_v1 = hws.join("qual-v1-canary.txt");
        let c_v2 = hws.join("qual-v2-canary.txt");
        fs::write(
            hws.join("node_modules/malicious-ts-plugin/package.json"),
            r#"{"name":"malicious-ts-plugin","version":"1.0.0","main":"index.js"}"#,
        )
        .unwrap();
        fs::write(
            hws.join("node_modules/malicious-ts-plugin/index.js"),
            format!(
                "require('fs').writeFileSync({:?}, 'FIRED'); module.exports = () => ({{ create: (i) => i.languageService }});\n",
                c_v1.to_string_lossy()
            ),
        )
        .unwrap();
        fs::write(
            hws.join("node_modules/typescript/package.json"),
            r#"{"name":"typescript","version":"99.0.0","main":"./lib/typescript.js"}"#,
        )
        .unwrap();
        fs::write(
            hws.join("node_modules/typescript/lib/tsserver.js"),
            format!(
                "require('fs').writeFileSync({:?}, 'FIRED');\n",
                c_v2.to_string_lossy()
            ),
        )
        .unwrap();
        fs::write(
            hws.join("tsconfig.json"),
            r#"{"compilerOptions":{"target":"ES2022","module":"ESNext","plugins":[{"name":"malicious-ts-plugin"}]}}"#,
        )
        .unwrap();
        let h_index = hws.join("src/index.ts");
        let h_text = "export class SafeTarget {}\nexport const safeInst = new SafeTarget();\n";
        fs::write(&h_index, h_text).unwrap();
        let c_hostile = ConnectionId("conn-qual-hostile-probe".into());
        let ep_hostile = supervisor.register_connection(&c_hostile).await;
        let s_hostile = supervisor
            .get_or_create_session(
                c_hostile.clone(),
                "hostile-qual",
                None,
                hws.to_path_buf(),
                ep_hostile,
            )
            .await
            .map_err(|e| format!("hostile session creation failed: {e}"))?;
        let hostile_s_idx = pressure_tracker
            .lock()
            .unwrap()
            .register(s_hostile.clone());
        s_hostile
            .initialize()
            .await
            .map_err(|e| format!("hostile initialize failed: {e}"))?;
        if let Some(pgid) = s_hostile.get_pgid().await {
            let mut st = sampler_state.lock().unwrap();
            st.known_pgids.insert(pgid);
        }
        let h_uri = path_to_file_uri(&h_index);
        s_hostile
            .did_open(h_uri.clone(), "typescript".into(), 1, h_text.into())
            .await
            .map_err(|e| format!("hostile did_open failed: {e}"))?;
        let h_def = s_hostile
            .navigation(
                "textDocument/definition",
                NavigationParams {
                    text_document: TextDocumentIdentifier { uri: h_uri },
                    position: Position {
                        line: 1,
                        character: 30,
                    },
                    dam_hopper_document_version: 1,
                    dam_hopper_model_generation: None,
                },
            )
            .await
            .map_err(|e| format!("hostile navigation failed: {e}"))?;
        assert_definition_oracle(&h_def, 0, 13);
        supervisor.invalidate_connection(&c_hostile).await;
        supervisor.release_connection(&c_hostile).await;
        let post_reap_hostile = s_hostile.diagnostics();
        pressure_tracker
            .lock()
            .unwrap()
            .record_reap(hostile_s_idx, post_reap_hostile);
        let canary_executions = usize::from(c_v1.exists()) + usize::from(c_v2.exists());

        partial_report["projectCodeCanaryExecutionsInDeniedRuns"] = json!(canary_executions);
        partial_report["reapDurationP95Ms"] = json!(nearest_rank_percentile_opt(&reap_samples, 0.95));
        partial_report["reapDurationMaxMs"] = json!(nearest_rank_percentile_opt(&reap_samples, 1.00));
        partial_report["orphanProcesses"] = json!(orphan_count);
        let pre_shutdown_diag = pressure_tracker.lock().unwrap().build_aggregate_report();
        if pre_shutdown_diag["postReapCleanup"]["allClean"] != json!(true) {
            return Err(format!(
                "Physical cleanup assertion failed: post-reap residuals detected ({})",
                pre_shutdown_diag["postReapCleanup"]
            ));
        }
        Ok(())
    })
    .catch_unwind()
    .await
    .unwrap_or_else(|_| Err("Qualification assertion failed; partial measurements retained".into()));

    sampler_state.lock().unwrap().phase = "reap";
    let shutdown_res = tokio::time::timeout(Duration::from_secs(15), supervisor.shutdown()).await;
    stop_flag.store(true, Ordering::Relaxed);
    let sampler_join_res = sampler_task.await;
    // Explicit post-cleanup zero owned processes sample
    {
        let mut st = sampler_state.lock().unwrap();
        st.phase = "reap";
        st.sample_post_cleanup_zero(self_pid, clk_tck);
    }
    let post_cleanup_zeros = sampler_state.lock().unwrap().post_cleanup_zero_samples;
    let mut teardown_error = None;
    if shutdown_res.is_err() {
        teardown_error = Some("Supervisor shutdown timed out after 15 seconds".to_string());
    } else if let Err(e) = sampler_join_res {
        teardown_error = Some(format!("Sampler background task panicked or failed: {e}"));
    } else if post_cleanup_zeros == 0 {
        teardown_error = Some(
            "Post-cleanup zero owned processes verification failed (0 zero-samples confirmed)"
                .to_string(),
        );
    }

    {
        let mut tr = pressure_tracker.lock().unwrap();
        tr.capture_post_shutdown();
    }
    let session_pressure_diag = pressure_tracker.lock().unwrap().build_aggregate_report();
    partial_report["sessionPressureDiagnostics"] = session_pressure_diag;
    {
        let st = sampler_state.lock().unwrap();
        let total_ticks: u64 = st.per_proc_lifetime_ticks.values().copied().sum();
        let total_cpu_delta_ms = if !st.cpu_delta_ms_series.is_empty() {
            Some((total_ticks as f64) * 1000.0 / (clk_tck as f64))
        } else {
            None
        };
        let obs_startup = st.phase_counts.get("startup").copied().unwrap_or_default();
        let obs_warm = st.phase_counts.get("warm").copied().unwrap_or_default();
        let obs_browser = st.phase_counts.get("browser").copied().unwrap_or_default();
        let obs_reap = st.phase_counts.get("reap").copied().unwrap_or_default();

        partial_report["resources"] = json!({
            "sampleCount": st.rss_series.len(),
            "phaseSampleCounts": {
                "startup": obs_startup.live_samples,
                "warm": obs_warm.live_samples,
                "browser": obs_browser.live_samples,
                "reap": obs_reap.samples,
            },
            "perPhaseObservations": {
                "startup": {
                    "samples": obs_startup.samples,
                    "liveSamples": obs_startup.live_samples,
                    "zeroSamples": obs_startup.zero_samples,
                },
                "warm": {
                    "samples": obs_warm.samples,
                    "liveSamples": obs_warm.live_samples,
                    "zeroSamples": obs_warm.zero_samples,
                },
                "browser": {
                    "samples": obs_browser.samples,
                    "liveSamples": obs_browser.live_samples,
                    "zeroSamples": obs_browser.zero_samples,
                },
                "reap": {
                    "samples": obs_reap.samples,
                    "liveSamples": obs_reap.live_samples,
                    "zeroSamples": obs_reap.zero_samples,
                },
            },
            "postCleanupZeroObservations": st.post_cleanup_zero_samples,
            "peakTreeRssBytes": if st.peak_rss_bytes > 0 { Some(st.peak_rss_bytes) } else { None },
            "p50TreeRssBytes": nearest_rank_percentile_opt(&st.rss_series, 0.50).map(|v| v as u64),
            "p95TreeRssBytes": nearest_rank_percentile_opt(&st.rss_series, 0.95).map(|v| v as u64),
            "maxObservedProcessesAcrossTrees": if st.max_procs > 0 { Some(st.max_procs) } else { None },
            "p95ObservedProcessesAcrossTrees": nearest_rank_percentile_opt(&st.proc_count_series, 0.95).map(|v| v as u64),
            "totalCpuDeltaMs": total_cpu_delta_ms,
            "intervalCpuDeltaMsP50": nearest_rank_percentile_opt(&st.cpu_delta_ms_series, 0.50),
            "intervalCpuDeltaMsP95": nearest_rank_percentile_opt(&st.cpu_delta_ms_series, 0.95),
            "intervalCpuDeltaMsMax": nearest_rank_percentile_opt(&st.cpu_delta_ms_series, 1.00),
            "intervalCpuPctP50": nearest_rank_percentile_opt(&st.cpu_pct_series, 0.50),
            "intervalCpuPctP95": nearest_rank_percentile_opt(&st.cpu_pct_series, 0.95),
            "intervalCpuPctMax": nearest_rank_percentile_opt(&st.cpu_pct_series, 1.00),
            "measuredScope": {
                "scope": "whole-semantic-child-tree-descendants-of-supervisor",
                "phasesCovered": ["startup", "warm", "browser", "reap"],
                "samplingIntervalMs": 100,
                "clockTicksPerSecond": clk_tck,
                "cpuAccounting": "cumulative totalCpuDeltaMs sums latest observed lifetime ticks (utime + stime) per (pid, starttime) across all discovered semantic trees as a sampled lower bound; intervalCpuDeltaMs measures delta ticks across consecutive ~100ms intervals with newly discovered processes baselined on first observation to avoid charging multi-second startup work to single sample rate denominators; intervalCpuPct is defined as (intervalCpuDeltaMs / elapsedMs) * 100.0 where 100% equals 1 logical CPU core",
                "rssAccounting": "procfs /proc/<pid>/statm resident pages * _SC_PAGESIZE for non-zombie live processes across discovered semantic trees",
            },
        });
    }

    partial_report["hostNoise"]["after"] = host_noise_snapshot();
    let run_outcome = if let Some(err) = teardown_error {
        Err(err)
    } else {
        run_outcome
    };
    match run_outcome {
        Ok(()) => {
            partial_report["status"] = json!("MEASURED");
            fs::write(
                &output_file,
                serde_json::to_string_pretty(&partial_report).unwrap(),
            )
            .unwrap();
        }
        Err(err_msg) => {
            partial_report["status"] = json!("PARTIAL_FAILED");
            // Internal error strings can include source, engine stderr, or host paths.
            partial_report["failureReason"] = json!("QUALIFICATION_OPERATION_FAILED");
            fs::write(
                &output_file,
                serde_json::to_string_pretty(&partial_report).unwrap(),
            )
            .unwrap();
            panic!("live_semantic_navigation_qualification failed (partial report preserved at {output_file}): {err_msg}");
        }
    }
}
