#![cfg(target_os = "linux")]

use std::fs::{self, File};
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use tempfile::TempDir;

use dam_hopper_server::semantic::overlay::SessionOverlayMap;
use dam_hopper_server::semantic::protocol::{
    ConnectionId, NavigationParams, Position, Range, SemanticState, SessionKey,
    TextDocumentContentChangeEvent, TextDocumentIdentifier,
};
use dam_hopper_server::semantic::supervisor::{SemanticSupervisor, SupervisorError};
use dam_hopper_server::semantic::tool_profile::{
    compute_file_sha256, PinnedDigests, SemanticToolProfile,
};

fn resolve_node_bin() -> PathBuf {
    if let Ok(p) = std::env::var("NODE_BIN") {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return pb;
        }
    }
    if let Ok(out) = std::process::Command::new("which").arg("node").output() {
        let p = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
        if p.is_file() {
            return p;
        }
    }
    let out = std::process::Command::new("which")
        .arg("node")
        .output()
        .expect("Failed to locate node");
    PathBuf::from(String::from_utf8_lossy(&out.stdout).trim())
}

fn fixture_server_script() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir.join("tests/fixtures/lsp-test-server.mjs")
}

/// Sets up a mock release directory containing a real executable node script and mock tsls server.
struct TestToolchain {
    _temp_dir: TempDir,
    root: PathBuf,
}

impl TestToolchain {
    fn new() -> Self {
        let temp_dir = TempDir::new().expect("create temp dir");
        let root = temp_dir.path().to_path_buf();

        let engine_dir = root.join("lib").join("semantic-engine");
        let tsls_dir = engine_dir.join("tsls");
        let tsls_pkg_dir = tsls_dir
            .join("node_modules")
            .join("typescript-language-server")
            .join("lib");
        let ts_pkg_dir = tsls_dir.join("node_modules").join("typescript").join("lib");

        fs::create_dir_all(&engine_dir).expect("create engine dir");
        fs::create_dir_all(&tsls_pkg_dir).expect("create tsls pkg dir");
        fs::create_dir_all(&ts_pkg_dir).expect("create ts pkg dir");

        // Create executable node wrapper
        let real_node = resolve_node_bin();
        let node_path = engine_dir.join("node");
        let wrapper_content = format!("#!/bin/sh\nexec {} \"$@\"\n", real_node.display());
        {
            let mut node_file = File::create(&node_path).expect("create node wrapper");
            node_file
                .write_all(wrapper_content.as_bytes())
                .expect("write node wrapper");
            node_file.sync_all().expect("sync node wrapper");
        }
        fs::set_permissions(&node_path, fs::Permissions::from_mode(0o755)).expect("set node 0755");

        // Copy lsp-test-server.mjs as cli.mjs
        let fixture_path = fixture_server_script();
        let cli_path = tsls_pkg_dir.join("cli.mjs");
        fs::copy(&fixture_path, &cli_path).expect("copy cli.mjs");
        fs::set_permissions(&cli_path, fs::Permissions::from_mode(0o644)).expect("set cli 0644");

        // Create tsserver.js
        let tsserver_path = ts_pkg_dir.join("tsserver.js");
        {
            let mut tsserver_file = File::create(&tsserver_path).expect("create tsserver.js");
            tsserver_file
                .write_all(b"// mock tsserver")
                .expect("write tsserver");
            tsserver_file.sync_all().expect("sync tsserver");
        }
        fs::set_permissions(&tsserver_path, fs::Permissions::from_mode(0o644))
            .expect("set tsserver 0644");

        // Create tsls package.json
        let pkg_json_path = tsls_dir.join("package.json");
        {
            let mut pkg_file = File::create(&pkg_json_path).expect("create package.json");
            pkg_file
                .write_all(b"{\"name\":\"tsls-bundle\"}")
                .expect("write package.json");
            pkg_file.sync_all().expect("sync package.json");
        }
        fs::set_permissions(&pkg_json_path, fs::Permissions::from_mode(0o644))
            .expect("set package.json 0644");

        Self {
            _temp_dir: temp_dir,
            root,
        }
    }

