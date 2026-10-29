//! Real-binary integration tests verifying startup backend selection,
//! failure contracts, and lack of fallback between MongoDB and SQLite.

use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

struct TestEnv {
    dir: tempfile::TempDir,
    config_path: PathBuf,
    port: u16,
}

struct ChildGuard(Option<Child>);

impl ChildGuard {
    fn new(child: Child) -> Self {
        Self(Some(child))
    }

    fn child_mut(&mut self) -> &mut Child {
        self.0.as_mut().expect("child active")
    }

    fn finish_output(mut self) -> std::process::Output {
        let mut child = self.0.take().expect("child active");
        let _ = child.kill();
        child.wait_with_output().expect("wait with output")
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn allocate_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
    listener.local_addr().expect("local addr").port()
}

impl TestEnv {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let home = dir.path().join("home");
        let xdg_config = home.join(".config");
        let workspace = dir.path().join("workspace");
        fs::create_dir_all(&xdg_config).expect("create config dir");
        fs::create_dir_all(&workspace).expect("create workspace dir");
        fs::create_dir_all(dir.path().join("tmp")).expect("create tmp dir");

        let port = allocate_port();
        let config_path = dir.path().join("dam-hopper.toml");
        let toml_content = format!(
            r#"[workspace]
name = "test-workspace"
root = "{workspace}"
projects = []

[server]
host = "127.0.0.1"
port = {port}
jwt_secret = "test-jwt-secret-key-32-bytes-long!"

[features]
"#,
            workspace = workspace.display(),
            port = port
        );
        fs::write(&config_path, toml_content).expect("write config");

        Self {
            dir,
            config_path,
            port,
        }
    }

    fn home_dir(&self) -> PathBuf {
        self.dir.path().join("home")
    }

    fn default_sqlite_path(&self) -> PathBuf {
        self.home_dir()
            .join(".config")
            .join("dam-hopper")
            .join("auth.db")
    }

    fn base_command(&self) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_dam-hopper-server"));
        cmd.arg("--config")
            .arg(&self.config_path)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(self.port.to_string())
            .current_dir(self.dir.path());

        // Strip ambient backend/auth environment variables
        cmd.env_remove("DAM_HOPPER_LITE_MODE")
            .env_remove("DAM_HOPPER_AUTH_SQLITE_PATH")
            .env_remove("MONGODB_URI")
            .env_remove("MONGODB_DATABASE")
            .env_remove("RUST_ENV")
            .env_remove("ENVIRONMENT")
            .env_remove("DAM_HOPPER_MFA_KEY_FILE")
            .env_remove("DAM_HOPPER_NO_AUTH")
            .env_remove("DAM_HOPPER_CONFIG")
            .env_remove("DAM_HOPPER_PORT");

        // Isolate filesystem environment
        let home = self.home_dir();
        cmd.env("HOME", &home)
            .env("XDG_CONFIG_HOME", home.join(".config"))
            .env("XDG_DATA_HOME", home.join(".local/share"))
            .env("XDG_STATE_HOME", home.join(".local/state"))
            .env("TMPDIR", self.dir.path().join("tmp"));

        if let Ok(path) = std::env::var("PATH") {
            cmd.env("PATH", path);
        }

