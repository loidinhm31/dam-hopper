use std::sync::Arc;

use axum::Router;
use bcrypt::{hash, DEFAULT_COST};
use chrono::Utc;
use dam_hopper_server::api::build_router;
use dam_hopper_server::auth::model::{
    chrono_to_bson, AuthSession, MfaConfirmed, UserRecord, UserRole,
};
use dam_hopper_server::auth::policy::MockClock;
use dam_hopper_server::auth::secret::MfaEncryptionKey;
use dam_hopper_server::auth::totp::TotpEngine;
use dam_hopper_server::auth::{AuthService, AuthStore, Clock};
use dam_hopper_server::config::{
    DamHopperConfig, FeaturesConfig, GlobalConfig, ServerConfig, WorkspaceInfo,
};
use dam_hopper_server::crypto::DamHopperOpaqueSuite;
use dam_hopper_server::diagnostics::DiagnosticStore;
use dam_hopper_server::fs::FsSubsystem;
use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
use dam_hopper_server::state::AppState;
use dam_hopper_server::telemetry::TelemetryRuntime;
use mongodb::Database;
use opaque_ke::ServerSetup;
use rand::rngs::OsRng;
use tempfile::{tempdir, TempDir};

pub const TEST_JWT_SECRET: &str = "test-jwt-secret-key-32-bytes-long!";
pub const DEFAULT_MFA_KEY: [u8; 32] = [0x55u8; 32];

pub struct AuthTestFixture {
    pub app: Router,
    pub db: Option<Database>,
    pub db_name: Option<String>,
    pub sqlite_path: Option<std::path::PathBuf>,
    pub store: AuthStore,
    pub clock: Arc<MockClock>,
    pub raw_mfa_key: [u8; 32],
    pub tmp_dir: TempDir,
    pub state: AppState,
}

impl AuthTestFixture {
    pub async fn new() -> Option<Self> {
        let uri = std::env::var("TEST_MONGODB_URI")
            .unwrap_or_else(|_| "mongodb://127.0.0.1:27018".to_string());
        let client = match mongodb::Client::with_uri_str(&uri).await {
            Ok(c) => c,
            Err(_) => return None,
        };

        let db_name = format!("test_mfa_qual_{}", uuid::Uuid::new_v4().simple());
        let db = client.database(&db_name);
        if db
            .run_command(mongodb::bson::doc! { "ping": 1 })
            .await
            .is_err()
        {
            return None;
        }

        let store = AuthStore::from_mongo(db.clone());
        if let Err(e) = store.init_indexes().await {
            eprintln!("Warning: failed to init indexes on {}: {:?}", db_name, e);
        }

        let tmp = tempdir().unwrap();
        let workspace_root = tmp.path().to_path_buf();
        let (event_sink, _rx) = BroadcastEventSink::new(512);
        let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

        let config = DamHopperConfig {
            workspace: WorkspaceInfo {
                name: "test-workspace".into(),
                root: workspace_root.display().to_string(),
            },
            server: ServerConfig::default(),
            agent_store: None,
            projects: vec![],
            features: FeaturesConfig::default(),
            config_path: workspace_root.join("dam-hopper.toml"),
        };

        let global_config = GlobalConfig::default();
        let store_path = workspace_root.join(".dam-hopper/agent-store");
        let agent_store = dam_hopper_server::agent_store::AgentStoreService::new(store_path);
        let fs = FsSubsystem::new(vec![]);
        let tunnel_manager = super::make_tunnel_manager(&event_sink);
        let diagnostics = DiagnosticStore::new(workspace_root.join("diagnostics.jsonl"));

        let state = AppState::new(
            workspace_root,
            config,
            global_config,
            pty_manager,
            agent_store,
            event_sink,
            TEST_JWT_SECRET.to_string(),
            fs,
            Some(store.clone()),
            false,
            tunnel_manager,
            None,
            ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
            diagnostics,
            TelemetryRuntime::new(),
        )
        .expect("Failed to create AppState");

        let mfa_key = MfaEncryptionKey::new(DEFAULT_MFA_KEY, "test-mfa-fixture-key");
        let clock = Arc::new(MockClock::new(Utc::now()));

        let auth_service = Arc::new(AuthService::new(
            Some(store.clone()),
            Some(mfa_key),
            clock.clone(),
        ));

        let state = state.with_auth_service(auth_service);
        state.host_resource_events.start();
        let app = build_router(state.clone());

        Some(Self {
            app,
            db: Some(db),
            db_name: Some(db_name),
            sqlite_path: None,
            store,
            clock,
            raw_mfa_key: DEFAULT_MFA_KEY,
            tmp_dir: tmp,
            state,
        })
    }