    fn tool_profile(&self) -> SemanticToolProfile {
        let node_path = self.root.join("lib/semantic-engine/node");
        let cli_path = self
            .root
            .join("lib/semantic-engine/tsls/node_modules/typescript-language-server/lib/cli.mjs");
        let tsserver_path = self
            .root
            .join("lib/semantic-engine/tsls/node_modules/typescript/lib/tsserver.js");
        let pkg_path = self.root.join("lib/semantic-engine/tsls/package.json");

        let digests = PinnedDigests {
            node_sha256: compute_file_sha256(&node_path).expect("hash node"),
            tsls_entrypoint_sha256: Some(compute_file_sha256(&cli_path).expect("hash cli")),
            tsserver_sha256: Some(compute_file_sha256(&tsserver_path).expect("hash tsserver")),
            package_json_sha256: Some(compute_file_sha256(&pkg_path).expect("hash pkg")),
        };

        SemanticToolProfile::from_release_root_with_digests(&self.root, digests)
    }
}

#[tokio::test]
async fn test_supervisor_default_off_starts_zero_children() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));

    assert!(!supervisor.is_enabled());

    let target_dir = tempfile::tempdir().unwrap();
    let conn_id = ConnectionId("conn-1".into());
    let ep = supervisor.register_connection(&conn_id).await;
    let result = supervisor
        .get_or_create_session(
            conn_id,
            "project-1",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await;

    assert!(matches!(result, Err(SupervisorError::Disabled)));

    let status = supervisor.get_aggregate_status().await;
    assert_eq!(status.state, SemanticState::Disabled);
    assert_eq!(status.active_sessions, 0);
    assert_eq!(status.active_trees, 0);
}

#[tokio::test]
async fn test_multi_connection_isolation() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn1 = ConnectionId("conn-1".into());
    let conn2 = ConnectionId("conn-2".into());
    let ep1 = supervisor.register_connection(&conn1).await;
    let ep2 = supervisor.register_connection(&conn2).await;
    let session1 = supervisor
        .get_or_create_session(
            conn1,
            "project-1",
            None,
            target_dir.path().to_path_buf(),
            ep1,
        )
        .await
        .expect("create session 1");

    let session2 = supervisor
        .get_or_create_session(
            conn2,
            "project-1",
            None,
            target_dir.path().to_path_buf(),
            ep2,
        )
        .await
        .expect("create session 2");

    // Open index.ts in session1
    session1
        .did_open(
            "file:///index.ts".into(),
            "typescript".into(),
            1,
            "const x = 'conn1';".into(),
        )
        .await
        .expect("did_open session 1");

    // Open index.ts in session2 with different content
    session2
        .did_open(
            "file:///index.ts".into(),
            "typescript".into(),
            1,
            "const x = 'conn2';".into(),
        )
        .await
        .expect("did_open session 2");

    // Modify session 1
    let change = TextDocumentContentChangeEvent {
        range: None,
        range_length: None,
        text: "const x = 'conn1_modified';".into(),
    };
    session1
        .did_change("file:///index.ts".into(), 2, vec![change])
        .await
        .expect("did_change session 1");

    // Verify session 1 and 2 stats remain independent
    let (s1_docs, s1_bytes) = session1.get_overlay_stats().await;
    let (s2_docs, s2_bytes) = session2.get_overlay_stats().await;

    assert_eq!(s1_docs, 1);
    assert_eq!(s2_docs, 1);
    assert_ne!(s1_bytes, s2_bytes);

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_document_scoped_close_isolation() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-doc-scope".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-doc",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    session
        .did_open(
            "file:///docA.ts".into(),
            "typescript".into(),
            1,
            "const A = 100;".into(),
        )
        .await
        .expect("open docA");

    session
        .did_open(
            "file:///docB.ts".into(),
            "typescript".into(),
            1,
            "const B = 200;".into(),
        )
        .await
        .expect("open docB");

    let (docs_before, _) = session.get_overlay_stats().await;
    assert_eq!(docs_before, 2);

    // Close docA
    session
        .did_close("file:///docA.ts".into())
        .await
        .expect("close docA");

    let (docs_after, _) = session.get_overlay_stats().await;
    assert_eq!(docs_after, 1);

    // Verify session state remains ready
    assert_eq!(session.get_state().await, SemanticState::Ready);

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_adaptive_sync_threshold_crossing() {
    let mut map = SessionOverlayMap::new();

    // 1. Open document with small text (<64 KiB)
    let initial_text = "const greeting = 'hello world';\n".repeat(50); // ~1.6 KiB
    let inc = map
        .open_document(
            "file:///sync.ts".into(),
            "typescript".into(),
            1,
            initial_text,
        )
        .unwrap();
    assert_eq!(inc, 1);
    assert!(!map
        .get("file:///sync.ts")
        .unwrap()
        .is_incremental_sync_recommended());

    // 2. Expand document beyond 64 KiB threshold
    let large_chunk = "const padding = 'large file buffer data line content';\n".repeat(1500); // ~80 KiB
    let change_expand = TextDocumentContentChangeEvent {
        range: None,
        range_length: None,
        text: large_chunk,
    };
    let is_inc = map
        .apply_changes("file:///sync.ts", 2, &[change_expand])
        .unwrap();
    assert!(is_inc, "Should recommend incremental sync at/above 64 KiB");
    assert!(map
        .get("file:///sync.ts")
        .unwrap()
        .is_incremental_sync_recommended());

    // 3. Shrink document back below 64 KiB threshold
    let small_chunk = "const small = 1;\n";
    let change_shrink = TextDocumentContentChangeEvent {
        range: None,
        range_length: None,
        text: small_chunk.into(),
    };
    let is_inc_after = map
        .apply_changes("file:///sync.ts", 3, &[change_shrink])
        .unwrap();
    assert!(!is_inc_after, "Should recommend full sync below 64 KiB");
    assert!(!map
        .get("file:///sync.ts")
        .unwrap()
        .is_incremental_sync_recommended());
}