        cmd
    }

    async fn wait_for_ready(&self, child: &mut Child, timeout: Duration) -> bool {
        let start = Instant::now();
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(300))
            .build()
            .unwrap();
        let health_url = format!("http://127.0.0.1:{}/api/health", self.port);

        while start.elapsed() < timeout {
            // Check if process died early
            if let Ok(Some(_)) = child.try_wait() {
                return false;
            }
            if let Ok(resp) = client.get(&health_url).send().await {
                if resp.status().is_success() {
                    return true;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        false
    }
}

#[tokio::test]
async fn unconfigured_startup_defaults_to_sqlite() {
    let env = TestEnv::new();
    let mut cmd = env.base_command();
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut guard = ChildGuard::new(cmd.spawn().expect("spawn server"));
    let ready = env
        .wait_for_ready(guard.child_mut(), Duration::from_secs(5))
        .await;
    if !ready {
        let out = guard.finish_output();
        panic!(
            "Server failed to reach ready state.\nSTDOUT:\n{}\nSTDERR:\n{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
    }

    // Default SQLite database file must have been created
    let default_db = env.default_sqlite_path();
    assert!(
        default_db.exists(),
        "Default auth.db was not created at {}",
        default_db.display()
    );

    // Verify protected route rejects unauthenticated request
    let client = reqwest::Client::new();
    let auth_status = client
        .get(format!("http://127.0.0.1:{}/api/auth/status", env.port))
        .send()
        .await
        .expect("send auth status request");
    let text = auth_status.text().await.expect("read body");
    let body: serde_json::Value = serde_json::from_str(&text).expect("parse json");
    assert_ne!(body["dev_mode"], true, "Should not be in dev_mode");

    // Clean shutdown and verify log line
    let output = guard.finish_output();
    let logs = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        logs.contains("Authentication backend: SQLite (default — MONGODB_URI not set)"),
        "Logs missing expected default SQLite message. Got:\n{logs}"
    );
}

#[tokio::test]
async fn explicit_true_selects_sqlite_ignoring_bad_mongo() {
    let env = TestEnv::new();
    let mut cmd = env.base_command();
    cmd.env("DAM_HOPPER_LITE_MODE", "true")
        .env("MONGODB_URI", "invalid://mongo.uri")
        .env("MONGODB_DATABASE", "invalid_db")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut guard = ChildGuard::new(cmd.spawn().expect("spawn server"));
    let ready = env
        .wait_for_ready(guard.child_mut(), Duration::from_secs(5))
        .await;
    assert!(ready, "Server failed to start in explicit true mode");

    let output = guard.finish_output();
    let logs = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        logs.contains("Authentication backend: SQLite (explicit)"),
        "Logs missing expected explicit SQLite message. Got:\n{logs}"
    );
}

#[tokio::test]
async fn explicit_false_without_mongo_vars_fails_fast() {
    let env = TestEnv::new();
    let mut cmd = env.base_command();
    cmd.env("DAM_HOPPER_LITE_MODE", "false")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd.output().expect("run server");
    assert!(
        !output.status.success(),
        "Expected server to exit nonzero with explicit false and missing Mongo"
    );

    let err_str = String::from_utf8_lossy(&output.stderr);
    assert!(
        err_str.contains("DAM_HOPPER_LITE_MODE was set to false/0 to enforce MongoDB"),
        "Missing expected error diagnostic. Got:\n{err_str}"
    );
    assert!(
        !env.default_sqlite_path().exists(),
        "auth.db must not be created on configuration failure"
    );
}

#[tokio::test]
async fn partial_mongo_configuration_fails_fast() {
    // 1. URI present, DATABASE missing
    {
        let env = TestEnv::new();
        let mut cmd = env.base_command();
        cmd.env("MONGODB_URI", "mongodb://localhost:27017")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let output = cmd.output().expect("run server");
        assert!(!output.status.success());
        let err_str = String::from_utf8_lossy(&output.stderr);
        assert!(
            err_str.contains("missing MONGODB_DATABASE"),
            "Got:\n{err_str}"
        );
        assert!(!env.default_sqlite_path().exists());
    }

    // 2. DATABASE present, URI missing
    {
        let env = TestEnv::new();
        let mut cmd = env.base_command();
        cmd.env("MONGODB_DATABASE", "damHopper")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let output = cmd.output().expect("run server");
        assert!(!output.status.success());
        let err_str = String::from_utf8_lossy(&output.stderr);
        assert!(err_str.contains("missing MONGODB_URI"), "Got:\n{err_str}");
        assert!(!env.default_sqlite_path().exists());
    }
}

#[tokio::test]
async fn empty_or_whitespace_mongo_variables_fail_fast() {
    let env = TestEnv::new();
    let mut cmd = env.base_command();
    cmd.env("MONGODB_URI", "   ")
        .env("MONGODB_DATABASE", "damHopper")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd.output().expect("run server");
    assert!(!output.status.success());
    let err_str = String::from_utf8_lossy(&output.stderr);
    assert!(
        err_str.contains("MONGODB_URI is set but empty or whitespace-only"),
        "Got:\n{err_str}"
    );
    assert!(!env.default_sqlite_path().exists());
}

#[tokio::test]
async fn unreachable_mongo_fails_at_startup_without_sqlite_fallback() {
    let env = TestEnv::new();
    let mut cmd = env.base_command();
    // Port 1 on loopback is typically closed and rejects connections immediately
    cmd.env(
        "MONGODB_URI",
        "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500&connectTimeoutMS=500",
    )
    .env("MONGODB_DATABASE", "testdb")
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    let output = cmd.output().expect("run server");
    assert!(
        !output.status.success(),
        "Expected server to exit nonzero on unreachable MongoDB"
    );

    let err_str = String::from_utf8_lossy(&output.stderr);
    assert!(
        err_str.contains("cannot connect to MongoDB database 'testdb'")
            || err_str.contains("timed out after 10s connecting to MongoDB database 'testdb'"),
        "Missing expected MongoDB connection error. Got:\n{err_str}"
    );
    assert!(
        !env.default_sqlite_path().exists(),
        "FATAL: server must never fall back to SQLite when MongoDB is unreachable!"
    );
}

