use std::sync::Arc;

use uuid::Uuid;

use crate::pty::NoopEventSink;

use super::{
    driver::{BoxFuture, DriverHandle, TunnelDriver, TunnelDriverEvent},
    error::TunnelError,
    installer::TunnelInstaller,
    manager::TunnelSessionManager,
    session::{TunnelSession, TunnelStatus},
};

// ---------------------------------------------------------------------------
// TunnelStatus serialization
// ---------------------------------------------------------------------------

#[test]
fn tunnel_status_lowercase() {
    assert_eq!(
        serde_json::to_string(&TunnelStatus::Starting).unwrap(),
        r#""starting""#
    );
    assert_eq!(
        serde_json::to_string(&TunnelStatus::Ready).unwrap(),
        r#""ready""#
    );
    assert_eq!(
        serde_json::to_string(&TunnelStatus::Failed).unwrap(),
        r#""failed""#
    );
    assert_eq!(
        serde_json::to_string(&TunnelStatus::Stopped).unwrap(),
        r#""stopped""#
    );
}

// ---------------------------------------------------------------------------
// TunnelError display messages
// ---------------------------------------------------------------------------

#[test]
fn tunnel_error_display() {
    let e = TunnelError::BinaryMissing;
    assert_eq!(e.to_string(), "cloudflared binary not found");

    let e = TunnelError::DuplicatePort(3000);
    assert_eq!(e.to_string(), "tunnel already running on port 3000");

    let id = Uuid::nil();
    let e = TunnelError::NotFound(id);
    assert!(e.to_string().contains("tunnel not found"));

    let e = TunnelError::SpawnFailed("permission denied".into());
    assert!(e.to_string().contains("spawn failed"));

    let e = TunnelError::InstallFailed("network error".into());
    assert!(e.to_string().contains("install failed"));

    let e = TunnelError::BinaryMissingHint("brew install cloudflared".into());
    assert!(e.to_string().contains("brew install cloudflared"));
}

// ---------------------------------------------------------------------------
// TunnelSession serialization shape
// ---------------------------------------------------------------------------

#[test]
fn tunnel_session_camel_case() {
    let s = TunnelSession {
        id: Uuid::nil(),
        port: 3000,
        label: "test".into(),
        driver: "cloudflared".into(),
        status: TunnelStatus::Starting,
        url: None,
        error: None,
        started_at: 0,
        pid: None,
    };
    let v = serde_json::to_value(&s).unwrap();
    // camelCase field names
    assert!(v.get("startedAt").is_some());
    // optional fields absent when None
    assert!(v.get("url").is_none());
    assert!(v.get("pid").is_none());
}

// ---------------------------------------------------------------------------
// TunnelSessionManager::list() empty on fresh manager
// ---------------------------------------------------------------------------

struct NoopDriver;

impl TunnelDriver for NoopDriver {
    fn name(&self) -> &'static str {
        "noop"
    }

    fn start(
        &self,
        _port: u16,
        _label: &str,
        _event_tx: tokio::sync::mpsc::Sender<TunnelDriverEvent>,
    ) -> BoxFuture<'_, Result<DriverHandle, TunnelError>> {
        Box::pin(async { Err(TunnelError::SpawnFailed("noop".into())) })
    }
}

#[tokio::test]
async fn manager_list_empty_on_new() {
    let sink = Arc::new(NoopEventSink::default());
    let driver = Arc::new(NoopDriver);
    let manager = TunnelSessionManager::new(sink, driver);
    assert!(manager.list().await.is_empty());
}

// ---------------------------------------------------------------------------
// installer::resolve() returns BinaryMissing when binary absent from PATH
// ---------------------------------------------------------------------------

/// Tests resolve() with an isolated temp dir as PATH to avoid finding the real
/// cloudflared binary. Runs single-threaded to avoid concurrent env mutation.
#[tokio::test(flavor = "current_thread")]
async fn installer_resolve_binary_missing_isolated_path() {
    let tmp = tempfile::tempdir().unwrap();

    // Swap PATH to a dir that definitely has no cloudflared.
    // Single-threaded runtime keeps this env mutation safe within this test.
    let original = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", tmp.path());

    let result = TunnelInstaller::resolve().await;

    std::env::set_var("PATH", original);

    // Either BinaryMissing (expected) or Ok (user has ~/.dam-hopper/bin/cloudflared).
    match result {
        Err(TunnelError::BinaryMissing) => {}
        Ok(_) => {} // pre-installed binary present at local path
        Err(other) => panic!("unexpected error: {other}"),
    }
}
