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
        reminder_due: false,
        pid: None,
    };
    let v = serde_json::to_value(&s).unwrap();
    // camelCase field names
    assert!(v.get("startedAt").is_some());
    assert_eq!(v["reminderDue"], false);
    assert!(v.get("sessionId").is_none());
    assert!(v.get("incarnation").is_none());
    // optional fields absent when None
    assert!(v.get("url").is_none());
    assert!(v.get("pid").is_none());
}

// ---------------------------------------------------------------------------
// TunnelSessionManager lifecycle
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
async fn stop_cancels_driver_startup_without_orphaning_session() {
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
    changed: Arc<Notify>,
}

impl CapturingEventSink {
    fn new() -> (
        Self,
        Arc<parking_lot::Mutex<Vec<(String, serde_json::Value)>>>,
    ) {
        let events = Arc::new(parking_lot::Mutex::new(Vec::new()));
        (
            Self {
                events: Arc::clone(&events),
                changed: Arc::new(Notify::new()),
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
    ) {
    }
    fn send_process_restarted(&self, _: &str, _: u32, _: Option<i32>) {}
    fn broadcast(&self, event_type: &str, payload: serde_json::Value) {
        self.events.lock().push((event_type.to_string(), payload));
        self.changed.notify_waiters();
    }
}

#[tokio::test]
async fn channel_drop_triggers_fallback_stopped_broadcast_and_cleanup() {
    let (sink, events) = CapturingEventSink::new();
    let driver = Arc::new(ChannelDropDriver {
        url_to_send: Some("https://test-drop.trycloudflare.com".to_string()),
    });
    let manager = TunnelSessionManager::new(Arc::new(sink), driver);

    let session = manager.create(3001, "test-drop".to_string()).await.unwrap();

    // Wait for the driver task to send UrlReady and drop the channel
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Verify that manager cleared the session on channel drop
    let active = manager.list().await;
    assert!(
        active.is_empty(),
        "session should be cleaned up after channel drop"
    );

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
    let session = manager
        .create(3002, "test-exited".to_string())
        .await
        .unwrap();

    tokio::time::sleep(Duration::from_millis(50)).await;

    let active = manager.list().await;
    assert!(active.is_empty(), "session should be cleaned up after exit");

    let captured = events.lock().clone();
    let stopped_count = captured
        .iter()
        .filter(|(e, _)| e == "tunnel:stopped")
        .count();
    assert_eq!(
        stopped_count, 1,
        "tunnel:stopped should be broadcast exactly once"
    );

    let stop_result = manager.stop(session.id).await;
    assert!(stop_result.is_err());
}

// These drivers exercise manager state and cancellation only. Real connector
// persistence requires a separate isolated Cloudflared smoke.
#[derive(Default)]
struct ControlledDriver {
    events: parking_lot::Mutex<Option<tokio::sync::mpsc::Sender<TunnelDriverEvent>>>,
    stop: parking_lot::Mutex<Option<oneshot::Receiver<()>>>,
    startup_delay: Duration,
}

impl TunnelDriver for ControlledDriver {
    fn name(&self) -> &'static str {
        "controlled-test"
    }

    fn start(
        &self,
        _port: u16,
        _label: &str,
        event_tx: tokio::sync::mpsc::Sender<TunnelDriverEvent>,
    ) -> BoxFuture<'_, Result<DriverHandle, TunnelError>> {
        *self.events.lock() = Some(event_tx);
        let (stop_tx, stop_rx) = oneshot::channel();
        *self.stop.lock() = Some(stop_rx);
        Box::pin(async move {
            if !self.startup_delay.is_zero() {
                tokio::time::sleep(self.startup_delay).await;
            }
            Ok(DriverHandle {
                pid: Some(4242),
                stop_tx: Some(stop_tx),
            })
        })
    }
}

struct TunnelFixture {
    manager: TunnelSessionManager,
    driver: Arc<ControlledDriver>,
    events: Arc<parking_lot::Mutex<Vec<(String, serde_json::Value)>>>,
    changed: Arc<Notify>,
}

impl TunnelFixture {
    fn new(startup_delay: Duration) -> Self {
        let (sink, events) = CapturingEventSink::new();
        let changed = Arc::clone(&sink.changed);
        let driver = Arc::new(ControlledDriver {
            startup_delay,
            ..Default::default()
        });
        Self {
            manager: TunnelSessionManager::new(Arc::new(sink), driver.clone()),
            driver,
            events,
            changed,
        }
    }

