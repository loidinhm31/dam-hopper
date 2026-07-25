/// PTY integration tests — spawn real processes.
///
/// These tests require a working shell (`/bin/sh`) and are Linux-specific.
/// They are gated behind `#[cfg(unix)]` to avoid CI failures on Windows.
#[cfg(test)]
#[cfg(unix)]
mod pty_tests {
    use std::{
        collections::HashMap,
        ffi::OsString,
        fs,
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };

    use std::sync::OnceLock;

    use crate::config::schema::{RestartPolicy, DEFAULT_RESTART_MAX_RETRIES};
    use crate::diagnostics::DiagnosticStore;
    use crate::persistence::{PersistCmd, PersistWorker, SessionStore};
    use crate::pty::{
        event_sink::{EventSink, NoopEventSink},
        manager::{
            build_child_env_from_parent_snapshot, send_visible_output_then_lifecycle,
            PtyCreateOpts, PtySessionManager,
        },
        shell_lifecycle::{LifecycleEvent, LifecycleState},
    };
    use crate::telemetry::{
        load_or_create_hmac_key, ChannelTelemetrySink, CommandClassifier, CommandOutcome,
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
            if predicate() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        false
    }

    fn process_exists(pid: i32) -> bool {
        unsafe { nix::libc::kill(pid, 0) == 0 }
    }

    fn make_manager() -> PtySessionManager {
        test_rt().block_on(async { PtySessionManager::new(Arc::new(NoopEventSink)) })
    }

    /// Async poll helper for use inside `#[tokio::test]` functions.
    async fn tokio_wait_for(timeout: Duration, predicate: impl Fn() -> bool) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        while tokio::time::Instant::now() < deadline {
            if predicate() {
                return true;
            }
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
        let valid_ids = [
            "build:proj1",
            "run:api-server",
            "terminal:001",
            "free:abc.xyz",
        ];
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
        assert!(sessions
            .iter()
            .any(|s| s.id == "build:kill-test" && !s.alive));
    }

    #[test]
    fn kill_terminates_child_process_group() {
        let mgr = make_manager();
        let pid_file = tempfile::NamedTempFile::new().unwrap();
        let pid_path = pid_file.path().to_string_lossy().replace('\'', "'\\''");
        let command = format!("sleep 60 & echo $! > '{pid_path}'; wait");

        mgr.create(opts("build:kill-tree", &command)).unwrap();

        let pid_ready = wait_for(Duration::from_secs(2), || {
            fs::read_to_string(pid_file.path())
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false)
        });
        assert!(pid_ready, "background child pid should be written");

        let child_pid = fs::read_to_string(pid_file.path())
            .unwrap()
            .trim()
            .parse::<i32>()
            .unwrap();
        assert!(
            process_exists(child_pid),
            "background child should be alive"
        );

        mgr.kill("build:kill-tree").unwrap();

