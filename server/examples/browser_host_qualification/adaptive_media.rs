//! `DAM_HOPPER_QUALIFICATION_MODE=adaptive-media`: production AppState + router with the real
//! browser host, served on a configurable address for disposable real-link qualification.
//!
//! The extra metrics/fixture surface is a SECOND listener, always loopback, never part of the
//! production router. Environment: `QUAL_WORK_DIR` (required), `QUAL_LISTEN` (default
//! 127.0.0.1:18080; a non-loopback address is rejected unless `QUAL_ALLOW_NON_LOOPBACK=1`, which
//! is only for a disposable isolated network namespace), `QUAL_PUBLIC_ORIGIN` (default
//! http://127.0.0.1:18080: the SPA only sends credentials to https or loopback origins),
//! `QUAL_AUX_ADDR` (default 127.0.0.1:18090, loopback only, no opt-in), `QUAL_WEB_DIR`,
//! `QUAL_READY_FILE` (owner-only 0600; carries the admin bearer token), `QUAL_POLICY_LABEL`.
//!
//! The JWT signing secret, admin username, session id and auth/credential versions are random
//! per process; nothing predictable is compiled in.

use axum::routing::get;
use axum::Router;
use serde_json::json;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use dam_hopper_server::auth::model::{chrono_to_bson, AuthClaims, AuthSession, UserRecord, UserRole};
use dam_hopper_server::browser_host::config::{BrowserHostConfig, PublicServerOrigin};

use crate::fixtures;
use crate::stream_metrics::{env_or, stream_metrics};

/// Loopback policy for a listen address: non-loopback only with an explicit opt-in.
fn validate_listen_addr(name: &str, addr: SocketAddr, allow_non_loopback: bool) -> Result<SocketAddr, String> {
    if addr.ip().is_loopback() || allow_non_loopback {
        Ok(addr)
    } else {
        Err(format!(
            "{name}={addr} is not loopback; use a loopback address (only QUAL_LISTEN can be opted out, \
             with QUAL_ALLOW_NON_LOOPBACK=1 inside a disposable isolated network namespace)"
        ))
    }
}

