use std::collections::BTreeMap;
use std::fs;
use std::net::SocketAddr;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{ensure, Context};
use clap::{Parser, ValueEnum};
use dam_hopper_server::agent_store::AgentStoreService;
use dam_hopper_server::api::router::build_router_with_web_dir_and_origins;
use dam_hopper_server::config::{
    DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, RestartPolicy,
    WorkspaceInfo,
};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::plugins::contract::{GrantKey, PluginReadUiParams};
use dam_hopper_server::plugins::{
    AdminSubjectList, EpochRegistry, PluginApiService, PluginAuthorizationService,
    PluginContextTable, PluginRegistry, PluginRegistryLayout, RunnerClient, RunnerClientConfig,
    RunnerServer, RunnerServerConfig, SupervisorManager,
};
use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use dam_hopper_server::tunnel::{CloudflaredDriver, TunnelSessionManager};
use dam_hopper_server::workspace_target::WorkspaceTargetResolver;
use jsonwebtoken::{EncodingKey, Header};
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tempfile::TempDir;
use tokio::sync::watch;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

const OPERATIONS: &[&str] = &[
    "history.refresh",
    "history.summary",
    "history.page",
    "history.detail",
    "policy.readCurrent",
    "evaluations.list",
    "evaluations.read",
    "evaluations.compare",
];

#[derive(Clone, Debug, ValueEnum)]
enum TransportDeclaration {
    Https,
    TrustedEncryptedLan,
    LocalSmoke,
}

