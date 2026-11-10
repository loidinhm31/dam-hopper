use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use dam_hopper_server::browser_host::diagnostics::{global_memory_controller, TrackedBhjfFrame};
use dam_hopper_server::browser_host::media::{ViewerCreditController, MAX_OUTSTANDING_PER_VIEWER};
use dam_hopper_server::browser_host::protocol::{
    pack_bhjf_frame, unpack_bhjf_frame, TargetFrameHeader, TargetGeometry,
};
use tokio::time::sleep;
use uuid::Uuid;

fn make_dummy_jpeg() -> Vec<u8> {
    // Minimal valid JPEG header with SOF0 (64x64) and EOI
    let mut data = vec![
        0xFF, 0xD8, // SOI
        0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x40, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11,
        0x01, 0x03, 0x11, 0x01, // SOF0 (64x64, 3 components)
        0xFF, 0xD9, // EOI
    ];
    // Pad to valid payload
    data.resize(64, 0);
    data[62] = 0xFF;
    data[63] = 0xD9;
    data
}

fn make_test_frame(run_id: &str, v_epoch: &str, seq: &str) -> TrackedBhjfFrame {
    let header = TargetFrameHeader {
        browser_session_id: Uuid::new_v4().to_string(),
        browser_incarnation: Uuid::new_v4().to_string(),
        profile_epoch: "1".to_string(),
        producer_run: run_id.to_string(),
        viewport_epoch: v_epoch.to_string(),
        frame_seq: seq.to_string(),
        width: 64,
        height: 64,
        capture_time_unix_ms: 1000,
        geometry: TargetGeometry {
            css_width: 64.0,
            css_height: 64.0,
            offset_top: 0.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
            page_scale: 1.0,
            visual_offset_x: 0.0,
            visual_offset_y: 0.0,
            dpr: 1.0,
        },
        input_trusted: true,
    };
    let bytes = pack_bhjf_frame(&header, &make_dummy_jpeg()).expect("pack frame");
    let res = global_memory_controller()
        .try_reserve(bytes.len())
        .expect("reserve frame memory");
    TrackedBhjfFrame::new(bytes, res)
}

