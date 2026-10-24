use std::path::PathBuf;
use std::time::Duration;
use tokio::time::timeout;

use dam_hopper_server::semantic::child::{ChildEvent, ChildStatus, SemanticChildOwner};
use dam_hopper_server::semantic::launch::BundledLaunchSpec;
use dam_hopper_server::semantic::reaper::{get_all_descendants, is_pgid_empty, verify_pids_dead};
use dam_hopper_server::semantic::types::MAX_QUEUE_COUNT;

fn resolve_node_bin() -> PathBuf {
    if let Ok(p) = std::env::var("NODE_BIN") {
        let pb = PathBuf::from(p);
        if pb.is_absolute() && pb.is_file() {
            return pb;
        }
    }
    let candidates = [
        "/home/loidinh/.nvm/versions/node/v24.16.0/bin/node",
        "/usr/bin/node",
        "/usr/local/bin/node",
    ];
    for candidate in candidates {
        let p = PathBuf::from(candidate);
        if p.is_file() {
            return p;
        }
    }
    panic!("Pinned Node binary not found at absolute path");
}

fn fixture_path() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir.join("tests/fixtures/lsp-test-server.mjs")
}

#[cfg(target_os = "linux")]
#[test]
fn test_descendants_spawned_by_nonleader_thread() {
    use std::io::{BufRead, BufReader};
    use std::os::fd::OwnedFd;
    use std::os::unix::net::UnixStream;
    use std::os::unix::process::CommandExt;
    use std::process::{Child, Command, Stdio};
    use std::sync::mpsc;
    use std::thread;
    use std::time::Instant;

    use dam_hopper_server::semantic::reaper::{get_proc_children, signal_pgid};
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;

    struct OwnedTree(Option<Child>);

    impl OwnedTree {
        fn stop(&mut self) -> bool {
            let Some(mut child) = self.0.take() else {
                return true;
            };
            let pid = child.id();
            // The helper kills AND waits for its leaf before exiting on SIGTERM.
            let _ = kill(Pid::from_raw(pid as i32), Some(Signal::SIGTERM));
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        if is_pgid_empty(pid) {
                            return status.success();
                        }
                        break;
                    }
                    Ok(None) => thread::sleep(Duration::from_millis(10)),
                    Err(_) => break,
                }
            }
            // Best-effort group cleanup also covers readiness/assertion failures.
            let _ = signal_pgid(pid, Some(Signal::SIGKILL));
            let _ = child.kill();
            let _ = child.wait();
            false
        }
    }

    impl Drop for OwnedTree {
        fn drop(&mut self) {
            let _ = self.stop();
        }
    }

    let node = resolve_node_bin();
    // Unlike the stubborn-grandchildren fixture, this helper acknowledges leaf readiness
    // and reaps it on teardown, including when a Rust assertion unwinds.
    let helper = r#"
        const { spawn } = require('node:child_process');
        const leaf = spawn(process.execPath, ['-e',
            "process.send('ready'); setInterval(() => {}, 1000);"
        ], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        let stopping = false;
        const stop = () => { stopping = true; leaf.kill('SIGKILL'); };
        process.on('SIGTERM', stop);
        leaf.on('error', () => process.exit(2));
        leaf.on('close', () => process.exit(stopping ? 0 : 3));
        leaf.once('message', () => {
            process.stdout.write(`${process.pid} ${leaf.pid}\n`);
        });
    "#;

    thread::scope(|scope| {
        let (release_tx, release_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let worker = scope.spawn(move || {
            let (reader, writer) = UnixStream::pair().expect("readiness socket");
            reader
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("bounded readiness");
            let child = Command::new(node)
                .args(["-e", helper])
                .env_clear()
                .stdin(Stdio::null())
                .stdout(Stdio::from(OwnedFd::from(writer)))
                .stderr(Stdio::null())
                .process_group(0)
                .spawn()
                .expect("spawn owned helper from worker");
            let tree = OwnedTree(Some(child));
            if ready_tx.send((tree, reader)).is_ok() {
                match release_rx.recv_timeout(Duration::from_secs(15)) {
                    Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => {}
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        panic!("main must release spawning thread before deadline");
                    }
                }
            }
        });
        let (mut tree, reader) = ready_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("worker must hand over cleanup ownership");
        let mut ready = String::new();
        BufReader::new(reader)
            .read_line(&mut ready)
            .expect("helper and leaf readiness before deadline");
        let pids: Vec<u32> = ready
            .split_whitespace()
            .map(|pid| pid.parse().expect("readiness PID"))
            .collect();
        assert_eq!(pids.len(), 2, "helper must report its PID and leaf PID");
        assert_eq!(pids[0], tree.0.as_ref().unwrap().id());
        let root = std::process::id();

        // Keep the creator OS thread alive: the old leader-only implementation misses it.
        let direct = get_proc_children(root);
        assert!(
            direct.contains(&pids[0]),
            "worker-owned child absent: {direct:?}"
        );
        let descendants = get_all_descendants(root);
        for pid in &pids {
            assert_eq!(
                descendants.iter().filter(|found| *found == pid).count(),
                1,
                "worker-owned child/grandchild absent or duplicated: {descendants:?}"
            );
        }
        assert_eq!(get_proc_children(pids[0]), vec![pids[1]]);
        assert!(
            get_proc_children(0).is_empty(),
            "missing /proc root is harmless"
        );

        // Linux reparents children when their spawning task exits; keep both alive.
        release_tx.send(()).expect("release spawning thread");
        worker.join().expect("spawning thread exits");
        let descendants = get_all_descendants(root);
        for pid in &pids {
            assert!(
                descendants.contains(pid),
                "child/grandchild missing after creator-thread exit: {descendants:?}"
            );
        }
        assert!(
            tree.stop(),
            "helper must kill and wait for its leaf before exiting"
        );
        assert!(
            verify_pids_dead(&pids),
            "owned child and grandchild must both be reaped"
        );
    });
}

