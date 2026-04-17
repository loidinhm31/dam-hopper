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

    use crate::config::schema::{RestartPolicy, DEFAULT_RESTART_MAX_RETRIES};
    use crate::pty::{
        event_sink::{EventSink, NoopEventSink},
        manager::{PtyCreateOpts, PtySessionManager},
    };

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
        PtySessionManager::new(Arc::new(NoopEventSink))
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
    }

    #[test]
    fn sink_receives_terminal_changed_on_create() {
        let sink = Arc::new(RecordingSink::default());
        let events = Arc::clone(&sink.events);
        let mgr = PtySessionManager::new(sink);
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
        let mgr = PtySessionManager::new(sink);
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

    #[test]
    fn restart_on_failure_policy_restarts_failed_command() {
        let mgr = make_manager();
        let mut opts = opts("restart:fail", "exit 1");
        opts.restart_policy = RestartPolicy::OnFailure;
        opts.restart_max_retries = 3;

        mgr.create(opts).unwrap();
        
        // Wait for process to exit (first run).
        let exited = wait_for(Duration::from_secs(2), || !mgr.is_alive("restart:fail"));
        assert!(exited, "Process should exit within 2s");

        // Wait for restart (backoff is 1s).
        let restarted = wait_for(Duration::from_secs(3), || mgr.is_alive("restart:fail"));
        assert!(restarted, "Process should restart after backoff");

        // Check restart_count incremented.
        let sessions = mgr.list();
        let meta = sessions.iter().find(|s| s.id == "restart:fail").unwrap();
        assert_eq!(meta.restart_count, 1, "restart_count should be 1 after first restart");

        mgr.remove("restart:fail").unwrap();
    }

    #[test]
    fn restart_on_failure_policy_stops_after_max_retries() {
        let mgr = make_manager();
        let mut opts = opts("restart:retries", "exit 1");
        opts.restart_policy = RestartPolicy::OnFailure;
        opts.restart_max_retries = 2;

        mgr.create(opts).unwrap();
        
        // Wait for initial exit + 2 restarts + final failure.
        // Total: initial run + 2 restarts = 3 runs, then stops.
        // Each run takes ~10ms, backoffs are 1s, 2s.
        // Total time: ~3s backoff + process overhead.
        std::thread::sleep(Duration::from_secs(6));

        // After max_retries exhausted, session should be dead.
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

    #[test]
    fn restart_always_policy_restarts_on_clean_exit() {
        let mgr = make_manager();
        let mut opts = opts("restart:always", "exit 0");
        opts.restart_policy = RestartPolicy::Always;
        opts.restart_max_retries = 3;

        mgr.create(opts).unwrap();
        
        // Wait for process to exit (first run).
        let exited = wait_for(Duration::from_secs(2), || !mgr.is_alive("restart:always"));
        assert!(exited, "Process should exit");

        // Wait for restart (backoff is 1s).
        let restarted = wait_for(Duration::from_secs(3), || mgr.is_alive("restart:always"));
        assert!(restarted, "Always policy should restart even on clean exit");

        let sessions = mgr.list();
        let meta = sessions.iter().find(|s| s.id == "restart:always").unwrap();
        assert_eq!(meta.restart_count, 1, "restart_count should be 1");

        mgr.remove("restart:always").unwrap();
    }

    // -----------------------------------------------------------------------
    // Phase 07: Tombstone idempotency test
    // -----------------------------------------------------------------------

    #[test]
    fn create_during_backoff_cancels_pending_restart() {
        let mgr = make_manager();
        let mut opts = opts("restart:race", "exit 1");
        opts.restart_policy = RestartPolicy::OnFailure;
        opts.restart_max_retries = 5;

        // First create — process will exit with code 1.
        mgr.create(opts.clone()).unwrap();
        
        // Wait for process to exit (becomes dead, supervisor queues restart).
        let exited = wait_for(Duration::from_secs(2), || !mgr.is_alive("restart:race"));
        assert!(exited, "Process should exit with code 1");

        // During backoff window (1s delay), call create again with same ID.
        // This should:
        // 1. Insert into killed set (canceling pending supervisor restart)
        // 2. Remove dead tombstone
        // 3. Spawn fresh session immediately
        // 4. Remove from killed set after spawn
        std::thread::sleep(Duration::from_millis(200)); // Small delay but within backoff
        
        // Verify still in backoff window (not already restarted).
        assert!(!mgr.is_alive("restart:race"), "Should still be dead before manual create");
        
        let meta = mgr.create(opts).unwrap();
        assert!(meta.alive, "New session should be alive immediately");
        assert_eq!(meta.restart_count, 0, "Fresh session should have restart_count=0");

        // Wait beyond original backoff window to ensure no double-spawn.
        std::thread::sleep(Duration::from_millis(1500));
        
        // Only one session should exist (the fresh one from second create).
        assert!(mgr.is_alive("restart:race"), "Session should still be alive");
        let sessions = mgr.list();
        let count = sessions.iter().filter(|s| s.id == "restart:race").count();
        assert_eq!(count, 1, "Should have exactly one session, no double-spawn");
        
        // Verify killed set was properly cleaned after successful create.
        // This ensures idempotency mechanism worked correctly.
        // Note: Can't directly access inner.killed in public API, but the test
        // passing proves supervisor didn't double-spawn (killed flag prevented it).

        mgr.remove("restart:race").unwrap();
    }
}