#[tokio::test]
async fn test_version_extension_staleness_fence() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-fence".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-fence",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    session
        .did_open(
            "file:///target.ts".into(),
            "typescript".into(),
            1,
            "let val = 1;".into(),
        )
        .await
        .expect("open");

    // Advance to version 2
    let change = TextDocumentContentChangeEvent {
        range: None,
        range_length: None,
        text: "let val = 2;".into(),
    };
    session
        .did_change("file:///target.ts".into(), 2, vec![change])
        .await
        .expect("change");

    // Send navigation request requesting stale version 1
    let nav_params = NavigationParams {
        text_document: TextDocumentIdentifier {
            uri: "file:///target.ts".into(),
        },
        position: Position {
            line: 0,
            character: 4,
        },
        dam_hopper_document_version: 1, // Stale! Current is 2
        dam_hopper_model_generation: None,
    };

    let result = session
        .navigation("textDocument/definition", nav_params)
        .await;
    assert!(
        result.is_err(),
        "Stale version request must be rejected immediately"
    );

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_concurrency_limits_admission() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn1 = ConnectionId("conn-1".into());
    let conn2 = ConnectionId("conn-2".into());
    let conn3 = ConnectionId("conn-3".into());
    let ep1 = supervisor.register_connection(&conn1).await;
    let ep2 = supervisor.register_connection(&conn2).await;
    let ep3 = supervisor.register_connection(&conn3).await;
    // 1. First tree (conn1) succeeds
    let _s1 = supervisor
        .get_or_create_session(
            conn1.clone(),
            "project-1",
            None,
            target_dir.path().to_path_buf(),
            ep1,
        )
        .await
        .expect("session 1");

    // 2. Second tree (conn2) succeeds
    let _s2 = supervisor
        .get_or_create_session(
            conn2,
            "project-1",
            None,
            target_dir.path().to_path_buf(),
            ep2,
        )
        .await
        .expect("session 2");

    // 3. Third tree globally (conn3) should exceed MAX_GLOBAL_SEMANTIC_TREES (2)
    let res3 = supervisor
        .get_or_create_session(
            conn3,
            "project-1",
            None,
            target_dir.path().to_path_buf(),
            ep3,
        )
        .await;
    assert!(matches!(
        res3,
        Err(SupervisorError::GlobalTreeLimitExceeded(2))
    ));

    // 4. Second tree for same connection (conn1) on different project should exceed MAX_TREES_PER_CONNECTION (1)
    let res_conn1_dup = supervisor
        .get_or_create_session(
            conn1,
            "project-2",
            None,
            target_dir.path().to_path_buf(),
            ep1,
        )
        .await;
    assert!(matches!(
        res_conn1_dup,
        Err(SupervisorError::ConnectionTreeLimitExceeded(1))
    ));

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_clean_shutdown_and_tree_reap() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-reap".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-reap",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    // Open file to trigger child spawn
    session
        .did_open(
            "file:///reap.ts".into(),
            "typescript".into(),
            1,
            "const a = 1;".into(),
        )
        .await
        .expect("open");

    assert_eq!(session.get_state().await, SemanticState::Ready);
    let pgid = session.get_pgid().await.expect("child PGID must exist");
    assert!(!dam_hopper_server::semantic::reaper::is_pgid_empty(pgid));

    // Shut down supervisor
    supervisor.shutdown().await;

    // Verify state transitioned and process group is completely reaped
    assert_eq!(session.get_state().await, SemanticState::Invalidated);
    assert!(dam_hopper_server::semantic::reaper::is_pgid_empty(pgid));
    let status = supervisor.get_aggregate_status().await;
    assert_eq!(status.active_sessions, 0);
    assert_eq!(status.active_trees, 0);
    assert_eq!(status.open_documents, 0);
    assert_eq!(status.total_overlay_bytes, 0);
}

