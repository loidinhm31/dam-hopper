use super::*;

async fn pending(registry: &SessionRegistry) -> String {
    let request = CreateSessionRequest {
        creation_key: Uuid::new_v4().to_string(),
        url: "about:blank".to_string(),
        viewport: ViewportRequest { width: 800, height: 600, dpr: 1.0 },
    };
    match registry.reserve_creation(&CreateParams {
        principal: "alice",
        is_dev: true,
        browser_incarnation: "inc1",
        profile_epoch: 1,
        request: &request,
        allowed_origins: &[],
        max_targets: 2,
    }, &|| true).await.unwrap() {
        CreateReservation::Pending { session_id } => session_id,
        CreateReservation::Existing(_) => panic!("new creation must reserve a session"),
    }
}

async fn subscribe(registry: &SessionRegistry, id: &str) -> watch::Receiver<ServerControlEvent> {
    registry.subscribe_session(id, "alice", true, 1, "inc1").await.unwrap()
}

fn latest(receiver: &mut watch::Receiver<ServerControlEvent>) -> BrowserSessionDto {
    match &*receiver.borrow_and_update() {
        ServerControlEvent::SessionUpdated { session } => (**session).clone(),
        _ => panic!("registry subscriptions contain only session snapshots"),
    }
}

async fn running(registry: &SessionRegistry, id: &str) {
    assert_eq!(registry.bind_native_target(id, "inc1", id).await, BindOutcome::Bound);
    registry.commit_running(id, &|| true).await.unwrap();
}

#[tokio::test]
async fn initial_snapshot_and_updates_share_mutation_order() {
    let registry = SessionRegistry::new();
    let allowed = ["http://127.0.0.1".to_string()];
    let id = pending(&registry).await;
    let mut receiver = subscribe(&registry, &id).await;
    assert_eq!(latest(&mut receiver).status, "initializing");
    registry.note_creation_error(&id, "native creation pending").await;
    assert!(receiver.has_changed().unwrap());
    assert_eq!(latest(&mut receiver).unavailable_reason.as_deref(), Some("native creation pending"));
    registry.bind_native_target(&id, "inc1", &id).await;
    assert!(latest(&mut receiver).unavailable_reason.is_none());
    running(&registry, &id).await;
    assert_eq!(latest(&mut receiver).status, "running");

    // A commit between subscribing and reading the first snapshot cannot disappear.
    let mut second = subscribe(&registry, &id).await;
    registry.record_cdp_navigation(&id, Some("http://127.0.0.1/committed"), &allowed).await;
    assert_eq!(latest(&mut second).url, "http://127.0.0.1/committed");
    assert_eq!(latest(&mut receiver).navigation_revision, "2");
}

#[tokio::test]
async fn subscriptions_reject_foreign_sessions_and_stale_runtime_tickets() {
    let registry = SessionRegistry::new();
    let id = pending(&registry).await;
    for (session_id, principal, is_dev, epoch, incarnation) in [
        (id.as_str(), "bob", true, 1, "inc1"),
        (id.as_str(), "alice", false, 1, "inc1"),
        (id.as_str(), "alice", true, 2, "inc1"),
        (id.as_str(), "alice", true, 1, "inc2"),
        ("absent", "alice", true, 1, "inc1"),
    ] {
        assert!(matches!(registry.subscribe_session(session_id, principal, is_dev, epoch, incarnation).await,
            Err(SessionError::NotFound)));
    }
    let mut receiver = subscribe(&registry, &id).await;
    latest(&mut receiver);
    let other = pending(&registry).await;
    registry.update_title(&other, "other session").await;
    assert!(!receiver.has_changed().unwrap());
}

#[tokio::test]
async fn slow_receivers_coalesce_navigation_and_utf8_title_updates() {
    let registry = SessionRegistry::new();
    let allowed = ["http://127.0.0.1".to_string()];
    let id = pending(&registry).await;
    running(&registry, &id).await;
    let mut receiver = subscribe(&registry, &id).await;
    latest(&mut receiver);
    for n in 0..128 {
        registry.record_cdp_navigation(&id, Some(&format!("http://127.0.0.1/step/{n}")), &allowed).await;
    }
    let title = "界".repeat(MAX_TITLE_BYTES);
    registry.update_title(&id, &title).await;
    let session = latest(&mut receiver);
    assert_eq!(session.url, "http://127.0.0.1/step/127");
    assert_eq!(session.navigation_revision, "129");
    assert!(session.title.len() <= MAX_TITLE_BYTES);
    assert!(title.starts_with(&session.title));
    assert!(!receiver.has_changed().unwrap(), "no backlog of intermediate snapshots");
    registry.update_title(&id, &title).await;
    assert!(!receiver.has_changed().unwrap(), "unchanged title is not republished");
}