#[tokio::test]
async fn test_normal_lsp_lifecycle_and_reap() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec");

    let (mut handle, mut event_rx) = SemanticChildOwner::spawn(&spec).expect("spawn child");
    let pgid = handle.pgid;

    assert!(!is_pgid_empty(pgid), "Process group should be running");

    // Send a sample LSP request
    let request = br#"{"jsonrpc":"2.0","id":1,"method":"ping","params":{"value":42}}"#.to_vec();
    handle.send_message(request).expect("send request");

    // Wait for echo response
    let response_event = timeout(Duration::from_secs(5), event_rx.recv())
        .await
        .expect("timeout waiting for response")
        .expect("event stream closed");

    match response_event {
        ChildEvent::Message(bytes) => {
            let parsed: serde_json::Value =
                serde_json::from_slice(&bytes).expect("valid JSON response");
            assert_eq!(parsed["id"], 1);
            assert_eq!(parsed["result"]["echo"]["value"], 42);
        }
        other => panic!("Expected ChildEvent::Message, got {:?}", other),
    }

    // Gracefully shut down
    handle.shutdown();

    // Await terminal event
    let mut terminal_received = false;
    while let Ok(Some(evt)) = timeout(Duration::from_secs(4), event_rx.recv()).await {
        if let ChildEvent::Terminated(status) = evt {
            terminal_received = true;
            assert!(
                matches!(
                    status,
                    ChildStatus::Exited(Some(0)) | ChildStatus::Exited(None)
                ),
                "Unexpected exit status: {:?}",
                status
            );
            break;
        }
    }
    assert!(terminal_received, "Must receive terminal event");
    assert!(
        is_pgid_empty(pgid),
        "Zero surviving descendants/zombies in PGID"
    );
}