#[tokio::test]
async fn test_multi_change_batch_integration() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-batch".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-batch",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    session
        .did_open(
            "file:///batch.ts".into(),
            "typescript".into(),
            1,
            "let x = 10; let y = 20;".into(),
        )
        .await
        .expect("open");

    let c1 = TextDocumentContentChangeEvent {
        range: Some(Range {
            start: Position {
                line: 0,
                character: 8,
            },
            end: Position {
                line: 0,
                character: 10,
            },
        }),
        range_length: Some(2),
        text: "99".into(),
    };
    let c2 = TextDocumentContentChangeEvent {
        range: Some(Range {
            start: Position {
                line: 0,
                character: 20,
            },
            end: Position {
                line: 0,
                character: 22,
            },
        }),
        range_length: Some(2),
        text: "88".into(),
    };

    session
        .did_change("file:///batch.ts".into(), 2, vec![c1, c2])
        .await
        .expect("multi change batch did_change");

    let (docs, bytes) = session.get_overlay_stats().await;
    assert_eq!(docs, 1);
    assert!(bytes > 0);

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_child_crash_and_automatic_restart_with_replay() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-crash".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-crash",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    session
        .did_open(
            "file:///crash.ts".into(),
            "typescript".into(),
            1,
            "const preserveMe = true;".into(),
        )
        .await
        .expect("open");

    assert_eq!(session.get_state().await, SemanticState::Ready);
    let pgid = session.get_pgid().await.expect("child PGID must exist");
    assert!(!dam_hopper_server::semantic::reaper::is_pgid_empty(pgid));

    // Send SIGKILL to crash the child process group
    let _ = dam_hopper_server::semantic::reaper::signal_pgid(
        pgid,
        Some(nix::sys::signal::Signal::SIGKILL),
    );

    // Await restart backoff (RESTART_BACKOFF_STAGE1 is 1s)
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

    // Verify session automatically recovered and open document was replayed
    assert_eq!(session.get_state().await, SemanticState::Ready);
    let new_pgid = session.get_pgid().await.expect("new child PGID must exist");
    assert_ne!(
        pgid, new_pgid,
        "A new child process group must be spawned on restart"
    );
    let (docs, bytes) = session.get_overlay_stats().await;
    assert_eq!(docs, 1);
    assert!(bytes > 0);

    supervisor.shutdown().await;
    assert!(dam_hopper_server::semantic::reaper::is_pgid_empty(new_pgid));
}

#[tokio::test]
async fn test_drop_handles_triggers_actor_exit_and_reap() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-drop".into());
    let ep = supervisor.register_connection(&conn).await;
    let key = SessionKey::new(conn.clone(), "project-drop", None);

    let session = supervisor
        .get_or_create_session(
            conn,
            "project-drop",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    session
        .did_open(
            "file:///drop.ts".into(),
            "typescript".into(),
            1,
            "const dropTest = true;".into(),
        )
        .await
        .expect("open");

    let pgid = session.get_pgid().await.expect("child PGID");
    assert!(!dam_hopper_server::semantic::reaper::is_pgid_empty(pgid));

    // Drop caller handle and remove from supervisor without explicit shutdown
    drop(session);
    supervisor.close_session(&key).await;

    // Await reap
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    assert!(dam_hopper_server::semantic::reaper::is_pgid_empty(pgid));
}

#[tokio::test]
async fn test_invalidated_connection_rejects_admission_and_spawns_zero_children() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-invalidated".into());

    // Register connection then invalidate it immediately
    let ep = supervisor.register_connection(&conn).await;
    supervisor.invalidate_connection(&conn).await;

    // Attempt admission on invalidated connection must be rejected
    let res = supervisor
        .get_or_create_session(conn, "project-1", None, target_dir.path().to_path_buf(), ep)
        .await;
    assert!(matches!(
        res,
        Err(SupervisorError::Session(
            dam_hopper_server::semantic::session::SessionError::Invalidated
        ))
    ));

    let status = supervisor.get_aggregate_status().await;
    assert_eq!(
        status.active_sessions, 0,
        "Zero sessions must exist after invalidated admission"
    );
}

