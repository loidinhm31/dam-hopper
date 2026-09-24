#[path = "plugin_test_helpers.rs"]
mod plugin_test_helpers;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;

use dam_hopper_server::plugins::contract::{ContextScopeDescriptor, ContextScopeKind};
use dam_hopper_server::plugins::registry_state::OwnerHistorySource;
use dam_hopper_server::plugins::{
    AdminSubjectList, CancelOutcome, ContextCloseParams, ContextOpenParams, PluginErrorCode,
    PluginInvokeParams, PluginRegistry, PluginRegistryLayout, RequestCancelParams, RunnerClient,
    RunnerClientConfig, RunnerServer, RunnerServerConfig, SupervisorManager, SupervisorStatus,
};
use plugin_test_helpers::{build_manifest_json, create_regular_tar_gz};
use tempfile::TempDir;

fn real_node_worker_code() -> &'static [u8] {
    br#"
const fs = require('fs');

function readFrame(buf) {
  if (buf.length < 4) return null;
  const len = buf.readUInt32BE(0);
  if (buf.length < 4 + len) return null;
  const payload = buf.slice(4, 4 + len).toString('utf8');
  return { payload, totalLen: 4 + len };
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
    handleMessage(JSON.parse(frame.payload));
  }
});

function handleMessage(msg) {
  if (msg.method === 'runner.hello') {
    writeFrame({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        runnerVersion: '1.0.0',
        negotiatedProtocolVersion: '1.0.0',
        supportedCapabilities: ['advisor.scan']
      }
    });
  } else if (msg.method === 'context.open') {
    writeFrame({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        contextId: msg.params.contextId,
        bindingRevision: 1,
        grantRevision: 1,
        activationGeneration: 1,
        expiresAt: Math.floor(Date.now() / 1000) + 900
      }
    });
  } else if (msg.method === 'context.close') {
    writeFrame({
      jsonrpc: '2.0',
      id: msg.id,
      result: { closed: true }
    });
  } else if (msg.method === 'plugin.invoke') {
    if (msg.params.operation === 'snapshot.summary') {
      writeFrame({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          snapshotId: 'snap-42',
          totalFiles: 10,
          totalBytes: 2048,
          status: 'ok'
        }
      });
    } else if (msg.params.operation === 'slow.op') {
      setTimeout(() => {
        writeFrame({
          jsonrpc: '2.0',
          id: msg.id,
          result: { completed: true }
        });
      }, 500);
    } else if (msg.params.operation === 'crash.worker') {
      process.exit(1);
    } else if (msg.params.operation === 'check.env') {
      writeFrame({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          hasToken: Boolean(process.env.DAM_HOPPER_TOKEN || process.env.API_TOKEN),
          nodeEnv: process.env.NODE_ENV || ''
        }
      });
    }
  } else if (msg.method === 'request.cancel') {
    // Ack cancel
  } else if (msg.method === 'worker.shutdown') {
    process.exit(0);
  }
}
"#
}

fn setup_test_installation(temp_dir: &TempDir) -> (Arc<PluginRegistry>, String, String) {
    let layout = PluginRegistryLayout::new(temp_dir.path().join("registry"));
    let admin_subjects = AdminSubjectList::new(vec!["admin-user".to_string()]);
    let registry = Arc::new(PluginRegistry::new(layout, admin_subjects).unwrap());

    let worker_code = real_node_worker_code();
    let manifest_str = build_manifest_json(
        "evcrate-advisor",
        "1.0.0",
        &[("backend/worker.cjs", worker_code, 0o755)],
    );

    let (tar_gz, digest) = create_regular_tar_gz(&[
        ("manifest.json", manifest_str.as_bytes(), 0o644),
        ("backend/worker.cjs", worker_code, 0o755),
    ]);

    let begin = registry
        .stage_begin("admin-user", &digest, tar_gz.len() as u64)
        .unwrap();
    registry
        .stage_chunk("admin-user", &begin.stage_id, 0, &tar_gz)
        .unwrap();
    registry
        .stage_finish("admin-user", &begin.stage_id)
        .unwrap();

    let mut bindings = BTreeMap::new();
    bindings.insert("target".to_string(), "default".to_string());
    let inst = registry
        .approve_stage("admin-user", &begin.stage_id, &digest, 1, bindings, vec![])
        .unwrap();

    (registry, inst.installation_id, digest)
}

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

