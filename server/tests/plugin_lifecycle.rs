use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use dam_hopper_server::plugins::{
    write_lifecycle_journal_record, AdminSubjectList, GrantKey, LifecycleCandidate,
    LifecycleCoordinator, LifecycleOperation, LifecyclePhase, LifecycleTransactionRecord,
    PluginRegistry, PluginRegistryLayout, SupervisorManager,
};
use tempfile::TempDir;

mod plugin_test_helpers;
use plugin_test_helpers::{build_manifest_json, create_regular_tar_gz};

fn find_node_bin() -> PathBuf {
    if let Ok(output) = std::process::Command::new("which").arg("node").output() {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                return PathBuf::from(path_str);
            }
        }
    }
    PathBuf::from("/usr/bin/node")
}

fn framed_node_worker() -> &'static [u8] {
    br#"
const fs = require('fs');
function readFrame(buf) {
  if (buf.length < 4) return null;
  const len = buf.readUInt32BE(0);
  if (buf.length < 4 + len) return null;
  return { payload: buf.slice(4, 4 + len).toString('utf8'), totalLen: 4 + len };
}
function writeFrame(payloadObj) {
  const str = JSON.stringify(payloadObj);
  const buf = Buffer.from(str, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(buf.length, 0);
  process.stdout.write(Buffer.concat([header, buf]));
}
let inBuf = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  inBuf = Buffer.concat([inBuf, chunk]);
  while (true) {
    const frame = readFrame(inBuf);
    if (!frame) break;
    inBuf = inBuf.slice(frame.totalLen);
    const msg = JSON.parse(frame.payload);
    if (msg.method === 'runner.hello') {
      writeFrame({
        jsonrpc: '2.0',
        id: msg.id,
        result: { runnerVersion: '1.0.0', negotiatedProtocolVersion: '1.0.0', supportedCapabilities: ['advisor.scan'] }
      });
    } else if (msg.method === 'worker.ping') {
      writeFrame({ jsonrpc: '2.0', id: msg.id, result: { pong: true } });
    } else if (msg.method === 'worker.shutdown') {
      process.exit(0);
    } else {
      writeFrame({ jsonrpc: '2.0', id: msg.id, result: {} });
    }
  }
});
"#
}

fn create_test_package(id: &str, version: &str) -> (Vec<u8>, String) {
    let worker = framed_node_worker();
    let manifest = build_manifest_json(id, version, &[("backend/worker.cjs", worker, 0o755)]);
    create_regular_tar_gz(&[
        ("manifest.json", manifest.as_bytes(), 0o644),
        ("backend/worker.cjs", worker, 0o755),
    ])
}

fn setup_coordinator(temp_dir: &TempDir) -> LifecycleCoordinator {
    let layout = PluginRegistryLayout::new(temp_dir.path().join("registry"));
    let admin_subjects = AdminSubjectList::new(vec!["admin-user".to_string()]);
    let registry = Arc::new(PluginRegistry::new(layout, admin_subjects).unwrap());
    let node_bin = find_node_bin();
    let supervisor_mgr = Arc::new(SupervisorManager::new(registry.clone(), node_bin));
    LifecycleCoordinator::new(registry, supervisor_mgr)
}