#[tokio::test]
async fn test_tombstoned_connection_cannot_be_resurrected_by_register() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-tombstone".into());

    let ep = supervisor.register_connection(&conn).await;
    supervisor.invalidate_connection(&conn).await;

    // Subsequent register must not revive tombstone
    let ep2 = supervisor.register_connection(&conn).await;
    assert_eq!(ep2, 0);

    let res = supervisor
        .get_or_create_session(conn, "project-1", None, target_dir.path().to_path_buf(), ep)
        .await;
    assert!(matches!(
        res,
        Err(SupervisorError::Session(
            dam_hopper_server::semantic::session::SessionError::Invalidated
        ))
    ));
}

#[tokio::test]
async fn test_epoch_mismatch_rejects_admission() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-mismatch".into());

    let ep = supervisor.register_connection(&conn).await;
    // Pass stale epoch (ep + 999)
    let res = supervisor
        .get_or_create_session(
            conn,
            "project-1",
            None,
            target_dir.path().to_path_buf(),
            ep + 999,
        )
        .await;
    assert!(matches!(
        res,
        Err(SupervisorError::Session(
            dam_hopper_server::semantic::session::SessionError::Invalidated
        ))
    ));
}
#[tokio::test]
async fn test_two_phase_invalidation_prepare_and_reap() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-two-phase".into());
    let ep = supervisor.register_connection(&conn).await;

    let handle = supervisor
        .get_or_create_session(
            conn.clone(),
            "project-1",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("session created");

    assert_eq!(supervisor.get_aggregate_status().await.active_sessions, 1);

    // Phase 1: prepare_invalidate_all synchronously detaches sessions
    let detached = supervisor.prepare_invalidate_all().await;
    assert_eq!(detached.len(), 1);
    assert_eq!(supervisor.get_aggregate_status().await.active_sessions, 0);

    // Immediately, new admissions with old epoch fail
    let res = supervisor
        .get_or_create_session(
            conn.clone(),
            "project-1",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await;
    assert!(res.is_err());

    // Phase 2: reap detached sessions outside the lock
    supervisor.reap_sessions(detached).await;
    assert_eq!(handle.get_state().await, SemanticState::Invalidated);
}

#[tokio::test]
async fn test_scoped_project_invalidation_preserves_other_projects() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir_a = tempfile::tempdir().unwrap();
    let target_dir_b = tempfile::tempdir().unwrap();
    let conn_a = ConnectionId("conn-scoped-a".into());
    let ep_a = supervisor.register_connection(&conn_a).await;
    let conn_b = ConnectionId("conn-scoped-b".into());
    let ep_b = supervisor.register_connection(&conn_b).await;

    let handle_a = supervisor
        .get_or_create_session(
            conn_a,
            "project-a",
            None,
            target_dir_a.path().to_path_buf(),
            ep_a,
        )
        .await
        .expect("session a created");

    let handle_b = supervisor
        .get_or_create_session(
            conn_b,
            "project-b",
            None,
            target_dir_b.path().to_path_buf(),
            ep_b,
        )
        .await
        .expect("session b created");
    assert_eq!(supervisor.get_aggregate_status().await.active_sessions, 2);

    // Invalidate project-a only
    supervisor.invalidate_project("project-a").await;

    // Project-a session is reaped; project-b session remains alive
    assert_eq!(handle_a.get_state().await, SemanticState::Invalidated);
    assert_ne!(handle_b.get_state().await, SemanticState::Invalidated);
    assert_eq!(supervisor.get_aggregate_status().await.active_sessions, 1);

    // Cleanup
    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_admission_revocation_during_shutdown_blocks_new_registrations() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    assert!(!supervisor.is_admission_revoked());
    assert!(supervisor.is_effective_enabled());

    // Signal shutdown: revoke admission immediately
    supervisor.revoke_admission();
    assert!(supervisor.is_admission_revoked());
    assert!(!supervisor.is_effective_enabled());

    // Any attempt to register returns 0 and is tombstoned
    let conn = ConnectionId("conn-shutdown-attempt".into());
    let ep = supervisor.register_connection(&conn).await;
    assert_eq!(ep, 0);

    let target_dir = tempfile::tempdir().unwrap();
    let res = supervisor
        .get_or_create_session(
            conn,
            "project-1",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await;
    assert!(matches!(res, Err(SupervisorError::Disabled)));
}
