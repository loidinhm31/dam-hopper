use std::{sync::Arc, time::Duration};

use tokio::sync::{oneshot, Notify};
use uuid::Uuid;

use crate::pty::NoopEventSink;

use super::{
    cloudflared::cloudflared_tunnel_args,
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
        session_id: None,
        incarnation: None,
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

#[tokio::test]
async fn manager_dispose_all_is_immediate_without_tunnels() {
    let sink = Arc::new(NoopEventSink::default());
    let driver = Arc::new(NoopDriver);
    let manager = TunnelSessionManager::new(sink, driver);

    tokio::time::timeout(Duration::from_millis(100), manager.dispose_all())
        .await
        .expect("an empty manager must not delay server shutdown");
}

struct BlockingDriver {
    started: Arc<Notify>,
    release: Arc<Notify>,
    stopped: Arc<Notify>,
}

impl TunnelDriver for BlockingDriver {
    fn name(&self) -> &'static str {
        "blocking-test"
    }

    fn start(
        &self,
        _port: u16,
        _label: &str,
        _event_tx: tokio::sync::mpsc::Sender<TunnelDriverEvent>,
    ) -> BoxFuture<'_, Result<DriverHandle, TunnelError>> {
        let started = Arc::clone(&self.started);
        let release = Arc::clone(&self.release);
        let stopped = Arc::clone(&self.stopped);
        Box::pin(async move {
            let (stop_tx, stop_rx) = oneshot::channel();
            tokio::spawn(async move {
                let _ = stop_rx.await;
                stopped.notify_one();
            });
            started.notify_one();
            release.notified().await;
            Ok(DriverHandle {
                pid: None,
                stop_tx: Some(stop_tx),
            })
        })
    }
}

#[tokio::test]
async fn stop_by_port_cancels_driver_startup_without_orphaning_session() {
    let driver = Arc::new(BlockingDriver {
        started: Arc::new(Notify::new()),
        release: Arc::new(Notify::new()),
        stopped: Arc::new(Notify::new()),
    });
    let manager = TunnelSessionManager::new(Arc::new(NoopEventSink), driver.clone());
    let creating = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.create(5173, "manual".to_string()).await })
    };

    driver.started.notified().await;
    let id = manager.list().await.first().expect("starting tunnel").id;
    let (first_stop, second_stop) = tokio::join!(manager.stop(id), manager.stop(id));
    assert!(first_stop.is_ok());
    assert!(second_stop.is_ok());
    driver.release.notify_one();

    assert!(matches!(
        creating.await.unwrap(),
        Err(TunnelError::CreationCancelled)
    ));
    assert!(manager.list().await.is_empty());
    tokio::time::timeout(Duration::from_secs(1), driver.stopped.notified())
        .await
        .expect("cleanup must stop the driver returned after cancellation");
}

#[tokio::test]
async fn dispose_all_cancels_and_awaits_driver_startup() {
    let driver = Arc::new(BlockingDriver {
        started: Arc::new(Notify::new()),
        release: Arc::new(Notify::new()),
        stopped: Arc::new(Notify::new()),
    });
    let manager = TunnelSessionManager::new(Arc::new(NoopEventSink), driver.clone());
    let creating = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.create(8080, "manual".to_string()).await })
    };

    driver.started.notified().await;
    let disposing = {
        let manager = manager.clone();
        tokio::spawn(async move { manager.dispose_all().await })
    };
    driver.release.notify_one();

    assert!(matches!(
        creating.await.unwrap(),
        Err(TunnelError::CreationCancelled)
    ));
    tokio::time::timeout(Duration::from_secs(5), disposing)
        .await
        .expect("shutdown should await in-flight startup")
        .unwrap();
    assert!(manager.list().await.is_empty());
    tokio::time::timeout(Duration::from_secs(1), driver.stopped.notified())
        .await
        .expect("shutdown must stop the driver returned after cancellation");
}

// ---------------------------------------------------------------------------
// installer PATH lookup returns none when binary absent from PATH
// ---------------------------------------------------------------------------

/// Tests resolve() with an isolated PATH without mutating process-global env.
#[test]
fn installer_path_lookup_missing_isolated_path() {
    let tmp = tempfile::tempdir().unwrap();

    let result = TunnelInstaller::resolve_path_binary(Some(tmp.path().as_os_str().to_os_string()));

    assert!(result.is_none());
}

// ---------------------------------------------------------------------------
// cloudflared_tunnel_args isolates subprocess from global configs and rewrites host
// ---------------------------------------------------------------------------

#[test]
fn cloudflared_tunnel_args_contains_isolation_and_host_header() {
    let args = cloudflared_tunnel_args(25001);
    assert_eq!(
        args,
        vec![
            "--no-autoupdate",
            "--config",
            "",
            "tunnel",
            "--http-host-header",
            "localhost",
            "--url",
            "http://127.0.0.1:25001"
        ]
    );
}

struct ChannelDropDriver {
    url_to_send: Option<String>,
}

