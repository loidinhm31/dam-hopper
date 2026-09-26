#[path = "plugin_test_helpers.rs"]
mod plugin_test_helpers;

use std::collections::BTreeMap;

use plugin_test_helpers::{build_manifest_json, create_regular_tar_gz};
use dam_hopper_server::plugins::{
    GrantKey, PluginRegistry, PluginRegistryLayout,
};
use sha2::{Digest, Sha256};
use tempfile::TempDir;

#[test]
fn test_package_stream_inspect_approve_lifecycle() {
    let temp_dir = TempDir::new().unwrap();
    let layout = PluginRegistryLayout::new(temp_dir.path());
    let registry = PluginRegistry::new(layout.clone()).unwrap();

    let worker_code = b"console.log('worker running');";
    let manifest_str = build_manifest_json(
        "evcrate-advisor",
        "1.0.0",
        &[("backend/worker.cjs", worker_code, 0o644)],
    );

    let (tar_gz, digest) = create_regular_tar_gz(&[
        ("manifest.json", manifest_str.as_bytes(), 0o644),
        ("backend/worker.cjs", worker_code, 0o644),
    ]);

    let begin_res = registry.stage_begin("admin-alice", &digest, tar_gz.len() as u64).unwrap();
    assert_eq!(begin_res.security_revision, 1);

    let received = registry.stage_chunk("admin-alice", &begin_res.stage_id, 0, &tar_gz).unwrap();
    assert_eq!(received, tar_gz.len() as u64);

    let review = registry.stage_finish("admin-alice", &begin_res.stage_id).unwrap();
    assert_eq!(review.plugin_id, "evcrate-advisor");
    assert_eq!(review.archive_sha256, digest);

    let mut initial_bindings = BTreeMap::new();
    initial_bindings.insert("target".to_string(), "default-repo".to_string());
    let inst = registry.approve_stage(
        "admin-alice",
        &begin_res.stage_id,
        &digest,
        1,
        initial_bindings,
        vec![],
    ).unwrap();

    assert_eq!(inst.plugin_id, "evcrate-advisor");
    assert_eq!(inst.active_package_digest, digest);
    assert_eq!(inst.activation_generation, 1);

    let (plugins, rev) = registry.list_plugins().unwrap();
    assert_eq!(plugins.len(), 1);
    assert_eq!(rev, 2);

    let published_dir = layout.package_dir("evcrate-advisor", "1.0.0", &digest);
    assert!(published_dir.exists());
    assert!(published_dir.join("backend/worker.cjs").exists());
}

#[test]
fn test_approval_rejects_wrong_revision_or_digest() {
    let temp_dir = TempDir::new().unwrap();
    let layout = PluginRegistryLayout::new(temp_dir.path());
    let registry = PluginRegistry::new(layout).unwrap();

    let worker_code = b"console.log('worker');";
    let manifest_str = build_manifest_json("test-plugin", "1.0.0", &[("backend/worker.cjs", worker_code, 0o644)]);
    let (tar_gz, digest) = create_regular_tar_gz(&[
        ("manifest.json", manifest_str.as_bytes(), 0o644),
        ("backend/worker.cjs", worker_code, 0o644),
    ]);


    let begin = registry.stage_begin("admin-alice", &digest, tar_gz.len() as u64).unwrap();
    registry.stage_chunk("admin-alice", &begin.stage_id, 0, &tar_gz).unwrap();
    registry.stage_finish("admin-alice", &begin.stage_id).unwrap();

    assert!(registry.approve_stage("admin-alice", &begin.stage_id, &digest, 99, BTreeMap::new(), vec![]).is_err());
    let fake_digest = "0".repeat(64);
    assert!(registry.approve_stage("admin-alice", &begin.stage_id, &fake_digest, 1, BTreeMap::new(), vec![]).is_err());
}

#[test]
fn test_streaming_chunk_sequence_and_overflow_errors() {
    let temp_dir = TempDir::new().unwrap();
    let layout = PluginRegistryLayout::new(temp_dir.path());
    let registry = PluginRegistry::new(layout).unwrap();

    let data = vec![1u8; 1000];
    let digest = hex::encode(Sha256::digest(&data));
    let begin = registry.stage_begin("admin-alice", &digest, 1000).unwrap();

    assert!(registry.stage_chunk("admin-alice", &begin.stage_id, 1, &data[..500]).is_err());
    assert_eq!(registry.stage_chunk("admin-alice", &begin.stage_id, 0, &data[..500]).unwrap(), 500);
    assert!(registry.stage_chunk("admin-alice", &begin.stage_id, 1, &data[..600]).is_err());
}

#[test]
fn test_cas_grants_and_bindings() {
    let temp_dir = TempDir::new().unwrap();
    let layout = PluginRegistryLayout::new(temp_dir.path());
    let registry = PluginRegistry::new(layout).unwrap();

    let worker_code = b"console.log('worker');";
    let manifest_str = build_manifest_json("test-plugin", "1.0.0", &[("backend/worker.cjs", worker_code, 0o644)]);
    let (tar_gz, digest) = create_regular_tar_gz(&[
        ("manifest.json", manifest_str.as_bytes(), 0o644),
        ("backend/worker.cjs", worker_code, 0o644),
    ]);

    let begin = registry.stage_begin("admin-alice", &digest, tar_gz.len() as u64).unwrap();
    registry.stage_chunk("admin-alice", &begin.stage_id, 0, &tar_gz).unwrap();
    registry.stage_finish("admin-alice", &begin.stage_id).unwrap();

    let inst = registry.approve_stage("admin-alice", &begin.stage_id, &digest, 1, BTreeMap::new(), vec![]).unwrap();

    let new_grant = GrantKey {
        actor_subject: "user-bob".to_string(),
        installation_id: inst.installation_id.clone(),
        configured_project_target: "repo-1".to_string(),
        allowed_operations: vec!["advisor.scan".to_string()],
        allow_current_account_policy: false,
    };
    let updated = registry.update_grants("admin-alice", &inst.installation_id, 1, vec![new_grant]).unwrap();
    assert_eq!(updated.grants.len(), 1);
    assert!(registry.update_grants("admin-alice", &inst.installation_id, 1, vec![]).is_err());

    let state = registry.read_state().unwrap();
    let mut new_b = BTreeMap::new();
    new_b.insert("mode".to_string(), "read-only".to_string());
    let updated_b = registry.update_bindings("admin-alice", &inst.installation_id, state.registry_revision, new_b).unwrap();
    assert_eq!(updated_b.bindings.get("mode").unwrap(), "read-only");
}

#[test]
fn test_crash_recovery_cleans_incomplete_staging() {
    let temp_dir = TempDir::new().unwrap();
    let layout = PluginRegistryLayout::new(temp_dir.path());
    let registry = PluginRegistry::new(layout.clone()).unwrap();

    let begin = registry.stage_begin("admin-alice", &"a".repeat(64), 500).unwrap();
    let stage_dir = layout.stage_dir(&begin.stage_id);
    assert!(stage_dir.exists());

    let _recovered_reg = PluginRegistry::new(layout.clone()).unwrap();
    assert!(!stage_dir.exists());
}