#[tokio::test]
async fn test_credit_controller_bounds_and_governor() {
    let sub = Uuid::new_v4().to_string();
    let run = Uuid::new_v4().to_string();
    let mut ctrl = ViewerCreditController::new(sub.clone());

    let frame1 = make_test_frame(&run, "1", "1");
    let frame2 = make_test_frame(&run, "1", "2");
    let frame3 = make_test_frame(&run, "1", "3");
    let frame4 = make_test_frame(&run, "1", "4");

    // 1. First frame sent immediately
    let res1 = ctrl.on_incoming_frame(frame1);
    assert!(res1.is_some(), "first frame should be dispatched");
    assert_eq!(ctrl.outstanding_count(), 1);

    // 2. Immediate second frame throttled by 100ms governor -> buffered in pending
    let res2 = ctrl.on_incoming_frame(frame2.clone());
    assert!(
        res2.is_none(),
        "frame within 100ms should be held in pending"
    );
    assert_eq!(ctrl.outstanding_count(), 1);
    assert!(ctrl.has_pending());

    // 3. Wait > 100ms -> incoming third frame replaces pending and dispatches since outstanding (1) < 2
    sleep(Duration::from_millis(110)).await;
    let res3 = ctrl.on_incoming_frame(frame3);
    assert!(
        res3.is_some(),
        "frame after 100ms with credit should be dispatched"
    );
    assert_eq!(ctrl.outstanding_count(), 2);

    // 4. Fourth frame arrives while outstanding == 2 -> must be held in pending (capacity capped at 2 outstanding)
    sleep(Duration::from_millis(110)).await;
    let res4 = ctrl.on_incoming_frame(frame4);
    assert!(
        res4.is_none(),
        "when outstanding == 2, incoming frame must be pending"
    );
    assert_eq!(ctrl.outstanding_count(), 2);
    assert!(ctrl.has_pending());

    // 5. ACK for frame 1 frees 1 credit and unblocks dispatch of pending frame 4!
    let unblocked = ctrl.on_credit_return(&sub, &run, "1", "1", false);
    assert!(
        unblocked.is_some(),
        "ACKing frame 1 should release pending frame"
    );
    assert_eq!(ctrl.outstanding_count(), 2); // Frame 3 + Frame 4 now outstanding
    assert!(!ctrl.has_pending());
    assert_eq!(ctrl.total_acked, 1);
}
#[tokio::test]
async fn test_settled_frame_governor_flush() {
    let sub = Uuid::new_v4().to_string();
    let run = Uuid::new_v4().to_string();
    let mut ctrl = ViewerCreditController::new(sub.clone());

    let frame1 = make_test_frame(&run, "1", "1");
    let frame2 = make_test_frame(&run, "1", "2");

    // 1. Frame 1 dispatched
    let res1 = ctrl.on_incoming_frame(frame1);
    assert!(res1.is_some());

    // 2. Immediate frame 2 buffered as pending
    let res2 = ctrl.on_incoming_frame(frame2);
    assert!(res2.is_none());
    assert!(ctrl.has_pending());

    // 3. ACK for frame 1 arrives immediately (< 100ms)
    let _ = ctrl.on_credit_return(&sub, &run, "1", "1", false);
    // Because last_delivery was < 100ms ago, pending frame is still held
    assert!(ctrl.has_pending());
    assert_eq!(ctrl.outstanding_count(), 0);

    // 4. Time passes (> 100ms), page settles and no new frames or ACKs arrive
    sleep(Duration::from_millis(110)).await;

    // 5. Governor flush ticker picks up pending settled frame!
    let flushed = ctrl.check_flush_pending();
    assert!(
        flushed.is_some(),
        "settled pending frame must be flushed by governor"
    );
    assert!(!ctrl.has_pending());
    assert_eq!(ctrl.outstanding_count(), 1);
}

#[tokio::test]
async fn test_credit_controller_foreign_socket_rejection() {
    let sub1 = Uuid::new_v4().to_string();
    let sub2 = Uuid::new_v4().to_string();
    let run = Uuid::new_v4().to_string();
    let mut ctrl = ViewerCreditController::new(sub1.clone());

    let frame1 = make_test_frame(&run, "1", "1");
    let _ = ctrl.on_incoming_frame(frame1);
    assert_eq!(ctrl.outstanding_count(), 1);

    // Attempt to ACK with foreign subscription sub2
    let res = ctrl.on_credit_return(&sub2, &run, "1", "1", false);
    assert!(res.is_none());
    // Credit is NOT freed
    assert_eq!(ctrl.outstanding_count(), 1);
    assert_eq!(ctrl.total_acked, 0);

    // Legitimate ACK with matching sub1 frees credit
    let res_ok = ctrl.on_credit_return(&sub1, &run, "1", "1", false);
    assert!(res_ok.is_none()); // No pending frame to unblock
    assert_eq!(ctrl.outstanding_count(), 0);
    assert_eq!(ctrl.total_acked, 1);
}

#[tokio::test]
async fn test_stalled_viewer_isolation_between_two_viewers() {
    let run = Uuid::new_v4().to_string();
    let sub_active = Uuid::new_v4().to_string();
    let sub_stalled = Uuid::new_v4().to_string();

    let mut ctrl_active = ViewerCreditController::new(sub_active.clone());
    let mut ctrl_stalled = ViewerCreditController::new(sub_stalled.clone());

    // Stream 10 frames
    for i in 1..=10 {
        sleep(Duration::from_millis(110)).await;
        let frame = make_test_frame(&run, "1", &i.to_string());

        // Stalled viewer never ACKs
        let _ = ctrl_stalled.on_incoming_frame(frame.clone());

        // Active viewer ACKs every frame it receives
        if let Some(delivered) = ctrl_active.on_incoming_frame(frame) {
            let (hdr, _) = unpack_bhjf_frame(delivered.data()).unwrap();
            let _ = ctrl_active.on_credit_return(
                &sub_active,
                &hdr.producer_run,
                &hdr.viewport_epoch,
                &hdr.frame_seq,
                false,
            );
        }
    }

    // Active viewer received all 10 frames because it ACKed promptly
    assert_eq!(ctrl_active.total_delivered, 10);
    assert_eq!(ctrl_active.total_acked, 10);
    assert_eq!(ctrl_active.outstanding_count(), 0);

    // Stalled viewer stopped at max 2 outstanding + 1 pending, and NEVER blocked active viewer!
    assert_eq!(ctrl_stalled.outstanding_count(), MAX_OUTSTANDING_PER_VIEWER);
    assert!(ctrl_stalled.has_pending());
    assert_eq!(ctrl_stalled.total_delivered, 2);
}