    /// Create an authenticated SQLite fixture (lite mode). File-backed, independent
    /// of MongoDB, never skips.
    pub async fn new_sqlite() -> Self {
        let tmp = tempdir().unwrap();
        let workspace_root = tmp.path().to_path_buf();
        let db_path = workspace_root.join("auth.db");
        let store = AuthStore::open_sqlite(&db_path)
            .await
            .expect("open sqlite test store");

        let (event_sink, _rx) = BroadcastEventSink::new(512);
        let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));

        let config = DamHopperConfig {
            workspace: WorkspaceInfo {
                name: "test-workspace-sqlite".into(),
                root: workspace_root.display().to_string(),
            },
            server: ServerConfig::default(),
            agent_store: None,
            projects: vec![],
            features: FeaturesConfig::default(),
            config_path: workspace_root.join("dam-hopper.toml"),
        };

        let global_config = GlobalConfig::default();
        let store_path = workspace_root.join(".dam-hopper/agent-store");
        let agent_store = dam_hopper_server::agent_store::AgentStoreService::new(store_path);
        let fs = FsSubsystem::new(vec![]);
        let tunnel_manager = super::make_tunnel_manager(&event_sink);
        let diagnostics = DiagnosticStore::new(workspace_root.join("diagnostics.jsonl"));

        let state = AppState::new(
            workspace_root,
            config,
            global_config,
            pty_manager,
            agent_store,
            event_sink,
            TEST_JWT_SECRET.to_string(),
            fs,
            Some(store.clone()),
            false,
            tunnel_manager,
            None,
            ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
            diagnostics,
            TelemetryRuntime::new(),
        )
        .expect("Failed to create AppState for SQLite fixture");

        let mfa_key = MfaEncryptionKey::new(DEFAULT_MFA_KEY, "test-mfa-fixture-key");
        let clock = Arc::new(MockClock::new(Utc::now()));

        let auth_service = Arc::new(AuthService::new(
            Some(store.clone()),
            Some(mfa_key),
            clock.clone(),
        ));

        let state = state.with_auth_service(auth_service);
        state.host_resource_events.start();
        let app = build_router(state.clone());

        Self {
            app,
            db: None,
            db_name: None,
            sqlite_path: Some(db_path),
            store,
            clock,
            raw_mfa_key: DEFAULT_MFA_KEY,
            tmp_dir: tmp,
            state,
        }
    }

    /// Create a mandatory test fixture. Unlike `new()`, panics if MongoDB is not reachable.
    /// Used by qualification tests where MongoDB is required and skipping is disallowed.
    pub async fn mandatory() -> Self {
        Self::new().await.expect(
            "Mandatory test MongoDB instance is not available on TEST_MONGODB_URI; skipping is disallowed for qualification",
        )
    }

    pub async fn create_user(
        &self,
        username: &str,
        password: &str,
        is_enabled: bool,
    ) -> UserRecord {
        let password_hash = hash(password, DEFAULT_COST).expect("bcrypt hash");
        let user = UserRecord {
            id: None,
            username: username.to_string(),
            password_hash,
            is_enabled,
            role: UserRole::User,
            auth_version: 1,
            mfa: None,
            mfa_attempt_window_started_at: None,
            mfa_attempt_count: 0,
            mfa_blocked_until: None,
        };
        self.store
            .create_user(user.clone())
            .await
            .expect("insert user via store");
        user
    }

    pub async fn create_enrolled_user(
        &self,
        username: &str,
        password: &str,
        secret: &[u8; 20],
    ) -> UserRecord {
        let password_hash = hash(password, DEFAULT_COST).expect("bcrypt hash");
        let mfa_key = MfaEncryptionKey::new(self.raw_mfa_key, "test-mfa-fixture-key");
        let (secret_ciphertext, nonce) = mfa_key
            .encrypt(username, "enrollment-confirmed", secret)
            .expect("encrypt secret");

        let now = self.clock.now();
        let step = (now.timestamp() / 30) - 1;
        let confirmed = MfaConfirmed {
            secret_ciphertext,
            nonce,
            key_id: mfa_key.key_id().to_string(),
            enrolled_at: chrono_to_bson(now),
            last_accepted_step: step,
        };

        let user = UserRecord {
            id: None,
            username: username.to_string(),
            password_hash,
            is_enabled: true,
            role: UserRole::User,
            auth_version: 1,
            mfa: Some(confirmed),
            mfa_attempt_window_started_at: None,
            mfa_attempt_count: 0,
            mfa_blocked_until: None,
        };
        self.store
            .create_user(user.clone())
            .await
            .expect("insert enrolled user via store");
        user
    }
    pub async fn insert_user_record(&self, user: UserRecord) {
        self.store
            .create_user(user)
            .await
            .expect("insert user record via store");
    }

    /// Access the MongoDB database, panicking if this fixture uses SQLite.
    pub fn db(&self) -> &Database {
        self.db
            .as_ref()
            .expect("AuthTestFixture is not using MongoDB")
    }

    /// Return the path to the SQLite authentication database if in lite mode.
    pub fn sqlite_path(&self) -> Option<&std::path::Path> {
        self.sqlite_path.as_deref()
    }

    /// Open an independent connection to the SQLite database (simulates operator sqlite3).
    pub fn sqlite_conn(&self) -> rusqlite::Connection {
        let path = self
            .sqlite_path
            .as_ref()
            .expect("AuthTestFixture is not using SQLite");
        let conn = rusqlite::Connection::open(path).expect("open independent sqlite connection");
        conn.busy_timeout(std::time::Duration::from_secs(2))
            .expect("set busy timeout");
        conn
    }

    /// Retrieve immutable user ID (24 hex characters) from the store.
    pub async fn get_user_id(&self, username: &str) -> String {
        let user = self
            .store
            .get_user(username)
            .await
            .expect("store lookup")
            .expect("user exists");
        user.id.expect("immutable user id").to_hex()
    }

    /// Operator approval: sets `is_enabled = true`.
    pub async fn operator_approve(&self, username: &str) -> usize {
        if let Some(sqlite_path) = &self.sqlite_path {
            let conn = rusqlite::Connection::open(sqlite_path).unwrap();
            conn.execute(
                "UPDATE auth_users SET is_enabled = 1 WHERE username = ?1 AND is_enabled = 0",
                [username],
            )
            .expect("operator approve sqlite")
        } else if let Some(db) = &self.db {
            let res = db
                .collection::<UserRecord>("users")
                .update_one(
                    mongodb::bson::doc! { "username": username },
                    mongodb::bson::doc! { "$set": { "isEnabled": true } },
                )
                .await
                .expect("operator approve mongo");
            res.modified_count as usize
        } else {
            panic!("No active backend in fixture");
        }
    }

    /// Operator role assignment: updates role.
    pub async fn operator_promote(&self, username: &str, role: UserRole) -> usize {
        let role_str = match role {
            UserRole::Admin => "admin",
            UserRole::User => "user",
        };
        if let Some(sqlite_path) = &self.sqlite_path {
            let conn = rusqlite::Connection::open(sqlite_path).unwrap();
            conn.execute(
                "UPDATE auth_users SET role = ?1 WHERE username = ?2",
                rusqlite::params![role_str, username],
            )
            .expect("operator promote sqlite")
        } else if let Some(db) = &self.db {
            let res = db
                .collection::<UserRecord>("users")
                .update_one(
                    mongodb::bson::doc! { "username": username },
                    mongodb::bson::doc! { "$set": { "role": role_str } },
                )
                .await
                .expect("operator promote mongo");
            res.modified_count as usize
        } else {
            panic!("No active backend in fixture");
        }
    }

    /// Operator recovery MFA reset: atomic version increment and MFA factor removal.
    pub async fn operator_reset_mfa(&self, username: &str, expected_auth_version: i64) -> usize {
        if let Some(sqlite_path) = &self.sqlite_path {
            let conn = rusqlite::Connection::open(sqlite_path).unwrap();
            conn.execute(
                "UPDATE auth_users \
                 SET auth_version = auth_version + 1, \
                     mfa_secret_ciphertext = NULL, \
                     mfa_nonce = NULL, \
                     mfa_key_id = NULL, \
                     mfa_enrolled_at_ms = NULL, \
                     mfa_last_accepted_step = NULL, \
                     mfa_attempt_window_started_at_ms = NULL, \
                     mfa_attempt_count = 0, \
                     mfa_blocked_until_ms = NULL \
                 WHERE username = ?1 AND auth_version = ?2",
                rusqlite::params![username, expected_auth_version],
            )
            .expect("operator reset mfa sqlite")
        } else if let Some(db) = &self.db {
            let res = db
                .collection::<UserRecord>("users")
                .update_one(
                    mongodb::bson::doc! { "username": username, "authVersion": expected_auth_version },
                    mongodb::bson::doc! {
                        "$inc": { "authVersion": 1 },
                        "$unset": {
                            "mfa": "",
                            "mfaAttemptWindowStartedAt": "",
                            "mfaAttemptCount": "",
                            "mfaBlockedUntil": ""
                        }
                    },
                )
                .await
                .expect("operator reset mfa mongo");
            res.modified_count as usize
        } else {
            panic!("No active backend in fixture");
        }
    }

    pub async fn create_session(
        &self,
        username: &str,
        credential_version: i64,
        issued_at: chrono::DateTime<Utc>,
        expires_at: chrono::DateTime<Utc>,
        mfa_verified_at: chrono::DateTime<Utc>,
    ) -> (AuthSession, String) {
        let session = AuthSession {
            id: format!("sess-{}", uuid::Uuid::new_v4().simple()),
            username: username.to_string(),
            auth_version: 1,
            credential_version,
            issued_at: chrono_to_bson(issued_at),
            expires_at: chrono_to_bson(expires_at),
            mfa_verified_at: chrono_to_bson(mfa_verified_at),
            revoked_at: None,
        };
        self.store
            .create_session(session.clone())
            .await
            .expect("create session");

        let claims = dam_hopper_server::auth::model::AuthClaims {
            v: 2,
            sub: username.to_string(),
            sid: session.id.clone(),
            auth_version: 1,
            credential_version,
            iat: issued_at.timestamp() as usize,
            exp: expires_at.timestamp() as usize,
        };
        let token = claims.encode(TEST_JWT_SECRET).expect("encode claims");
        (session, token)
    }

    pub fn generate_code(&self, secret: &[u8; 20], offset_steps: i64) -> String {
        let timestamp = self.clock.now().timestamp() as u64;
        let step = (timestamp / 30) as i64 + offset_steps;
        let effective_ts = (step.max(0) as u64) * 30;
        TotpEngine::generate_code_at(secret, effective_ts).expect("generate totp code")
    }

    pub async fn cleanup(&self) {
        if let Some(db) = &self.db {
            let _ = db.drop().await;
        }
    }
}
impl Drop for AuthTestFixture {
    fn drop(&mut self) {
        if let Some(db) = &self.db {
            if let Ok(handle) = tokio::runtime::Handle::try_current() {
                let db = db.clone();
                handle.spawn(async move {
                    let _ = db.drop().await;
                });
            }
        }
    }
}