#[tokio::test]
async fn malformed_mongo_uri_does_not_leak_credentials_in_stderr() {
    let env = TestEnv::new();
    let mut cmd = env.base_command();
    cmd.env(
        "MONGODB_URI",
        "mongodb://supersecretuser:supersecretpass@invalid-host-chars!@#$",
    )
    .env("MONGODB_DATABASE", "testdb")
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    let output = cmd.output().expect("run server");
    assert!(!output.status.success());

    let err_str = String::from_utf8_lossy(&output.stderr);
    assert!(
        !err_str.contains("supersecretpass"),
        "Credential leaked in stderr: {err_str}"
    );
    assert!(
        !err_str.contains("supersecretuser"),
        "Username leaked in stderr: {err_str}"
    );
    assert!(err_str.contains("failed to parse MongoDB URI"));
}

#[tokio::test]
async fn production_sqlite_without_mfa_key_fails_closed() {
    let env = TestEnv::new();
    let mut cmd = env.base_command();
    cmd.env("RUST_ENV", "production")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd.output().expect("run server");
    assert!(!output.status.success());

    let err_str = String::from_utf8_lossy(&output.stderr);
    assert!(
        err_str.contains("DAM_HOPPER_MFA_KEY_FILE is required in production authenticated mode"),
        "Got:\n{err_str}"
    );
    assert!(!env.default_sqlite_path().exists());
}

#[tokio::test]
async fn production_sqlite_with_valid_mfa_key_succeeds() {
    let env = TestEnv::new();
    let key_path = env.dir.path().join("mfa.key");
    // Write 32-byte key
    fs::write(&key_path, [0x42u8; 32]).expect("write mfa key");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600)).unwrap();
    }

    let mut cmd = env.base_command();
    cmd.env("RUST_ENV", "production")
        .env("DAM_HOPPER_MFA_KEY_FILE", &key_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut guard = ChildGuard::new(cmd.spawn().expect("spawn server"));
    let ready = env
        .wait_for_ready(guard.child_mut(), Duration::from_secs(5))
        .await;
    assert!(
        ready,
        "Server failed to start in production with valid MFA key"
    );

    assert!(
        env.default_sqlite_path().exists(),
        "Default auth.db created in production"
    );
}

#[tokio::test]
async fn no_auth_bypasses_all_auth_storage() {
    let env = TestEnv::new();
    let mut cmd = env.base_command();
    cmd.arg("--no-auth")
        .env("MONGODB_URI", "") // even with malformed Mongo env
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut guard = ChildGuard::new(cmd.spawn().expect("spawn server"));
    let ready = env
        .wait_for_ready(guard.child_mut(), Duration::from_secs(5))
        .await;
    assert!(ready, "Server failed to start with --no-auth");

    let client = reqwest::Client::new();
    let auth_status = client
        .get(format!("http://127.0.0.1:{}/api/auth/status", env.port))
        .send()
        .await
        .expect("send auth status request");
    let text = auth_status.text().await.expect("read body");
    let body: serde_json::Value = serde_json::from_str(&text).expect("parse json");
    assert_eq!(body["authenticated"], true);
    assert_eq!(body["dev_mode"], true);

    drop(guard);
    assert!(
        !env.default_sqlite_path().exists(),
        "auth.db must not be created when running with --no-auth"
    );
}