#[tokio::test]
async fn test_real_worker_lifecycle_and_snapshot_summary() {
    let temp_dir = TempDir::new().unwrap();
    let (registry, installation_id, _) = setup_test_installation(&temp_dir);

    let node_bin = find_node_bin();
    let sup_mgr = Arc::new(SupervisorManager::new(registry.clone(), node_bin));

    let sup = sup_mgr.get_or_create(&installation_id).await.unwrap();
    sup.activate().await.unwrap();
    assert_eq!(sup.status(), SupervisorStatus::Ready);
    assert_eq!(sup.generation(), 2);

    let open_res = sup
        .open_context(ContextOpenParams {
            actor_subject: "user-bob".to_string(),
            installation_id: installation_id.clone(),
            configured_project_target: "default".to_string(),
            scope: None,
            worktree_path: None,
            allowed_operations: vec!["snapshot.summary".to_string(), "check.env".to_string()],
            allow_current_account_policy: false,
            api_connection_epoch: 1,
            activation_generation: sup.activation_generation(),
        })
        .await
        .unwrap();

    assert_eq!(open_res.activation_generation, sup.activation_generation());

    // Invoke snapshot.summary
    let invoke_res = sup
        .invoke(
            "req-1",
            PluginInvokeParams {
                context_id: open_res.context_id.clone(),
                operation: "snapshot.summary".to_string(),
                payload: serde_json::json!({}),
                deadline_ms: Some(5000),
            },
        )
        .await
        .unwrap();

    let result_obj = invoke_res.result;
    assert_eq!(result_obj["status"], "ok");
    assert_eq!(result_obj["snapshotId"], "snap-42");
    assert_eq!(result_obj["totalFiles"], 10);

    // Verify environment isolation: worker does not receive ambient tokens
    let env_res = sup
        .invoke(
            "req-2",
            PluginInvokeParams {
                context_id: open_res.context_id.clone(),
                operation: "check.env".to_string(),
                payload: serde_json::json!({}),
                deadline_ms: Some(5000),
            },
        )
        .await
        .unwrap();
    assert_eq!(env_res.result["hasToken"], false);
    assert_eq!(env_res.result["nodeEnv"], "production");

    // Close context
    let close_res = sup
        .close_context(ContextCloseParams {
            context_id: open_res.context_id.clone(),
            reason: None,
        })
        .await
        .unwrap();
    assert!(close_res.closed);

    // Deactivate
    sup.deactivate().await.unwrap();
    assert_eq!(sup.status(), SupervisorStatus::Stopped);
}

