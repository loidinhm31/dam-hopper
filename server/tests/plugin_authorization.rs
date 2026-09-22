use std::path::PathBuf;
use std::sync::Arc;

use dam_hopper_server::api::auth::AuthenticatedActor;
use dam_hopper_server::plugins::authorization::{EpochRegistry, PluginAuthorizationService};
use dam_hopper_server::plugins::contexts::{ContextRecord, PluginContextTable};
use dam_hopper_server::plugins::contract::budgets::{
    MAX_CONTEXTS_PER_WORKER, MAX_OPERATIONS_PER_CONTEXT,
};
use dam_hopper_server::plugins::contract::GrantKey;
use dam_hopper_server::plugins::error::PluginErrorCode;

#[test]
fn test_epoch_issuance_and_validation() {
    let registry = EpochRegistry::new();
    let actor = "alice";

    // Issue valid epoch
    let epoch = registry.issue_epoch(actor, None);
    assert_ne!(epoch, 0);

    // Validate matching actor
    let validated = registry.validate_epoch(epoch, actor).unwrap();
    assert_eq!(validated.epoch_id, epoch);
    assert_eq!(validated.actor_subject, actor);
    assert!(validated.is_valid);

    // Mismatching actor
    let err = registry.validate_epoch(epoch, "bob").unwrap_err();
    assert_eq!(err.code, PluginErrorCode::Unauthorized);

    // Explicit revocation
    let revoked_actor = registry.revoke_epoch(epoch);
    assert_eq!(revoked_actor.as_deref(), Some(actor));

    // Validating revoked epoch fails
    let err = registry.validate_epoch(epoch, actor).unwrap_err();
    assert_eq!(err.code, PluginErrorCode::Unauthorized);
}

#[test]
fn test_epoch_expiration() {
    let registry = EpochRegistry::new();
    let actor = "alice";

    // Expired timestamp (1 second in the past)
    let past = 1000;
    let epoch = registry.issue_epoch(actor, Some(past));

    let err = registry.validate_epoch(epoch, actor).unwrap_err();
    assert_eq!(err.code, PluginErrorCode::Unauthorized);
    assert!(err.message.contains("expired"));
}

#[test]
fn test_no_auth_mode_strictly_denied() {
    let epoch_registry = Arc::new(EpochRegistry::new());
    let auth_service = PluginAuthorizationService::new(epoch_registry.clone());
    let actor = AuthenticatedActor::new("dev-user", None);
    let epoch = epoch_registry.issue_epoch("dev-user", None);
    auth_service.set_actor_grants(
        "dev-user",
        vec![GrantKey {
            actor_subject: "dev-user".to_string(),
            installation_id: "test-plugin".to_string(),
            configured_project_target: "test-project".to_string(),
            allowed_operations: vec!["history.summary".to_string()],
            allow_current_account_policy: false,
        }],
    );
    // Open context with no_auth=true must fail
    let err = auth_service
        .check_open_authorization(
            &actor,
            epoch,
            "test-plugin",
            "test-project",
            &["history.summary".to_string()],
            false,
            true, // no_auth
        )
        .unwrap_err();
    assert_eq!(err.code, PluginErrorCode::Unauthorized);
    assert!(err.message.contains("--no-auth"));

    // Invoke with no_auth=true must fail
    let err = auth_service
        .check_invoke_authorization(
            &actor,
            epoch,
            "test-plugin",
            "test-project",
            "history.summary",
            false,
            true, // no_auth
        )
        .unwrap_err();
    assert_eq!(err.code, PluginErrorCode::Unauthorized);
    assert!(err.message.contains("--no-auth"));
}
#[test]
fn test_unconfigured_actor_default_deny() {
    let epoch_registry = Arc::new(EpochRegistry::new());
    let auth_service = PluginAuthorizationService::new(epoch_registry.clone());
    let actor = AuthenticatedActor::new("unknown-actor", None);
    let epoch = epoch_registry.issue_epoch("unknown-actor", None);

    let err = auth_service
        .check_open_authorization(
            &actor,
            epoch,
            "test-plugin",
            "test-project",
            &["history.summary".to_string()],
            false,
            false,
        )
        .unwrap_err();
    assert_eq!(err.code, PluginErrorCode::Forbidden);
    assert!(err.message.contains("default deny"));
}

#[test]
fn test_grant_authorization_operations_and_policy() {
    let epoch_registry = Arc::new(EpochRegistry::new());
    let auth_service = PluginAuthorizationService::new(epoch_registry.clone());
    let actor = AuthenticatedActor::new("alice", None);
    let epoch = epoch_registry.issue_epoch("alice", None);

    // Configure explicit grant: alice can only do history.summary on project-alpha
    let grant = GrantKey {
        actor_subject: "alice".to_string(),
        installation_id: "advisor-plugin".to_string(),
        configured_project_target: "project-alpha".to_string(),
        allowed_operations: vec!["history.summary".to_string()],
        allow_current_account_policy: false,
    };
    auth_service.set_actor_grants("alice", vec![grant]);

    // Authorized operation on authorized target
    assert!(auth_service
        .check_open_authorization(
            &actor,
            epoch,
            "advisor-plugin",
            "project-alpha",
            &["history.summary".to_string()],
            false,
            false,
        )
        .is_ok());

    // Unauthorized operation on authorized target
    let err = auth_service
        .check_open_authorization(
            &actor,
            epoch,
            "advisor-plugin",
            "project-alpha",
            &["policy.readCurrent".to_string()],
            false,
            false,
        )
        .unwrap_err();
    assert_eq!(err.code, PluginErrorCode::Forbidden);

    // Authorized operation on unauthorized target (cross-target denial)
    let err = auth_service
        .check_open_authorization(
            &actor,
            epoch,
            "advisor-plugin",
            "project-beta",
            &["history.summary".to_string()],
            false,
            false,
        )
        .unwrap_err();
    assert_eq!(err.code, PluginErrorCode::Forbidden);

    // Requesting account-wide policy when grant denies it
    let err = auth_service
        .check_open_authorization(
            &actor,
            epoch,
            "advisor-plugin",
            "project-alpha",
            &["history.summary".to_string()],
            true, // allow_current_policy
            false,
        )
        .unwrap_err();
    assert_eq!(err.code, PluginErrorCode::Forbidden);
}