impl TunnelDriver for ChannelDropDriver {
    fn name(&self) -> &'static str {
        "channel_drop"
    }

    fn start(
        &self,
        _port: u16,
        _label: &str,
        event_tx: tokio::sync::mpsc::Sender<TunnelDriverEvent>,
    ) -> BoxFuture<'_, Result<DriverHandle, TunnelError>> {
        let url = self.url_to_send.clone();
        Box::pin(async move {
            tokio::spawn(async move {
                if let Some(u) = url {
                    let _ = event_tx.send(TunnelDriverEvent::UrlReady(u)).await;
                }
                // Channel drops here without sending Exited or Failed!
            });

            Ok(DriverHandle {
                pid: Some(99999),
                stop_tx: None,
            })
        })
    }
}

struct CapturingEventSink {
    events: Arc<parking_lot::Mutex<Vec<(String, serde_json::Value)>>>,
}

impl CapturingEventSink {
    fn new() -> (Self, Arc<parking_lot::Mutex<Vec<(String, serde_json::Value)>>>) {
        let events = Arc::new(parking_lot::Mutex::new(Vec::new()));
        (
            Self {
                events: Arc::clone(&events),
            },
            events,
        )
    }
}

impl crate::pty::EventSink for CapturingEventSink {
    fn send_terminal_data(&self, _: &str, _: &str, _: u64, _: u64) {}
    fn send_terminal_exit(&self, _: &str, _: Option<i32>) {}
    fn send_terminal_changed(&self) {}
    fn send_terminal_exit_enhanced(
        &self,
        _: &str,
        _: Option<i32>,
        _: bool,
        _: Option<u64>,
        _: Option<u32>,
    ) {}
    fn send_process_restarted(&self, _: &str, _: u32, _: Option<i32>) {}
    fn broadcast(&self, event_type: &str, payload: serde_json::Value) {
        self.events
            .lock()
            .push((event_type.to_string(), payload));
    }
}

#[tokio::test]
async fn channel_drop_triggers_fallback_stopped_broadcast_and_cleanup() {
    let (sink, events) = CapturingEventSink::new();
    let driver = Arc::new(ChannelDropDriver {
        url_to_send: Some("https://test-drop.trycloudflare.com".to_string()),
    });
    let manager = TunnelSessionManager::new(Arc::new(sink), driver);

    let session = manager
        .create(3001, "test-drop".to_string())
        .await
        .unwrap();

    // Wait for the driver task to send UrlReady and drop the channel
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Verify that manager cleared the session on channel drop
    let active = manager.list().await;
    assert!(active.is_empty(), "session should be cleaned up after channel drop");

    // Verify events received: tunnel:created, tunnel:ready, and fallback tunnel:stopped
    let captured = events.lock().clone();
    let event_names: Vec<String> = captured.into_iter().map(|(e, _)| e).collect();
    assert!(
        event_names.contains(&"tunnel:created".to_string()),
        "missing tunnel:created"
    );
    assert!(
        event_names.contains(&"tunnel:ready".to_string()),
        "missing tunnel:ready"
    );
    assert!(
        event_names.contains(&"tunnel:stopped".to_string()),
        "missing fallback tunnel:stopped"
    );

    // Ensure stop on the cleaned-up session returns NotFound without panic
    let stop_result = manager.stop(session.id).await;
    assert!(stop_result.is_err());
}

#[tokio::test]
async fn driver_exited_event_triggers_stopped_broadcast_once() {
    let (sink, events) = CapturingEventSink::new();
    struct ExitedDriver;
    impl TunnelDriver for ExitedDriver {
        fn name(&self) -> &'static str {
            "exited_driver"
        }
        fn start(
            &self,
            _port: u16,
            _label: &str,
            event_tx: tokio::sync::mpsc::Sender<TunnelDriverEvent>,
        ) -> BoxFuture<'_, Result<DriverHandle, TunnelError>> {
            Box::pin(async move {
                tokio::spawn(async move {
                    let _ = event_tx
                        .send(TunnelDriverEvent::UrlReady(
                            "https://test-exited.trycloudflare.com".to_string(),
                        ))
                        .await;
                    tokio::time::sleep(Duration::from_millis(10)).await;
                    let _ = event_tx.send(TunnelDriverEvent::Exited).await;
                });
                Ok(DriverHandle {
                    pid: Some(88888),
                    stop_tx: None,
                })
            })
        }
    }

    let manager = TunnelSessionManager::new(Arc::new(sink), Arc::new(ExitedDriver));
    let session = manager.create(3002, "test-exited".to_string()).await.unwrap();

    tokio::time::sleep(Duration::from_millis(50)).await;

    let active = manager.list().await;
    assert!(active.is_empty(), "session should be cleaned up after exit");

    let captured = events.lock().clone();
    let stopped_count = captured
        .iter()
        .filter(|(e, _)| e == "tunnel:stopped")
        .count();
    assert_eq!(stopped_count, 1, "tunnel:stopped should be broadcast exactly once");

    let stop_result = manager.stop(session.id).await;
    assert!(stop_result.is_err());
}