#[tokio::test]
async fn test_real_worker_cancellation() {
    let temp_dir = TempDir::new().unwrap();
    let (registry, installation_id, _) = setup_test_installation(&temp_dir);

    let node_bin = find_node_bin();
    let sup_mgr = Arc::new(SupervisorManager::new(registry.clone(), node_bin));

    let sup = sup_mgr.get_or_create(&installation_id).await.unwrap();
    sup.activate().await.unwrap();

    let open_res = sup
        .open_context(ContextOpenParams {
            actor_subject: "user-bob".to_string(),
            installation_id: installation_id.clone(),
            configured_project_target: "default".to_string(),
            scope: None,
            worktree_path: None,
            allowed_operations: vec!["slow.op".to_string()],
            allow_current_account_policy: false,
            api_connection_epoch: 1,
            activation_generation: sup.activation_generation(),
        })
        .await
        .unwrap();

    // Spawn slow invocation in background
    let sup_clone = sup.clone();
    let ctx_id = open_res.context_id.clone();
    tokio::spawn(async move {
        let _ = sup_clone
            .invoke(
                "slow-req-1",
                PluginInvokeParams {
                    context_id: ctx_id,
                    operation: "slow.op".to_string(),
                    payload: serde_json::json!({}),
                    deadline_ms: Some(5000),
                },
            )
            .await;
    });

    // Brief sleep to allow in-flight registration
    tokio::time::sleep(Duration::from_millis(50)).await;

    // Cancel the request
    let cancel_res = sup
        .cancel_request(RequestCancelParams {
            context_id: open_res.context_id.clone(),
            request_id: "slow-req-1".to_string(),
        })
        .await;

    assert_eq!(cancel_res.outcome, CancelOutcome::Accepted);

    // After settlement, canceling again returns AlreadySettled
    tokio::time::sleep(Duration::from_millis(600)).await;
    let cancel_again = sup
        .cancel_request(RequestCancelParams {
            context_id: open_res.context_id.clone(),
            request_id: "slow-req-1".to_string(),
        })
        .await;
    assert_eq!(cancel_again.outcome, CancelOutcome::AlreadySettled);

    // Canceling an unknown request returns Unknown
    let unknown_cancel = sup
        .cancel_request(RequestCancelParams {
            context_id: open_res.context_id.clone(),
            request_id: "never-existed".to_string(),
        })
        .await;
    assert_eq!(unknown_cancel.outcome, CancelOutcome::Unknown);

    sup.deactivate().await.unwrap();
}

#[tokio::test]
async fn test_real_worker_crash_and_restart_exhaustion() {
    let temp_dir = TempDir::new().unwrap();
    let (registry, installation_id, _) = setup_test_installation(&temp_dir);

    let node_bin = find_node_bin();
    let sup_mgr = Arc::new(SupervisorManager::new(registry.clone(), node_bin));

    let sup = sup_mgr.get_or_create(&installation_id).await.unwrap();
    sup.activate().await.unwrap();

    let open_res = sup
        .open_context(ContextOpenParams {
            actor_subject: "user-bob".to_string(),
            installation_id: installation_id.clone(),
            configured_project_target: "default".to_string(),
            scope: None,
            worktree_path: None,
            allowed_operations: vec!["crash.worker".to_string()],
            allow_current_account_policy: false,
            api_connection_epoch: 1,
            activation_generation: sup.activation_generation(),
        })
        .await
        .unwrap();

    // Trigger crash 1
    let _ = sup
        .invoke(
            "crash-1",
            PluginInvokeParams {
                context_id: open_res.context_id.clone(),
                operation: "crash.worker".to_string(),
                payload: serde_json::json!({}),
                deadline_ms: Some(1000),
            },
        )
        .await;

    // Reactivate and trigger crash 2
    sup.activate().await.unwrap();
    let open_res2 = sup
        .open_context(ContextOpenParams {
            actor_subject: "user-bob".to_string(),
            installation_id: installation_id.clone(),
            configured_project_target: "default".to_string(),
            scope: None,
            worktree_path: None,
            allowed_operations: vec!["crash.worker".to_string()],
            allow_current_account_policy: false,
            api_connection_epoch: 1,
            activation_generation: sup.activation_generation(),
        })
        .await
        .unwrap();

    let _ = sup
        .invoke(
            "crash-2",
            PluginInvokeParams {
                context_id: open_res2.context_id.clone(),
                operation: "crash.worker".to_string(),
                payload: serde_json::json!({}),
                deadline_ms: Some(1000),
            },
        )
        .await;

    // Reactivate and trigger crash 3
    sup.activate().await.unwrap();
    let open_res3 = sup
        .open_context(ContextOpenParams {
            actor_subject: "user-bob".to_string(),
            installation_id: installation_id.clone(),
            configured_project_target: "default".to_string(),
            scope: None,
            worktree_path: None,
            allowed_operations: vec!["crash.worker".to_string()],
            allow_current_account_policy: false,
            api_connection_epoch: 1,
            activation_generation: sup.activation_generation(),
        })
        .await
        .unwrap();

    let _ = sup
        .invoke(
            "crash-3",
            PluginInvokeParams {
                context_id: open_res3.context_id.clone(),
                operation: "crash.worker".to_string(),
                payload: serde_json::json!({}),
                deadline_ms: Some(1000),
            },
        )
        .await;

    // Supervisor should now be in Failed state due to 3 crashes within 60s
    assert!(matches!(sup.status(), SupervisorStatus::Failed(_)));

    // Further activation attempts fail
    let act_err = sup.activate().await.unwrap_err();
    assert_eq!(act_err.code, PluginErrorCode::RunnerUnavailable);

    // Registry records disabled status
    let inst_record = registry
        .get_installation(&installation_id)
        .unwrap()
        .unwrap();
    assert!(!inst_record.enabled);
}

