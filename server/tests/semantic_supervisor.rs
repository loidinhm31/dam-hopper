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
use dam_hopper_server::semantic::session::SessionError;
use dam_hopper_server::semantic::supervisor::{SemanticSupervisor, SupervisorError};
use dam_hopper_server::semantic::tool_profile::{
    compute_file_sha256, PinnedDigests, SemanticToolProfile, ToolIntegrityStatus,
};

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
        Self::with_mode(None)
    }

    fn with_mode(mode: Option<&str>) -> Self {
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

        // Stage actual ELF Node binary directly (zero /bin/sh wrapper or PATH lookup)
        let real_node = resolve_node_bin();
        let node_path = engine_dir.join("node");
        fs::copy(&real_node, &node_path).expect("copy isolated real node binary");
        fs::set_permissions(&node_path, fs::Permissions::from_mode(0o755)).expect("set node 0755");

        // Copy lsp-test-server.mjs as cli.mjs (injecting default mode if requested)
        let fixture_path = fixture_server_script();
        let cli_path = tsls_pkg_dir.join("cli.mjs");
        if let Some(m) = mode {
            let raw = fs::read_to_string(&fixture_path).expect("read fixture");
            let patched = raw.replacen("let mode = \"echo\";", &format!("let mode = \"{m}\";"), 1);
            fs::write(&cli_path, patched).expect("write patched cli.mjs");
        } else {
            fs::copy(&fixture_path, &cli_path).expect("copy cli.mjs");
        }
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
        .get_or_create_session(conn, "project-1", None, target_dir.path().to_path_buf(), ep)
        .await;
    assert!(matches!(res, Err(SupervisorError::Disabled)));
}