#[tokio::test]
async fn clean_install_provisioning_and_login_flow() {
    let env = TestEnv::new();

    // 1. Generate MFA key file in config directory with 0600 permissions
    let key_path = env.home_dir().join(".config/dam-hopper/mfa-encryption.key");
    fs::create_dir_all(key_path.parent().unwrap()).unwrap();
    fs::write(
        &key_path,
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600)).unwrap();
    }

    // 2. Run offline provisioning script targeting default auth.db via HOME/XDG environment
    let script_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("scripts/create-admin.mjs");

    let script_output = Command::new("node")
        .arg(&script_path)
        .arg("clean_admin")
        .arg("CleanPassword123!")
        .env("HOME", env.home_dir())
        .env("XDG_CONFIG_HOME", env.home_dir().join(".config"))
        .env_remove("DAM_HOPPER_AUTH_SQLITE_PATH")
        .env_remove("DAM_HOPPER_LITE_MODE")
        .env_remove("MONGODB_URI")
        .env_remove("MONGODB_DATABASE")
        .env_remove("DAM_HOPPER_MFA_KEY_FILE")
        .output()
        .expect("run create-admin script");

    assert!(
        script_output.status.success(),
        "create-admin script failed: stdout: {}, stderr: {}",
        String::from_utf8_lossy(&script_output.stdout),
        String::from_utf8_lossy(&script_output.stderr)
    );

    let default_db = env.default_sqlite_path();
    assert!(default_db.exists(), "auth.db must exist after create-admin");

    // 3. Start server with DAM_HOPPER_MFA_KEY_FILE configured
    let mut cmd = env.base_command();
    cmd.env("DAM_HOPPER_MFA_KEY_FILE", &key_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut guard = ChildGuard::new(cmd.spawn().expect("spawn server"));
    let ready = env
        .wait_for_ready(guard.child_mut(), Duration::from_secs(5))
        .await;
    assert!(ready, "Server failed to start after provisioning");

    let client = reqwest::Client::new();

    // 4. Submit credentials to POST /api/auth/login
    let login_payload = serde_json::to_string(&serde_json::json!({
        "username": "clean_admin",
        "password": "CleanPassword123!"
    }))
    .unwrap();
    let login_resp = client
        .post(format!("http://127.0.0.1:{}/api/auth/login", env.port))
        .header("content-type", "application/json")
        .body(login_payload)
        .send()
        .await
        .expect("send login request");

    assert_eq!(login_resp.status(), reqwest::StatusCode::OK);
    let login_text = login_resp.text().await.expect("read login text");
    let login_body: serde_json::Value =
        serde_json::from_str(&login_text).expect("parse login json");
    assert_eq!(login_body["state"], "enrollmentRequired");
    let challenge_token = login_body["challengeToken"]
        .as_str()
        .expect("challengeToken must be present")
        .to_string();

    // 5. Fetch MFA setup info using challenge token
    let setup_payload = serde_json::to_string(&serde_json::json!({
        "challengeToken": &challenge_token
    }))
    .unwrap();
    let setup_resp = client
        .post(format!("http://127.0.0.1:{}/api/auth/mfa/setup", env.port))
        .header("content-type", "application/json")
        .body(setup_payload)
        .send()
        .await
        .expect("send mfa setup request");

    assert_eq!(setup_resp.status(), reqwest::StatusCode::OK);
    let setup_text = setup_resp.text().await.expect("read setup text");
    let setup_body: serde_json::Value =
        serde_json::from_str(&setup_text).expect("parse setup json");
    let secret_base32 = setup_body["secret"]
        .as_str()
        .expect("secret base32 present");

    // 6. Generate TOTP code from setup secret and confirm enrollment
    let raw_secret = dam_hopper_server::auth::totp::TotpEngine::base32_to_secret(secret_base32)
        .expect("decode base32 secret");
    let totp = dam_hopper_server::auth::totp::TotpEngine::build_totp(
        &raw_secret,
        "clean_admin",
        "DamHopper",
    )
    .expect("build totp generator");
    let totp_code = totp.generate_current().to_string();

    let confirm_payload = serde_json::to_string(&serde_json::json!({
        "challengeToken": &challenge_token,
        "code": totp_code
    }))
    .unwrap();
    let confirm_resp = client
        .post(format!(
            "http://127.0.0.1:{}/api/auth/mfa/confirm",
            env.port
        ))
        .header("content-type", "application/json")
        .body(confirm_payload)
        .send()
        .await
        .expect("send confirm request");

    assert_eq!(confirm_resp.status(), reqwest::StatusCode::OK);
    let confirm_text = confirm_resp.text().await.expect("read confirm text");
    let confirm_body: serde_json::Value =
        serde_json::from_str(&confirm_text).expect("parse confirm json");
    assert_eq!(confirm_body["state"], "authenticated");
    let session_token = confirm_body["token"]
        .as_str()
        .expect("session token present");

    // 7. Verify session token against /api/auth/status
    let status_resp = client
        .get(format!("http://127.0.0.1:{}/api/auth/status", env.port))
        .header("Authorization", format!("Bearer {session_token}"))
        .send()
        .await
        .expect("send status request");

    assert_eq!(status_resp.status(), reqwest::StatusCode::OK);
    let status_text = status_resp.text().await.expect("read status text");
    let status_body: serde_json::Value =
        serde_json::from_str(&status_text).expect("parse status json");
    assert_eq!(status_body["authenticated"], true);
    assert_eq!(status_body["user"], "clean_admin");
    assert_eq!(status_body["role"], "admin");
}