#[tokio::test]
async fn test_context_id_uuid_support_through_runner_server() {
    let temp_dir = TempDir::new().unwrap();
    let (registry, installation_id, _) = setup_test_installation(&temp_dir);
    // Ensure installation_id is verified as a valid UUID format
    assert!(uuid::Uuid::parse_str(&installation_id).is_ok());

    let socket_path = temp_dir.path().join("runner.sock");
    let node_bin = find_node_bin();
    let sup_mgr = Arc::new(SupervisorManager::new(registry.clone(), node_bin));

    let my_uid = unsafe { libc::getuid() };
    let server = Arc::new(RunnerServer::new(
        RunnerServerConfig {
            socket_path: socket_path.clone(),
            expected_api_uid: Some(my_uid),
            allow_root_peer: true,
        },
        registry.clone(),
        sup_mgr.clone(),
    ));

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let server_handle = tokio::spawn({
        let s = server.clone();
        async move { s.run(shutdown_rx).await }
    });

    for _ in 0..50 {
        if socket_path.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let client = RunnerClient::new(RunnerClientConfig {
        socket_path: socket_path.clone(),
        expected_runner_uid: Some(my_uid),
        allow_root_peer: true,
        client_name: "test-client".to_string(),
        max_reconnect_retries: 3,
        reconnect_base_delay: Duration::from_millis(20),
    });

    client.activate(&installation_id, "1.0.0").await.unwrap();

    let open_res = client
        .open_context(ContextOpenParams {
            actor_subject: "user-alice".to_string(),
            installation_id: installation_id.clone(),
            configured_project_target: "default".to_string(),
            scope: None,
            worktree_path: None,
            allowed_operations: vec!["snapshot.summary".to_string()],
            allow_current_account_policy: false,
            api_connection_epoch: 1,
            activation_generation: 1,
        })
        .await
        .unwrap();

    // Invoke through server using UUID-bearing context ID
    let invoke_res = client
        .invoke(PluginInvokeParams {
            context_id: open_res.context_id.clone(),
            operation: "snapshot.summary".to_string(),
            payload: serde_json::json!({}),
            deadline_ms: Some(5000),
        })
        .await
        .unwrap();

    assert_eq!(invoke_res.result["snapshotId"], "snap-42");

    // Close context
    let close_res = client
        .close_context(&open_res.context_id, None)
        .await
        .unwrap();
    assert!(close_res.closed);

    let _ = shutdown_tx.send(true);
    let _ = server_handle.await;
}

#[tokio::test]
async fn test_concurrent_invokes_and_cancellation_multiplexed() {
    let temp_dir = TempDir::new().unwrap();
    let (registry, installation_id, _) = setup_test_installation(&temp_dir);

    let socket_path = temp_dir.path().join("runner_multiplex.sock");
    let node_bin = find_node_bin();
    let sup_mgr = Arc::new(SupervisorManager::new(registry.clone(), node_bin));

    let my_uid = unsafe { libc::getuid() };
    let server = Arc::new(RunnerServer::new(
        RunnerServerConfig {
            socket_path: socket_path.clone(),
            expected_api_uid: Some(my_uid),
            allow_root_peer: true,
        },
        registry.clone(),
        sup_mgr.clone(),
    ));

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let server_handle = tokio::spawn({
        let s = server.clone();
        async move { s.run(shutdown_rx).await }
    });

    for _ in 0..50 {
        if socket_path.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }

    let client = Arc::new(RunnerClient::new(RunnerClientConfig {
        socket_path: socket_path.clone(),
        expected_runner_uid: Some(my_uid),
        allow_root_peer: true,
        client_name: "test-multiplex".to_string(),
        max_reconnect_retries: 3,
        reconnect_base_delay: Duration::from_millis(20),
    }));

    client.activate(&installation_id, "1.0.0").await.unwrap();
    let open_res = client
        .open_context(ContextOpenParams {
            actor_subject: "user-alice".to_string(),
            installation_id: installation_id.clone(),
            configured_project_target: "default".to_string(),
            scope: None,
            worktree_path: None,
            allowed_operations: vec!["slow.op".to_string()],
            allow_current_account_policy: false,
            api_connection_epoch: 1,
            activation_generation: 1,
        })
        .await
        .unwrap();

    // Launch slow invoke on background task
    let target_req_id = format!("api-req-{}", client.peek_next_request_id());
    let client_clone = client.clone();
    let ctx_id = open_res.context_id.clone();
    let invoke_handle = tokio::spawn(async move {
        client_clone
            .invoke(PluginInvokeParams {
                context_id: ctx_id,
                operation: "slow.op".to_string(),
                payload: serde_json::json!({}),
                deadline_ms: Some(5000),
            })
            .await
    });

    tokio::time::sleep(Duration::from_millis(50)).await;

    // Send cancellation over the SAME client connection without waiting for invoke to finish
    let start_cancel = std::time::Instant::now();
    let cancel_res = client
        .cancel_request(&open_res.context_id, &target_req_id)
        .await
        .unwrap();
    let elapsed_cancel = start_cancel.elapsed();

    // Cancellation must respond immediately (< 250ms)
    assert!(elapsed_cancel < Duration::from_millis(250));
    assert_eq!(cancel_res.outcome, CancelOutcome::Accepted);

    let _ = invoke_handle.await;
    let _ = shutdown_tx.send(true);
    let _ = server_handle.await;
}

#[tokio::test]
async fn test_stale_context_revocation_across_worker_restarts() {
    let temp_dir = TempDir::new().unwrap();
    let (registry, installation_id, _) = setup_test_installation(&temp_dir);

    let node_bin = find_node_bin();
    let sup_mgr = Arc::new(SupervisorManager::new(registry.clone(), node_bin));
    let sup = sup_mgr.get_or_create(&installation_id).await.unwrap();
    sup.activate().await.unwrap();

    let open_res = sup
        .open_context(ContextOpenParams {
            actor_subject: "user-bob".to_string(),
            installation_id: installation_id.clone(),
            configured_project_target: "default".to_string(),
            scope: None,
            worktree_path: None,
            allowed_operations: vec!["snapshot.summary".to_string()],
            allow_current_account_policy: false,
            api_connection_epoch: 1,
            activation_generation: sup.activation_generation(),
        })
        .await
        .unwrap();

    // Deactivate and reactivate (advancing generation)
    sup.deactivate().await.unwrap();
    sup.activate().await.unwrap();

    // Attempting invoke with the old context must fail with ContextRevoked or InvalidInput
    let invoke_err = sup
        .invoke(
            "stale-invoke",
            PluginInvokeParams {
                context_id: open_res.context_id.clone(),
                operation: "snapshot.summary".to_string(),
                payload: serde_json::json!({}),
                deadline_ms: Some(5000),
            },
        )
        .await
        .unwrap_err();

    assert!(
        invoke_err.code == PluginErrorCode::ContextRevoked
            || invoke_err.code == PluginErrorCode::InvalidInput
    );
}
#[tokio::test]
async fn test_runner_supervision_root_history_validation_and_rejections() {
    let temp_dir = TempDir::new().unwrap();
    let (registry, installation_id, _) = setup_test_installation(&temp_dir);

    let node_bin = find_node_bin();
    let sup_mgr = Arc::new(SupervisorManager::new(registry.clone(), node_bin));

    let sup = sup_mgr.get_or_create(&installation_id).await.unwrap();
    sup.activate().await.unwrap();

    let history_dir = temp_dir.path().join("real_history");
    std::fs::create_dir_all(&history_dir).unwrap();
    let root_identity = "78be05fd4e2291fb9eb0b5f9e1cf560bc8e14f7d78406d29a5d86f878ceb69f8".to_string();

    let owner_source = OwnerHistorySource {
        root_path: history_dir.to_string_lossy().to_string(),
        root_identity: root_identity.clone(),
        source_revision: 1,
        all_authenticated_history_read: true,
    };
    let reg_rev = registry.read_state().unwrap().registry_revision;
    registry
        .update_owner_history_source("admin-user", &installation_id, reg_rev, Some(owner_source.clone()))
        .unwrap();
    // 1. Success case: valid scope descriptor matches owner source
    let open_res = sup
        .open_context(ContextOpenParams {
            actor_subject: "user-bob".to_string(),
            installation_id: installation_id.clone(),
            configured_project_target: "*".to_string(),
            scope: Some(ContextScopeDescriptor {
                kind: ContextScopeKind::HistoryRoot,
                root_identity: Some(root_identity.clone()),
                source_revision: Some(1),
            }),
            worktree_path: None,
            allowed_operations: vec!["snapshot.summary".to_string()],
            allow_current_account_policy: false,
            api_connection_epoch: 1,
            activation_generation: sup.activation_generation(),
        })
        .await
        .unwrap();

    assert_eq!(open_res.scope_kind, Some(ContextScopeKind::HistoryRoot));

    // 2. Reject mismatched root identity
    let err_id = sup
        .open_context(ContextOpenParams {
            actor_subject: "user-bob".to_string(),
            installation_id: installation_id.clone(),
            configured_project_target: "*".to_string(),
            scope: Some(ContextScopeDescriptor {
                kind: ContextScopeKind::HistoryRoot,
                root_identity: Some("f".repeat(64)),
                source_revision: Some(1),
            }),
            worktree_path: None,
            allowed_operations: vec!["snapshot.summary".to_string()],
            allow_current_account_policy: false,
            api_connection_epoch: 1,
            activation_generation: sup.activation_generation(),
        })
        .await
        .unwrap_err();
    assert_eq!(err_id.code, PluginErrorCode::Forbidden);

    // 3. Reject mismatched source revision
    let err_rev = sup
        .open_context(ContextOpenParams {
            actor_subject: "user-bob".to_string(),
            installation_id: installation_id.clone(),
            configured_project_target: "*".to_string(),
            scope: Some(ContextScopeDescriptor {
                kind: ContextScopeKind::HistoryRoot,
                root_identity: Some(root_identity.clone()),
                source_revision: Some(99),
            }),
            worktree_path: None,
            allowed_operations: vec!["snapshot.summary".to_string()],
            allow_current_account_policy: false,
            api_connection_epoch: 1,
            activation_generation: sup.activation_generation(),
        })
        .await
        .unwrap_err();
    assert_eq!(err_rev.code, PluginErrorCode::Forbidden);

    // 4. Reject symlink as root path
    #[cfg(unix)]
    {
        let symlink_path = temp_dir.path().join("symlink_history");
        std::os::unix::fs::symlink(&history_dir, &symlink_path).unwrap();
        let symlink_source = OwnerHistorySource {
            root_path: symlink_path.to_string_lossy().to_string(),
            root_identity: root_identity.clone(),
            source_revision: 2,
            all_authenticated_history_read: true,
        };
        let reg_rev2 = registry.read_state().unwrap().registry_revision;
        registry
            .update_owner_history_source("admin-user", &installation_id, reg_rev2, Some(symlink_source))
            .unwrap();

        let err_symlink = sup
            .open_context(ContextOpenParams {
                actor_subject: "user-bob".to_string(),
                installation_id: installation_id.clone(),
                configured_project_target: "*".to_string(),
                scope: Some(ContextScopeDescriptor {
                    kind: ContextScopeKind::HistoryRoot,
                    root_identity: Some(root_identity.clone()),
                    source_revision: Some(2),
                }),
                worktree_path: None,
                allowed_operations: vec!["snapshot.summary".to_string()],
                allow_current_account_policy: false,
                api_connection_epoch: 1,
                activation_generation: sup.activation_generation(),
            })
            .await
            .unwrap_err();
        assert_eq!(err_symlink.code, PluginErrorCode::SourcePermissionDenied);
        // 4b. Reject ancestor symlink in root path
        let parent_dir = temp_dir.path().join("real_parent");
        let child_dir = parent_dir.join("child");
        std::fs::create_dir_all(&child_dir).unwrap();
        let symlink_parent = temp_dir.path().join("symlink_parent");
        std::os::unix::fs::symlink(&parent_dir, &symlink_parent).unwrap();
        let ancestor_symlink_path = symlink_parent.join("child");

        let ancestor_symlink_source = OwnerHistorySource {
            root_path: ancestor_symlink_path.to_string_lossy().to_string(),
            root_identity: root_identity.clone(),
            source_revision: 3,
            all_authenticated_history_read: true,
        };
        let reg_rev_anc = registry.read_state().unwrap().registry_revision;
        registry
            .update_owner_history_source("admin-user", &installation_id, reg_rev_anc, Some(ancestor_symlink_source))
            .unwrap();

        let err_ancestor = sup
            .open_context(ContextOpenParams {
                actor_subject: "user-bob".to_string(),
                installation_id: installation_id.clone(),
                configured_project_target: "*".to_string(),
                scope: Some(ContextScopeDescriptor {
                    kind: ContextScopeKind::HistoryRoot,
                    root_identity: Some(root_identity.clone()),
                    source_revision: Some(3),
                }),
                worktree_path: None,
                allowed_operations: vec!["snapshot.summary".to_string()],
                allow_current_account_policy: false,
                api_connection_epoch: 1,
                activation_generation: sup.activation_generation(),
            })
            .await
            .unwrap_err();
        assert_eq!(err_ancestor.code, PluginErrorCode::SourcePermissionDenied);
        // 5. Reject root directory not owned by the runner owner UID
        let current_uid = unsafe { libc::geteuid() };
        if current_uid != 0 && std::path::Path::new("/proc/1").exists() {
            let proc_meta = std::fs::symlink_metadata("/proc/1").unwrap();
            if proc_meta.uid() != current_uid {
                let wrong_uid_source = OwnerHistorySource {
                    root_path: "/proc/1".to_string(),
                    root_identity: root_identity.clone(),
                    source_revision: 3,
                    all_authenticated_history_read: true,
                };
                let reg_rev3 = registry.read_state().unwrap().registry_revision;
                registry
                    .update_owner_history_source("admin-user", &installation_id, reg_rev3, Some(wrong_uid_source))
                    .unwrap();

                let err_uid = sup
                    .open_context(ContextOpenParams {
                        actor_subject: "user-bob".to_string(),
                        installation_id: installation_id.clone(),
                        configured_project_target: "*".to_string(),
                        scope: Some(ContextScopeDescriptor {
                            kind: ContextScopeKind::HistoryRoot,
                            root_identity: Some(root_identity.clone()),
                            source_revision: Some(3),
                        }),
                        worktree_path: None,
                        allowed_operations: vec!["snapshot.summary".to_string()],
                        allow_current_account_policy: false,
                        api_connection_epoch: 1,
                        activation_generation: sup.activation_generation(),
                    })
                    .await
                    .unwrap_err();
                assert_eq!(err_uid.code, PluginErrorCode::SourcePermissionDenied);
            }
        }
    }
}