#[tokio::test]
async fn test_fragmented_frame_handling() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec")
        .with_extra_args(vec!["--mode=fragment".to_string()]);

    let (mut handle, mut event_rx) = SemanticChildOwner::spawn(&spec).expect("spawn child");
    let pgid = handle.pgid;

    let request = br#"{"jsonrpc":"2.0","id":99,"method":"split"}"#.to_vec();
    handle.send_message(request).expect("send request");

    let response = timeout(Duration::from_secs(5), event_rx.recv())
        .await
        .expect("timeout")
        .expect("event stream closed");

    match response {
        ChildEvent::Message(bytes) => {
            let parsed: serde_json::Value = serde_json::from_slice(&bytes).expect("valid JSON");
            assert_eq!(parsed["id"], 99);
            assert_eq!(parsed["result"]["ok"], true);
        }
        other => panic!("Expected ChildEvent::Message, got {:?}", other),
    }

    handle.shutdown();
    timeout(Duration::from_secs(3), async {
        while let Some(evt) = event_rx.recv().await {
            if let ChildEvent::Terminated(_) = evt {
                break;
            }
        }
    })
    .await
    .expect("shutdown timeout");

    assert!(is_pgid_empty(pgid));
}

#[tokio::test]
async fn test_crash_reporting_and_reap() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec")
        .with_extra_args(vec!["--mode=crash-on-msg".to_string()]);

    let (handle, mut event_rx) = SemanticChildOwner::spawn(&spec).expect("spawn child");
    let pgid = handle.pgid;

    handle
        .send_message(br#"{"jsonrpc":"2.0","id":1}"#.to_vec())
        .expect("send message");

    let mut terminal_received = false;
    while let Ok(Some(evt)) = timeout(Duration::from_secs(4), event_rx.recv()).await {
        if let ChildEvent::Terminated(status) = evt {
            terminal_received = true;
            assert_eq!(status, ChildStatus::Exited(Some(42)));
            break;
        }
    }

    assert!(terminal_received, "Terminal event must be emitted on crash");
    assert!(
        is_pgid_empty(pgid),
        "Process group must be completely reaped"
    );
}

#[tokio::test]
async fn test_stderr_flood_bounded_drain() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec")
        .with_extra_args(vec!["--mode=stderr-flood".to_string()]);

    let (mut handle, mut event_rx) = SemanticChildOwner::spawn(&spec).expect("spawn child");
    let pgid = handle.pgid;

    // Send a message and verify stdout is not blocked by stderr flood
    handle
        .send_message(br#"{"jsonrpc":"2.0","id":7,"method":"ping"}"#.to_vec())
        .expect("send message");

    let mut got_message = false;
    let mut got_stderr = false;

    for _ in 0..5 {
        if let Ok(Some(evt)) = timeout(Duration::from_secs(2), event_rx.recv()).await {
            match evt {
                ChildEvent::Message(bytes) => {
                    let parsed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                    if parsed["id"] == 7 {
                        got_message = true;
                    }
                }
                ChildEvent::StderrSummary { total_lines, .. } if total_lines > 0 => {
                    got_stderr = true;
                }
                _ => {}
            }
        }
    }

    assert!(
        got_message,
        "Stdout message must arrive despite stderr flood"
    );

    handle.shutdown();
    timeout(Duration::from_secs(3), async {
        while let Some(evt) = event_rx.recv().await {
            if let ChildEvent::StderrSummary { .. } = evt {
                got_stderr = true;
            }
            if let ChildEvent::Terminated(_) = evt {
                break;
            }
        }
    })
    .await
    .expect("shutdown timeout");

    assert!(got_stderr, "Must produce stderr summary event");
    assert!(is_pgid_empty(pgid));
}

#[tokio::test]
async fn test_stuck_shutdown_signal_escalation() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec")
        .with_extra_args(vec!["--mode=stuck-shutdown".to_string()]);

    let (mut handle, mut event_rx) = SemanticChildOwner::spawn(&spec).expect("spawn child");
    let pgid = handle.pgid;

    // Trigger shutdown; fixture will refuse to exit on RPC, forcing SIGKILL
    handle.shutdown();

    let mut terminated = false;
    while let Ok(Some(evt)) = timeout(Duration::from_secs(6), event_rx.recv()).await {
        if let ChildEvent::Terminated(status) = evt {
            terminated = true;
            // On Unix SIGKILL causes code() to be None, or status Crashed/Exited
            assert!(matches!(
                status,
                ChildStatus::Exited(None) | ChildStatus::Crashed(_)
            ));
            break;
        }
    }

    assert!(
        terminated,
        "Must terminate stuck child via signal escalation"
    );
    assert!(
        is_pgid_empty(pgid),
        "Stuck child PGID must be completely empty"
    );
}