        let child_gone = wait_for(Duration::from_secs(2), || !process_exists(child_pid));
        assert!(
            child_gone,
            "kill should terminate the background child process, not just the PTY metadata"
        );
    }

    #[test]
    fn recreating_existing_id_kills_old_session() {
        let sink = Arc::new(RecordingSink::default());
        let events = Arc::clone(&sink.events);
        let mgr = test_rt().block_on(async { PtySessionManager::new(sink) });

        mgr.create(opts("run:recreate", "cat")).unwrap();
        // Second create should not fail — old session gets killed first
        mgr.create(opts("run:recreate", "cat")).unwrap();

        let replacement_alive = wait_for(Duration::from_secs(2), || mgr.is_alive("run:recreate"));
        assert!(
            replacement_alive,
            "replacement session should remain live after old reader exits"
        );

        mgr.write("run:recreate", b"replacement-alive\n").unwrap();
        let echoed = wait_for(Duration::from_secs(2), || {
            mgr.get_buffer("run:recreate")
                .map(|b| b.contains("replacement-alive"))
                .unwrap_or(false)
        });
        assert!(echoed, "replacement session should still accept input");

        let ev = events.lock().unwrap();
        assert!(
            !ev.iter()
                .any(|event| event.starts_with("exit:run:recreate:")
                    || event.starts_with("exit_enhanced:run:recreate:")),
            "old killed session exit should not be emitted for replacement id: {ev:?}"
        );
        drop(ev);

        mgr.remove("run:recreate").unwrap();
    }

    #[test]
    fn rapid_recreates_suppress_each_old_exit_event() {
        let sink = Arc::new(RecordingSink::default());
        let events = Arc::clone(&sink.events);
        let mgr = test_rt().block_on(async { PtySessionManager::new(sink) });

        mgr.create(opts("run:rapid-recreate", "cat")).unwrap();
        mgr.create(opts("run:rapid-recreate", "cat")).unwrap();
        mgr.create(opts("run:rapid-recreate", "cat")).unwrap();

        let replacement_alive = wait_for(Duration::from_secs(2), || {
            mgr.is_alive("run:rapid-recreate")
        });
        assert!(
            replacement_alive,
            "latest replacement session should remain live"
        );

        mgr.write("run:rapid-recreate", b"rapid-replacement-alive\n")
            .unwrap();
        let echoed = wait_for(Duration::from_secs(2), || {
            mgr.get_buffer("run:rapid-recreate")
                .map(|b| b.contains("rapid-replacement-alive"))
                .unwrap_or(false)
        });
        assert!(echoed, "latest replacement session should accept input");

        let ev = events.lock().unwrap();
        assert!(
            !ev.iter()
                .any(|event| event.starts_with("exit:run:rapid-recreate:")
                    || event.starts_with("exit_enhanced:run:rapid-recreate:")),
            "old killed session exits should not be emitted for replacement id: {ev:?}"
        );
        drop(ev);

        mgr.remove("run:rapid-recreate").unwrap();
    }

    // -----------------------------------------------------------------------
    // Write + buffer
    // -----------------------------------------------------------------------

    #[test]
    fn write_and_buffer_receives_output() {
        let mgr = make_manager();
        mgr.create(opts("shell:write-test", "cat")).unwrap();
        mgr.write("shell:write-test", b"hello\n").unwrap();
        let ok = wait_for(Duration::from_secs(5), || {
            mgr.get_buffer("shell:write-test")
                .map(|b| b.contains("hello"))
                .unwrap_or(false)
        });
        assert!(ok, "buffer should contain echo within 5s");
        mgr.remove("shell:write-test").unwrap();
    }

    #[test]
    fn write_to_nonexistent_session_returns_error() {
        let mgr = make_manager();
        let result = mgr.write("nonexistent", b"data");
        assert!(result.is_err());
    }

    #[test]
    fn child_env_builder_excludes_unallowlisted_parent_vars() {
        let parent_env = HashMap::from([
            ("PATH".to_string(), OsString::from("/usr/bin:/bin")),
            ("HOME".to_string(), OsString::from("/tmp/test-home")),
            (
                "DAM_HOPPER_SECRET_TEST".to_string(),
                OsString::from("server-only-secret"),
            ),
        ]);

        let child_env = build_child_env_from_parent_snapshot(&parent_env, &HashMap::new())
            .into_iter()
            .collect::<HashMap<_, _>>();

        assert_eq!(
            child_env.get("PATH"),
            Some(&OsString::from("/usr/bin:/bin"))
        );
        assert_eq!(
            child_env.get("HOME"),
            Some(&OsString::from("/tmp/test-home"))
        );
        assert!(
            !child_env.contains_key("DAM_HOPPER_SECRET_TEST"),
            "synthetic parent-only secret should not reach child env"
        );
    }

    #[test]
    fn create_does_not_inherit_unallowlisted_parent_env() {
        let inherited_key = ["CARGO_PKG_NAME", "CARGO_MANIFEST_DIR", "PWD"]
            .iter()
            .find(|key| std::env::var(key).is_ok())
            .expect("expected at least one inherited test env var");

        let mgr = make_manager();
        let mut create_opts = opts(
            "shell:no-inherit",
            &format!("printf '%s\n' \"${{{inherited_key}:-missing}}\"; cat"),
        );
        create_opts.env.remove(*inherited_key);

        mgr.create(create_opts).unwrap();
        let ok = wait_for(Duration::from_secs(2), || {
            mgr.get_buffer("shell:no-inherit")
                .map(|b| b.contains("missing"))
                .unwrap_or(false)
        });
        assert!(ok, "child should not inherit {inherited_key}");
        mgr.remove("shell:no-inherit").unwrap();
    }

    #[test]
    fn create_preserves_safe_baseline_env_for_shell_execution() {
        let mgr = make_manager();
        let create_opts = opts(
            "shell:safe-baseline",
            "printf '%s|%s\\n' \"${PATH:+path-set}\" \"${HOME:+home-set}\"; cat",
        );

        mgr.create(create_opts).unwrap();
        let ok = wait_for(Duration::from_secs(2), || {
            mgr.get_buffer("shell:safe-baseline")
                .map(|b| b.contains("path-set|home-set"))
                .unwrap_or(false)
        });
        assert!(ok, "safe baseline env should preserve PATH and HOME");
        mgr.remove("shell:safe-baseline").unwrap();
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
            self.events
                .lock()
                .unwrap()
                .push(format!("data:{id}:{data}"));
        }
        fn send_terminal_exit(&self, id: &str, exit_code: Option<i32>) {
            self.events
                .lock()
                .unwrap()
                .push(format!("exit:{id}:{exit_code:?}"));
        }
        fn send_terminal_changed(&self) {
            self.events.lock().unwrap().push("changed".to_string());
        }
        fn send_terminal_lifecycle(
            &self,
            id: &str,
            state: &str,
            generation: u64,
            command: Option<&str>,
        ) {
            let suffix = command
                .map(|command| format!(":{command}"))
                .unwrap_or_default();
            self.events
                .lock()
                .unwrap()
                .push(format!("lifecycle:{id}:{state}:{generation}{suffix}"));
        }
        fn broadcast(&self, event_type: &str, _payload: serde_json::Value) {
            self.events
                .lock()
                .unwrap()
                .push(format!("broadcast:{event_type}"));
        }
        fn send_terminal_exit_enhanced(
            &self,
            id: &str,
            exit_code: Option<i32>,
            _will_restart: bool,
            _restart_in_ms: Option<u64>,
            _restart_count: Option<u32>,
        ) {
            self.events
                .lock()
                .unwrap()
                .push(format!("exit_enhanced:{id}:{exit_code:?}"));
        }
        fn send_process_restarted(&self, id: &str, restart_count: u32, _prev: Option<i32>) {
            self.events
                .lock()
                .unwrap()
                .push(format!("restarted:{id}:{restart_count}"));
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
    fn prompt_output_precedes_pending_editing_lifecycle() {
        let sink = RecordingSink::default();
        let mut visible_output_since_boundary = false;
        let mut pending = vec![(
            7,
            LifecycleEvent {
                state: LifecycleState::Editing,
                command: None,
                exit_code: None,
            },
        )];

        send_visible_output_then_lifecycle(
            &sink,
            "shell:prompt",
            "prompt> ",
            &mut pending,
            &mut visible_output_since_boundary,
        );

        assert_eq!(
            *sink.events.lock().unwrap(),
            [
                "data:shell:prompt:prompt> ",
                "lifecycle:shell:prompt:editing:7"
            ]
        );
        assert!(pending.is_empty());
        assert!(visible_output_since_boundary);
    }

    #[test]
    fn marker_only_chunk_cannot_flush_editing_lifecycle() {
        let sink = RecordingSink::default();
        let mut visible_output_since_boundary = false;
        let mut pending = vec![(
            7,
            LifecycleEvent {
                state: LifecycleState::Editing,
                command: None,
                exit_code: None,
            },
        )];

        send_visible_output_then_lifecycle(
            &sink,
            "shell:prompt",
            "",
            &mut pending,
            &mut visible_output_since_boundary,
        );

        assert!(sink.events.lock().unwrap().is_empty());
        assert_eq!(pending.len(), 1);
    }

    #[test]
    fn marker_only_editing_after_prompt_output_flushes_safely() {
        let sink = RecordingSink::default();
        let mut visible_output_since_boundary = true;
        let mut pending = vec![(
            7,
            LifecycleEvent {
                state: LifecycleState::Editing,
                command: None,
                exit_code: None,
            },
        )];

        send_visible_output_then_lifecycle(
            &sink,
            "shell:prompt",
            "",
            &mut pending,
            &mut visible_output_since_boundary,
        );

        assert_eq!(
            *sink.events.lock().unwrap(),
            ["lifecycle:shell:prompt:editing:7"]
        );
        assert!(pending.is_empty());
    }

    #[test]
    fn prompt_chunk_with_reset_and_editing_finishes_in_editing_order() {
        let sink = RecordingSink::default();
        let mut visible_output_since_boundary = true;
        let mut pending = vec![
            (
                7,
                LifecycleEvent {
                    state: LifecycleState::Unverified,
                    command: None,
                    exit_code: None,
                },
            ),
            (
                7,
                LifecycleEvent {
                    state: LifecycleState::Editing,
                    command: None,
                    exit_code: None,
                },
            ),
        ];

        send_visible_output_then_lifecycle(
            &sink,
            "shell:prompt",
            "prompt> ",
            &mut pending,
            &mut visible_output_since_boundary,
        );

        assert_eq!(
            *sink.events.lock().unwrap(),
            [
                "data:shell:prompt:prompt> ",
                "lifecycle:shell:prompt:unverified:7",
                "lifecycle:shell:prompt:editing:7"
            ]
        );
        assert!(pending.is_empty());
    }

    #[test]
    fn sink_receives_data_events_on_output() {
        let sink = Arc::new(RecordingSink::default());
        let events = Arc::clone(&sink.events);
        let mgr = test_rt().block_on(async { PtySessionManager::new(sink) });
        mgr.create(opts("shell:sink-data", "cat")).unwrap();
        mgr.write("shell:sink-data", b"ping\n").unwrap();
        let ok = wait_for(Duration::from_secs(2), || {
            events
                .lock()
                .unwrap()
                .iter()
                .any(|e| e.starts_with("data:shell:sink-data:"))
        });
        assert!(
            ok,
            "expected data event within 2s, events: {:?}",
            events.lock().unwrap()
        );
        mgr.remove("shell:sink-data").unwrap();
    }

    #[test]
    fn explicit_bash_session_emits_validated_lifecycle() {
        let sink = Arc::new(RecordingSink::default());
        let events = Arc::clone(&sink.events);
        let mgr = test_rt().block_on(async { PtySessionManager::new(sink) });
        let home = tempfile::tempdir().unwrap();
        let options = PtyCreateOpts {
            env: HashMap::from([
                ("TERM".into(), "xterm-256color".into()),
                ("HOME".into(), home.path().to_string_lossy().into_owned()),
            ]),
            ..opts("terminal:explicit-bash", "bash")
        };

        mgr.create(options).unwrap();
        assert!(
            wait_for(Duration::from_secs(2), || events
                .lock()
                .unwrap()
                .iter()
                .any(
                    |event| event.starts_with("lifecycle:terminal:explicit-bash:editing:")
                )),
            "initial lifecycle events: {:?}",
            events.lock().unwrap()
        );
        let snapshot = mgr
            .get_attach_snapshot("terminal:explicit-bash", None)
            .unwrap();
        assert!(snapshot.editing_generation.is_some());
        assert!(snapshot.replay.offset > 0);

        mgr.write("terminal:explicit-bash", b"echo explicit-bash\n")
            .unwrap();
        assert!(
            wait_for(Duration::from_secs(2), || events
                .lock()
                .unwrap()
                .iter()
                .any(|event| {
                    event.contains(":submitted:") && event.ends_with(":echo explicit-bash")
                })),
            "submitted lifecycle events: {:?}",
            events.lock().unwrap()
        );
        mgr.remove("terminal:explicit-bash").unwrap();
    }

    #[test]
    fn real_pty_emits_normalized_command_to_bounded_telemetry_sink() {
        let directory = tempfile::tempdir().unwrap();
        let classifier = Arc::new(CommandClassifier::new(Arc::new(
            load_or_create_hmac_key(&directory.path().join("telemetry-key")).unwrap(),
        )));
        let (telemetry_sink, receiver) = ChannelTelemetrySink::channel(8);
        let mgr = test_rt().block_on(async {
            PtySessionManager::with_persist_and_telemetry(
                Arc::new(NoopEventSink),
                None,
                None,
                Arc::new(telemetry_sink),
                Some(classifier),
            )
        });
        let home = tempfile::tempdir().unwrap();
        let options = PtyCreateOpts {
            env: HashMap::from([
                ("TERM".into(), "xterm-256color".into()),
                ("HOME".into(), home.path().to_string_lossy().into_owned()),
            ]),
            ..opts("terminal:telemetry-e2e", "bash")
        };
        mgr.create(options).unwrap();
        mgr.write("terminal:telemetry-e2e", b"false\n").unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let event = loop {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            let event = receiver
                .recv_timeout(remaining)
                .expect("validated command telemetry");
            if let crate::telemetry::TelemetryCmd::Command(event) = event {
                break event;
            }
        };
        assert_eq!(event.outcome, CommandOutcome::Failed);
        assert_eq!(event.exit_code, Some(1));
        assert!(event.duration_ms.is_some());
        mgr.remove("terminal:telemetry-e2e").unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn explicit_bash_respawn_emits_validated_lifecycle() {
        let sink = Arc::new(RecordingSink::default());
        let events = Arc::clone(&sink.events);
        let mgr = PtySessionManager::new(sink);
        let home = tempfile::tempdir().unwrap();
        let mut options = PtyCreateOpts {
            env: HashMap::from([
                ("TERM".into(), "xterm-256color".into()),
                ("HOME".into(), home.path().to_string_lossy().into_owned()),
            ]),
            ..opts("terminal:respawn-bash", "bash")
        };
        options.restart_policy = RestartPolicy::Always;
        options.restart_max_retries = 1;

        mgr.create(options).unwrap();
        assert!(
            tokio_wait_for(Duration::from_secs(2), || events
                .lock()
                .unwrap()
                .iter()
                .any(|event| {
                    event.starts_with("lifecycle:terminal:respawn-bash:editing:")
                }))
            .await,
            "initial lifecycle events: {:?}",
            events.lock().unwrap()
        );

        mgr.write("terminal:respawn-bash", b"exit\n").unwrap();
        assert!(
            tokio_wait_for(Duration::from_secs(3), || events
                .lock()
                .unwrap()
                .iter()
                .filter(|event| event.starts_with("lifecycle:terminal:respawn-bash:editing:"))
                .count()
                >= 2)
            .await,
            "respawn lifecycle events: {:?}",
            events.lock().unwrap()
        );

        mgr.write("terminal:respawn-bash", b"echo respawn-bash\n")
            .unwrap();
        assert!(
            tokio_wait_for(Duration::from_secs(2), || events
                .lock()
                .unwrap()
                .iter()
                .any(|event| {
                    event.contains(":submitted:") && event.ends_with(":echo respawn-bash")
                }))
            .await,
            "submitted lifecycle events: {:?}",
            events.lock().unwrap()
        );
        mgr.remove("terminal:respawn-bash").unwrap();
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

        assert_eq!(restart_delay_ms(0), 1000); // 1s
        assert_eq!(restart_delay_ms(1), 2000); // 2s
        assert_eq!(restart_delay_ms(2), 4000); // 4s
        assert_eq!(restart_delay_ms(3), 8000); // 8s
        assert_eq!(restart_delay_ms(4), 16000); // 16s
        assert_eq!(restart_delay_ms(5), 30000); // 30s cap
        assert_eq!(restart_delay_ms(10), 30000); // Cap persists
        assert_eq!(restart_delay_ms(100), 30000); // Cap persists
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
        assert_eq!(
            decide_restart(RestartPolicy::OnFailure, 1, true, 0, 5),
            None
        );
        assert_eq!(decide_restart(RestartPolicy::Always, 0, true, 0, 5), None);
        assert_eq!(decide_restart(RestartPolicy::Always, 1, true, 0, 5), None);
    }

    #[test]
    fn decide_restart_on_failure_policy_clean_exit() {
        use crate::pty::manager::decide_restart;

        // OnFailure + exit=0 → no restart (clean exit).
        assert_eq!(
            decide_restart(RestartPolicy::OnFailure, 0, false, 0, 5),
            None
        );
        assert_eq!(
            decide_restart(RestartPolicy::OnFailure, 0, false, 2, 5),
            None
        );
    }

    #[test]
    fn decide_restart_on_failure_policy_failure_exit() {
        use crate::pty::manager::decide_restart;

        // OnFailure + exit≠0 + retries left → restart with backoff.
        assert_eq!(
            decide_restart(RestartPolicy::OnFailure, 1, false, 0, 5),
            Some(1000)
        );
        assert_eq!(
            decide_restart(RestartPolicy::OnFailure, 1, false, 1, 5),
            Some(2000)
        );
        assert_eq!(
            decide_restart(RestartPolicy::OnFailure, 127, false, 2, 5),
            Some(4000)
        );
    }

    #[test]
    fn decide_restart_on_failure_policy_retries_exhausted() {
        use crate::pty::manager::decide_restart;

        // OnFailure + exit≠0 but restart_count >= max_retries → no restart.
        assert_eq!(
            decide_restart(RestartPolicy::OnFailure, 1, false, 5, 5),
            None
        );
        assert_eq!(
            decide_restart(RestartPolicy::OnFailure, 1, false, 10, 5),
            None
        );
    }

    #[test]
    fn decide_restart_always_policy_restarts_on_clean_exit() {
        use crate::pty::manager::decide_restart;

        // Always + exit=0 + retries left → restart.
        assert_eq!(
            decide_restart(RestartPolicy::Always, 0, false, 0, 5),
            Some(1000)
        );
        assert_eq!(
            decide_restart(RestartPolicy::Always, 0, false, 2, 5),
            Some(4000)
        );
    }

    #[test]
    fn decide_restart_always_policy_restarts_on_failure() {
        use crate::pty::manager::decide_restart;

        // Always + exit≠0 + retries left → restart.
        assert_eq!(
            decide_restart(RestartPolicy::Always, 1, false, 0, 5),
            Some(1000)
        );
        assert_eq!(
            decide_restart(RestartPolicy::Always, 127, false, 1, 5),
            Some(2000)
        );
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
        })
        .await;
        assert!(
            restarted,
            "Process should restart after backoff (restart_count >= 1)"
        );

        let sessions = mgr.list();
        let meta = sessions.iter().find(|s| s.id == "restart:fail").unwrap();
        assert!(
            meta.restart_count >= 1,
            "restart_count should be >= 1 after first restart"
        );

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

        assert!(
            !mgr.is_alive("restart:retries"),
            "Session should be dead after retries exhausted"
        );

        let sessions = mgr.list();
        let meta = sessions.iter().find(|s| s.id == "restart:retries").unwrap();
        assert_eq!(
            meta.restart_count, 2,
            "restart_count should cap at max_retries"
        );
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
        assert!(
            !mgr.is_alive("restart:never"),
            "Never policy should not restart"
        );

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
        assert!(
            !mgr.is_alive("restart:kill"),
            "Killed sessions should not restart"
        );

        mgr.remove("restart:kill").unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn restart_always_policy_restarts_on_clean_exit() {
        let mgr = PtySessionManager::new(Arc::new(NoopEventSink));
        let mut opts = opts("restart:always", "exit 0");
        opts.restart_policy = RestartPolicy::Always;
        opts.restart_max_retries = 3;

        mgr.create(opts).unwrap();

        let exited =
            tokio_wait_for(Duration::from_secs(2), || !mgr.is_alive("restart:always")).await;
        assert!(exited, "Process should exit");

        // `exit 0` exits instantly after restart; poll restart_count instead of
        // is_alive to avoid the brief-alive race. Backoff is 1s.
        let restarted = tokio_wait_for(Duration::from_secs(3), || {
            mgr.list()
                .iter()
                .find(|s| s.id == "restart:always")
                .map(|s| s.restart_count >= 1)
                .unwrap_or(false)
        })
        .await;
        assert!(
            restarted,
            "Always policy should restart even on clean exit (restart_count >= 1)"
        );

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
        assert!(
            !mgr.is_alive("restart:race"),
            "Should still be dead before manual create"
        );

        let meta = mgr.create(opts).unwrap();
        assert!(meta.alive, "New session should be alive immediately");
        assert_eq!(
            meta.restart_count, 0,
            "Fresh session should have restart_count=0"
        );

        // Wait beyond original backoff to confirm no double-spawn.
        // `exit 1` exits instantly so don't rely on is_alive; just confirm the
        // session exists exactly once (live or dead) with no phantom duplicate.
        tokio::time::sleep(Duration::from_millis(1500)).await;

        let sessions = mgr.list();
        let count = sessions.iter().filter(|s| s.id == "restart:race").count();
        assert_eq!(
            count, 1,
            "Should have exactly one session, no double-spawn from canceled backoff"
        );

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
        let replay = mgr
            .get_buffer_with_offset("shell:offset-test1", None)
            .unwrap();
        assert!(replay.data.contains("hello"), "data should contain 'hello'");
        assert!(replay.offset > 0, "offset should be > 0 after writing data");
        assert!(replay.reset);
        assert!(!replay.truncated);

        mgr.remove("shell:offset-test1").unwrap();
    }

    #[test]
    fn get_buffer_with_offset_returns_delta_when_offset_provided() {
        let mgr = make_manager();
        mgr.create(opts(
            "shell:offset-test2",
            "printf 'first\\n'; sleep 1; printf 'second\\n'; sleep 5",
        ))
        .unwrap();

        // Wait for the first process-generated chunk before sampling the offset.
        // Using `cat` here is flaky because the PTY line discipline can echo input
        // independently of the child process, so \"first\" may appear again after
        // we've already captured the previous offset.
        let ok1 = wait_for(Duration::from_secs(2), || {
            mgr.get_buffer("shell:offset-test2")
                .map(|b| b.contains("first"))
                .unwrap_or(false)
        });
        assert!(ok1, "buffer should contain 'first'");

        // Get current offset.
        let replay1 = mgr
            .get_buffer_with_offset("shell:offset-test2", None)
            .unwrap();
        assert!(
            replay1.data.contains("first"),
            "first read should contain 'first'"
        );
        assert!(replay1.reset);
        let offset1 = replay1.offset;

        // Wait for the second chunk to be emitted after the captured offset.
        let ok2 = wait_for(Duration::from_secs(2), || {
            mgr.get_buffer("shell:offset-test2")
                .map(|b| b.contains("second"))
                .unwrap_or(false)
        });
        assert!(ok2, "buffer should contain 'second'");

        // Get delta (from previous offset).
        let replay2 = mgr
            .get_buffer_with_offset("shell:offset-test2", Some(offset1))
            .unwrap();
        let data2 = replay2.data;
        assert!(data2.contains("second"), "delta should contain 'second'");
        assert!(
            !data2.contains("first"),
            "delta should NOT contain 'first' (already seen)"
        );
        assert!(replay2.offset > offset1, "offset should have advanced");
        assert!(!replay2.reset);
        assert!(!replay2.truncated);

        mgr.remove("shell:offset-test2").unwrap();
    }

    #[test]
    fn get_buffer_with_offset_returns_full_buffer_when_offset_too_old() {
        use crate::pty::buffer::ScrollbackBuffer;

        // This test uses a small buffer capacity to force eviction.
        // However, we can't easily override the buffer capacity in a live session,
        // so we test the buffer directly here rather than via manager.

        let cap = 10; // Small capacity for testing eviction.
        let mut buf = ScrollbackBuffer::new(cap);

        buf.push(b"1234567890"); // Fill buffer to capacity.
        let offset1 = buf.current_offset(); // offset = 10

        buf.push(b"ABCDEFGHIJ"); // This evicts old data.
        let offset2 = buf.current_offset(); // offset = 20

        // Request from offset1, which is now older than buffer start.
        let (data, offset) = buf.read_from(Some(offset1));
        assert_eq!(offset, offset2, "should return current offset");
        assert_eq!(
            data, b"ABCDEFGHIJ",
            "should return full buffer when offset too old"
        );

        // Request from offset2 (current), should return empty.
        let (data2, offset3) = buf.read_from(Some(offset2));
        assert_eq!(offset3, offset2, "offset unchanged");
        assert_eq!(data2.len(), 0, "no new data since offset2");
    }

    #[test]
    fn get_buffer_with_offset_returns_error_for_nonexistent_session() {
        let mgr = make_manager();
        let result = mgr.get_buffer_with_offset("nonexistent", None);
        assert!(
            result.is_err(),
            "should return error for nonexistent session"
        );
    }

    #[test]
    fn short_output_is_persisted_on_session_exit() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let store = Arc::new(SessionStore::open(temp.path()).unwrap());
        let (tx, rx) = std::sync::mpsc::sync_channel(256);
        let worker = PersistWorker::new(rx, store.clone());
        let handle = std::thread::spawn(move || worker.run());

        let mgr = test_rt().block_on(async {
            PtySessionManager::with_persist(
                Arc::new(NoopEventSink),
                Some(tx.clone()),
                Some(store.clone()),
            )
        });
        mgr.create(opts("shell:short-persist", "printf short-output"))
            .unwrap();

        let exited = wait_for(Duration::from_secs(3), || {
            mgr.list()
                .iter()
                .any(|session| session.id == "shell:short-persist" && !session.alive)
        });
        assert!(exited, "short-output session should exit");

        tx.send(PersistCmd::Shutdown).unwrap();
        handle.join().unwrap();

        let (data, total_written) = store
            .load_buffer("shell:short-persist")
            .unwrap()
            .expect("short-output buffer should be persisted");
        let text = String::from_utf8_lossy(&data);
        assert!(text.contains("short-output"), "persisted text: {text:?}");
        assert!(total_written >= "short-output".len() as u64);
    }

    #[test]
    fn live_buffers_are_snapshotted_before_shutdown() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let store = Arc::new(SessionStore::open(temp.path()).unwrap());
        let (tx, rx) = std::sync::mpsc::sync_channel(256);
        let worker = PersistWorker::new(rx, store.clone());
        let handle = std::thread::spawn(move || worker.run());

        let mgr = test_rt().block_on(async {
            PtySessionManager::with_persist(
                Arc::new(NoopEventSink),
                Some(tx.clone()),
                Some(store.clone()),
            )
        });
        mgr.create(opts("shell:shutdown-snapshot", "cat")).unwrap();
        mgr.write("shell:shutdown-snapshot", b"shutdown-output\n")
            .unwrap();

        let buffered = wait_for(Duration::from_secs(2), || {
            mgr.get_buffer("shell:shutdown-snapshot")
                .map(|buffer| buffer.contains("shutdown-output"))
                .unwrap_or(false)
        });
        assert!(buffered, "live buffer should receive test output");

        mgr.snapshot_live_buffers();
        tx.send(PersistCmd::Shutdown).unwrap();
        handle.join().unwrap();

        let (data, _) = store
            .load_buffer("shell:shutdown-snapshot")
            .unwrap()
            .expect("shutdown snapshot should persist buffer");
        let text = String::from_utf8_lossy(&data);
        assert!(text.contains("shutdown-output"), "persisted text: {text:?}");

        mgr.remove("shell:shutdown-snapshot").unwrap();
    }

    // -----------------------------------------------------------------------
    // Phase 03: Diagnostic lifecycle events + terminal tail
    // -----------------------------------------------------------------------

    fn make_manager_with_diag(store: &DiagnosticStore) -> PtySessionManager {
        let mgr = test_rt().block_on(async { PtySessionManager::new(Arc::new(NoopEventSink)) });
        mgr.set_diagnostics(store.clone());
        mgr
    }

    #[test]
    fn terminal_create_event_recorded_in_diagnostics() {
        let dir = tempfile::tempdir().unwrap();
        let store = DiagnosticStore::new(dir.path().join("diag.jsonl"));
        let mgr = make_manager_with_diag(&store);

        mgr.create(opts("shell:diag-create", "echo hello")).unwrap();
        // Give the reader thread a moment to process.
        wait_for(Duration::from_secs(2), || {
            mgr.get_buffer("shell:diag-create")
                .map(|b| b.contains("hello"))
                .unwrap_or(false)
        });

        let events = store.recent_events(60);
        let create_events: Vec<_> = events
            .iter()
            .filter(|e| e.message == "terminal.create")
            .collect();
        assert!(
            create_events.iter().any(|e| e
                .fields
                .get("sessionId")
                .is_some_and(|v| v == "shell:diag-create")),
            "terminal.create event should be recorded with sessionId"
        );

        mgr.remove("shell:diag-create").unwrap();
    }

    #[test]
    fn terminal_kill_event_recorded_in_diagnostics() {
        let dir = tempfile::tempdir().unwrap();
        let store = DiagnosticStore::new(dir.path().join("diag.jsonl"));
        let mgr = make_manager_with_diag(&store);

        mgr.create(opts("shell:diag-kill", "sleep 30")).unwrap();
        mgr.kill("shell:diag-kill").unwrap();

        let events = store.recent_events(60);
        assert!(
            events.iter().any(|e| {
                e.message == "terminal.kill"
                    && e.fields
                        .get("sessionId")
                        .is_some_and(|v| v == "shell:diag-kill")
            }),
            "terminal.kill event should be recorded"
        );

        mgr.remove("shell:diag-kill").unwrap();
    }

    #[test]
    fn terminal_exit_event_recorded_with_exit_code() {
        let dir = tempfile::tempdir().unwrap();
        let store = DiagnosticStore::new(dir.path().join("diag.jsonl"));
        let mgr = make_manager_with_diag(&store);

        mgr.create(opts("shell:diag-exit", "exit 1")).unwrap();
        // Wait for the process to exit.
        wait_for(Duration::from_secs(3), || {
            mgr.list()
                .iter()
                .all(|s| s.id != "shell:diag-exit" || !s.alive)
        });

        let events = store.recent_events(60);
        let exit_events: Vec<_> = events
            .iter()
            .filter(|e| e.message == "terminal.exit")
            .collect();
        assert!(
            exit_events.iter().any(|e| {
                e.fields
                    .get("sessionId")
                    .is_some_and(|v| v == "shell:diag-exit")
                    && e.fields.get("exitCode").is_some_and(|v| v == "1")
            }),
            "terminal.exit event should be recorded with exitCode=1, events: {:?}",
            exit_events.iter().map(|e| &e.fields).collect::<Vec<_>>()
        );
    }

    #[test]
    fn terminal_tail_returns_capped_redacted_live_buffer() {
        let dir = tempfile::tempdir().unwrap();
        let store = DiagnosticStore::new(dir.path().join("diag.jsonl"));
        let mgr = make_manager_with_diag(&store);

        // Produce output containing a secret pattern that should be redacted.
        mgr.create(opts("shell:diag-tail", "echo 'token=secret123'; sleep 5"))
            .unwrap();
        wait_for(Duration::from_secs(3), || {
            mgr.get_buffer("shell:diag-tail")
                .map(|b| b.contains("secret123"))
                .unwrap_or(false)
        });

        let tail = mgr.terminal_tail("shell:diag-tail", 1024);
        assert!(
            tail.is_some(),
            "terminal_tail should return Some for live session"
        );
        let tail = tail.unwrap();
        assert_eq!(tail.source, "live");
        assert_eq!(tail.session_id, "shell:diag-tail");
        // The secret value should be redacted.
        assert!(
            !tail.tail.contains("secret123"),
            "tail should be redacted, got: {}",
            tail.tail
        );
        assert!(tail.tail.contains("[REDACTED]"));

        mgr.remove("shell:diag-tail").unwrap();
    }

    #[test]
    fn terminal_tail_caps_to_max_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let store = DiagnosticStore::new(dir.path().join("diag.jsonl"));
        let mgr = make_manager_with_diag(&store);

        // Produce ~2KB of output (40 lines × ~50 chars).
        mgr.create(opts(
            "shell:diag-cap",
            "for i in $(seq 1 40); do echo \"line-$i-0123456789abcdef\"; done; sleep 5",
        ))
        .unwrap();
        wait_for(Duration::from_secs(3), || {
            mgr.get_buffer("shell:diag-cap")
                .map(|b| b.contains("line-40"))
                .unwrap_or(false)
        });

        // Request only 100 bytes — tail should be capped.
        let tail = mgr.terminal_tail("shell:diag-cap", 100);
        assert!(tail.is_some());
        let tail = tail.unwrap();
        assert!(
            tail.tail_bytes <= 100,
            "tail_bytes ({}) should be <= 100",
            tail.tail_bytes
        );

        mgr.remove("shell:diag-cap").unwrap();
    }

    #[test]
    fn terminal_tail_returns_none_for_unknown_session() {
        let dir = tempfile::tempdir().unwrap();
        let store = DiagnosticStore::new(dir.path().join("diag.jsonl"));
        let mgr = make_manager_with_diag(&store);

        let tail = mgr.terminal_tail("nonexistent", 1024);
        assert!(
            tail.is_none(),
            "terminal_tail should return None for unknown session"
        );
    }

    #[test]
    fn terminal_tail_falls_back_to_persisted_buffer_after_exit() {
        let temp = tempfile::NamedTempFile::new().unwrap();
        let store = Arc::new(SessionStore::open(temp.path()).unwrap());
        let (tx, rx) = std::sync::mpsc::sync_channel(256);
        let worker = PersistWorker::new(rx, store.clone());
        let handle = std::thread::spawn(move || worker.run());

        let diag_store = DiagnosticStore::new(temp.path().with_extension("jsonl"));
        let mgr = test_rt().block_on(async {
            PtySessionManager::with_persist(
                Arc::new(NoopEventSink),
                Some(tx.clone()),
                Some(store.clone()),
            )
        });
        mgr.set_diagnostics(diag_store);

        mgr.create(opts(
            "shell:diag-persisted-tail",
            "printf 'token=secret123'",
        ))
        .unwrap();
        let exited = wait_for(Duration::from_secs(3), || {
            mgr.list()
                .iter()
                .any(|session| session.id == "shell:diag-persisted-tail" && !session.alive)
        });
        assert!(exited, "persisted-tail session should exit");

        tx.send(PersistCmd::Shutdown).unwrap();
        handle.join().unwrap();

        let tail = mgr
            .terminal_tail("shell:diag-persisted-tail", 1024)
            .expect("terminal_tail should use persisted buffer");
        assert_eq!(tail.source, "persisted");
        assert!(tail.tail.contains("[REDACTED]"));
        assert!(!tail.tail.contains("secret123"));
    }

    #[test]
    fn list_detailed_includes_dead_sessions_for_export_consistency() {
        let dir = tempfile::tempdir().unwrap();
        let store = DiagnosticStore::new(dir.path().join("diag.jsonl"));
        let mgr = make_manager_with_diag(&store);

        mgr.create(opts("shell:diag-dead-detail", "printf 'done\\n'"))
            .unwrap();
        wait_for(Duration::from_secs(3), || {
            mgr.list()
                .iter()
                .any(|session| session.id == "shell:diag-dead-detail" && !session.alive)
        });

        let details = mgr.list_detailed();
        assert!(details.iter().any(|detail| {
            detail.meta.id == "shell:diag-dead-detail"
                && !detail.meta.alive
                && detail.buffer_bytes == 0
        }));
    }

    #[test]
    fn terminal_respawn_failures_are_recorded_in_diagnostics() {
        let dir = tempfile::tempdir().unwrap();
        let diag_store = DiagnosticStore::new(dir.path().join("diag.jsonl"));
        let mgr = make_manager_with_diag(&diag_store);
        let shell_path = dir.path().join("respawn-shell.sh");
        fs::write(&shell_path, "#!/bin/sh\nexit 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&shell_path).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&shell_path, perms).unwrap();
        }

        let shell_value = shell_path.to_string_lossy().into_owned();
        let PtyCreateOpts {
            id,
            command,
            cwd,
            env: base_env,
            cols,
            rows,
            project,
            ..
        } = opts("shell:diag-respawn-fail", "");
        let create_opts = PtyCreateOpts {
            id,
            command,
            cwd,
            env: base_env
                .into_iter()
                .chain([("SHELL".into(), shell_value)])
                .collect(),
            cols,
            rows,
            project,
            restart_policy: RestartPolicy::Always,
            restart_max_retries: 1,
        };

        mgr.create(create_opts).unwrap();
        fs::remove_file(&shell_path).unwrap();

        let recorded = wait_for(Duration::from_secs(5), || {
            diag_store.recent_events(60).iter().any(|event| {
                event.message == "terminal.respawn_failed"
                    && event
                        .fields
                        .get("sessionId")
                        .is_some_and(|value| value == "shell:diag-respawn-fail")
            })
        });
        assert!(recorded, "respawn failure should be recorded");

        let events = diag_store.recent_events(60);
        let failure = events
            .iter()
            .find(|event| event.message == "terminal.respawn_failed")
            .expect("respawn failure event should exist");
        assert_eq!(failure.fields.get("restartCount"), Some(&"1".to_string()));
        assert_eq!(
            failure.fields.get("restartPolicy"),
            Some(&"Always".to_string())
        );
    }
}
