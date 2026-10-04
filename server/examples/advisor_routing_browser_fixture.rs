//! Dedicated loopback temp-HOME/auth/model test fixture for Vitest Browser Mode cross-layer tests.
//!
//! Serves only localhost, creates its own TempDir, uses production router/domain code,
//! and terminates on stdin EOF or Ctrl+C / SIGTERM.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use clap::Parser;
use dam_hopper_server::advisor::AdvisorService;
use dam_hopper_server::agent_store::AgentStoreService;
use dam_hopper_server::api::router::{build_router_with_origins, parse_cors_origins};
use dam_hopper_server::auth::AuthService;
use dam_hopper_server::auth::model::{
    AuthClaims, AuthSession, UserRecord, UserRole, chrono_to_bson,
};
use dam_hopper_server::config::{
    DamHopperConfig, FeaturesConfig, GlobalConfig, ProjectConfig, ProjectType, RestartPolicy,
    ServerConfig, WorkspaceInfo,
};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use dam_hopper_server::tunnel::TunnelSessionManager;
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use serde_json::json;
use tokio::io::AsyncReadExt;

const TEST_JWT_SECRET: &str = "test-jwt-secret-key-32bytes-long!";

#[derive(Parser, Debug)]
#[command(name = "advisor_routing_browser_fixture")]
struct Args {
    #[arg(long, default_value = "0")]
    port: u16,

    #[arg(long)]
    cors_origin: Vec<String>,
}

fn generate_auth_token(subject: &str, sid: &str) -> String {
    let now = chrono::Utc::now();
    let claims = AuthClaims {
        v: 2,
        sub: subject.to_string(),
        sid: sid.to_string(),
        auth_version: 0,
        credential_version: 0,
        iat: now.timestamp() as usize,
        exp: (now.timestamp() + 86400) as usize,
    };
    claims.encode(TEST_JWT_SECRET).unwrap()
}

fn setup_temp_home(root: &Path) -> PathBuf {
    let home = root.join("home");
    let dot_evcrate = home.join(".evcrate");
    fs::create_dir_all(&dot_evcrate).expect("failed to create .evcrate directory");

    let initial_policy = json!({
        "version": 2,
        "advisor": {
            "primary": { "backend": "codex", "model": "gpt-6.1-sol", "effort": "medium" },
            "backup": { "backend": "omp", "model": "openai/gpt-4.1-mini", "effort": "low" }
        },
        "wait": {
            "mode": "until_terminal",
            "warn_after_ms": 10000,
            "warn_every_ms": 5000
        },
        "history": {
            "retention_days": 30,
            "max_bytes": 10485760
        }
    });

    let policy_path = dot_evcrate.join("advisor-routing.json");
    fs::write(
        &policy_path,
        serde_json::to_string_pretty(&initial_policy).unwrap(),
    )
    .expect("failed to write initial policy");

    home
}

async fn shutdown_signal() {
    let mut stdin = tokio::io::stdin();
    let mut buf = [0u8; 1];

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {},
        _ = async {
            #[cfg(unix)]
            {
                let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("failed to register SIGTERM handler");
                sigterm.recv().await;
            }
            #[cfg(not(unix))]
            {
                std::future::pending::<()>().await;
            }
        } => {},
        _ = async {
            let _ = stdin.read(&mut buf).await;
        } => {},
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    let temp_dir = tempfile::tempdir()?;
    let temp_home = setup_temp_home(temp_dir.path());

    let config_path = temp_dir.path().join("dam-hopper.toml");
    let mut server_config = ServerConfig::default();
    server_config.advisor.enabled = true;

    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "browser-test-workspace".into(),
            root: temp_dir.path().display().to_string(),
        },
        agent_store: None,
        server: server_config,
        projects: vec![ProjectConfig {
            name: "test-project".into(),
            path: temp_dir.path().join("proj").display().to_string(),
            project_type: ProjectType::Npm,
            services: None,
            commands: None,
            env_file: None,
            tags: None,
            terminals: vec![],
            agents: None,
            restart_policy: RestartPolicy::Never,
            restart_max_retries: 0,
            health_check_url: None,
        }],
        features: FeaturesConfig::default(),
        config_path: config_path.clone(),
    };
    dam_hopper_server::config::write_config(&config_path, &config)?;

    let (event_sink, _rx) = BroadcastEventSink::new(64);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
    let dummy_driver = Arc::new(dam_hopper_server::tunnel::CloudflaredDriver);
    let tunnel_manager = TunnelSessionManager::new(Arc::new(event_sink.clone()), dummy_driver);
    let diagnostics = DiagnosticStore::new(temp_dir.path().join("diag.jsonl"));

    let mut state = AppState::new(
        temp_dir.path().to_path_buf(),
        config,
        GlobalConfig::default(),
        pty_manager,
        AgentStoreService::new(temp_dir.path().join("store")),
        event_sink,
        TEST_JWT_SECRET.to_string(),
        FsSubsystem::new(vec![]),
        None,
        false, // auth required
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
        dam_hopper_server::telemetry::TelemetryRuntime::new(),
    )?;

    // Mock admin user and session
    let now = chrono::Utc::now();
    let exp = chrono::DateTime::from_timestamp((now.timestamp() + 86400) as i64, 0).unwrap();
    let user = UserRecord {
        id: None,
        username: "browser-admin".to_string(),
        password_hash: String::new(),
        is_enabled: true,
        role: UserRole::Admin,
        auth_version: 0,
        mfa: None,
        mfa_attempt_window_started_at: None,
        mfa_attempt_count: 0,
        mfa_blocked_until: None,
    };
    let session = AuthSession {
        id: "session-browser-admin".to_string(),
        username: "browser-admin".to_string(),
        auth_version: 0,
        credential_version: 0,
        issued_at: chrono_to_bson(now),
        expires_at: chrono_to_bson(exp),
        mfa_verified_at: chrono_to_bson(now),
        revoked_at: None,
    };
    let token = generate_auth_token("browser-admin", "session-browser-admin");
    let auth_service = Arc::new(AuthService::new_mock(user, session));
    state = state.with_auth_service(auth_service);

    let advisor_service = Arc::new(AdvisorService::new(Some(temp_home.clone())));
    state = state.with_advisor_service(advisor_service);

    let allowed_origins = if !args.cors_origin.is_empty() {
        parse_cors_origins(Some(&args.cors_origin.join(",")))?
    } else {
        Vec::new()
    };
    let router = build_router_with_origins(state, allowed_origins);

    let bind_addr = format!("127.0.0.1:{}", args.port);
    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    let local_addr = listener.local_addr()?;
    let actual_port = local_addr.port();

    let ready_payload = json!({
        "status": "ready",
        "port": actual_port,
        "url": format!("http://127.0.0.1:{}", actual_port),
        "token": token,
        "tempHome": temp_home.display().to_string(),
    });

    println!("{}", serde_json::to_string(&ready_payload)?);
    io::stdout().flush()?;

    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}