    fn event_count(&self, kind: &str) -> usize {
        self.events.lock().iter().filter(|(k, _)| k == kind).count()
    }

    async fn wait_for_event(&self, kind: &str) {
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                let changed = self.changed.notified();
                if self.event_count(kind) > 0 {
                    return;
                }
                changed.await;
            }
        })
        .await
        .expect("watcher must publish the expected event");
    }

    fn event_sender(&self) -> tokio::sync::mpsc::Sender<TunnelDriverEvent> {
        self.driver.events.lock().as_ref().unwrap().clone()
    }

    async fn ready(&self) -> TunnelSession {
        self.manager.create(5173, "web".into()).await.unwrap();
        self.event_sender()
            .send(TunnelDriverEvent::UrlReady(
                "https://controlled.trycloudflare.com".into(),
            ))
            .await
            .unwrap();
        self.wait_for_event("tunnel:ready").await;
        self.manager.list().await.remove(0)
    }

    async fn wait_for_watcher_exit(&self) {
        tokio::time::timeout(Duration::from_secs(1), self.event_sender().closed())
            .await
            .expect("terminal cleanup must close the watcher without waiting three hours");
    }
}

const THREE_HOURS: Duration = Duration::from_secs(3 * 60 * 60);

#[tokio::test(start_paused = true)]
async fn reminder_is_due_at_three_hours_once_and_retained_in_snapshot() {
    let fixture = TunnelFixture::new(Duration::ZERO);
    let created_at = tokio::time::Instant::now();
    let session = fixture.ready().await;
    assert!(!session.reminder_due);
    assert_eq!(fixture.events.lock()[0].1["reminderDue"], false);

    tokio::time::advance(THREE_HOURS - Duration::from_millis(1)).await;
    tokio::task::yield_now().await;
    assert_eq!(fixture.event_count("tunnel:reminder"), 0);
    assert!(!fixture.manager.list().await[0].reminder_due);

    tokio::time::advance(Duration::from_millis(1)).await;
    fixture.wait_for_event("tunnel:reminder").await;
    assert_eq!(tokio::time::Instant::now(), created_at + THREE_HOURS);
    let due = fixture.manager.list().await.remove(0);
    assert_eq!(due.id, session.id);
    assert_eq!(due.pid, session.pid);
    assert_eq!(due.url, session.url);
    assert_eq!(due.started_at, session.started_at);
    assert_eq!(serde_json::to_value(&due).unwrap()["reminderDue"], true);
    assert_eq!(due.status, TunnelStatus::Ready);
    assert_eq!(
        fixture
            .events
            .lock()
            .iter()
            .find(|(k, _)| k == "tunnel:reminder")
            .unwrap()
            .1,
        serde_json::json!({ "id": session.id })
    );

    tokio::time::advance(THREE_HOURS * 2).await;
    tokio::task::yield_now().await;
    assert_eq!(fixture.event_count("tunnel:reminder"), 1);
    assert!(fixture.manager.list().await[0].reminder_due);
    assert!(matches!(
        fixture.driver.stop.lock().as_mut().unwrap().try_recv(),
        Err(oneshot::error::TryRecvError::Empty)
    ));
    fixture.manager.stop(session.id).await.unwrap();
    fixture.wait_for_watcher_exit().await;
}

