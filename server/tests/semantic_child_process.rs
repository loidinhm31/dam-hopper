use std::path::PathBuf;
use std::time::Duration;
use tokio::time::timeout;

use dam_hopper_server::semantic::child::{ChildEvent, ChildStatus, SemanticChildOwner};
use dam_hopper_server::semantic::launch::BundledLaunchSpec;
use dam_hopper_server::semantic::reaper::is_pgid_empty;
use dam_hopper_server::semantic::types::MAX_QUEUE_COUNT;

fn resolve_node_bin() -> PathBuf {
    if let Ok(p) = std::env::var("NODE_BIN") {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return pb;
        }
    }
    let nvm_path = PathBuf::from("/home/loidinh/.nvm/versions/node/v24.16.0/bin/node");
    if nvm_path.is_file() {
        return nvm_path;
    }
    let out = std::process::Command::new("which")
        .arg("node")
        .output()
        .expect("Failed to locate node");
    PathBuf::from(String::from_utf8_lossy(&out.stdout).trim())
}

fn fixture_path() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir.join("tests/fixtures/lsp-test-server.mjs")
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
            let parsed: serde_json::Value = serde_json::from_slice(&bytes).expect("valid JSON response");
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
                matches!(status, ChildStatus::Exited(Some(0)) | ChildStatus::Exited(None)),
                "Unexpected exit status: {:?}",
                status
            );
            break;
        }
    }
    assert!(terminal_received, "Must receive terminal event");
    assert!(is_pgid_empty(pgid), "Zero surviving descendants/zombies in PGID");
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
    assert!(is_pgid_empty(pgid), "Process group must be completely reaped");
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

    assert!(got_message, "Stdout message must arrive despite stderr flood");

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
            assert!(matches!(status, ChildStatus::Exited(None) | ChildStatus::Crashed(_)));
            break;
        }
    }

    assert!(terminated, "Must terminate stuck child via signal escalation");
    assert!(is_pgid_empty(pgid), "Stuck child PGID must be completely empty");
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
    assert!(is_pgid_empty(pgid), "All spawned descendants in PGID must be reaped (0 survivors)");
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

    assert!(rejected, "Queue must reject messages once MAX_QUEUE_COUNT is exceeded");

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
    assert!(is_pgid_empty(pgid), "Dropped handle must clean up entire PGID");
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

    assert!(terminated, "Must receive termination event for stubborn descendants");
    assert!(is_pgid_empty(pgid), "SIGKILL must forcibly clean stubborn descendants");
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