#[tokio::test]
async fn test_lifecycle_update_atomicity_and_drain() {
    let temp_dir = TempDir::new().unwrap();
    let coordinator = setup_coordinator(&temp_dir);

    // 1. Initial installation v1.0.0
    let (pkg_v1, digest_v1) = create_test_package("advisor-core", "1.0.0");
    let stage1 = coordinator
        .registry()
        .stage_begin("admin-user", &digest_v1, pkg_v1.len() as u64)
        .unwrap();
    coordinator
        .registry()
        .stage_chunk("admin-user", &stage1.stage_id, 0, &pkg_v1)
        .unwrap();
    coordinator
        .registry()
        .stage_finish("admin-user", &stage1.stage_id)
        .unwrap();

    let inst1 = coordinator
        .approve_and_install_stage(
            "admin-user",
            &stage1.stage_id,
            &digest_v1,
            1,
            BTreeMap::from([("proj-a".to_string(), "approved-source".to_string())]),
            vec![GrantKey {
                actor_subject: "alice".to_string(),
                installation_id: "".to_string(), // will be matched
                configured_project_target: "proj-a".to_string(),
                allowed_operations: vec!["advisor.scan".to_string()],
                allow_current_account_policy: false,
            }],
        )
        .await
        .unwrap();

    assert_eq!(inst1.plugin_id, "advisor-core");
    assert_eq!(inst1.active_version, "1.0.0");
    assert_eq!(inst1.active_package_digest, digest_v1);
    assert_eq!(inst1.activation_generation, 1);
    assert!(inst1.previous_package.is_none());
    assert!(!inst1.can_rollback);

    // 2. Update to v1.1.0
    let (pkg_v2, digest_v2) = create_test_package("advisor-core", "1.1.0");
    let stage2 = coordinator
        .registry()
        .stage_begin("admin-user", &digest_v2, pkg_v2.len() as u64)
        .unwrap();
    coordinator
        .registry()
        .stage_chunk("admin-user", &stage2.stage_id, 0, &pkg_v2)
        .unwrap();
    coordinator
        .registry()
        .stage_finish("admin-user", &stage2.stage_id)
        .unwrap();

    let inst2 = coordinator
        .approve_and_install_stage(
            "admin-user",
            &stage2.stage_id,
            &digest_v2,
            1,
            BTreeMap::new(), // will preserve previous bindings
            vec![],          // will preserve previous grants
        )
        .await
        .unwrap();

    assert_eq!(inst2.plugin_id, "advisor-core");
    assert_eq!(inst2.active_version, "1.1.0");
    assert_eq!(inst2.active_package_digest, digest_v2);
    assert_eq!(inst2.activation_generation, 2);
    assert!(inst2.can_rollback);

    let prev = inst2.previous_package.unwrap();
    assert_eq!(prev.version, "1.0.0");
    assert_eq!(prev.package_digest, digest_v1);
    assert_eq!(prev.bindings.get("proj-a").map(|s| s.as_str()), Some("approved-source"));

    // Verify stage directory was cleaned up
    assert!(!coordinator.registry().layout.stage_dir(&stage2.stage_id).exists());
}

#[tokio::test]
async fn test_lifecycle_rollback_preserves_current_security_intent() {
    let temp_dir = TempDir::new().unwrap();
    let coordinator = setup_coordinator(&temp_dir);

    // 1. Install v1.0.0
    let (pkg_v1, digest_v1) = create_test_package("security-test", "1.0.0");
    let stage1 = coordinator
        .registry()
        .stage_begin("admin-user", &digest_v1, pkg_v1.len() as u64)
        .unwrap();
    coordinator.registry().stage_chunk("admin-user", &stage1.stage_id, 0, &pkg_v1).unwrap();
    coordinator.registry().stage_finish("admin-user", &stage1.stage_id).unwrap();

    let inst1 = coordinator
        .approve_and_install_stage(
            "admin-user",
            &stage1.stage_id,
            &digest_v1,
            1,
            BTreeMap::from([("proj".to_string(), "bound-src".to_string())]),
            vec![GrantKey {
                actor_subject: "admin-user".to_string(),
                installation_id: "".to_string(),
                configured_project_target: "proj".to_string(),
                allowed_operations: vec!["advisor.scan".to_string()],
                allow_current_account_policy: false,
            }],
        )
        .await
        .unwrap();

    let inst_id = inst1.installation_id.clone();

    // 2. Update to v1.1.0
    let (pkg_v2, digest_v2) = create_test_package("security-test", "1.1.0");
    let stage2 = coordinator
        .registry()
        .stage_begin("admin-user", &digest_v2, pkg_v2.len() as u64)
        .unwrap();
    coordinator.registry().stage_chunk("admin-user", &stage2.stage_id, 0, &pkg_v2).unwrap();
    coordinator.registry().stage_finish("admin-user", &stage2.stage_id).unwrap();

    coordinator
        .approve_and_install_stage(
            "admin-user",
            &stage2.stage_id,
            &digest_v2,
            1,
            BTreeMap::new(),
            vec![],
        )
        .await
        .unwrap();

    // 3. Admin disables installation (security intent change)
    coordinator.disable("admin-user", &inst_id, 1).await.unwrap();

    let disabled_inst = coordinator.get_installation("admin-user", &inst_id).await.unwrap();
    assert!(!disabled_inst.enabled);

    // 4. Execute rollback
    // Under Requirement 12 & 13:
    // Persisted current security intent wins! Disabled status must survive rollback!
    // Activation generation must advance to 3 (never rewinds!).
    let rolled_back = coordinator.rollback("admin-user", &inst_id, 1).await.unwrap();

    assert_eq!(rolled_back.active_version, "1.0.0");
    assert_eq!(rolled_back.active_package_digest, digest_v1);
    assert_eq!(rolled_back.activation_generation, 3);
    assert!(!rolled_back.enabled, "Current disabled security intent must survive rollback");
    assert_eq!(rolled_back.worker_status, "stopped");
    assert!(!rolled_back.can_rollback, "Rollback snapshot consumed");
}