#[tokio::test(start_paused = true)]
async fn reminder_deadline_includes_driver_startup_time() {
    let startup_delay = Duration::from_secs(60);
    let fixture = TunnelFixture::new(startup_delay);
    let created_at = tokio::time::Instant::now();
    let session = fixture.ready().await;
    tokio::time::advance(THREE_HOURS - startup_delay).await;
    fixture.wait_for_event("tunnel:reminder").await;
    assert_eq!(tokio::time::Instant::now(), created_at + THREE_HOURS);
    assert!(fixture.manager.list().await[0].reminder_due);
    fixture.manager.stop(session.id).await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn stop_cancels_reminder_and_watcher_even_with_open_driver_channel() {
    let fixture = TunnelFixture::new(Duration::ZERO);
    let session = fixture.ready().await;
    tokio::time::advance(THREE_HOURS - Duration::from_millis(1)).await;
    fixture.manager.stop(session.id).await.unwrap();
    fixture.wait_for_watcher_exit().await;
    assert_eq!(
        fixture.driver.stop.lock().as_mut().unwrap().try_recv(),
        Ok(())
    );

    tokio::time::advance(THREE_HOURS).await;
    assert!(fixture.manager.list().await.is_empty());
    assert_eq!(fixture.event_count("tunnel:reminder"), 0);
    assert_eq!(fixture.event_count("tunnel:stopped"), 1);
}

#[tokio::test(start_paused = true)]
async fn queued_exit_wins_reminder_boundary_and_cancels_watcher() {
    let fixture = TunnelFixture::new(Duration::ZERO);
    fixture.ready().await;
    fixture
        .event_sender()
        .send(TunnelDriverEvent::Exited)
        .await
        .unwrap();
    tokio::time::advance(THREE_HOURS).await;
    fixture.wait_for_watcher_exit().await;
    assert!(fixture.manager.list().await.is_empty());
    assert_eq!(fixture.event_count("tunnel:reminder"), 0);
    assert_eq!(fixture.event_count("tunnel:stopped"), 1);
}

#[tokio::test(start_paused = true)]
async fn failed_connector_cancels_reminder_and_watcher() {
    let fixture = TunnelFixture::new(Duration::ZERO);
    fixture.manager.create(5173, "web".into()).await.unwrap();
    fixture
        .event_sender()
        .send(TunnelDriverEvent::Failed("URL timeout".into()))
        .await
        .unwrap();
    fixture.wait_for_watcher_exit().await;
    tokio::time::advance(THREE_HOURS).await;
    assert!(fixture.manager.list().await.is_empty());
    assert_eq!(fixture.event_count("tunnel:failed"), 1);
    assert_eq!(fixture.event_count("tunnel:reminder"), 0);
    assert_eq!(fixture.event_count("tunnel:stopped"), 0);
}

#[tokio::test(start_paused = true)]
async fn dispose_cancels_reminder_and_watcher() {
    let fixture = TunnelFixture::new(Duration::ZERO);
    fixture.ready().await;
    fixture.manager.dispose_all().await;
    fixture.wait_for_watcher_exit().await;
    tokio::time::advance(THREE_HOURS).await;
    assert!(fixture.manager.list().await.is_empty());
    assert_eq!(fixture.event_count("tunnel:reminder"), 0);
    assert_eq!(
        fixture.driver.stop.lock().as_mut().unwrap().try_recv(),
        Ok(())
    );
}

#[tokio::test(start_paused = true)]
async fn synchronous_start_failure_leaves_no_reminder_or_session() {
    let (sink, events) = CapturingEventSink::new();
    let manager = TunnelSessionManager::new(Arc::new(sink), Arc::new(NoopDriver));
    assert!(matches!(
        manager.create(5173, "web".into()).await,
        Err(TunnelError::SpawnFailed(_))
    ));
    tokio::time::advance(THREE_HOURS).await;
    assert!(manager.list().await.is_empty());
    assert!(events.lock().is_empty());
}

#[tokio::test(start_paused = true)]
async fn port_and_pty_lifecycle_preserve_tunnel_identity_and_reminder_clock() {
    use crate::{persistence::SessionStore, port_forward::PortForwardManager};

    for detected_before_creation in [false, true] {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let store = Arc::new(SessionStore::open(temp.path()).unwrap());
        let ports = PortForwardManager::new(Arc::new(NoopEventSink))
            .with_session_store(Some(store.clone()));
        ports.enable_session_validation();
        ports.register_session("terminal", 1);
        if detected_before_creation {
            ports
                .report_stdout_hit(5173, "terminal".into(), 1, None)
                .await;
            ports.confirm_listen(5173, 1).await;
        }
        let fixture = TunnelFixture::new(Duration::ZERO);
        let original = fixture.ready().await;
        let original_json = serde_json::to_value(&original).unwrap();

        tokio::time::advance(Duration::from_secs(3600)).await;
        ports.report_lost(5173, 1).await;
        assert!(ports.list().await.is_empty());
        assert!(store.load_detected_ports().unwrap().is_empty());
        assert_eq!(
            serde_json::to_value(&fixture.manager.list().await[0]).unwrap(),
            original_json
        );

        // Origin returns, another PTY takes over, then the old PTY exits.
        ports
            .report_stdout_hit(5173, "terminal".into(), 1, None)
            .await;
        ports.register_session("replacement", 2);
        ports
            .report_stdout_hit(5173, "replacement".into(), 2, None)
            .await;
        ports.unregister_session("terminal", 1);
        ports.report_lost(5173, 1).await;
        assert_eq!(ports.list().await[0].incarnation, 2);
        assert_eq!(store.load_detected_ports().unwrap()[0].incarnation, 2);
        assert_eq!(
            serde_json::to_value(&fixture.manager.list().await[0]).unwrap(),
            original_json
        );

        // PTY replacement uses the same public id with a new incarnation.
        ports.register_session("replacement", 3);
        ports
            .report_stdout_hit(5173, "replacement".into(), 3, None)
            .await;
        ports.unregister_session("replacement", 2);
        ports.remove_session_ports("replacement", 2);
        assert_eq!(ports.list().await[0].incarnation, 3);
        ports.unregister_session("replacement", 3);
        assert!(ports.list().await.is_empty());
        assert!(store.load_detected_ports().unwrap().is_empty());
        assert_eq!(
            serde_json::to_value(&fixture.manager.list().await[0]).unwrap(),
            original_json
        );
        assert!(matches!(
            fixture.manager.create(5173, "duplicate".into()).await,
            Err(TunnelError::DuplicatePort(5173))
        ));
        assert!(matches!(
            fixture.driver.stop.lock().as_mut().unwrap().try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ));

        tokio::time::advance(Duration::from_secs(7200)).await;
        fixture.wait_for_event("tunnel:reminder").await;
        assert!(fixture.manager.list().await[0].reminder_due);
        fixture.manager.stop(original.id).await.unwrap();
        fixture.wait_for_watcher_exit().await;
    }
}

#[tokio::test(start_paused = true)]
async fn reminder_waits_for_ready_and_does_not_repeat_on_ready_events() {
    let fixture = TunnelFixture::new(Duration::ZERO);
    let session = fixture.manager.create(5173, "web".into()).await.unwrap();
    tokio::time::advance(THREE_HOURS).await;
    tokio::task::yield_now().await;
    assert_eq!(fixture.event_count("tunnel:reminder"), 0);
    assert!(!fixture.manager.list().await[0].reminder_due);

    fixture
        .event_sender()
        .send(TunnelDriverEvent::UrlReady(
            "https://controlled.trycloudflare.com".into(),
        ))
        .await
        .unwrap();
    fixture.wait_for_event("tunnel:reminder").await;
    fixture
        .event_sender()
        .send(TunnelDriverEvent::UrlReady(
            "https://controlled.trycloudflare.com".into(),
        ))
        .await
        .unwrap();
    tokio::task::yield_now().await;
    assert_eq!(fixture.event_count("tunnel:reminder"), 1);
    assert!(fixture.manager.list().await[0].reminder_due);
    fixture.manager.stop(session.id).await.unwrap();
    fixture.wait_for_watcher_exit().await;
}

#[tokio::test(start_paused = true)]
async fn stop_and_queued_exit_publish_stopped_once_without_reminder() {
    let fixture = TunnelFixture::new(Duration::ZERO);
    let session = fixture.ready().await;
    let sender = fixture.event_sender();
    let (exited, stopped) = tokio::join!(
        sender.send(TunnelDriverEvent::Exited),
        fixture.manager.stop(session.id),
    );
    exited.unwrap();
    stopped.unwrap();
    fixture.wait_for_watcher_exit().await;
    tokio::time::advance(THREE_HOURS).await;
    assert!(fixture.manager.list().await.is_empty());
    assert_eq!(fixture.event_count("tunnel:stopped"), 1);
    assert_eq!(fixture.event_count("tunnel:reminder"), 0);
}

#[tokio::test(start_paused = true)]
async fn driver_channel_closure_cancels_reminder() {
    let fixture = TunnelFixture::new(Duration::ZERO);
    fixture.ready().await;
    fixture.driver.events.lock().take();
    fixture.wait_for_event("tunnel:stopped").await;
    tokio::time::advance(THREE_HOURS).await;
    assert!(fixture.manager.list().await.is_empty());
    assert_eq!(fixture.event_count("tunnel:stopped"), 1);
    assert_eq!(fixture.event_count("tunnel:reminder"), 0);
}