#[tokio::test]
async fn test_descendant_spawn_and_reap() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec")
        .with_extra_args(vec!["--mode=spawn-descendants".to_string()]);

    let (mut handle, mut event_rx) = SemanticChildOwner::spawn(&spec).expect("spawn child");
    let pgid = handle.pgid;

    // Give helper children a moment to spawn
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Trigger shutdown
    handle.shutdown();

    let mut terminated = false;
    while let Ok(Some(evt)) = timeout(Duration::from_secs(5), event_rx.recv()).await {
        if let ChildEvent::Terminated(_) = evt {
            terminated = true;
            break;
        }
    }

    assert!(terminated, "Must receive termination event");
    assert!(
        is_pgid_empty(pgid),
        "All spawned descendants in PGID must be reaped (0 survivors)"
    );
}

#[tokio::test]
async fn test_queue_overflow_protection() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec")
        .with_extra_args(vec!["--mode=delay".to_string()]);

    let (mut handle, mut event_rx) = SemanticChildOwner::spawn(&spec).expect("spawn child");
    let pgid = handle.pgid;

    let payload = br#"{"jsonrpc":"2.0","method":"ping"}"#.to_vec();

    // Fill the queue
    let mut rejected = false;
    for _ in 0..MAX_QUEUE_COUNT + 10 {
        if handle.send_message(payload.clone()).is_err() {
            rejected = true;
            break;
        }
    }

    assert!(
        rejected,
        "Queue must reject messages once MAX_QUEUE_COUNT is exceeded"
    );

    handle.shutdown();
    let mut terminated = false;
    while let Ok(Some(evt)) = timeout(Duration::from_secs(5), event_rx.recv()).await {
        if let ChildEvent::Terminated(_) = evt {
            terminated = true;
            break;
        }
    }
    assert!(terminated, "Termination event must be received");
    assert!(is_pgid_empty(pgid));
}
#[tokio::test]
async fn test_handle_drop_triggers_cleanup() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec");

    let (handle, mut event_rx) = SemanticChildOwner::spawn(&spec).expect("spawn child");
    let pgid = handle.pgid;

    assert!(!is_pgid_empty(pgid));

    // Drop the handle without calling shutdown
    drop(handle);

    // Verify child event stream reaches termination and process group is empty
    let mut terminated = false;
    while let Ok(Some(evt)) = timeout(Duration::from_secs(5), event_rx.recv()).await {
        if let ChildEvent::Terminated(_) = evt {
            terminated = true;
            break;
        }
    }

    assert!(terminated, "Dropping handle must trigger child teardown");
    assert!(
        is_pgid_empty(pgid),
        "Dropped handle must clean up entire PGID"
    );
}

#[tokio::test]
async fn test_malformed_stdout_triggers_crashed_and_reap() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec")
        .with_extra_args(vec!["--mode=malformed-stdout".to_string()]);

    let (_handle, mut event_rx) = SemanticChildOwner::spawn(&spec).expect("spawn child");

    let mut terminated_status = None;
    while let Ok(Some(evt)) = timeout(Duration::from_secs(5), event_rx.recv()).await {
        if let ChildEvent::Terminated(status) = evt {
            terminated_status = Some(status);
            break;
        }
    }

    let status = terminated_status.expect("Malformed stdout must trigger child termination");
    assert!(
        matches!(status, ChildStatus::Crashed(_)),
        "Expected ChildStatus::Crashed, got {:?}",
        status
    );
}

#[tokio::test]
async fn test_stubborn_descendant_forced_sigkill() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec")
        .with_extra_args(vec!["--mode=spawn-stubborn-descendants".to_string()]);

    let (mut handle, mut event_rx) = SemanticChildOwner::spawn(&spec).expect("spawn child");
    let pgid = handle.pgid;

    tokio::time::sleep(Duration::from_millis(400)).await;

    handle.shutdown();

    let mut terminated = false;
    while let Ok(Some(evt)) = timeout(Duration::from_secs(6), event_rx.recv()).await {
        if let ChildEvent::Terminated(_) = evt {
            terminated = true;
            break;
        }
    }

    assert!(
        terminated,
        "Must receive termination event for stubborn descendants"
    );
    assert!(
        is_pgid_empty(pgid),
        "SIGKILL must forcibly clean stubborn descendants"
    );
}

