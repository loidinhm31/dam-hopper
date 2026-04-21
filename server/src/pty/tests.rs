/// PTY integration tests — spawn real processes.
///
/// These tests require a working shell (`/bin/sh`) and are Linux-specific.
/// They are gated behind `#[cfg(unix)]` to avoid CI failures on Windows.
#[cfg(test)]
#[cfg(unix)]
mod pty_tests {
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };

    use std::sync::OnceLock;

    use crate::config::schema::{RestartPolicy, DEFAULT_RESTART_MAX_RETRIES};
    use crate::pty::{
        event_sink::{EventSink, NoopEventSink},
        manager::{PtyCreateOpts, PtySessionManager},
    };

    // Shared multi-thread Tokio runtime for tests. PtySessionManager::new
    // calls tokio::spawn (supervisor loop) which requires an active runtime.
    // The runtime lives for the process lifetime so spawned tasks keep running
    // across all tests.
    fn test_rt() -> &'static tokio::runtime::Runtime {
        static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
        RT.get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .expect("test Tokio runtime")
        })
    }

    /// Poll `predicate` up to `timeout` in 10ms increments.
    /// Avoids fixed sleeps that cause flakiness under load.
    fn wait_for(timeout: Duration, predicate: impl Fn() -> bool) -> bool {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if predicate() { return true; }
            std::thread::sleep(Duration::from_millis(10));
        }
        false
    }

    fn make_manager() -> PtySessionManager {
        test_rt().block_on(async {
            PtySessionManager::new(Arc::new(NoopEventSink))
        })
    }

    /// Async poll helper for use inside `#[tokio::test]` functions.
    async fn tokio_wait_for(timeout: Duration, predicate: impl Fn() -> bool) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        while tokio::time::Instant::now() < deadline {
            if predicate() { return true; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        false
    }

    fn opts(id: &str, command: &str) -> PtyCreateOpts {
        let mut env = HashMap::new();
        env.insert("TERM".into(), "xterm-256color".into());
        env.insert("HOME".into(), std::env::var("HOME").unwrap_or_default());
        PtyCreateOpts {
            id: id.to_string(),
            command: command.to_string(),
            cwd: "/tmp".to_string(),
            env,
            cols: 80,
            rows: 24,
            project: None,
            restart_policy: RestartPolicy::Never,
            restart_max_retries: DEFAULT_RESTART_MAX_RETRIES,
        }
    }

    // -----------------------------------------------------------------------
    // Session ID validation
    // -----------------------------------------------------------------------

    #[test]
    fn rejects_empty_session_id() {
        let mgr = make_manager();
        let result = mgr.create(opts("", "echo hi"));
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("Session ID"), "unexpected: {msg}");
    }

    #[test]
    fn rejects_session_id_with_spaces() {
        let mgr = make_manager();
        let result = mgr.create(opts("bad id here", "echo hi"));
        assert!(result.is_err());
    }

    #[test]
    fn rejects_session_id_too_long() {
        let mgr = make_manager();
        let long_id = "a".repeat(200);
        let result = mgr.create(opts(&long_id, "echo hi"));
        assert!(result.is_err());
    }

    #[test]
    fn accepts_valid_session_id_formats() {
        let mgr = make_manager();
        let valid_ids = ["build:proj1", "run:api-server", "terminal:001", "free:abc.xyz"];
        for id in &valid_ids {
            let meta = mgr.create(opts(id, "echo ok")).expect(id);
            assert_eq!(meta.id, *id);
            mgr.remove(id).unwrap();
        }
    }

    // -----------------------------------------------------------------------
    // Session lifecycle
    // -----------------------------------------------------------------------

    #[test]
    fn create_produces_correct_meta() {
        let mgr = make_manager();
        let meta = mgr.create(opts("build:test-meta", "echo hello")).unwrap();
        assert_eq!(meta.id, "build:test-meta");
        assert!(meta.alive);
        assert_eq!(meta.exit_code, None);
        assert_eq!(meta.restart_count, 0);
        assert_eq!(meta.last_exit_at, None);
        assert_eq!(meta.restart_policy, RestartPolicy::Never);
        mgr.remove("build:test-meta").unwrap();
    }

    #[test]
    fn session_appears_in_list() {
        let mgr = make_manager();
        mgr.create(opts("shell:list-test", "cat")).unwrap();
        let sessions = mgr.list();
        assert!(sessions.iter().any(|s| s.id == "shell:list-test"));
        mgr.remove("shell:list-test").unwrap();
    }

    #[test]
    fn is_alive_true_after_create() {
        let mgr = make_manager();
        mgr.create(opts("run:alive-check", "cat")).unwrap();
        assert!(mgr.is_alive("run:alive-check"));
        mgr.remove("run:alive-check").unwrap();
    }

    #[test]
    fn remove_clears_session_from_list() {
        let mgr = make_manager();
        mgr.create(opts("free:remove-test", "cat")).unwrap();
        mgr.remove("free:remove-test").unwrap();
        assert!(!mgr.is_alive("free:remove-test"));
        let sessions = mgr.list();
        assert!(!sessions.iter().any(|s| s.id == "free:remove-test"));
    }

    #[test]
    fn kill_marks_session_dead_but_retains_meta() {
        let mgr = make_manager();
        mgr.create(opts("build:kill-test", "cat")).unwrap();
        mgr.kill("build:kill-test").unwrap();
        assert!(!mgr.is_alive("build:kill-test"));
        // Dead meta still shows in list (60s TTL)
        let sessions = mgr.list();
        assert!(sessions.iter().any(|s| s.id == "build:kill-test" && !s.alive));
    }

    #[test]
    fn recreating_existing_id_kills_old_session() {
        let mgr = make_manager();
        mgr.create(opts("run:recreate", "cat")).unwrap();
        // Second create should not fail — old session gets killed first
        mgr.create(opts("run:recreate", "cat")).unwrap();
        mgr.remove("run:recreate").unwrap();
    }

    // -----------------------------------------------------------------------
    // Write + buffer
    // -----------------------------------------------------------------------

    #[test]
    fn write_and_buffer_receives_output() {
        let mgr = make_manager();
        mgr.create(opts("shell:write-test", "cat")).unwrap();
        mgr.write("shell:write-test", b"hello\n").unwrap();
        let ok = wait_for(Duration::from_secs(2), || {
            mgr.get_buffer("shell:write-test")
                .map(|b| b.contains("hello"))
                .unwrap_or(false)
        });
        assert!(ok, "buffer should contain echo within 2s");
        mgr.remove("shell:write-test").unwrap();
    }

    #[test]
    fn write_to_nonexistent_session_returns_error() {
        let mgr = make_manager();
        let result = mgr.write("nonexistent", b"data");
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // Resize
    // -----------------------------------------------------------------------

    #[test]
    fn resize_succeeds_on_live_session() {
        let mgr = make_manager();
        mgr.create(opts("terminal:resize-test", "cat")).unwrap();
        mgr.resize("terminal:resize-test", 120, 40).unwrap();
        mgr.remove("terminal:resize-test").unwrap();
    }

    #[test]
    fn resize_nonexistent_returns_error() {
        let mgr = make_manager();
        let result = mgr.resize("nonexistent", 80, 24);
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // Buffer eviction
    // -----------------------------------------------------------------------

    #[test]
    fn buffer_evicts_oldest_bytes_at_256kb() {
        use crate::pty::buffer::ScrollbackBuffer;
        let cap = 256 * 1024;
        let mut buf = ScrollbackBuffer::new(cap);
        let chunk = vec![b'A'; cap / 2];
        buf.push(&chunk);
        buf.push(&chunk);
        // A third push to force eviction
        buf.push(&chunk);
        assert!(buf.len() <= cap, "buffer exceeded capacity: {}", buf.len());
    }

    // -----------------------------------------------------------------------
    // Dispose
    // -----------------------------------------------------------------------

    #[test]
    fn dispose_clears_all_sessions() {
        let mgr = make_manager();
        mgr.create(opts("build:dispose1", "cat")).unwrap();
        mgr.create(opts("build:dispose2", "cat")).unwrap();
        mgr.dispose();
        assert!(!mgr.is_alive("build:dispose1"));
        assert!(!mgr.is_alive("build:dispose2"));
        let sessions = mgr.list();
        assert!(sessions.is_empty());
    }

    // -----------------------------------------------------------------------
    // EventSink recording — verify events are emitted
    // -----------------------------------------------------------------------

    #[derive(Default)]
    struct RecordingSink {
        events: Arc<Mutex<Vec<String>>>,
    }

    impl EventSink for RecordingSink {
        fn send_terminal_data(&self, id: &str, data: &str) {
            self.events.lock().unwrap().push(format!("data:{id}:{data}"));
        }
        fn send_terminal_exit(&self, id: &str, exit_code: Option<i32>) {
            self.events.lock().unwrap().push(format!("exit:{id}:{exit_code:?}"));
        }
        fn send_terminal_changed(&self) {
            self.events.lock().unwrap().push("changed".to_string());
        }
        fn broadcast(&self, event_type: &str, _payload: serde_json::Value) {
            self.events.lock().unwrap().push(format!("broadcast:{event_type}"));
        }
        fn send_terminal_exit_enhanced(
            &self,
            id: &str,
            exit_code: Option<i32>,
            _will_restart: bool,
            _restart_in_ms: Option<u64>,
            _restart_count: Option<u32>,
        ) {
            self.events.lock().unwrap().push(format!("exit_enhanced:{id}:{exit_code:?}"));
        }
        fn send_process_restarted(&self, id: &str, restart_count: u32, _prev: Option<i32>) {
            self.events.lock().unwrap().push(format!("restarted:{id}:{restart_count}"));
        }
    }

    #[test]
    fn sink_receives_terminal_changed_on_create() {
        let sink = Arc::new(RecordingSink::default());
        let events = Arc::clone(&sink.events);
        let mgr = test_rt().block_on(async { PtySessionManager::new(sink) });
        mgr.create(opts("build:sink-test", "cat")).unwrap();
        let ev = events.lock().unwrap();
        assert!(ev.contains(&"changed".to_string()), "events: {ev:?}");
        drop(ev);
        mgr.remove("build:sink-test").unwrap();
    }

    #[test]
    fn sink_receives_data_events_on_output() {
        let sink = Arc::new(RecordingSink::default());
        let events = Arc::clone(&sink.events);
        let mgr = test_rt().block_on(async { PtySessionManager::new(sink) });
        mgr.create(opts("shell:sink-data", "cat")).unwrap();
        mgr.write("shell:sink-data", b"ping\n").unwrap();
        let ok = wait_for(Duration::from_secs(2), || {
            events.lock().unwrap().iter().any(|e| e.starts_with("data:shell:sink-data:"))
        });
        assert!(ok, "expected data event within 2s, events: {:?}", events.lock().unwrap());
        mgr.remove("shell:sink-data").unwrap();
    }

    #[test]
    fn session_type_derived_from_id_prefix() {
        use crate::pty::session::SessionType;
        assert_eq!(SessionType::from_id("build:foo"), SessionType::Build);
        assert_eq!(SessionType::from_id("run:bar"), SessionType::Run);
        assert_eq!(SessionType::from_id("custom:baz"), SessionType::Custom);
        assert_eq!(SessionType::from_id("shell:x"), SessionType::Shell);
        assert_eq!(SessionType::from_id("terminal:y"), SessionType::Terminal);
        assert_eq!(SessionType::from_id("free:z"), SessionType::Free);
        assert_eq!(SessionType::from_id("anything"), SessionType::Unknown);
    }

    // -----------------------------------------------------------------------
    // Phase 04: Restart engine unit tests
    // -----------------------------------------------------------------------

    #[test]
    fn restart_delay_ms_exponential_backoff_with_cap() {
        use crate::pty::manager::restart_delay_ms;
        
        assert_eq!(restart_delay_ms(0), 1000);      // 1s
        assert_eq!(restart_delay_ms(1), 2000);      // 2s
        assert_eq!(restart_delay_ms(2), 4000);      // 4s
        assert_eq!(restart_delay_ms(3), 8000);      // 8s
        assert_eq!(restart_delay_ms(4), 16000);     // 16s
        assert_eq!(restart_delay_ms(5), 30000);     // 30s cap
        assert_eq!(restart_delay_ms(10), 30000);    // Cap persists
        assert_eq!(restart_delay_ms(100), 30000);   // Cap persists
    }

    #[test]
    fn decide_restart_never_policy() {
        use crate::pty::manager::decide_restart;

        // Never policy — no restarts regardless of exit code or killed status.
        assert_eq!(decide_restart(RestartPolicy::Never, 0, false, 0, 5), None);
        assert_eq!(decide_restart(RestartPolicy::Never, 1, false, 0, 5), None);
        assert_eq!(decide_restart(RestartPolicy::Never, 0, true, 0, 5), None);
        assert_eq!(decide_restart(RestartPolicy::Never, 1, true, 0, 5), None);
    }

    #[test]
    fn decide_restart_manual_kill_blocks_restart() {
        use crate::pty::manager::decide_restart;

        // Any policy — was_killed=true → no restart.
        assert_eq!(decide_restart(RestartPolicy::OnFailure, 1, true, 0, 5), None);
        assert_eq!(decide_restart(RestartPolicy::Always, 0, true, 0, 5), None);
        assert_eq!(decide_restart(RestartPolicy::Always, 1, true, 0, 5), None);
    }

    #[test]
    fn decide_restart_on_failure_policy_clean_exit() {
        use crate::pty::manager::decide_restart;

        // OnFailure + exit=0 → no restart (clean exit).
        assert_eq!(decide_restart(RestartPolicy::OnFailure, 0, false, 0, 5), None);
        assert_eq!(decide_restart(RestartPolicy::OnFailure, 0, false, 2, 5), None);
    }

    #[test]
    fn decide_restart_on_failure_policy_failure_exit() {
        use crate::pty::manager::decide_restart;

        // OnFailure + exit≠0 + retries left → restart with backoff.
        assert_eq!(decide_restart(RestartPolicy::OnFailure, 1, false, 0, 5), Some(1000));
        assert_eq!(decide_restart(RestartPolicy::OnFailure, 1, false, 1, 5), Some(2000));
        assert_eq!(decide_restart(RestartPolicy::OnFailure, 127, false, 2, 5), Some(4000));
    }

    #[test]
    fn decide_restart_on_failure_policy_retries_exhausted() {
        use crate::pty::manager::decide_restart;

        // OnFailure + exit≠0 but restart_count >= max_retries → no restart.
        assert_eq!(decide_restart(RestartPolicy::OnFailure, 1, false, 5, 5), None);
        assert_eq!(decide_restart(RestartPolicy::OnFailure, 1, false, 10, 5), None);
    }

    #[test]
    fn decide_restart_always_policy_restarts_on_clean_exit() {
        use crate::pty::manager::decide_restart;

        // Always + exit=0 + retries left → restart.
        assert_eq!(decide_restart(RestartPolicy::Always, 0, false, 0, 5), Some(1000));
        assert_eq!(decide_restart(RestartPolicy::Always, 0, false, 2, 5), Some(4000));
    }

    #[test]
    fn decide_restart_always_policy_restarts_on_failure() {
        use crate::pty::manager::decide_restart;

        // Always + exit≠0 + retries left → restart.
        assert_eq!(decide_restart(RestartPolicy::Always, 1, false, 0, 5), Some(1000));
        assert_eq!(decide_restart(RestartPolicy::Always, 127, false, 1, 5), Some(2000));
    }

    #[test]
    fn decide_restart_always_policy_retries_exhausted() {
        use crate::pty::manager::decide_restart;

        // Always but restart_count >= max_retries → no restart.
        assert_eq!(decide_restart(RestartPolicy::Always, 0, false, 5, 5), None);
        assert_eq!(decide_restart(RestartPolicy::Always, 1, false, 10, 5), None);
    }

    // -----------------------------------------------------------------------
    // Phase 04: Restart engine integration tests
    // -----------------------------------------------------------------------

    #[tokio::test(flavor = "multi_thread")]
    async fn restart_on_failure_policy_restarts_failed_command() {
        let mgr = PtySessionManager::new(Arc::new(NoopEventSink));
        let mut opts = opts("restart:fail", "exit 1");
        opts.restart_policy = RestartPolicy::OnFailure;
        opts.restart_max_retries = 3;

        mgr.create(opts).unwrap();

        let exited = tokio_wait_for(Duration::from_secs(2), || !mgr.is_alive("restart:fail")).await;
        assert!(exited, "Process should exit within 2s");

        // `exit 1` exits too fast to catch via is_alive; instead confirm that
        // restart_count incremented (restart happened even if it already died again).
        // Backoff is 1s, so allow up to 3s total.
        let restarted = tokio_wait_for(Duration::from_secs(3), || {
            mgr.list()
                .iter()
                .find(|s| s.id == "restart:fail")
                .map(|s| s.restart_count >= 1)
                .unwrap_or(false)
        }).await;
        assert!(restarted, "Process should restart after backoff (restart_count >= 1)");

        let sessions = mgr.list();
        let meta = sessions.iter().find(|s| s.id == "restart:fail").unwrap();
        assert!(meta.restart_count >= 1, "restart_count should be >= 1 after first restart");

        mgr.remove("restart:fail").unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn restart_on_failure_policy_stops_after_max_retries() {
        let mgr = PtySessionManager::new(Arc::new(NoopEventSink));
        let mut opts = opts("restart:retries", "exit 1");
        opts.restart_policy = RestartPolicy::OnFailure;
        opts.restart_max_retries = 2;

        mgr.create(opts).unwrap();

        // Initial run + 2 restarts, backoffs: 1s, 2s → ~4s total.
        tokio::time::sleep(Duration::from_secs(6)).await;

        assert!(!mgr.is_alive("restart:retries"), "Session should be dead after retries exhausted");

        let sessions = mgr.list();
        let meta = sessions.iter().find(|s| s.id == "restart:retries").unwrap();
        assert_eq!(meta.restart_count, 2, "restart_count should cap at max_retries");
        assert!(!meta.alive, "Session should be dead");

        mgr.remove("restart:retries").unwrap();
    }

    #[test]
    fn restart_never_policy_does_not_restart() {
        let mgr = make_manager();
        let mut opts = opts("restart:never", "exit 1");
        opts.restart_policy = RestartPolicy::Never;
        opts.restart_max_retries = 5;

        mgr.create(opts).unwrap();
        
        // Wait for process to exit.
        let exited = wait_for(Duration::from_secs(2), || !mgr.is_alive("restart:never"));
        assert!(exited, "Process should exit");

        // Wait additional time to ensure no restart happens.
        std::thread::sleep(Duration::from_millis(2000));
        assert!(!mgr.is_alive("restart:never"), "Never policy should not restart");

        let sessions = mgr.list();
        let meta = sessions.iter().find(|s| s.id == "restart:never").unwrap();
        assert_eq!(meta.restart_count, 0, "restart_count should be 0");

        mgr.remove("restart:never").unwrap();
    }

    #[test]
    fn restart_kill_via_api_prevents_restart() {
        let mgr = make_manager();
        let mut opts = opts("restart:kill", "sleep 10");
        opts.restart_policy = RestartPolicy::Always;
        opts.restart_max_retries = 5;

        mgr.create(opts).unwrap();
        assert!(mgr.is_alive("restart:kill"), "Session should be alive");

        // Kill via API.
        mgr.kill("restart:kill").unwrap();
        
        // Wait to ensure session dies.
        let killed = wait_for(Duration::from_secs(2), || !mgr.is_alive("restart:kill"));
        assert!(killed, "Session should be killed");

        // Wait additional time to ensure no restart happens.
        std::thread::sleep(Duration::from_millis(2000));
        assert!(!mgr.is_alive("restart:kill"), "Killed sessions should not restart");

        mgr.remove("restart:kill").unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn restart_always_policy_restarts_on_clean_exit() {
        let mgr = PtySessionManager::new(Arc::new(NoopEventSink));
        let mut opts = opts("restart:always", "exit 0");
        opts.restart_policy = RestartPolicy::Always;
        opts.restart_max_retries = 3;

        mgr.create(opts).unwrap();

        let exited = tokio_wait_for(Duration::from_secs(2), || !mgr.is_alive("restart:always")).await;
        assert!(exited, "Process should exit");

        // `exit 0` exits instantly after restart; poll restart_count instead of
        // is_alive to avoid the brief-alive race. Backoff is 1s.
        let restarted = tokio_wait_for(Duration::from_secs(3), || {
            mgr.list()
                .iter()
                .find(|s| s.id == "restart:always")
                .map(|s| s.restart_count >= 1)
                .unwrap_or(false)
        }).await;
        assert!(restarted, "Always policy should restart even on clean exit (restart_count >= 1)");

        let sessions = mgr.list();
        let meta = sessions.iter().find(|s| s.id == "restart:always").unwrap();
        assert!(meta.restart_count >= 1, "restart_count should be >= 1");

        mgr.remove("restart:always").unwrap();
    }

    // -----------------------------------------------------------------------
    // Phase 07: Tombstone idempotency test
    // -----------------------------------------------------------------------

    #[tokio::test(flavor = "multi_thread")]
    async fn create_during_backoff_cancels_pending_restart() {
        let mgr = PtySessionManager::new(Arc::new(NoopEventSink));
        let mut opts = opts("restart:race", "exit 1");
        opts.restart_policy = RestartPolicy::OnFailure;
        opts.restart_max_retries = 5;

        mgr.create(opts.clone()).unwrap();

        let exited = tokio_wait_for(Duration::from_secs(2), || !mgr.is_alive("restart:race")).await;
        assert!(exited, "Process should exit with code 1");

        // Still within the 1s backoff window — manually recreate with same ID.
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(!mgr.is_alive("restart:race"), "Should still be dead before manual create");

        let meta = mgr.create(opts).unwrap();
        assert!(meta.alive, "New session should be alive immediately");
        assert_eq!(meta.restart_count, 0, "Fresh session should have restart_count=0");

        // Wait beyond original backoff to confirm no double-spawn.
        // `exit 1` exits instantly so don't rely on is_alive; just confirm the
        // session exists exactly once (live or dead) with no phantom duplicate.
        tokio::time::sleep(Duration::from_millis(1500)).await;

        let sessions = mgr.list();
        let count = sessions.iter().filter(|s| s.id == "restart:race").count();
        assert_eq!(count, 1, "Should have exactly one session, no double-spawn from canceled backoff");

        mgr.remove("restart:race").unwrap();
    }

    // -----------------------------------------------------------------------
    // Phase 02: Buffer offset tracking & replay tests
    // -----------------------------------------------------------------------

    #[test]
    fn get_buffer_with_offset_returns_full_buffer_when_no_offset() {
        let mgr = make_manager();
        mgr.create(opts("shell:offset-test1", "cat")).unwrap();
        mgr.write("shell:offset-test1", b"hello\n").unwrap();
        
        // Wait for data to appear in buffer.
        let ok = wait_for(Duration::from_secs(2), || {
            mgr.get_buffer("shell:offset-test1")
                .map(|b| b.contains("hello"))
                .unwrap_or(false)
        });
        assert!(ok, "buffer should contain 'hello' within 2s");

        // Get full buffer (no offset).
        let (data, offset) = mgr.get_buffer_with_offset("shell:offset-test1", None).unwrap();
        assert!(data.contains("hello"), "data should contain 'hello'");
        assert!(offset > 0, "offset should be > 0 after writing data");

        mgr.remove("shell:offset-test1").unwrap();
    }

    #[test]
    fn get_buffer_with_offset_returns_delta_when_offset_provided() {
        let mgr = make_manager();
        mgr.create(opts("shell:offset-test2", "cat")).unwrap();
        
        // Write first chunk.
        mgr.write("shell:offset-test2", b"first\n").unwrap();
        let ok1 = wait_for(Duration::from_secs(2), || {
            mgr.get_buffer("shell:offset-test2")
                .map(|b| b.contains("first"))
                .unwrap_or(false)
        });
        assert!(ok1, "buffer should contain 'first'");

        // Get current offset.
        let (data1, offset1) = mgr.get_buffer_with_offset("shell:offset-test2", None).unwrap();
        assert!(data1.contains("first"), "first read should contain 'first'");

        // Write second chunk.
        mgr.write("shell:offset-test2", b"second\n").unwrap();
        let ok2 = wait_for(Duration::from_secs(2), || {
            mgr.get_buffer("shell:offset-test2")
                .map(|b| b.contains("second"))
                .unwrap_or(false)
        });
        assert!(ok2, "buffer should contain 'second'");

        // Get delta (from previous offset).
        let (data2, offset2) = mgr.get_buffer_with_offset("shell:offset-test2", Some(offset1)).unwrap();
        assert!(data2.contains("second"), "delta should contain 'second'");
        assert!(!data2.contains("first"), "delta should NOT contain 'first' (already seen)");
        assert!(offset2 > offset1, "offset should have advanced");

        mgr.remove("shell:offset-test2").unwrap();
    }

    #[test]
    fn get_buffer_with_offset_returns_full_buffer_when_offset_too_old() {
        use crate::pty::buffer::ScrollbackBuffer;
        
        // This test uses a small buffer capacity to force eviction.
        // However, we can't easily override the buffer capacity in a live session,
        // so we test the buffer directly here rather than via manager.
        
        let cap = 10;  // Small capacity for testing eviction.
        let mut buf = ScrollbackBuffer::new(cap);
        
        buf.push(b"1234567890");  // Fill buffer to capacity.
        let offset1 = buf.current_offset();  // offset = 10
        
        buf.push(b"ABCDEFGHIJ");  // This evicts old data.
        let offset2 = buf.current_offset();  // offset = 20
        
        // Request from offset1, which is now older than buffer start.
        let (data, offset) = buf.read_from(Some(offset1));
        assert_eq!(offset, offset2, "should return current offset");
        assert_eq!(data, b"ABCDEFGHIJ", "should return full buffer when offset too old");
        
        // Request from offset2 (current), should return empty.
        let (data2, offset3) = buf.read_from(Some(offset2));
        assert_eq!(offset3, offset2, "offset unchanged");
        assert_eq!(data2.len(), 0, "no new data since offset2");
    }

    #[test]
    fn get_buffer_with_offset_returns_error_for_nonexistent_session() {
        let mgr = make_manager();
        let result = mgr.get_buffer_with_offset("nonexistent", None);
        assert!(result.is_err(), "should return error for nonexistent session");
    }
}