#[tokio::test]
async fn test_lifecycle_enable_disable_persistence() {
    let temp_dir = TempDir::new().unwrap();
    let coordinator = setup_coordinator(&temp_dir);

    let (pkg, digest) = create_test_package("enable-disable", "1.0.0");
    let stage = coordinator
        .registry()
        .stage_begin("admin-user", &digest, pkg.len() as u64)
        .unwrap();
    coordinator.registry().stage_chunk("admin-user", &stage.stage_id, 0, &pkg).unwrap();
    coordinator.registry().stage_finish("admin-user", &stage.stage_id).unwrap();

    let inst = coordinator
        .approve_and_install_stage("admin-user", &stage.stage_id, &digest, 1, BTreeMap::new(), vec![])
        .await
        .unwrap();

    assert!(inst.enabled);
    assert_eq!(inst.activation_generation, 1);

    // Disable
    let disabled = coordinator.disable("admin-user", &inst.installation_id, 1).await.unwrap();
    assert!(!disabled.enabled);
    assert_eq!(disabled.worker_status, "stopped");

    // Enable
    let enabled = coordinator.enable("admin-user", &inst.installation_id, 1).await.unwrap();
    assert!(enabled.enabled);
    assert_eq!(enabled.activation_generation, 2);
}

#[tokio::test]
async fn test_lifecycle_remove_and_unreferenced_cleanup() {
    let temp_dir = TempDir::new().unwrap();
    let coordinator = setup_coordinator(&temp_dir);

    let (pkg, digest) = create_test_package("to-remove", "1.0.0");
    let stage = coordinator
        .registry()
        .stage_begin("admin-user", &digest, pkg.len() as u64)
        .unwrap();
    coordinator.registry().stage_chunk("admin-user", &stage.stage_id, 0, &pkg).unwrap();
    coordinator.registry().stage_finish("admin-user", &stage.stage_id).unwrap();

    let inst = coordinator
        .approve_and_install_stage("admin-user", &stage.stage_id, &digest, 1, BTreeMap::new(), vec![])
        .await
        .unwrap();

    let pkg_dir = coordinator.registry().layout.package_dir("to-remove", "1.0.0", &digest);
    assert!(pkg_dir.exists());

    // Remove installation
    let res = coordinator.remove("admin-user", &inst.installation_id, 1).await.unwrap();
    assert!(res.removed);
    assert!(res.cleaned_packages.contains(&digest));

    // Verify package directory was deleted because unreferenced
    assert!(!pkg_dir.exists());

    // Verify installation list is empty
    let list = coordinator.list_installations("admin-user").await.unwrap();
    assert!(list.is_empty());
}