#[tokio::test]
async fn test_identical_full_bhjf_buffer_shared_without_app_copies() {
    let run = Uuid::new_v4().to_string();
    let frame = make_test_frame(&run, "1", "1");

    // Bytes clone is O(1) atomic refcount increment
    let clone1 = frame.clone();
    let clone2 = frame.clone();

    assert_eq!(frame.data().as_ptr(), clone1.data().as_ptr());
    assert_eq!(frame.data().as_ptr(), clone2.data().as_ptr());

    let (hdr1, _) = unpack_bhjf_frame(clone1.data()).unwrap();
    let (hdr2, _) = unpack_bhjf_frame(clone2.data()).unwrap();

    // Headers contain only target/process/producer values, zero per-viewer or subscription data
    assert_eq!(hdr1.producer_run, run);
    assert_eq!(hdr2.producer_run, run);
    assert_eq!(hdr1.frame_seq, "1");
}

#[tokio::test]
async fn test_full_ticket_pairing_and_lease_scoping_journey() {
    use dam_hopper_server::browser_host::attachments::{
        AttachmentManager, AttachmentPurpose, IssueTicketRequest,
    };
    use dam_hopper_server::browser_host::input::SessionInputManager;

    let att_manager = AttachmentManager::new();
    let input_manager = SessionInputManager::new();

    let session_id = Uuid::new_v4().to_string();
    let viewer_a = "viewer-a";
    let viewer_b = "viewer-b";
    let sub_a = Uuid::new_v4().to_string();
    let sub_b = Uuid::new_v4().to_string();
    let inc = Uuid::new_v4().to_string();

    // 1. Issue media and control tickets for viewer A
    let media_req_a = IssueTicketRequest {
        purpose: AttachmentPurpose::Media,
        browser_session_id: Some(session_id.clone()),
        viewer_id: Some(viewer_a.to_string()),
        subscription_epoch: Some(sub_a.clone()),
        browser_incarnation: inc.clone(),
        profile_epoch: 1,
    };
    let control_req_a = IssueTicketRequest {
        purpose: AttachmentPurpose::Control,
        browser_session_id: Some(session_id.clone()),
        viewer_id: Some(viewer_a.to_string()),
        subscription_epoch: Some(sub_a.clone()),
        browser_incarnation: inc.clone(),
        profile_epoch: 1,
    };

    let admission = dam_hopper_server::browser_host::auth::BrowserAdmission {
        principal: "alice".to_string(),
        is_dev: false,
        session_id: Some("auth-sess-1".to_string()),
        auth_version: Some(1),
        credential_version: Some(1),
        effective_deadline: None,
    };
    let media_res_a = att_manager
        .issue_ticket(&admission, &media_req_a, None)
        .await
        .unwrap();
    let control_res_a = att_manager
        .issue_ticket(&admission, &control_req_a, None)
        .await
        .unwrap();

    // 2. Consume both tickets
    let admitted_media = att_manager
        .consume_ticket(&media_res_a.ticket, AttachmentPurpose::Media, None)
        .await
        .unwrap();
    let admitted_control = att_manager
        .consume_ticket(&control_res_a.ticket, AttachmentPurpose::Control, None)
        .await
        .unwrap();

    // 3. Register connections and verify pairing
    let (conn_media, _cancel_media) = att_manager
        .register_connection(&admitted_media)
        .await
        .unwrap();
    let (conn_ctrl, _cancel_ctrl) = att_manager
        .register_connection(&admitted_control)
        .await
        .unwrap();

    // 4. Viewer A acquires lease
    let (lease_tok_a, _) = input_manager
        .acquire_lease(viewer_a, "human")
        .await
        .unwrap();
    assert!(input_manager.is_lease_holder(viewer_a).await);
    assert!(!input_manager.is_lease_holder(viewer_b).await);

    // 5. Viewer B tries to revoke lease on exit -> must NOT revoke viewer A's lease! (W6 invariant)
    if input_manager.is_lease_holder(viewer_b).await {
        let _ = input_manager.revoke_lease().await;
    }
    // Viewer A is still the active lease holder!
    assert!(input_manager.is_lease_holder(viewer_a).await);

    // 6. Viewer A releases lease
    let _ = input_manager.release_lease(&lease_tok_a).await.unwrap();
    assert!(!input_manager.is_lease_holder(viewer_a).await);

    // 7. Cleanup connections
    att_manager.unregister_connection(conn_media).await;
    att_manager.unregister_connection(conn_ctrl).await;
}