#[tokio::test]
async fn test_event_receiver_drop_triggers_cleanup() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec");

    let (handle, event_rx) = SemanticChildOwner::spawn(&spec).expect("spawn child");
    let pgid = handle.pgid;

    // Drop the event receiver
    drop(event_rx);

    assert!(
        dam_hopper_server::semantic::reaper::verify_pgid_reaped(pgid, Duration::from_secs(4)).await,
        "Dropping event receiver must trigger teardown of process group"
    );
}

#[tokio::test]
async fn test_launch_spec_omits_unsupported_tsserver_cli_flag() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let fake_tsserver = temp_dir.path().join("tsserver.js");
    std::fs::write(&fake_tsserver, b"// bundled tsserver").expect("write tsserver");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec")
        .with_tsserver_path(&fake_tsserver);

    // Fixture exits 1 if --tsserver-path is passed on CLI; spawning must succeed and echo
    let (mut handle, mut event_rx) = SemanticChildOwner::spawn(&spec).expect("spawn child");
    let pgid = handle.pgid;

    handle
        .send_message(br#"{"jsonrpc":"2.0","id":1,"method":"ping","params":{"ok":true}}"#.to_vec())
        .expect("send ping");

    let evt = timeout(Duration::from_secs(5), event_rx.recv())
        .await
        .expect("timeout")
        .expect("event");
    match evt {
        ChildEvent::Message(bytes) => {
            let parsed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(parsed["id"], 1);
        }
        other => panic!("Expected ChildEvent::Message, got {:?}", other),
    }

    handle.shutdown();
    let _ = handle.wait_terminated().await;
    assert!(is_pgid_empty(pgid));
}

#[tokio::test]
async fn test_coalesced_frames_and_duplicate_replies() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    // 1. Coalesced frames
    let spec_coalesce =
        BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
            .expect("launch spec")
            .with_extra_args(vec!["--mode=coalesce".to_string()]);

    let (mut handle, mut event_rx) = SemanticChildOwner::spawn(&spec_coalesce).expect("spawn");
    let pgid = handle.pgid;
    handle
        .send_message(br#"{"jsonrpc":"2.0","id":11,"method":"ping","params":{"x":1}}"#.to_vec())
        .expect("send");

    let first = timeout(Duration::from_secs(3), event_rx.recv())
        .await
        .unwrap()
        .unwrap();
    let second = timeout(Duration::from_secs(3), event_rx.recv())
        .await
        .unwrap()
        .unwrap();
    match (first, second) {
        (ChildEvent::Message(b1), ChildEvent::Message(b2)) => {
            let p1: serde_json::Value = serde_json::from_slice(&b1).unwrap();
            let p2: serde_json::Value = serde_json::from_slice(&b2).unwrap();
            assert_eq!(p1["method"], "window/logMessage");
            assert_eq!(p2["id"], 11);
            assert_eq!(p2["result"]["coalesced"], true);
        }
        other => panic!(
            "Expected two coalesced ChildEvent::Message, got {:?}",
            other
        ),
    }
    handle.shutdown();
    let _ = handle.wait_terminated().await;
    assert!(is_pgid_empty(pgid));

    // 2. Duplicate replies
    let spec_dup = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec")
        .with_extra_args(vec!["--mode=duplicate-reply".to_string()]);
    let (mut handle_dup, mut rx_dup) = SemanticChildOwner::spawn(&spec_dup).expect("spawn");
    let pgid_dup = handle_dup.pgid;
    handle_dup
        .send_message(br#"{"jsonrpc":"2.0","id":22,"method":"ping"}"#.to_vec())
        .expect("send");
    for expected_dup in [1, 2] {
        let evt = timeout(Duration::from_secs(3), rx_dup.recv())
            .await
            .unwrap()
            .unwrap();
        match evt {
            ChildEvent::Message(bytes) => {
                let parsed: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                assert_eq!(parsed["id"], 22);
                assert_eq!(parsed["result"]["duplicate"], expected_dup);
            }
            other => panic!("Expected duplicate reply message, got {:?}", other),
        }
    }
    handle_dup.shutdown();
    let _ = handle_dup.wait_terminated().await;
    assert!(is_pgid_empty(pgid_dup));
}

#[tokio::test]
async fn test_oversized_frame_and_header_trigger_crash_and_reap() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    for mode in ["--mode=oversized-frame", "--mode=oversized-header"] {
        let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
            .expect("launch spec")
            .with_extra_args(vec![mode.to_string()]);

        let (mut handle, _rx) = SemanticChildOwner::spawn(&spec).expect("spawn");
        let pgid = handle.pgid;
        let status = timeout(Duration::from_secs(5), handle.wait_terminated())
            .await
            .expect("timeout waiting for oversized framing crash");
        assert!(
            matches!(status, ChildStatus::Crashed(_)),
            "Mode {mode} must terminate with Crashed, got {status:?}"
        );
        assert!(is_pgid_empty(pgid), "PGID must be empty after {mode}");
    }
}