#[tokio::test]
async fn test_lifecycle_crash_recovery() {
    let temp_dir = TempDir::new().unwrap();
    let coordinator = setup_coordinator(&temp_dir);

    let now_str = chrono::Utc::now().to_rfc3339();

    // 1. Transaction in Initiated state (pre-publish)
    let tx1 = LifecycleTransactionRecord {
        transaction_id: "00000000-0000-4000-8000-000000000001".to_string(),
        installation_id: "inst-1".to_string(),
        operation: LifecycleOperation::Install,
        phase: LifecyclePhase::Initiated,
        actor_subject: "admin-user".to_string(),
        candidate: Some(LifecycleCandidate {
            plugin_id: "test-plugin".to_string(),
            version: "1.0.0".to_string(),
            package_digest: "a".repeat(64),
            target_generation: 1,
        }),
        security_revision_before: 1,
        generation_before: 0,
        generation_after: Some(1),
        error: None,
        created_at: now_str.clone(),
        updated_at: now_str.clone(),
    };
    write_lifecycle_journal_record(&coordinator.registry().layout, &tx1).unwrap();

    // 2. Transaction in Published state (already committed to registry)
    let tx2 = LifecycleTransactionRecord {
        transaction_id: "00000000-0000-4000-8000-000000000002".to_string(),
        installation_id: "inst-2".to_string(),
        operation: LifecycleOperation::Update,
        phase: LifecyclePhase::Published,
        actor_subject: "admin-user".to_string(),
        candidate: Some(LifecycleCandidate {
            plugin_id: "test-plugin".to_string(),
            version: "1.1.0".to_string(),
            package_digest: "b".repeat(64),
            target_generation: 2,
        }),
        security_revision_before: 1,
        generation_before: 1,
        generation_after: Some(2),
        error: None,
        created_at: now_str.clone(),
        updated_at: now_str.clone(),
    };
    write_lifecycle_journal_record(&coordinator.registry().layout, &tx2).unwrap();

    // Run crash recovery
    coordinator.run_crash_recovery().await.unwrap();

    // Verify tx1 aborted
    let recovered1 = dam_hopper_server::plugins::read_lifecycle_journal_record(
        &coordinator.registry().layout,
        &tx1.transaction_id,
    )
    .unwrap();
    assert_eq!(recovered1.phase, LifecyclePhase::Aborted);

    // Verify tx2 committed
    let recovered2 = dam_hopper_server::plugins::read_lifecycle_journal_record(
        &coordinator.registry().layout,
        &tx2.transaction_id,
    )
    .unwrap();
    assert_eq!(recovered2.phase, LifecyclePhase::Committed);
}

#[tokio::test]
async fn test_lifecycle_activation_failure_leaves_registry_untouched() {
    let temp_dir = TempDir::new().unwrap();
    let coordinator = setup_coordinator(&temp_dir);

    // Create broken package that exits immediately on start
    let broken_worker = b"process.exit(1);";
    let manifest = build_manifest_json("broken-plugin", "1.0.0", &[("backend/worker.cjs", broken_worker, 0o755)]);
    let (pkg, digest) = create_regular_tar_gz(&[
        ("manifest.json", manifest.as_bytes(), 0o644),
        ("backend/worker.cjs", broken_worker, 0o755),
    ]);

    let stage = coordinator
        .registry()
        .stage_begin("admin-user", &digest, pkg.len() as u64)
        .unwrap();
    coordinator.registry().stage_chunk("admin-user", &stage.stage_id, 0, &pkg).unwrap();
    coordinator.registry().stage_finish("admin-user", &stage.stage_id).unwrap();

    // Approve should fail during worker candidate activation
    let result = coordinator
        .approve_and_install_stage("admin-user", &stage.stage_id, &digest, 1, BTreeMap::new(), vec![])
        .await;
    assert!(result.is_err(), "Activation failure must cause approve to return error");

    // Registry state must NOT contain the broken plugin
    let state = coordinator.registry().read_state().unwrap();
    assert!(
        state.installations.is_empty(),
        "Installation must NOT be published in registry if activation fails"
    );
    let pkg_key = format!("broken-plugin@1.0.0#{digest}");
    assert!(
        !state.packages.contains_key(&pkg_key),
        "Package must NOT be registered if activation fails"
    );
}