/// `bytes` of OS randomness as lowercase hex.
fn random_hex(bytes: usize) -> String {
    use rand::RngCore;
    use std::fmt::Write;
    let mut buf = vec![0u8; bytes];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    buf.iter().fold(String::with_capacity(bytes * 2), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

/// Writes `contents` to `path`, owner-only (temp file + rename: readers never see a partial file).
fn write_private(path: &str, contents: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let tmp = format!("{path}.tmp");
    let _ = std::fs::remove_file(&tmp);
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&tmp)?;
    file.write_all(contents.as_bytes())?;
    file.sync_all()?;
    std::fs::rename(tmp, path)
}

pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    // Server-side tracing to stderr (-> server.log). RUST_LOG overrides; default keeps warnings
    // everywhere and debug for the browser host (media close causes, rate limits, timeouts).
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "warn,dam_hopper_server::browser_host=debug".into()),
        )
        .with_writer(std::io::stderr)
        .try_init();
    let allow_non_loopback = std::env::var("QUAL_ALLOW_NON_LOOPBACK").is_ok_and(|v| v == "1");
    let work = PathBuf::from(std::env::var("QUAL_WORK_DIR").map_err(|_| "QUAL_WORK_DIR is required")?);
    let listen = validate_listen_addr("QUAL_LISTEN", env_or("QUAL_LISTEN", "127.0.0.1:18080").parse()?, allow_non_loopback)?;
    let aux_addr = validate_listen_addr("QUAL_AUX_ADDR", env_or("QUAL_AUX_ADDR", "127.0.0.1:18090").parse()?, false)?;
    let web_dir = PathBuf::from(env_or("QUAL_WEB_DIR", "../apps/web/dist"));
    let exec = dam_hopper_server::browser_host::process::find_browser_executable(
        std::env::var("DAM_HOPPER_BROWSER_EXECUTABLE").ok().map(PathBuf::from).as_deref(),
    )?;
    let origin = env_or("QUAL_PUBLIC_ORIGIN", "http://127.0.0.1:18080");
    let fixture_origin = format!("http://{aux_addr}");
    std::fs::create_dir_all(&work)?;
    let jwt_secret = random_hex(32);
    let admin_name = format!("qual-{}", random_hex(8));
    let session_id = uuid::Uuid::new_v4().to_string();
    let auth_version = 1 + i64::from(rand::random::<u32>());
    let credential_version = 1 + i64::from(rand::random::<u32>());

    let (event_sink, _rx) = dam_hopper_server::pty::BroadcastEventSink::new(512);
    let pty_manager = dam_hopper_server::pty::PtySessionManager::new(Arc::new(event_sink.clone()));
    let config = dam_hopper_server::config::DamHopperConfig {
        workspace: dam_hopper_server::config::WorkspaceInfo {
            name: "qual-adaptive".into(),
            root: work.display().to_string(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig {
            session_db_path: work.join("sessions.db").display().to_string(),
            browser: BrowserHostConfig {
                enabled: true,
                executable_path: Some(exec),
                profile_root: Some(work.join("browser-profiles")),
                allowed_target_origins: vec![fixture_origin.clone()],
                ..Default::default()
            },
            ..Default::default()
        },
        projects: vec![],
        features: dam_hopper_server::config::FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: work.join("dam-hopper.toml"),
    };
    let store = dam_hopper_server::auth::AuthStore::open_sqlite(&work.join("auth.db")).await?;
    let setup = opaque_ke::ServerSetup::<dam_hopper_server::crypto::DamHopperOpaqueSuite>::new(&mut rand::rngs::OsRng);
    let state = dam_hopper_server::state::AppState::new(
        work.clone(),
        config,
        dam_hopper_server::config::GlobalConfig::default(),
        pty_manager,
        dam_hopper_server::agent_store::AgentStoreService::new(work.join(".dam-hopper/agent-store")),
        event_sink,
        jwt_secret.clone(),
        dam_hopper_server::fs::FsSubsystem::new(vec![]),
        None,
        false,
        dam_hopper_server::tunnel::TunnelSessionManager::new(
            Arc::new(dam_hopper_server::pty::BroadcastEventSink::new(8).0),
            Arc::new(dam_hopper_server::tunnel::CloudflaredDriver),
        ),
        None,
        setup,
        dam_hopper_server::diagnostics::DiagnosticStore::new(work.join("diagnostics.jsonl")),
    )?
    .with_auth_service(Arc::new(dam_hopper_server::auth::AuthService::with_system_clock(
        Some(store.clone()),
        None,
    )))
    .with_public_server_origin(Some(PublicServerOrigin::parse(&origin)?));

    // One real admin session; both viewers use its bearer token like the e2e fixtures.
    let now = chrono::Utc::now();
    let exp = now + chrono::Duration::days(30);
    store
        .create_user(UserRecord {
            id: None,
            username: admin_name.clone(),
            password_hash: "unused-hash".into(),
            role: UserRole::Admin,
            is_enabled: true,
            auth_version,
            mfa: None,
            mfa_attempt_window_started_at: None,
            mfa_attempt_count: 0,
            mfa_blocked_until: None,
        })
        .await?;
    store
        .create_session(AuthSession {
            id: session_id.clone(),
            username: admin_name.clone(),
            auth_version,
            credential_version,
            issued_at: chrono_to_bson(now),
            expires_at: chrono_to_bson(exp),
            mfa_verified_at: chrono_to_bson(now),
            revoked_at: None,
            user_agent: None,
        })
        .await?;
    let token = AuthClaims {
        v: dam_hopper_server::auth::policy::AUTH_PROTOCOL_VERSION,
        sub: admin_name.clone(),
        sid: session_id.clone(),
        auth_version,
        credential_version,
        iat: now.timestamp() as usize,
        exp: exp.timestamp() as usize,
    }
    .encode(&jwt_secret)?;

    let listener = tokio::net::TcpListener::bind(listen).await?;
    state.record_bound_listener(listener.local_addr()?).map_err(|_| "listener already recorded")?;
    let router = dam_hopper_server::api::router::build_router_with_web_dir_and_origins(
        state,
        dam_hopper_server::api::router::parse_cors_origins(Some(&origin))?,
        Some(web_dir),
    );
    let aux = Router::new()
        .route("/qualification/stream-metrics", get(stream_metrics))
        .route("/fixture/static-text", get(fixtures::static_text))
        .route("/fixture/code-scroll", get(fixtures::code_scroll))
        .route("/fixture/motion", get(fixtures::motion));
    let aux_listener = tokio::net::TcpListener::bind(aux_addr).await?;
    tokio::spawn(async move {
        let _ = axum::serve(aux_listener, aux).await;
    });

    let ready = json!({"origin": origin, "fixtureOrigin": fixture_origin, "adminToken": token,
                       "username": admin_name, "policy": env_or("QUAL_POLICY_LABEL", "unlabeled")});
    if let Ok(path) = std::env::var("QUAL_READY_FILE") {
        write_private(&path, &serde_json::to_string(&ready)?)?;
    }
    eprintln!("[adaptive-media] ready origin={origin} fixtures={fixture_origin}");
    axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    #[test]
    fn loopback_addresses_are_always_accepted() {
        for s in ["127.0.0.1:18080", "[::1]:18080", "127.9.9.9:1"] {
            assert_eq!(validate_listen_addr("X", addr(s), false), Ok(addr(s)));
        }
    }

    #[test]
    fn non_loopback_is_rejected_without_opt_in_and_names_the_variable() {
        for s in ["0.0.0.0:18080", "[::]:18080", "10.0.1.1:18080", "192.168.1.5:1"] {
            let err = validate_listen_addr("QUAL_LISTEN", addr(s), false).unwrap_err();
            assert!(err.contains("QUAL_LISTEN") && err.contains("QUAL_ALLOW_NON_LOOPBACK"), "{err}");
        }
    }

    #[test]
    fn explicit_opt_in_allows_non_loopback() {
        assert_eq!(validate_listen_addr("X", addr("0.0.0.0:18080"), true), Ok(addr("0.0.0.0:18080")));
    }

    #[test]
    fn random_hex_is_fixed_length_and_not_repeated() {
        let (a, b) = (random_hex(32), random_hex(32));
        assert_eq!(a.len(), 64);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn private_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("qual-priv-{}", random_hex(6)));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ready.json");
        write_private(path.to_str().unwrap(), "{}").unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