#[tokio::test]
async fn test_grandchild_descendant_spawn_and_complete_tree_reap() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec")
        .with_extra_args(vec!["--mode=spawn-grandchildren".to_string()]);

    let (mut handle, _rx) = SemanticChildOwner::spawn(&spec).expect("spawn");
    let pgid = handle.pgid;

    // Wait for child + grandchild to be spawned
    let mut descendants = Vec::new();
    for _ in 0..25 {
        descendants = get_all_descendants(pgid);
        if descendants.len() >= 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(
        descendants.len() >= 2,
        "Expected child and grandchild in /proc descendants, found {:?}",
        descendants
    );

    handle.shutdown();
    let _ = timeout(Duration::from_secs(6), handle.wait_terminated())
        .await
        .expect("shutdown timeout");

    assert!(
        is_pgid_empty(pgid),
        "PGID must be empty after grandchild reap"
    );
    assert!(
        verify_pids_dead(&descendants),
        "All recorded child and grandchild PIDs must be dead"
    );
}

#[tokio::test]
async fn test_portable_process_tree_count_limit_enforced() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec")
        .with_extra_args(vec!["--mode=spawn-many-descendants".to_string()]);

    let (mut handle, _rx) = SemanticChildOwner::spawn(&spec).expect("spawn");
    let pgid = handle.pgid;

    let status = timeout(Duration::from_secs(6), handle.wait_terminated())
        .await
        .expect("timeout waiting for process tree limit enforcement");

    match status {
        ChildStatus::Crashed(reason) => {
            assert!(
                reason.contains("Portable process tree limit exceeded"),
                "Unexpected crash reason: {reason}"
            );
        }
        other => panic!("Expected ChildStatus::Crashed for process tree limit, got {other:?}"),
    }
    assert!(
        is_pgid_empty(pgid),
        "Excess descendants must be completely reaped when process count limit triggers"
    );
}

#[tokio::test]
async fn test_portable_sampled_rss_limit_enforced() {
    let node_bin = resolve_node_bin();
    let fixture = fixture_path();
    let temp_dir = tempfile::tempdir().expect("tempdir");

    let spec = BundledLaunchSpec::new(&node_bin, &fixture, temp_dir.path(), temp_dir.path())
        .expect("launch spec")
        .with_extra_args(vec!["--mode=memory-hog".to_string()])
        .with_max_tree_rss_bytes(16 * 1024 * 1024);

    let (mut handle, _rx) = SemanticChildOwner::spawn(&spec).expect("spawn");
    let pgid = handle.pgid;

    let status = timeout(Duration::from_secs(6), handle.wait_terminated())
        .await
        .expect("timeout waiting for sampled RSS limit enforcement");

    match status {
        ChildStatus::Crashed(reason) => {
            assert!(
                reason.contains("Portable sampled RSS limit exceeded"),
                "Unexpected crash reason: {reason}"
            );
        }
        other => panic!("Expected ChildStatus::Crashed for sampled RSS limit, got {other:?}"),
    }
    assert!(
        is_pgid_empty(pgid),
        "Process group must be completely reaped after sampled RSS limit triggers"
    );
}