#[tokio::test]
async fn test_lifecycle_update_activation_failure_preserves_prior_installation() {
    let temp_dir = TempDir::new().unwrap();
    let coordinator = setup_coordinator(&temp_dir);

    // 1. Install working v1.0.0
    let (pkg_v1, digest_v1) = create_test_package("advisor-failover", "1.0.0");
    let stage1 = coordinator
        .registry()
        .stage_begin("admin-user", &digest_v1, pkg_v1.len() as u64)
        .unwrap();
    coordinator.registry().stage_chunk("admin-user", &stage1.stage_id, 0, &pkg_v1).unwrap();
    coordinator.registry().stage_finish("admin-user", &stage1.stage_id).unwrap();

    let inst1 = coordinator
        .approve_and_install_stage("admin-user", &stage1.stage_id, &digest_v1, 1, BTreeMap::new(), vec![])
        .await
        .unwrap();
    assert_eq!(inst1.active_version, "1.0.0");

    // 2. Stage broken update v1.1.0
    let broken_worker = b"process.exit(1);";
    let manifest = build_manifest_json("advisor-failover", "1.1.0", &[("backend/worker.cjs", broken_worker, 0o755)]);
    let (pkg_v2, digest_v2) = create_regular_tar_gz(&[
        ("manifest.json", manifest.as_bytes(), 0o644),
        ("backend/worker.cjs", broken_worker, 0o755),
    ]);

    let stage2 = coordinator
        .registry()
        .stage_begin("admin-user", &digest_v2, pkg_v2.len() as u64)
        .unwrap();
    coordinator.registry().stage_chunk("admin-user", &stage2.stage_id, 0, &pkg_v2).unwrap();
    coordinator.registry().stage_finish("admin-user", &stage2.stage_id).unwrap();

    // Update fails during candidate activation
    let update_res = coordinator
        .approve_and_install_stage("admin-user", &stage2.stage_id, &digest_v2, 1, BTreeMap::new(), vec![])
        .await;
    assert!(update_res.is_err(), "Broken candidate activation must fail update");

    // Prior installation v1.0.0 remains active and unmutated in durable registry
    let state = coordinator.registry().read_state().unwrap();
    let cur_inst = state.installations.get(&inst1.installation_id).unwrap();
    assert_eq!(cur_inst.active_version, "1.0.0", "Prior version must be preserved");
    assert_eq!(cur_inst.active_package_digest, digest_v1, "Prior digest must be preserved");
    assert_eq!(cur_inst.activation_generation, 1, "Generation must not advance on failed candidate");
}

#[tokio::test]
async fn test_lifecycle_rollback_activation_failure_preserves_current_installation() {
    let temp_dir = TempDir::new().unwrap();
    let coordinator = setup_coordinator(&temp_dir);

    // 1. Install working v1.0.0
    let (pkg_v1, digest_v1) = create_test_package("rollback-failover", "1.0.0");
    let stage1 = coordinator
        .registry()
        .stage_begin("admin-user", &digest_v1, pkg_v1.len() as u64)
        .unwrap();
    coordinator.registry().stage_chunk("admin-user", &stage1.stage_id, 0, &pkg_v1).unwrap();
    coordinator.registry().stage_finish("admin-user", &stage1.stage_id).unwrap();

    let inst1 = coordinator
        .approve_and_install_stage("admin-user", &stage1.stage_id, &digest_v1, 1, BTreeMap::new(), vec![])
        .await
        .unwrap();
    assert_eq!(inst1.active_version, "1.0.0");

    // 2. Update to working v1.1.0
    let (pkg_v2, digest_v2) = create_test_package("rollback-failover", "1.1.0");
    let stage2 = coordinator
        .registry()
        .stage_begin("admin-user", &digest_v2, pkg_v2.len() as u64)
        .unwrap();
    coordinator.registry().stage_chunk("admin-user", &stage2.stage_id, 0, &pkg_v2).unwrap();
    coordinator.registry().stage_finish("admin-user", &stage2.stage_id).unwrap();

    let inst2 = coordinator
        .approve_and_install_stage("admin-user", &stage2.stage_id, &digest_v2, 1, BTreeMap::new(), vec![])
        .await
        .unwrap();
    assert_eq!(inst2.active_version, "1.1.0");
    assert_eq!(inst2.activation_generation, 2);
    assert!(inst2.can_rollback);

    // 3. Corrupt v1.0.0 worker on disk so rollback candidate activation fails
    let v1_worker_path = coordinator
        .registry()
        .layout
        .package_dir("rollback-failover", "1.0.0", &digest_v1)
        .join("backend/worker.cjs");
    std::fs::write(&v1_worker_path, b"process.exit(1);").unwrap();

    // 4. Rollback fails during candidate activation
    let rollback_res = coordinator
        .rollback("admin-user", &inst1.installation_id, 1)
        .await;
    assert!(rollback_res.is_err(), "Failed rollback candidate activation must return error");

    // 5. Verify registry is unchanged: v1.1.0 remains active, generation is 2, previous_package is preserved
    let state = coordinator.registry().read_state().unwrap();
    let cur_inst = state.installations.get(&inst1.installation_id).unwrap();
    assert_eq!(cur_inst.active_version, "1.1.0", "Current version must remain 1.1.0 on failed rollback");
    assert_eq!(cur_inst.active_package_digest, digest_v2);
    assert_eq!(cur_inst.activation_generation, 2, "Generation must not advance on failed rollback");
    assert!(cur_inst.previous_package.is_some(), "Rollback snapshot must be preserved for admin repair");
}