#[derive(Debug, Parser)]
#[command(
    name = "dam-hopper-plugin-test-server",
    about = "Integrated development and qualification test server for DamHopper plugins"
)]
struct Args {
    #[arg(long)]
    candidate: PathBuf,
    #[arg(long)]
    expected_digest: String,
    #[arg(long)]
    project_path: PathBuf,
    #[arg(long, default_value = "evcrate")]
    project_name: String,
    #[arg(long)]
    web_dir: PathBuf,
    #[arg(long)]
    node_bin: PathBuf,
    #[arg(long, default_value = "127.0.0.1:4800")]
    bind: SocketAddr,
    #[arg(long)]
    public_origin: String,
    #[arg(long, value_enum)]
    transport: TransportDeclaration,
    #[arg(long)]
    state_dir: Option<PathBuf>,
    #[arg(long, default_value = "g2-reader")]
    actor: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Claims {
    sub: String,
    exp: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionDescriptor {
    schema_version: u32,
    qualification: &'static str,
    transport_declaration: String,
    server_origin: String,
    profile_id: String,
    profile_name: &'static str,
    actor: String,
    token: String,
    project: String,
    project_path: String,
    installation_id: String,
    package_sha256: String,
    ui_sha256: String,
    activation_generation: u64,
    plugin_url: String,
    direct_asset_url: String,
    state_dir: String,
}

fn require_empty_state_dir(path: &Path) -> anyhow::Result<()> {
    if path.exists() {
        ensure!(path.is_dir(), "state directory is not a directory");
        ensure!(
            fs::read_dir(path)?.next().is_none(),
            "state directory must be empty for a disposable run"
        );
    } else {
        fs::create_dir_all(path)?;
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

fn validate_origin(origin: &str, transport: &TransportDeclaration) -> anyhow::Result<String> {
    let uri: axum::http::Uri = origin.parse().context("public origin is not a URI")?;
    ensure!(
        uri.authority().is_some(),
        "public origin must include a host"
    );
    ensure!(
        uri.path() == "/" && uri.query().is_none(),
        "public origin must not include a path or query"
    );
    match transport {
        TransportDeclaration::Https => ensure!(
            uri.scheme_str() == Some("https"),
            "HTTPS declaration requires an https origin"
        ),
        TransportDeclaration::TrustedEncryptedLan | TransportDeclaration::LocalSmoke => {
            ensure!(
                matches!(uri.scheme_str(), Some("http" | "https")),
                "origin must use http or https"
            )
        }
    }
    Ok(origin.trim_end_matches('/').to_string())
}

fn encode_token(subject: &str, secret: &str) -> anyhow::Result<String> {
    let claims = Claims {
        sub: subject.to_string(),
        exp: chrono::Utc::now().timestamp() as usize + 8 * 60 * 60,
    };
    Ok(jsonwebtoken::encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let args = Args::parse();
    let public_origin = validate_origin(&args.public_origin, &args.transport)?;
    ensure!(
        !args.project_name.is_empty()
            && args
                .project_name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')),
        "project name must be URL-safe ASCII"
    );
    ensure!(
        args.expected_digest.len() == 64
            && args
                .expected_digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase()),
        "expected digest must be lowercase SHA-256"
    );

    let candidate =
        fs::canonicalize(&args.candidate).context("candidate archive is unavailable")?;
    let project_path =
        fs::canonicalize(&args.project_path).context("project path is unavailable")?;
    let web_dir = fs::canonicalize(&args.web_dir).context("built web directory is unavailable")?;
    let node_bin = fs::canonicalize(&args.node_bin).context("pinned Node binary is unavailable")?;
    ensure!(
        web_dir.join("index.html").is_file(),
        "web directory has no index.html"
    );

    let temporary_state = if args.state_dir.is_none() {
        Some(TempDir::new().context("create temporary G2 state")?)
    } else {
        None
    };
    let state_dir = args
        .state_dir
        .clone()
        .unwrap_or_else(|| temporary_state.as_ref().unwrap().path().to_path_buf());
    require_empty_state_dir(&state_dir)?;

    let archive = fs::read(&candidate)?;
    let package_sha256 = hex::encode(Sha256::digest(&archive));
    ensure!(
        package_sha256 == args.expected_digest,
        "candidate digest mismatch"
    );

    let registry = Arc::new(PluginRegistry::new(
        PluginRegistryLayout::new(state_dir.join("registry")),
        AdminSubjectList::new(vec!["g2-admin".to_string()]),
    )?);
    let stage = registry.stage_begin("g2-admin", &package_sha256, archive.len() as u64)?;
    for (sequence, chunk) in archive.chunks(stage.max_chunk_size).enumerate() {
        registry.stage_chunk("g2-admin", &stage.stage_id, sequence as u64, chunk)?;
    }
    registry.stage_finish("g2-admin", &stage.stage_id)?;
    let bindings = BTreeMap::from([(
        args.project_name.clone(),
        project_path.display().to_string(),
    )]);
    let installation = registry.approve_stage(
        "g2-admin",
        &stage.stage_id,
        &package_sha256,
        1,
        bindings,
        Vec::new(),
    )?;
    let grant = GrantKey {
        actor_subject: args.actor.clone(),
        installation_id: installation.installation_id.clone(),
        configured_project_target: "*".to_string(),
        allowed_operations: OPERATIONS
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        allow_current_account_policy: true,
    };
    registry.update_grants(
        "g2-admin",
        &installation.installation_id,
        1,
        vec![grant.clone()],
    )?;
    let ui = registry.read_ui_bytes(&PluginReadUiParams {
        installation_id: installation.installation_id.clone(),
        expected_digest: package_sha256.clone(),
        activation_generation: installation.activation_generation,
        actor_subject: args.actor.clone(),
        project_target: args.project_name.clone(),
    })?;

    let socket_path = state_dir.join("runner.sock");
    let uid = unsafe { libc::geteuid() };
    let allow_root = uid == 0;
    let supervisors = Arc::new(SupervisorManager::new(registry.clone(), node_bin));
    supervisors
        .get_or_create(&installation.installation_id)
        .await?
        .activate()
        .await?;
    let runner = RunnerServer::new(
        RunnerServerConfig {
            socket_path: socket_path.clone(),
            expected_api_uid: Some(uid),
            allow_root_peer: allow_root,
        },
        registry,
        supervisors,
    );
    let (runner_shutdown_tx, runner_shutdown_rx) = watch::channel(false);
    let runner_task = tokio::spawn(async move { runner.run(runner_shutdown_rx).await });
    for _ in 0..100 {
        if socket_path.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    ensure!(socket_path.exists(), "runner socket did not become ready");

    let runner_client = Arc::new(RunnerClient::new(RunnerClientConfig {
        socket_path,
        expected_runner_uid: Some(uid),
        allow_root_peer: allow_root,
        client_name: "g2-harness-api".to_string(),
        max_reconnect_retries: 5,
        reconnect_base_delay: Duration::from_millis(50),
    }));
    let epochs = Arc::new(EpochRegistry::new());
    let authorization = Arc::new(PluginAuthorizationService::new(epochs));
    authorization.set_actor_grants(&args.actor, vec![grant]);
    let plugin_service = Arc::new(PluginApiService::new(
        runner_client,
        authorization,
        Arc::new(PluginContextTable::new()),
        WorkspaceTargetResolver::new(),
    ));

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "plugin-g2".to_string(),
            root: project_path.display().to_string(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![ProjectConfig {
            name: args.project_name.clone(),
            path: project_path.display().to_string(),
            project_type: ProjectType::Custom,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: Vec::new(),
            agents: None,
            restart_policy: RestartPolicy::Never,
            restart_max_retries: 0,
            health_check_url: None,
        }],
        features: FeaturesConfig::default(),
        config_path: state_dir.join("dam-hopper.toml"),
    };
    let (event_sink, _events) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
    let tunnel_manager =
        TunnelSessionManager::new(Arc::new(event_sink.clone()), Arc::new(CloudflaredDriver));
    let diagnostics = DiagnosticStore::new(state_dir.join("diagnostics.jsonl"));
    let jwt_secret = Uuid::new_v4().to_string();
    let token = encode_token(&args.actor, &jwt_secret)?;
    let state = AppState::new(
        state_dir.clone(),
        config,
        GlobalConfig::default(),
        pty_manager,
        AgentStoreService::new(state_dir.join("agent-store")),
        event_sink,
        jwt_secret,
        FsSubsystem::new(Vec::new()),
        None,
        false,
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )?
    .with_plugin_service(plugin_service);

    let profile_id = Uuid::new_v4().to_string();
    let asset_path = format!(
        "/api/plugins/{}/ui?project={}&activeDigest={}&activationGeneration={}",
        installation.installation_id,
        args.project_name,
        package_sha256,
        installation.activation_generation
    );
    let descriptor = SessionDescriptor {
        schema_version: 1,
        qualification: "D04-E03-G2",
        transport_declaration: format!("{:?}", args.transport),
        server_origin: public_origin.clone(),
        profile_id,
        profile_name: "Plugin G2",
        actor: args.actor,
        token,
        project: args.project_name,
        project_path: project_path.display().to_string(),
        installation_id: installation.installation_id.clone(),
        package_sha256,
        ui_sha256: ui.sha256,
        activation_generation: installation.activation_generation,
        plugin_url: format!("{public_origin}/plugins/{}", installation.installation_id),
        direct_asset_url: format!("{public_origin}{asset_path}"),
        state_dir: state_dir.display().to_string(),
    };
    let session_path = state_dir.join("g2-session.json");
    fs::write(&session_path, serde_json::to_vec_pretty(&descriptor)?)?;
    fs::set_permissions(&session_path, fs::Permissions::from_mode(0o600))?;

    let allowed_origins = axum::http::HeaderValue::from_str(&public_origin)
        .ok()
        .map(|v| vec![v])
        .unwrap_or_default();
    let app = build_router_with_web_dir_and_origins(state, allowed_origins, Some(web_dir));
    let auth_state = Arc::new(AuthState {
        token: descriptor.token.clone(),
        actor: descriptor.actor.clone(),
    });
    let app = app.layer(axum::middleware::from_fn_with_state(
        auth_state,
        auto_auth_middleware,
    ));
    let listener = tokio::net::TcpListener::bind(args.bind).await?;
    println!(
        "PLUGIN_SERVER_READY session={} listen={} origin={}",
        session_path.display(),
        args.bind,
        public_origin
    );
    println!(
        "G2_READY session={} listen={} origin={}",
        session_path.display(),
        args.bind,
        public_origin
    );
    let server = axum::serve(listener, app).with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    });
    let result = server.await;
    let _ = runner_shutdown_tx.send(true);
    let runner_result = runner_task.await.context("runner task join")?;
    result?;
    runner_result?;
    Ok(())
}

#[derive(Clone)]
struct AuthState {
    token: String,
    actor: String,
}

async fn auto_auth_middleware(
    axum::extract::State(auth): axum::extract::State<Arc<AuthState>>,
    mut request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let path = request.uri().path().to_string();
    let method = request.method().clone();

    if path == "/api/auth/login" && method == axum::http::Method::POST {
        let cookie_val = format!("damhopper-auth={}; HttpOnly; SameSite=Lax; Path=/", auth.token);
        let body = serde_json::json!({
            "ok": true,
            "token": auth.token,
            "user": auth.actor,
            "dev_mode": true
        });
        let mut resp = axum::response::IntoResponse::into_response((
            axum::http::StatusCode::OK,
            axum::Json(body),
        ));
        if let Ok(header_val) = axum::http::HeaderValue::from_str(&cookie_val) {
            resp.headers_mut().append(axum::http::header::SET_COOKIE, header_val);
        }
        return resp;
    }

    let has_auth = request.headers().contains_key(axum::http::header::AUTHORIZATION);
    let has_cookie = request
        .headers()
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|c| c.contains("damhopper-auth="))
        .unwrap_or(false);

    if !has_auth && !has_cookie {
        if let Ok(bearer_val) = axum::http::HeaderValue::from_str(&format!("Bearer {}", auth.token)) {
            request.headers_mut().insert(axum::http::header::AUTHORIZATION, bearer_val);
        }
    }

    if path == "/ws" && !has_cookie {
        let uri = request.uri();
        let new_uri = if let Some(query) = uri.query() {
            if !query.contains("token=") {
                format!("{}?{}&token={}", uri.path(), query, auth.token)
            } else {
                uri.to_string()
            }
        } else {
            format!("{}?token={}", uri.path(), auth.token)
        };
        if let Ok(parsed) = new_uri.parse::<axum::http::Uri>() {
            *request.uri_mut() = parsed;
        }
    }

    let mut response = next.run(request).await;

    if !has_cookie {
        let cookie_val = format!("damhopper-auth={}; HttpOnly; SameSite=Lax; Path=/", auth.token);
        if let Ok(header_val) = axum::http::HeaderValue::from_str(&cookie_val) {
            response.headers_mut().append(axum::http::header::SET_COOKIE, header_val);
        }
    }

    response
}