#[test]
fn test_context_table_limits_and_concurrency() {
    let table = PluginContextTable::new();
    let inst_id = "test-plugin";

    // Fill up to MAX_CONTEXTS_PER_WORKER (16)
    for i in 0..MAX_CONTEXTS_PER_WORKER {
        let record = ContextRecord {
            context_id: format!("ctx-{i}"),
            actor_subject: "alice".to_string(),
            api_connection_epoch: 100,
            installation_id: inst_id.to_string(),
            configured_project_target: "proj".to_string(),
            resolved_root: PathBuf::from("/tmp/proj"),
            allowed_operations: vec!["history.summary".to_string()],
            allow_current_account_policy: false,
            binding_revision: 1,
            grant_revision: 1,
            activation_generation: 1,
            in_flight: 0,
            expires_at_secs: u64::MAX,
        };
        table.insert(record).unwrap();
    }

    // 17th context must be rejected with Overloaded
    let extra = ContextRecord {
        context_id: "ctx-extra".to_string(),
        actor_subject: "alice".to_string(),
        api_connection_epoch: 100,
        installation_id: inst_id.to_string(),
        configured_project_target: "proj".to_string(),
        resolved_root: PathBuf::from("/tmp/proj"),
        allowed_operations: vec!["history.summary".to_string()],
        allow_current_account_policy: false,
        binding_revision: 1,
        grant_revision: 1,
        activation_generation: 1,
        in_flight: 0,
        expires_at_secs: u64::MAX,
    };
    let err = table.insert(extra).unwrap_err();
    assert_eq!(err.code, PluginErrorCode::Overloaded);

    // Concurrency limit per context (MAX_OPERATIONS_PER_CONTEXT = 4)
    for _ in 0..MAX_OPERATIONS_PER_CONTEXT {
        table
            .begin_invoke("ctx-0", "alice", 100, "history.summary")
            .unwrap();
    }

    // 5th in-flight operation on ctx-0 must be rejected
    let err = table
        .begin_invoke("ctx-0", "alice", 100, "history.summary")
        .unwrap_err();
    assert_eq!(err.code, PluginErrorCode::Overloaded);

    // Finishing an invoke frees a slot
    table.finish_invoke("ctx-0");
    assert!(table
        .begin_invoke("ctx-0", "alice", 100, "history.summary")
        .is_ok());
}

#[test]
fn test_context_table_revocation_cascades() {
    let table = PluginContextTable::new();

    let record1 = ContextRecord {
        context_id: "ctx-alice-1".to_string(),
        actor_subject: "alice".to_string(),
        api_connection_epoch: 1001,
        installation_id: "plugin-1".to_string(),
        configured_project_target: "proj-1".to_string(),
        resolved_root: PathBuf::from("/tmp/proj-1"),
        allowed_operations: vec!["history.summary".to_string()],
        allow_current_account_policy: false,
        binding_revision: 1,
        grant_revision: 1,
        activation_generation: 1,
        in_flight: 0,
        expires_at_secs: u64::MAX,
    };

    let record2 = ContextRecord {
        context_id: "ctx-alice-2".to_string(),
        actor_subject: "alice".to_string(),
        api_connection_epoch: 1002,
        installation_id: "plugin-1".to_string(),
        configured_project_target: "proj-2".to_string(),
        resolved_root: PathBuf::from("/tmp/proj-2"),
        allowed_operations: vec!["history.summary".to_string()],
        allow_current_account_policy: false,
        binding_revision: 1,
        grant_revision: 1,
        activation_generation: 1,
        in_flight: 0,
        expires_at_secs: u64::MAX,
    };

    let record3 = ContextRecord {
        context_id: "ctx-bob-1".to_string(),
        actor_subject: "bob".to_string(),
        api_connection_epoch: 2001,
        installation_id: "plugin-2".to_string(),
        configured_project_target: "proj-1".to_string(),
        resolved_root: PathBuf::from("/tmp/proj-1"),
        allowed_operations: vec!["history.summary".to_string()],
        allow_current_account_policy: false,
        binding_revision: 1,
        grant_revision: 1,
        activation_generation: 1,
        in_flight: 0,
        expires_at_secs: u64::MAX,
    };

    table.insert(record1).unwrap();
    table.insert(record2).unwrap();
    table.insert(record3).unwrap();

    // Revoke epoch 1001
    let revoked = table.revoke_by_epoch(1001);
    assert_eq!(revoked.len(), 1);
    assert_eq!(revoked[0].context_id, "ctx-alice-1");
    assert!(table.get("ctx-alice-1").is_none());
    assert!(table.get("ctx-alice-2").is_some());

    // Revoke actor bob
    let revoked_bob = table.revoke_by_actor("bob");
    assert_eq!(revoked_bob.len(), 1);
    assert_eq!(revoked_bob[0].context_id, "ctx-bob-1");
    assert!(table.get("ctx-bob-1").is_none());

    // Close idempotently
    let closed = table.close("ctx-alice-2", "alice", 1002).unwrap();
    assert!(closed.is_some());
    let closed_again = table.close("ctx-alice-2", "alice", 1002).unwrap();
    assert!(closed_again.is_none());
}