#[tokio::test]
async fn test_retained_handle_and_inflight_navigation_fenced_immediately_on_prepare_c2() {
    use dam_hopper_server::semantic::session::SessionError;

    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-c2-fence".into());
    let ep = supervisor.register_connection(&conn).await;
    let retained_handle = supervisor
        .get_or_create_session(
            conn.clone(),
            "project-c2",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    // Open document with 400ms simulated navigation response delay
    retained_handle
        .did_open(
            "file:///delayed.ts".into(),
            "typescript".into(),
            1,
            "const slow = '__DELAY_MS_400__';".into(),
        )
        .await
        .expect("did_open");

    let nav_params = NavigationParams {
        text_document: TextDocumentIdentifier {
            uri: "file:///delayed.ts".into(),
        },
        position: Position {
            line: 0,
            character: 6,
        },
        dam_hopper_document_version: 1,
        dam_hopper_model_generation: Some(1),
    };

    // Submit in-flight navigation request before prepare_invalidate_project
    let inflight_rx = retained_handle
        .submit_navigation(
            serde_json::json!(77),
            "textDocument/definition",
            nav_params.clone(),
        )
        .await
        .expect("submit_navigation");

    // Phase 1 ONLY (prepare_invalidate_project): do NOT call reap_sessions yet
    let start = std::time::Instant::now();
    let detached = supervisor.prepare_invalidate_project("project-c2").await;
    assert!(
        start.elapsed() < std::time::Duration::from_millis(100),
        "prepare_invalidate_project must detach synchronously without waiting on child"
    );
    assert_eq!(detached.len(), 1);
    assert!(
        retained_handle.is_revoked(),
        "Retained handle token must be synchronously revoked upon prepare return"
    );

    // 1. In-flight navigation completion must resolve immediately to Err(SessionError::Invalidated),
    //    never surviving prepare or waiting 400ms for child response
    let inflight_res = tokio::time::timeout(std::time::Duration::from_millis(80), inflight_rx)
        .await
        .expect("in-flight receiver must resolve immediately upon token revocation")
        .expect("oneshot channel must not drop without error");
    assert!(
        matches!(inflight_res, Err(SessionError::Invalidated)),
        "In-flight navigation must be fenced with Invalidated, got: {:?}",
        inflight_res
    );

    // 2. Any new command on the retained handle before Phase 2 reap must be rejected immediately
    assert!(matches!(
        retained_handle
            .did_open("file:///new.ts".into(), "typescript".into(), 1, "x".into())
            .await,
        Err(SessionError::Invalidated)
    ));
    assert!(matches!(
        retained_handle
            .navigation("textDocument/definition", nav_params)
            .await,
        Err(SessionError::Invalidated)
    ));
    assert!(matches!(
        retained_handle
            .get_overlay_snapshot("file:///delayed.ts")
            .await,
        Err(SessionError::Invalidated)
    ));

    // 3. Replacement session on the same connection is blocked while the retiring child tree is still unreaped
    let replacement_before_reap = supervisor
        .get_or_create_session(
            conn.clone(),
            "project-c2",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await;
    assert!(
        matches!(
            replacement_before_reap,
            Err(SupervisorError::ConnectionTreeLimitExceeded(1))
        ),
        "Retiring session must retain concurrency accounting until physical reap completes"
    );

    // Phase 2: Reap detached session and verify replacement admission succeeds afterward
    let pgid = retained_handle.get_pgid().await.expect("pgid before reap");
    supervisor.reap_sessions(detached).await;
    assert!(dam_hopper_server::semantic::reaper::is_pgid_empty(pgid));

    let replacement_after_reap = supervisor
        .get_or_create_session(
            conn,
            "project-c2",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("replacement session must succeed after reap completes");
    assert!(!replacement_after_reap.is_revoked());

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_prepare_invalidate_during_child_crash_and_restart_backoff_prevents_restart_r3() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-r3-no-restart".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-r3",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    session
        .did_open(
            "file:///r3.ts".into(),
            "typescript".into(),
            1,
            "const a = 1;".into(),
        )
        .await
        .expect("did_open");

    let pgid = session.get_pgid().await.expect("initial child pgid");
    assert!(!dam_hopper_server::semantic::reaper::is_pgid_empty(pgid));

    // Phase 1: Invalidate target first
    let detached = supervisor
        .prepare_invalidate_target("project-r3", None)
        .await;
    assert_eq!(detached.len(), 1);
    assert!(session.is_revoked());

    // Simulate terminal child exit occurring DURING the prepare/reap gap before Phase 2 reap
    let _ = dam_hopper_server::semantic::reaper::signal_pgid(
        pgid,
        Some(nix::sys::signal::Signal::SIGKILL),
    );

    // Wait past RESTART_BACKOFF_STAGE1 (1s) to verify invalidated actor NEVER restarts child
    tokio::time::sleep(std::time::Duration::from_millis(1300)).await;

    assert_eq!(session.get_state().await, SemanticState::Invalidated);
    assert!(
        session.get_pgid().await.is_none()
            || dam_hopper_server::semantic::reaper::is_pgid_empty(pgid),
        "Invalidated actor must never spawn a replacement child after crash exit"
    );

    // Phase 2: Reap completes cleanly
    supervisor.reap_sessions(detached).await;
    assert!(session.is_cleanly_reaped());
    assert!(dam_hopper_server::semantic::reaper::is_pgid_empty(pgid));

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_prepare_invalidate_during_slow_startup_cancels_initialize_and_reaps_descendants() {
    use dam_hopper_server::semantic::session::SessionError;

    let toolchain = TestToolchain::with_mode(Some("slow-init"));
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-slow-init".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-slow-init",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    // Start did_open in background; it will block in do_initialize() because slow-init delays 5s
    let session_for_open = session.clone();
    let open_task = tokio::spawn(async move {
        session_for_open
            .did_open(
                "file:///init.ts".into(),
                "typescript".into(),
                1,
                "const init = 1;".into(),
            )
            .await
    });

    // Fresh pre-spawn integrity verification is legitimate startup work, not
    // proof that initialize reached the fixture. In slow-init mode the helper
    // is spawned only after initialize arrives, before its delayed response.
    let (pgid, descendants) = tokio::time::timeout(std::time::Duration::from_secs(15), async {
        loop {
            assert!(
                !open_task.is_finished(),
                "did_open completed before slow-initialize overlap was established"
            );
            if let Some(pgid) = session.current_pgid_cached() {
                let descendants: Vec<_> =
                    dam_hopper_server::semantic::reaper::get_all_descendants(pgid)
                        .into_iter()
                        .filter(|pid| {
                            dam_hopper_server::semantic::reaper::read_proc_rss_bytes(*pid).is_some()
                        })
                        .collect();
                if !descendants.is_empty()
                    && dam_hopper_server::semantic::reaper::read_proc_rss_bytes(pgid).is_some()
                {
                    break (pgid, descendants);
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .expect(
        "slow initialize must expose a live child PGID and helper within startup readiness budget",
    );
    assert!(
        !open_task.is_finished(),
        "did_open must still be pending when startup revocation begins"
    );

    // Phase 1: prepare_invalidate_all while actor is mid-initialize
    let prep_start = std::time::Instant::now();
    let detached = supervisor.prepare_invalidate_all().await;
    assert!(
        prep_start.elapsed() < std::time::Duration::from_millis(100),
        "prepare_invalidate_all must not block on slow child startup"
    );

    // The blocked did_open caller must immediately resolve with Err(SessionError::Invalidated)
    let open_res = tokio::time::timeout(std::time::Duration::from_millis(100), open_task)
        .await
        .expect("did_open must abort immediately on revocation")
        .expect("join open_task");
    assert!(matches!(open_res, Err(SessionError::Invalidated)));

    // Phase 2: reap_sessions must not return until both child and its descendant are dead
    supervisor.reap_sessions(detached).await;
    assert!(
        dam_hopper_server::semantic::reaper::is_pgid_empty(pgid),
        "PGID must be completely empty before reap_sessions returns"
    );
    assert!(
        dam_hopper_server::semantic::reaper::verify_pids_dead(&descendants),
        "All startup descendants must be dead before reap_sessions returns"
    );
}

#[tokio::test]
async fn test_prepare_enable_blocks_on_retiring_resources_and_recovers_after_reap() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-reenable".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-reenable",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    session
        .did_open(
            "file:///active.ts".into(),
            "typescript".into(),
            1,
            "const x = 1;".into(),
        )
        .await
        .expect("did_open");

    let pgid = session.get_pgid().await.expect("pgid");
    let detached = supervisor.prepare_invalidate_all().await;
    assert!(supervisor.has_unclean_or_retiring_resources());

    // While child tree is retiring (unreaped), prepare_enable must refuse
    let enable_while_retiring = supervisor.prepare_enable().await;
    assert!(
        matches!(enable_while_retiring, Err(SupervisorError::Shutdown(_))),
        "prepare_enable must reject while retiring child resources remain"
    );

    // Complete physical reap
    supervisor.reap_sessions(detached).await;
    assert!(dam_hopper_server::semantic::reaper::is_pgid_empty(pgid));
    assert!(!supervisor.has_unclean_or_retiring_resources());

    // Simulate persistence failure after clean reap (safe_disabled = true, 0 unclean resources)
    supervisor
        .record_disable_failure("CONFIG_PERSIST_FAILED".into())
        .await;
    assert!(supervisor.is_safe_disabled());

    // Explicit admin recovery via prepare_enable + commit_enable must succeed now that resources are clean
    supervisor.prepare_enable().await.expect(
        "prepare_enable must allow explicit admin recovery when 0 unclean resources remain",
    );
    supervisor.commit_enable().await;
    assert!(!supervisor.is_safe_disabled());
    assert!(supervisor.is_effective_enabled());
    assert_eq!(supervisor.last_transition_error().await, None);

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_g5_overlay_snapshot_and_submit_pinned_navigation_fifo_semantics() {
    use dam_hopper_server::semantic::session::SessionError;

    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let expected_tsserver_path = profile.tsserver_path().to_string_lossy().into_owned();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-g5".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-g5",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    let src_text = "import { helper } from './unopened';\nhelper();";
    session
        .did_open(
            "file:///main.ts".into(),
            "typescript".into(),
            3,
            src_text.into(),
        )
        .await
        .expect("open main.ts");

    // 1. Verify get_overlay_snapshot returns exact text, version, incarnation, and SHA-256 digest
    let snap = session
        .get_overlay_snapshot("file:///main.ts")
        .await
        .expect("get_overlay_snapshot")
        .expect("main.ts must be in overlays");
    assert_eq!(snap.uri, "file:///main.ts");
    assert_eq!(snap.version, 3);
    assert_eq!(snap.text, src_text);
    assert_eq!(snap.content_sha256.len(), 64);

    assert!(session
        .get_overlay_snapshot("file:///unopened.ts")
        .await
        .expect("snapshot unopened")
        .is_none());

    // 2. Verify submit_pinned_navigation opens pinned file on child stdin before request and closes after
    let nav_params = NavigationParams {
        text_document: TextDocumentIdentifier {
            uri: "file:///main.ts".into(),
        },
        position: Position {
            line: 1,
            character: 0,
        },
        dam_hopper_document_version: 3,
        dam_hopper_model_generation: Some(1),
    };
    let pinned_files = vec![(
        "file:///unopened.ts".to_string(),
        "typescript".to_string(),
        "export function helper() { return 42; }".to_string(),
    )];
    let rx = session
        .submit_pinned_navigation(
            serde_json::json!(501),
            "textDocument/definition",
            nav_params.clone(),
            pinned_files,
        )
        .await
        .expect("submit_pinned_navigation");
    let resp = rx.await.expect("oneshot").expect("navigation response");

    // Verify child saw both main.ts and pinned unopened.ts during the definition request
    let child_open_docs = resp["result"]["openDocs"]
        .as_array()
        .expect("openDocs array from fixture");
    assert!(
        child_open_docs
            .iter()
            .any(|d| d["uri"] == "file:///unopened.ts"),
        "Child must have had pinned file open during definition evaluation"
    );
    // Verify initializationOptions.tsserver.path was passed during initialize
    assert_eq!(
        resp["result"]["initializationOptions"]["tsserver"]["path"].as_str(),
        Some(expected_tsserver_path.as_str())
    );
    assert_eq!(
        resp["result"]["initializationOptions"]["disableAutomaticTypingAcquisition"],
        serde_json::json!(true)
    );
    assert_eq!(
        resp["result"]["initializationOptions"]["plugins"],
        serde_json::json!([])
    );

    // Verify Rust overlay map was NOT polluted by the temporary pinned file
    let (doc_count, _) = session.get_overlay_stats().await;
    assert_eq!(
        doc_count, 1,
        "Pinned file must not remain in session overlays"
    );

    // Verify temp pin lease was released after completion (1 user overlay remains)
    let (doc_count, _) = session.get_overlay_stats().await;
    assert_eq!(
        doc_count, 1,
        "Released temp pin must not remain in session overlays"
    );
    assert_eq!(
        resp["_damHopperProvenSnapshots"]["file:///unopened.ts"]["version"],
        serde_json::json!(0)
    );

    // 3. If a pinned file URI is already open in user overlays, submit_pinned_navigation
    //    atomically selects the authoritative user overlay (version 3, open_incarnation 1)
    //    without overwriting it with stale disk_text!
    let rx_overlay_wins = session
        .submit_pinned_navigation(
            serde_json::json!(502),
            "textDocument/definition",
            nav_params.clone(),
            vec![(
                "file:///main.ts".to_string(),
                "typescript".to_string(),
                "stale disk text that must not overwrite user overlay".to_string(),
            )],
        )
        .await
        .expect("submit");
    let overlay_wins_resp = rx_overlay_wins
        .await
        .expect("oneshot")
        .expect("authoritative user overlay must be selected");
    assert_eq!(
        overlay_wins_resp["_damHopperProvenSnapshots"]["file:///main.ts"]["version"],
        serde_json::json!(3)
    );
    assert_eq!(
        overlay_wins_resp["_damHopperProvenSnapshots"]["file:///main.ts"]["text"],
        serde_json::json!(src_text)
    );

    // 4. Stale source open_incarnation in submit_pinned_navigation must be rejected with StaleDocumentVersion
    let mut stale_inc_params = nav_params;
    stale_inc_params.dam_hopper_model_generation = Some(999);
    let rx_stale_inc = session
        .submit_pinned_navigation(
            serde_json::json!(503),
            "textDocument/definition",
            stale_inc_params,
            vec![(
                "file:///unopened.ts".to_string(),
                "typescript".to_string(),
                "export function helper() { return 42; }".to_string(),
            )],
        )
        .await
        .expect("submit");
    let stale_inc_res = rx_stale_inc.await.expect("oneshot");
    assert!(matches!(
        stale_inc_res,
        Err(SessionError::StaleDocumentVersion { .. })
    ));

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_queue_saturated_prepare_invalidate_detaches_without_blocking() {
    use dam_hopper_server::semantic::session::SessionError;

    let toolchain = TestToolchain::with_mode(Some("slow-init"));
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-queue-sat".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-queue-sat",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    // Spawn 40 concurrent commands (> 32 mailbox capacity) while actor is occupied in slow-init
    let mut waiters = Vec::with_capacity(40);
    for i in 0..40 {
        let h = session.clone();
        waiters.push(tokio::spawn(async move {
            h.did_open(
                format!("file:///doc_{i}.ts"),
                "typescript".into(),
                1,
                "const x = 1;".into(),
            )
            .await
        }));
    }

    tokio::time::sleep(std::time::Duration::from_millis(80)).await;

    // Phase 1: prepare_invalidate_all must complete immediately even though actor cmd_tx is full
    let start = std::time::Instant::now();
    let detached = supervisor.prepare_invalidate_all().await;
    assert!(
        start.elapsed() < std::time::Duration::from_millis(100),
        "prepare_invalidate_all must not await saturated actor mailbox"
    );
    assert_eq!(detached.len(), 1);
    assert!(session.is_revoked());

    // All 40 saturated callers must unblock immediately with Err(SessionError::Invalidated)
    for w in waiters {
        let res = tokio::time::timeout(std::time::Duration::from_millis(150), w)
            .await
            .expect("saturated caller must unblock on revocation")
            .expect("join waiter");
        assert!(matches!(res, Err(SessionError::Invalidated)));
    }

    supervisor.reap_sessions(detached).await;
    assert!(session.is_cleanly_reaped());
    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_prepare_disable_cancellation_safety_completes_reap_in_background() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-cancel-disable".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-cancel-disable",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    session
        .did_open(
            "file:///cancel.ts".into(),
            "typescript".into(),
            1,
            "const c = 1;".into(),
        )
        .await
        .expect("did_open");

    let pgid = session.get_pgid().await.expect("pgid");
    assert!(!dam_hopper_server::semantic::reaper::is_pgid_empty(pgid));

    // Drop prepare_disable future immediately after revocation/detachment
    let _ = tokio::time::timeout(
        std::time::Duration::from_nanos(1),
        supervisor.prepare_disable(),
    )
    .await;

    assert!(!supervisor.is_enabled());
    assert!(session.is_revoked());

    // Background tracked reap task must still finish reaping the child PGID
    assert!(
        dam_hopper_server::semantic::reaper::verify_pgid_reaped(
            pgid,
            std::time::Duration::from_secs(4)
        )
        .await,
        "Dropped prepare_disable future must still complete child tree reap in background"
    );

    // Subsequent retry of prepare_disable must observe clean completion
    supervisor
        .prepare_disable()
        .await
        .expect("retry prepare_disable must succeed after background reap");
    supervisor.commit_disable().await;
    assert!(!supervisor.has_unclean_or_retiring_resources());

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_diagnostic_status_queries_are_cheap_cached_reads_without_hashing() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));

    // 1. Prior to first verification: explicit Unverified
    assert_eq!(
        supervisor.tool_integrity_status(),
        Some(ToolIntegrityStatus::Unverified)
    );
    let agg = supervisor.get_aggregate_status().await;
    assert_eq!(agg.tool_integrity_status, Some("Unverified".to_string()));

    // 2. Deterministic proof of zero verification: acquire verifier semaphore permit
    // Diagnostic queries must complete immediately without blocking on the semaphore.
    {
        let sem = supervisor.verifier_semaphore().expect("verifier semaphore");
        let _permit = sem.clone().acquire_owned().await.unwrap();
        assert_eq!(sem.available_permits(), 0);

        // Even with 0 available permits on the verifier, diagnostic queries return immediately
        assert_eq!(
            supervisor.tool_integrity_status(),
            Some(ToolIntegrityStatus::Unverified)
        );
        let agg = supervisor.get_aggregate_status().await;
        assert_eq!(agg.tool_integrity_status, Some("Unverified".to_string()));
    }

    // 3. Perform fresh verification via prepare_enable
    supervisor
        .prepare_enable()
        .await
        .expect("prepare_enable must verify intact toolchain");
    supervisor.commit_enable().await;

    // 4. Cached status is now Valid
    assert_eq!(
        supervisor.tool_integrity_status(),
        Some(ToolIntegrityStatus::Valid)
    );
    let agg_valid = supervisor.get_aggregate_status().await;
    assert_eq!(agg_valid.tool_integrity_status, Some("Valid".to_string()));

    // 5. Repeated queries after Valid remain cheap and complete even while permit is held
    {
        let sem = supervisor.verifier_semaphore().expect("verifier semaphore");
        let _permit = sem.clone().acquire_owned().await.unwrap();
        assert_eq!(sem.available_permits(), 0);

        assert_eq!(
            supervisor.tool_integrity_status(),
            Some(ToolIntegrityStatus::Valid)
        );
        let agg = supervisor.get_aggregate_status().await;
        assert_eq!(agg.tool_integrity_status, Some("Valid".to_string()));
    }

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_tamper_after_valid_check_fails_fresh_verification_and_publishes_failure() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));

    // Verify initially valid
    supervisor
        .prepare_enable()
        .await
        .expect("initial verification passes");
    supervisor.commit_enable().await;
    assert_eq!(
        supervisor.tool_integrity_status(),
        Some(ToolIntegrityStatus::Valid)
    );

    // Tamper with toolchain file on disk (corrupt package.json)
    let pkg_json_path = toolchain.root.join("lib/semantic-engine/tsls/package.json");
    std::fs::write(&pkg_json_path, b"{\"tampered\": true}").expect("tamper file");

    // Diagnostics STILL returns cached Valid (diagnostics does not perform hashing)
    assert_eq!(
        supervisor.tool_integrity_status(),
        Some(ToolIntegrityStatus::Valid),
        "Diagnostic status must return cached result without performing fresh I/O"
    );

    // Cached valid NEVER authorizes: fresh prepare_enable MUST fail closed
    let enable_tampered = supervisor.prepare_enable().await;
    assert!(
        enable_tampered.is_err(),
        "prepare_enable must perform fresh verification and reject tampered toolchain"
    );

    // Failure status MUST be published to diagnostics cache
    let failed_status = supervisor.tool_integrity_status();
    assert!(
        matches!(
            failed_status,
            Some(ToolIntegrityStatus::DigestMismatch { .. })
        ),
        "Diagnostics must publish failure status after fresh verification failed, got {:?}",
        failed_status
    );

    // Launch MUST also fail closed on fresh verification
    let conn = ConnectionId("conn-tamper".into());
    let ep = supervisor.register_connection(&conn).await;
    let launch_res = supervisor
        .get_or_create_session(conn, "project-tamper", None, toolchain.root.clone(), ep)
        .await;
    assert!(
        launch_res.is_err(),
        "get_or_create_session must perform fresh verification and reject launch on tampered toolchain"
    );

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_revocation_during_verification_fence_prevents_late_enable_and_launch() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));

    // 1. Hold verifier permit to pause verification before execution
    let sem = supervisor.verifier_semaphore().expect("verifier semaphore");
    let permit = sem.clone().acquire_owned().await.unwrap();
    assert_eq!(sem.available_permits(), 0);

    // Spawn prepare_enable which will block waiting for the verifier permit
    let sup_clone = supervisor.clone();
    let enable_task = tokio::spawn(async move { sup_clone.prepare_enable().await });

    // Yield to ensure task is awaiting permit
    tokio::task::yield_now().await;

    // Revoke admission while verification is blocked waiting
    supervisor.revoke_admission();
    assert!(supervisor.is_admission_revoked());

    // Release permit to allow verification to proceed
    drop(permit);

    // prepare_enable must reject because admission was revoked during/before verification
    let enable_res = enable_task.await.expect("task join");
    assert!(
        enable_res.is_err(),
        "prepare_enable must reject when admission is revoked during verification"
    );

    // commit_enable must NOT enable when admission is revoked
    supervisor.commit_enable().await;
    assert!(!supervisor.is_effective_enabled());

    // 2. Test launch fence under revocation
    let supervisor2 = SemanticSupervisor::new(Some(toolchain.tool_profile()));
    supervisor2
        .prepare_enable()
        .await
        .expect("prepare_enable succeeds");
    supervisor2.commit_enable().await;
    assert!(supervisor2.is_effective_enabled());

    let conn = ConnectionId("conn-revoked".into());
    let ep = supervisor2.register_connection(&conn).await;

    // Hold verifier permit for launch
    let sem2 = supervisor2
        .verifier_semaphore()
        .expect("verifier semaphore");
    let permit2 = sem2.clone().acquire_owned().await.unwrap();

    let sup2_clone = supervisor2.clone();
    let root2 = toolchain.root.clone();
    let conn_clone = conn.clone();
    let launch_task = tokio::spawn(async move {
        sup2_clone
            .get_or_create_session(conn_clone, "proj-fence", None, root2, ep)
            .await
    });

    tokio::task::yield_now().await;
    supervisor2.revoke_admission();
    drop(permit2);

    let launch_res = launch_task.await.expect("launch join");
    assert!(
        matches!(launch_res, Err(SupervisorError::Disabled)),
        "get_or_create_session must reject when admission is revoked during verification"
    );

    supervisor.shutdown().await;
    supervisor2.shutdown().await;
}

#[tokio::test]
async fn test_bounded_verifier_permit_held_across_cancellation() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));

    let sem = supervisor.verifier_semaphore().expect("verifier semaphore");
    let permit = sem.clone().acquire_owned().await.unwrap();
    assert_eq!(sem.available_permits(), 0);

    // Spawn a second verification waiter
    let sup_clone = supervisor.clone();
    let waiter = tokio::spawn(async move { sup_clone.verify_toolchain_fresh().await });

    // Yield to let waiter block on the semaphore
    tokio::task::yield_now().await;

    // Cancel/abort the waiting task before permit is released
    waiter.abort();
    let _ = waiter.await;

    // Release the permit
    drop(permit);

    // Semaphore must return to 1 available permit and subsequent call must succeed cleanly
    assert_eq!(sem.available_permits(), 1);
    let status = supervisor
        .verify_toolchain_fresh()
        .await
        .expect("subsequent verification must acquire permit and succeed");
    assert_eq!(status, ToolIntegrityStatus::Valid);

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_lazy_start_fails_fresh_verification_when_toolchain_tampered_after_acquisition() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let conn = ConnectionId("conn-lazy-tamper".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-lazy-tamper",
            None,
            toolchain.root.clone(),
            ep,
        )
        .await
        .expect("create session before child spawn");

    // Tamper with toolchain on disk AFTER session acquisition but BEFORE lazy child spawn
    let pkg_json_path = toolchain.root.join("lib/semantic-engine/tsls/package.json");
    std::fs::write(&pkg_json_path, b"{\"tampered\": true}").expect("tamper file");

    // did_open triggers lazy child spawn via do_initialize()
    let open_res = session
        .did_open(
            "file:///active.ts".into(),
            "typescript".into(),
            1,
            "const x = 1;".into(),
        )
        .await;

    assert!(
        open_res.is_err(),
        "did_open lazy spawn must fail fresh verification on tampered toolchain"
    );

    // State must be Crashed and diagnostics must report published failure
    let state = session.get_state().await;
    assert_eq!(state, SemanticState::Crashed);
    assert!(
        matches!(
            supervisor.tool_integrity_status(),
            Some(ToolIntegrityStatus::DigestMismatch { .. })
        ),
        "Diagnostics must publish failure status after lazy spawn verification failed"
    );

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_restart_fails_fresh_verification_when_toolchain_tampered() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let conn = ConnectionId("conn-restart-tamper".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-restart-tamper",
            None,
            toolchain.root.clone(),
            ep,
        )
        .await
        .expect("create session");

    // Open document to spawn initial child process
    session
        .did_open(
            "file:///active.ts".into(),
            "typescript".into(),
            1,
            "const x = 1;".into(),
        )
        .await
        .expect("did_open initial child");

    let pgid = session.get_pgid().await.expect("pgid");
    assert!(!dam_hopper_server::semantic::reaper::is_pgid_empty(pgid));

    // Tamper with toolchain on disk before child restarts
    let pkg_json_path = toolchain.root.join("lib/semantic-engine/tsls/package.json");
    std::fs::write(&pkg_json_path, b"{\"tampered\": true}").expect("tamper file");

    // Kill child process with SIGKILL to force crash restart
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    assert!(
        kill(Pid::from_raw(pgid as i32), Signal::SIGKILL).is_ok(),
        "SIGKILL to child must succeed"
    );

    // Poll session state until it detects exit and fails restart verification
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    let mut final_state = session.get_state().await;
    while std::time::Instant::now() < deadline {
        final_state = session.get_state().await;
        if final_state == SemanticState::Crashed {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    assert_eq!(
        final_state,
        SemanticState::Crashed,
        "Session must transition to Crashed after tampered restart fails verification"
    );

    // Diagnostic failure must be published via shared ToolchainVerifier
    assert!(
        matches!(
            supervisor.tool_integrity_status(),
            Some(ToolIntegrityStatus::DigestMismatch { .. })
        ),
        "Restart failure must publish failure status to diagnostics"
    );

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_diagnostics_delayed_response_saturation_and_cancellation() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));

    supervisor
        .prepare_enable()
        .await
        .expect("prepare_enable must succeed");
    supervisor.commit_enable().await;

    let conn_id = ConnectionId("conn-sat-1".into());
    let epoch = supervisor.register_connection(&conn_id).await;
    let handle = supervisor
        .get_or_create_session(conn_id, "saturation", None, toolchain.root.clone(), epoch)
        .await
        .expect("create session");

    let barrier_file = toolchain.root.join("sat_barrier.txt");
    let uri = "file:///sat_document.ts".to_string();
    let text = format!(
        "export const val = 42; // __BARRIER_FILE__:{}",
        barrier_file.display()
    );

    handle
        .did_open(uri.clone(), "typescript".to_string(), 1, text.clone())
        .await
        .expect("did_open");

    let diag0 = handle.diagnostics();
    assert_eq!(diag0.open_documents, 1);
    assert_eq!(diag0.peak_open_documents, 1);
    assert_eq!(diag0.overlay_bytes, text.len());
    assert_eq!(diag0.peak_overlay_bytes, text.len());
    assert_eq!(diag0.in_flight_requests, 0);
    assert_eq!(diag0.peak_in_flight_requests, 0);
    assert_eq!(diag0.spawn_attempts, 1);
    assert_eq!(diag0.successful_spawns, 1);

    // 1. Submit 8 requests and verify they are all acknowledged and held in-flight
    let mut receivers = Vec::new();
    for i in 1..=8 {
        let params = NavigationParams {
            text_document: TextDocumentIdentifier { uri: uri.clone() },
            position: Position {
                line: 0,
                character: 15,
            },
            dam_hopper_model_generation: None,
            dam_hopper_document_version: 1,
        };
        let rx = handle
            .submit_navigation(
                serde_json::Value::from(i),
                "textDocument/definition",
                params,
            )
            .await
            .expect("submit_navigation");
        receivers.push((i, rx));
    }

    let start = std::time::Instant::now();
    while handle.diagnostics().in_flight_requests < 8 {
        if start.elapsed() > std::time::Duration::from_secs(5) {
            panic!(
                "Timed out waiting for 8 in-flight requests, got {}",
                handle.diagnostics().in_flight_requests
            );
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let acknowledged: std::collections::BTreeSet<u64> =
                fs::read_to_string(barrier_file.with_extension("txt.seen"))
                    .unwrap_or_default()
                    .lines()
                    .filter_map(|line| line.parse().ok())
                    .collect();
            if acknowledged == (1..=8).collect() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("real fixture must acknowledge all eight held requests");
    for (_, receiver) in &mut receivers {
        assert!(matches!(
            receiver.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Empty)
        ));
    }

    let diag_sat = handle.diagnostics();
    assert_eq!(diag_sat.in_flight_requests, 8);
    assert_eq!(diag_sat.peak_in_flight_requests, 8);

    // 2. 9th request must be rejected with InFlightQueueFull
    let params9 = NavigationParams {
        text_document: TextDocumentIdentifier { uri: uri.clone() },
        position: Position {
            line: 0,
            character: 15,
        },
        dam_hopper_model_generation: None,
        dam_hopper_document_version: 1,
    };
    let rx9 = handle
        .submit_navigation(
            serde_json::Value::from(9),
            "textDocument/definition",
            params9,
        )
        .await
        .expect("submit_navigation");
    let res9 = rx9.await.expect("oneshot receive");
    match res9 {
        Err(SessionError::InFlightQueueFull { count, max }) => {
            assert_eq!(count, 8);
            assert_eq!(max, 8);
        }
        other => panic!("Expected InFlightQueueFull, got {:?}", other),
    }

    let diag_overload = handle.diagnostics();
    assert_eq!(diag_overload.navigation_overloads, 1);
    assert_eq!(diag_overload.in_flight_requests, 8);
    assert_eq!(diag_overload.peak_in_flight_requests, 8);

    // 3. Cheap cached status reads under saturation
    let (cached_docs, cached_bytes) = handle.cached_overlay_stats();
    assert_eq!(cached_docs, 1);
    assert_eq!(cached_bytes, text.len());
    let agg = supervisor.get_aggregate_status().await;
    assert_eq!(agg.in_flight_requests, 8);
    assert_eq!(agg.open_documents, 1);
    assert_eq!(agg.total_overlay_bytes, text.len());

    // 4. Cancel 8 requests and verify current is 0, peaks and outcomes retained
    for i in 1..=8 {
        handle.cancel_request(serde_json::Value::from(i)).await;
    }

    let start_cancel = std::time::Instant::now();
    while handle.diagnostics().in_flight_requests > 0 {
        if start_cancel.elapsed() > std::time::Duration::from_secs(5) {
            panic!("Timed out waiting for in-flight requests cancellation");
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    for (_, receiver) in receivers {
        assert!(matches!(
            receiver.await.unwrap(),
            Err(SessionError::Cancelled)
        ));
    }

    let diag_post_cancel = handle.diagnostics();
    assert_eq!(diag_post_cancel.in_flight_requests, 0);
    assert_eq!(diag_post_cancel.peak_in_flight_requests, 8);
    assert_eq!(diag_post_cancel.navigation_cancellations, 8);
    assert_eq!(diag_post_cancel.navigation_overloads, 1);

    // 5. Clean reap and physical cleanup overlay 0
    supervisor.shutdown().await;
    assert!(handle.is_cleanly_reaped());
    let (reaped_docs, reaped_bytes) = handle.cached_overlay_stats();
    assert_eq!(reaped_docs, 0);
    assert_eq!(reaped_bytes, 0);

    let diag_final = handle.diagnostics();
    assert_eq!(diag_final.open_documents, 0);
    assert_eq!(diag_final.overlay_bytes, 0);
    assert_eq!(diag_final.in_flight_requests, 0);
    assert_eq!(diag_final.peak_open_documents, 1);
    assert_eq!(diag_final.peak_overlay_bytes, text.len());
    assert_eq!(diag_final.peak_in_flight_requests, 8);
    assert_eq!(diag_final.navigation_cancellations, 8);
    assert_eq!(diag_final.navigation_overloads, 1);
}

#[tokio::test]
async fn test_diagnostics_counters_persist_across_retiring_handle() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));

    supervisor
        .prepare_enable()
        .await
        .expect("prepare_enable must succeed");
    supervisor.commit_enable().await;

    let conn_id = ConnectionId("conn-persist-1".into());
    let epoch = supervisor.register_connection(&conn_id).await;
    let handle = supervisor
        .get_or_create_session(conn_id, "retirement", None, toolchain.root.clone(), epoch)
        .await
        .expect("create session");

    let uri = "file:///persist_doc.ts".to_string();
    let text = "export const y = 99;".to_string();
    handle
        .did_open(uri.clone(), "typescript".to_string(), 1, text.clone())
        .await
        .expect("did_open");

    let diag_before = handle.diagnostics();
    assert_eq!(diag_before.open_documents, 1);
    assert_eq!(diag_before.peak_open_documents, 1);
    assert_eq!(diag_before.overlay_bytes, text.len());

    // Prepare invalidate moves session to retiring
    let retiring = supervisor.prepare_invalidate_all().await;

    // The retiring session diagnostics must retain the peak values
    let diag_after = handle.diagnostics();
    assert_eq!(diag_after.peak_open_documents, 1);
    assert_eq!(diag_after.peak_overlay_bytes, text.len());
    supervisor.reap_sessions(retiring).await;
    assert_eq!(handle.diagnostics().open_documents, 0);
    assert_eq!(handle.diagnostics().overlay_bytes, 0);

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_diagnostics_barrier_file_release_and_response() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));

    supervisor
        .prepare_enable()
        .await
        .expect("prepare_enable must succeed");
    supervisor.commit_enable().await;

    let conn_id = ConnectionId("conn-barrier-release".into());
    let epoch = supervisor.register_connection(&conn_id).await;
    let handle = supervisor
        .get_or_create_session(conn_id, "barrier", None, toolchain.root.clone(), epoch)
        .await
        .expect("create session");

    let barrier_file = toolchain.root.join("release_barrier.txt");
    let uri = "file:///barrier_release_doc.ts".to_string();
    let text = format!(
        "export const val = 123; // __BARRIER_FILE__:{}",
        barrier_file.display()
    );

    handle
        .did_open(uri.clone(), "typescript".to_string(), 1, text.clone())
        .await
        .expect("did_open");

    let params = NavigationParams {
        text_document: TextDocumentIdentifier { uri: uri.clone() },
        position: Position {
            line: 0,
            character: 15,
        },
        dam_hopper_model_generation: None,
        dam_hopper_document_version: 1,
    };
    let rx = handle
        .submit_navigation(
            serde_json::Value::from(101),
            "textDocument/definition",
            params,
        )
        .await
        .expect("submit_navigation");

    // Wait until in_flight is 1
    let start = std::time::Instant::now();
    while handle.diagnostics().in_flight_requests < 1 {
        if start.elapsed() > std::time::Duration::from_secs(5) {
            panic!("Timed out waiting for request to enter in-flight");
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert_eq!(handle.diagnostics().in_flight_requests, 1);
    assert_eq!(handle.diagnostics().peak_in_flight_requests, 1);

    // Now release the barrier by creating the barrier file
    std::fs::write(&barrier_file, b"release").expect("write barrier file");

    // The request should now complete successfully
    rx.await
        .expect("receive reply")
        .expect("barrier releases navigation");

    // In flight should return to 0, peak remains 1
    let start_done = std::time::Instant::now();
    while handle.diagnostics().in_flight_requests > 0 {
        if start_done.elapsed() > std::time::Duration::from_secs(5) {
            panic!("Timed out waiting for request to complete");
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    assert_eq!(handle.diagnostics().in_flight_requests, 0);
    assert_eq!(handle.diagnostics().peak_in_flight_requests, 1);

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_crash_budget_exhaustion_rejects_did_open_and_initialize_revival() {
    use dam_hopper_server::semantic::session::SessionError;

    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-crash-budget".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-crash-budget",
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
    let pgid1 = session.get_pgid().await.expect("child PGID 1 must exist");

    // Crash 1: consumes restart attempt 1, backoff 1s
    let _ = dam_hopper_server::semantic::reaper::signal_pgid(
        pgid1,
        Some(nix::sys::signal::Signal::SIGKILL),
    );
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    assert_eq!(session.get_state().await, SemanticState::Ready);
    let pgid2 = session.get_pgid().await.expect("child PGID 2 must exist");
    assert_ne!(pgid1, pgid2);

    // Crash 2: consumes restart attempt 2, backoff 2s
    let _ = dam_hopper_server::semantic::reaper::signal_pgid(
        pgid2,
        Some(nix::sys::signal::Signal::SIGKILL),
    );
    tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
    assert_eq!(session.get_state().await, SemanticState::Ready);
    let pgid3 = session.get_pgid().await.expect("child PGID 3 must exist");
    assert_ne!(pgid2, pgid3);

    // Crash 3: budget exhausted (max 2 restarts in window) -> must NOT restart
    let _ = dam_hopper_server::semantic::reaper::signal_pgid(
        pgid3,
        Some(nix::sys::signal::Signal::SIGKILL),
    );
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Actor must remain terminal Crashed
    assert_eq!(session.get_state().await, SemanticState::Crashed);

    // Attempting did_open on exhausted actor must fail and NOT spawn a replacement child
    let open_res = session
        .did_open(
            "file:///another.ts".into(),
            "typescript".into(),
            1,
            "const x = 1;".into(),
        )
        .await;
    assert!(matches!(open_res, Err(SessionError::NotReady(SemanticState::Crashed))));

    // Attempting initialize on exhausted actor must also fail and NOT spawn a replacement child
    let init_res = session.initialize().await;
    assert!(matches!(init_res, Err(SessionError::NotReady(SemanticState::Crashed))));

    // Diagnostics must reflect 0 running child
    let current_pgid = session.get_pgid().await;
    assert_eq!(current_pgid, None);

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_idle_session_retirement_and_stale_token_rejection() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-idle-test".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn.clone(),
            "project-idle-test",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    // 1. Initial empty initialize: actor becomes Ready, overlays=0
    session.initialize().await.expect("initialize empty session");
    assert_eq!(session.get_state().await, SemanticState::Ready);

    // Idle retirement with matching token succeeds when session is genuinely empty
    let retired = session.retire_if_idle(1).await;
    assert!(retired, "retire_if_idle should succeed for empty initialized session");
    assert_eq!(session.get_state().await, SemanticState::Invalidated);

    // 2. Test activity cancels idle retirement
    let conn2 = ConnectionId("conn-idle-active".into());
    let ep2 = supervisor.register_connection(&conn2).await;
    let session2 = supervisor
        .get_or_create_session(
            conn2.clone(),
            "project-idle-active",
            None,
            target_dir.path().to_path_buf(),
            ep2,
        )
        .await
        .expect("create session 2");

    session2.initialize().await.expect("init session 2");
    // Open a document: cancels idle timer and adds overlay
    session2
        .did_open(
            "file:///active.ts".into(),
            "typescript".into(),
            1,
            "const a = 1;".into(),
        )
        .await
        .expect("open document");

    // Retirement must return false because document is open
    let retired_while_active = session2.retire_if_idle(1).await;
    assert!(!retired_while_active, "retire_if_idle must fail when document is open");
    assert_eq!(session2.get_state().await, SemanticState::Ready);

    // Close the document: transitions back to empty, scheduling a new idle token (token 2)
    session2
        .did_close("file:///active.ts".into())
        .await
        .expect("close document");

    // A stale idle token (1) must be rejected
    let retired_stale = session2.retire_if_idle(1).await;
    assert!(!retired_stale, "stale idle token must not retire session");

    // The fresh idle token succeeds
    let token_fresh = session2.current_idle_token();
    let retired_fresh = session2.retire_if_idle(token_fresh).await;
    assert!(retired_fresh, "current idle token must retire empty session");
    // 3. Generational safety in supervisor
    let key = session2.key.clone();
    supervisor
        .close_session_if_generation(&key, Some(999_999))
        .await;
    assert!(
        supervisor.get_session(&key).await.is_some(),
        "close_session_if_generation with mismatched generation must NOT remove session"
    );

    supervisor
        .close_session_if_generation(&key, Some(session2.fence.session_generation))
        .await;
    assert!(
        supervisor.get_session(&key).await.is_none(),
        "close_session_if_generation with matching generation must remove session"
    );

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_retired_session_rejects_subsequent_document_admission() {
    use dam_hopper_server::semantic::session::SessionError;

    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-retire-reject".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-retire-reject",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    session.initialize().await.expect("initialize empty session");
    assert_eq!(session.get_state().await, SemanticState::Ready);

    // Retire the empty session: must commit irreversible admission cutoff
    let retired = session.retire_if_idle(1).await;
    assert!(retired, "retire_if_idle should succeed");

    // Any subsequent did_open must be rejected immediately without admitting new work
    let open_res = session
        .did_open(
            "file:///late.ts".into(),
            "typescript".into(),
            1,
            "const late = true;".into(),
        )
        .await;
    assert!(
        matches!(open_res, Err(SessionError::Invalidated)),
        "Subsequent did_open on retired session must fail with Invalidated, got: {open_res:?}"
    );

    // Any subsequent initialize must also be rejected
    let init_res = session.initialize().await;
    assert!(
        matches!(init_res, Err(SessionError::Invalidated)),
        "Subsequent initialize on retired session must fail with Invalidated"
    );

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_lazy_startup_idle_timer_lifecycle_and_rearm_after_close() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-lazy-timer".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-lazy-timer",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    // 1. First-use did_open (lazy initialization without explicit initialize())
    session
        .did_open(
            "file:///lazy.ts".into(),
            "typescript".into(),
            1,
            "const lazy = 1;".into(),
        )
        .await
        .expect("lazy did_open");
    assert_eq!(session.get_state().await, SemanticState::Ready);
    assert!(!session.is_idle_timer_scheduled(), "Idle timer must not be scheduled while document is open");

    // Idle retirement must fail because a document is open
    let retired_while_open = session.retire_if_idle(1).await;
    assert!(!retired_while_open, "retire_if_idle must fail while lazy document is open");
    assert_eq!(session.get_state().await, SemanticState::Ready);

    // 2. Close the document: transitions back to empty and arms a fresh idle timer
    session
        .did_close("file:///lazy.ts".into())
        .await
        .expect("did_close");
    assert!(session.is_idle_timer_scheduled(), "Idle timer must be scheduled after closing document");

    // Stale/wrong token must fail
    let cur_token = session.current_idle_token();
    assert!(!session.retire_if_idle(cur_token.wrapping_add(99)).await, "stale token must be rejected");

    // Fresh token succeeds
    let retired_after_close = session.retire_if_idle(cur_token).await;
    assert!(retired_after_close, "fresh idle token must retire session after document is closed");
    assert!(!session.is_idle_timer_scheduled(), "Idle timer must be cleared after retirement");
    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_replay_to_empty_session_arms_idle_timer() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-replay-empty".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-replay-empty",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    // Initialize session with 0 documents
    session.initialize().await.expect("initialize empty session");
    let pgid1 = session.get_pgid().await.expect("pgid 1");

    // Kill child
    let _ = dam_hopper_server::semantic::reaper::signal_pgid(
        pgid1,
        Some(nix::sys::signal::Signal::SIGKILL),
    );
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;

    // Replacement child has started and replayed 0 documents -> arms idle timer
    assert_eq!(session.get_state().await, SemanticState::Ready);
    let pgid2 = session.get_pgid().await.expect("pgid 2");
    assert_ne!(pgid1, pgid2);
    assert!(session.is_idle_timer_scheduled(), "Replay-to-empty must arm idle timer");

    // After replay-to-empty, retirement with fresh token succeeds
    let token_empty = session.current_idle_token();
    assert!(!session.retire_if_idle(token_empty.wrapping_add(99)).await);
    let retired = session.retire_if_idle(token_empty).await;
    assert!(retired, "replay-to-empty must arm idle timer and permit retirement");
    assert!(!session.is_idle_timer_scheduled());

    supervisor.shutdown().await;
}

#[tokio::test]
async fn test_oversized_open_failure_rearms_idle_timer() {
    let toolchain = TestToolchain::new();
    let profile = toolchain.tool_profile();
    let supervisor = SemanticSupervisor::new(Some(profile));
    supervisor.set_enabled(true).await;

    let target_dir = tempfile::tempdir().unwrap();
    let conn = ConnectionId("conn-oversized".into());
    let ep = supervisor.register_connection(&conn).await;
    let session = supervisor
        .get_or_create_session(
            conn,
            "project-oversized",
            None,
            target_dir.path().to_path_buf(),
            ep,
        )
        .await
        .expect("create session");

    // Attempt to open a document exceeding 1 MiB limit (> MAX_DOCUMENT_BYTES)
    let oversized_text = "x".repeat(1024 * 1024 + 100);
    let open_err = session
        .did_open(
            "file:///huge.ts".into(),
            "typescript".into(),
            1,
            oversized_text,
        )
        .await;
    assert!(open_err.is_err(), "Opening oversized document must fail");
    assert_eq!(session.get_state().await, SemanticState::Ready);
    assert!(
        session.is_idle_timer_scheduled(),
        "Idle timer must be re-armed after failed open attempt"
    );

    let token = session.current_idle_token();
    let retired = session.retire_if_idle(token).await;
    assert!(retired, "Session must be eligible for idle retirement");

    supervisor.shutdown().await;
}