#[tokio::test]
async fn api_commands_and_native_geometry_publish_current_state() {
    let registry = SessionRegistry::new();
    let allowed = ["http://127.0.0.1".to_string()];
    let id = pending(&registry).await;
    running(&registry, &id).await;
    let mut receiver = subscribe(&registry, &id).await;
    registry.navigate(&id, "alice", "http://127.0.0.1/api", 1, &allowed).await.unwrap();
    assert_eq!(latest(&mut receiver).navigation_revision, "2");
    registry.mark_api_navigation_pending(&id).await;
    registry.record_cdp_navigation(&id, Some("http://127.0.0.1/redirected"), &allowed).await;
    let redirected = latest(&mut receiver);
    assert_eq!(redirected.url, "http://127.0.0.1/redirected");
    assert_eq!(redirected.navigation_revision, "2");
    registry.history(&id, "alice", "back", 2).await.unwrap();
    assert_eq!(latest(&mut receiver).navigation_revision, "3");
    registry.reload(&id, "alice", 3).await.unwrap();
    assert_eq!(latest(&mut receiver).navigation_revision, "4");
    registry.update_viewport(&id, "alice", 1, 1024, 768, 2.0).await.unwrap();
    let viewport = latest(&mut receiver);
    assert_eq!(viewport.viewport_epoch, "2");
    assert_eq!(viewport.geometry.css_width, 1024.0);
    registry.fence_geometry_and_advance_epoch("alice", true, Some(&id), None, None, None).await;
    let fenced = latest(&mut receiver);
    assert_eq!(fenced.viewport_epoch, "3");
    assert!(!fenced.input_available);
    registry.fence_geometry_and_advance_epoch("bob", true, None, None, None, None).await;
    registry.fence_geometry_and_advance_epoch("alice", false, None, None, None, None).await;
    assert!(!receiver.has_changed().unwrap());
}

#[tokio::test]
async fn terminal_snapshot_survives_channel_close_and_session_removal() {
    let registry = SessionRegistry::new();
    let id = pending(&registry).await;
    let mut receiver = subscribe(&registry, &id).await;
    assert_eq!(registry.rollback_creation(&id).await, RollbackOutcome::Removed);
    assert_eq!(latest(&mut receiver).status, "closed");
    assert!(receiver.changed().await.is_err());

    let id = pending(&registry).await;
    running(&registry, &id).await;
    let mut receiver = subscribe(&registry, &id).await;
    registry.begin_close(&id, "alice").await.unwrap();
    let closing = latest(&mut receiver);
    assert_eq!(closing.status, "closing");
    assert!(!closing.input_available);
    registry.finish_close(&id, true).await;
    assert_eq!(latest(&mut receiver).status, "closed");
    assert!(receiver.changed().await.is_err());
    assert!(matches!(registry.get_session(&id, "alice").await, Err(SessionError::NotFound)));
}

#[tokio::test]
async fn native_loss_and_principal_fences_publish_terminal_truth() {
    let registry = SessionRegistry::new();
    let id = pending(&registry).await;
    running(&registry, &id).await;
    let mut receiver = subscribe(&registry, &id).await;
    registry.native_destroyed("inc1", &id).await.unwrap();
    let lost = latest(&mut receiver);
    assert_eq!(lost.status, "lost");
    assert!(!lost.input_available);
    assert!(receiver.changed().await.is_err());

    let id = pending(&registry).await;
    running(&registry, &id).await;
    let mut receiver = subscribe(&registry, &id).await;
    registry.retire_incarnation("inc1", "browser stopped").await;
    assert_eq!(latest(&mut receiver).unavailable_reason.as_deref(), Some("browser stopped"));
    assert!(receiver.changed().await.is_err());

    let id = pending(&registry).await;
    let mut receiver = subscribe(&registry, &id).await;
    registry.close_principal_sessions("alice").await;
    assert_eq!(latest(&mut receiver).status, "closed");
    assert!(receiver.changed().await.is_err());
    let mut retired_subscription = subscribe(&registry, &id).await;
    assert_eq!(latest(&mut retired_subscription).status, "closed");
    assert!(retired_subscription.changed().await.is_err());
}

#[tokio::test]
async fn blocked_popup_is_published_only_to_opener() {
    let registry = SessionRegistry::new();
    let id = pending(&registry).await;
    running(&registry, &id).await;
    let mut receiver = subscribe(&registry, &id).await;
    assert!(matches!(registry.admit_popup("inc1", &id, "popup", "about:blank", 1).await,
        PopupAdmission::Blocked { .. }));
    assert_eq!(latest(&mut receiver).popup_blocked, Some(true));
}

#[tokio::test]
async fn snapshots_exclude_credentials_and_idle_publishers_do_not_allocate_state_slots() {
    let registry = SessionRegistry::new();
    let id = pending(&registry).await;
    registry.update_title(&id, "before subscribe").await;
    assert!(registry.inner.read().await.sessions[&id].updates.is_none());
    let mut receiver = subscribe(&registry, &id).await;
    {
        let mut inner = registry.inner.write().await;
        let session = inner.sessions.get_mut(&id).unwrap();
        session.lease = Some(SessionLease {
            lease_token: "private-lease-token".to_string(),
            viewer_id: "viewer".to_string(),
            holder_kind: "human".to_string(),
            expires_at: Instant::now() + Duration::from_secs(30),
        });
        session.publish_update();
    }
    let json = serde_json::to_value(&*receiver.borrow_and_update()).unwrap();
    assert_eq!(json["kind"], "sessionUpdated");
    assert_eq!(json["session"]["browserSessionId"], id);
    assert_eq!(json["session"]["lease"]["viewerId"], "viewer");
    assert!(json["session"].get("ownerPrincipal").is_none());
    assert!(json["session"]["lease"].get("leaseToken").is_none());
    assert!(!json.to_string().contains("private-lease-token"));
    let decoded: ServerControlEvent = serde_json::from_value(json).unwrap();
    assert!(matches!(decoded, ServerControlEvent::SessionUpdated { .. }));
    drop(receiver);
    registry.update_title(&id, "after unsubscribe").await;
    assert!(registry.inner.read().await.sessions[&id].updates.is_none());
}