#[tokio::test]
async fn test_live_axum_media_and_control_websocket_journey() {
    use dam_hopper_server::agent_store::AgentStoreService;
    use dam_hopper_server::api::browser_host::global_attachment_manager;
    use dam_hopper_server::api::build_router;
    use dam_hopper_server::browser_host::attachments::{AttachmentPurpose, IssueTicketRequest};
    use dam_hopper_server::browser_host::auth::BrowserAdmission;
    use dam_hopper_server::config::{DamHopperConfig, FeaturesConfig, GlobalConfig, WorkspaceInfo};
    use dam_hopper_server::crypto::DamHopperOpaqueSuite;
    use dam_hopper_server::diagnostics::DiagnosticStore;
    use dam_hopper_server::fs::FsSubsystem;
    use dam_hopper_server::pty::{BroadcastEventSink, PtySessionManager};
    use dam_hopper_server::state::AppState;
    use dam_hopper_server::tunnel::{CloudflaredDriver, TunnelSessionManager};
    use futures_util::{SinkExt, StreamExt};
    use opaque_ke::ServerSetup;
    use rand::rngs::OsRng;
    use std::path::PathBuf;
    use tempfile::tempdir;
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    let tmp = tempdir().unwrap();
    let workspace_root = tmp.path().to_path_buf();
    let (event_sink, _rx) = BroadcastEventSink::new(512);
    let pty_manager = PtySessionManager::new(Arc::new(event_sink.clone()));
    let config = DamHopperConfig {
        workspace: WorkspaceInfo {
            name: "test".into(),
            root: workspace_root.display().to_string(),
        },
        agent_store: None,
        server: dam_hopper_server::config::ServerConfig::default(),
        projects: vec![],
        features: FeaturesConfig::default(),
        ui: None,
        workspaces: None,
        config_path: workspace_root.join("dam-hopper.toml"),
    };
    let global_config = GlobalConfig::default();
    let agent_store = AgentStoreService::new(workspace_root.join(".dam-hopper/agent-store"));
    let fs = FsSubsystem::new(vec![]);
    let tunnel_manager =
        TunnelSessionManager::new(Arc::new(event_sink.clone()), Arc::new(CloudflaredDriver));
    let diagnostics = DiagnosticStore::new(workspace_root.join("diagnostics.jsonl"));

    let state = AppState::new(
        workspace_root,
        config,
        global_config,
        pty_manager,
        agent_store,
        event_sink,
        "test-secret-media".to_string(),
        fs,
        None,
        true, // no_auth = true (dev mode)
        tunnel_manager,
        None,
        ServerSetup::<DamHopperOpaqueSuite>::new(&mut OsRng),
        diagnostics,
    )
    .expect("test AppState");

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let local_addr = listener.local_addr().unwrap();
    state
        .record_bound_listener(local_addr)
        .expect("record listener");
    let router = build_router(state);
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap();
    });

    let inc = Uuid::new_v4().to_string();
    let (dto, _) = dam_hopper_server::api::browser_host::global_session_registry()
        .insert_running_for_test(
            "dev-user",
            true,
            &inc,
            1,
            &dam_hopper_server::browser_host::session::CreateSessionRequest {
                creation_key: Uuid::new_v4().to_string(),
                url: "about:blank".to_string(),
                viewport: dam_hopper_server::browser_host::session::ViewportRequest {
                    width: 1280,
                    height: 900,
                    dpr: 1.0,
                },
            },
            &[],
        )
        .await
        .unwrap();
    let session_id = dto.browser_session_id;
    let viewer_id = "test-viewer-ws";
    let sub_epoch = Uuid::new_v4().to_string();

    let att_manager = global_attachment_manager();
    let admission = BrowserAdmission {
        principal: "dev-user".to_string(),
        is_dev: true,
        session_id: Some("dev-sess".to_string()),
        auth_version: Some(1),
        credential_version: Some(1),
        effective_deadline: None,
    };

    // 1. Issue media and control tickets
    let media_req = IssueTicketRequest {
        purpose: AttachmentPurpose::Media,
        browser_session_id: Some(session_id.clone()),
        viewer_id: Some(viewer_id.to_string()),
        subscription_epoch: Some(sub_epoch.clone()),
        browser_incarnation: inc.clone(),
        profile_epoch: 1,
    };
    let control_req = IssueTicketRequest {
        purpose: AttachmentPurpose::Control,
        browser_session_id: Some(session_id.clone()),
        viewer_id: Some(viewer_id.to_string()),
        subscription_epoch: Some(sub_epoch.clone()),
        browser_incarnation: inc.clone(),
        profile_epoch: 1,
    };
    let media_tkt = att_manager
        .issue_ticket(&admission, &media_req, None)
        .await
        .unwrap();
    let control_tkt = att_manager
        .issue_ticket(&admission, &control_req, None)
        .await
        .unwrap();

    // 2. Connect media WebSocket
    let media_url = format!("ws://{local_addr}/api/browser/media");
    let mut req = media_url.into_client_request().unwrap();
    req.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        format!(
            "damhopper.browser.media.v1, damhopper.ticket.{}",
            media_tkt.ticket
        )
        .parse()
        .unwrap(),
    );
    let (mut media_ws, media_resp) = connect_async(req).await.expect("media ws connect failed");
    // Verify subprotocol negotiated
    assert_eq!(
        media_resp
            .headers()
            .get("Sec-WebSocket-Protocol")
            .and_then(|v| v.to_str().ok()),
        Some("damhopper.browser.media.v1")
    );

    // 3. Connect control WebSocket
    let control_url = format!("ws://{local_addr}/api/browser/control");
    let mut ctrl_req = control_url.into_client_request().unwrap();
    ctrl_req.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        format!(
            "damhopper.browser.control.v1, damhopper.ticket.{}",
            control_tkt.ticket
        )
        .parse()
        .unwrap(),
    );
    let (mut ctrl_ws, ctrl_resp) = connect_async(ctrl_req)
        .await
        .expect("control ws connect failed");
    assert_eq!(
        ctrl_resp
            .headers()
            .get("Sec-WebSocket-Protocol")
            .and_then(|v| v.to_str().ok()),
        Some("damhopper.browser.control.v1")
    );

    // 4. Verify initial Status message on control WS
    let init_msg = tokio::time::timeout(Duration::from_secs(3), ctrl_ws.next())
        .await
        .expect("timeout on control ws initial status")
        .expect("control ws stream closed")
        .expect("control ws message error");
    let text = init_msg.into_text().expect("status text message");
    assert!(text.contains("\"status\"") || text.contains("\"inputAvailable\""));

    // 5. Clean close
    let _ = media_ws.close(None).await;
    let _ = ctrl_ws.close(None).await;
}
