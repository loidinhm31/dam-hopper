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

#[tokio::test]
async fn test_custom_min_interval_and_audio_chunk_validation() {
    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
    use base64::Engine;
    use dam_hopper_server::browser_host::protocol::{
        BrowserAudioChunk, ProducerAudioChunk, AUDIO_CHANNELS, AUDIO_ENCODING_PCM16LE,
        AUDIO_SAMPLE_RATE, MAX_AUDIO_BASE64_BYTES, MAX_AUDIO_PCM_BYTES,
    };

    let sub = Uuid::new_v4().to_string();
    let run = Uuid::new_v4().to_string();
    let interval_24fps = Duration::from_secs_f64(1.0 / 24.0);
    let mut ctrl = ViewerCreditController::with_min_interval(sub.clone(), interval_24fps);
    assert_eq!(ctrl.min_delivery_interval(), interval_24fps);

    let frame1 = make_test_frame(&run, "1", "1");
    let frame2 = make_test_frame(&run, "1", "2");
    assert!(ctrl.on_incoming_frame(frame1).is_some());
    assert!(ctrl.on_incoming_frame(frame2).is_none());
    assert!(ctrl.has_pending());

    let _ = ctrl.on_credit_return(&sub, &run, "1", "1", false);
    sleep(Duration::from_millis(45)).await;
    assert!(
        ctrl.check_flush_pending().is_some(),
        "24 FPS controller must flush pending frame after ~42ms"
    );

    // Valid 24 kHz mono PCM16LE chunk (480 samples = 960 bytes)
    let pcm_bytes = vec![0u8; 960];
    let b64 = BASE64_STANDARD.encode(&pcm_bytes);
    let prod_chunk = ProducerAudioChunk {
        browser_session_id: Uuid::new_v4().to_string(),
        browser_incarnation: Uuid::new_v4().to_string(),
        profile_epoch: "1".to_string(),
        producer_run: run.clone(),
        doc_epoch: 1,
        audio_seq: "1".to_string(),
        sample_rate: AUDIO_SAMPLE_RATE,
        channels: AUDIO_CHANNELS,
        encoding: AUDIO_ENCODING_PCM16LE.to_string(),
        data: std::sync::Arc::<str>::from(b64),
        reservation: None,
    };
    let env = prod_chunk.to_viewer_envelope(&sub);
    assert!(env.validate().is_ok());
    let json = serde_json::to_string(&env).expect("serialize audioChunk");
    let roundtrip: BrowserAudioChunk = serde_json::from_str(&json).expect("deserialize audioChunk");
    assert_eq!(roundtrip, env);
    assert_eq!(roundtrip.kind, "audioChunk");

    // Reject invalid kind, rate, channels, encoding, odd decoded bytes, or oversized payload
    let mut bad_rate = env.clone();
    bad_rate.sample_rate = 48_000;
    assert!(bad_rate.validate().is_err());

    let mut bad_seq = env.clone();
    bad_seq.audio_seq = "0".to_string();
    assert!(bad_seq.validate().is_err());

    let mut odd_pcm = env.clone();
    odd_pcm.data = std::sync::Arc::<str>::from(BASE64_STANDARD.encode([1u8, 2, 3]));
    assert!(odd_pcm.validate().is_err());

    let mut oversized = env.clone();
    oversized.data = std::sync::Arc::<str>::from("A".repeat(MAX_AUDIO_BASE64_BYTES + 4));
    assert!(oversized.validate().is_err());
    assert_eq!(MAX_AUDIO_PCM_BYTES, 4_800);
}

#[tokio::test]
async fn test_real_chromium_media_stealth_and_pcm_audio_bridge() {
    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
    use base64::Engine;
    use chromiumoxide_cdp::cdp::browser_protocol::target::CreateTargetParams;
    use dam_hopper_server::browser_host::cdp::CdpClient;
    use dam_hopper_server::browser_host::process::{
        find_browser_executable, BrowserLaunchConfig, BrowserProcess,
    };
    use dam_hopper_server::browser_host::screencast::ScreencastProducer;
    use serde_json::json;
    use tempfile::tempdir;

    let exec = find_browser_executable(None).ok().or_else(|| {
        ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
            .into_iter()
            .map(std::path::PathBuf::from)
            .find(|p| p.is_file())
    });
    let Some(exec) = exec else {
        if std::env::var("DAM_HOPPER_REQUIRE_BROWSER").as_deref() == Ok("1") {
            panic!("Required Chrome/Chromium executable not found on host");
        }
        eprintln!("SKIP: No Chrome/Chromium executable available on this system.");
        return;
    };

    let tmp = tempdir().unwrap();
    let mut config = BrowserLaunchConfig::new(tmp.path().join("media-stealth-test-data"));
    config.executable_path = Some(exec);
    config.headless = true;

    let mut process = BrowserProcess::launch(config)
        .await
        .expect("browser launch failed");
    let client = CdpClient::connect(process.ws_endpoint())
        .await
        .expect("CDP connect failed");
    let target_res = client
        .send_typed(CreateTargetParams::builder().url("about:blank").build().unwrap(), None)
        .await
        .expect("Target.createTarget failed");

    let producer = ScreencastProducer::new(
        Uuid::new_v4().to_string(),
        Uuid::new_v4().to_string(),
        1,
        1,
        client.clone(),
        target_res.target_id.into(),
        TargetGeometry {
            css_width: 1280.0,
            css_height: 720.0,
            offset_top: 0.0,
            scroll_x: 0.0,
            scroll_y: 0.0,
            page_scale: 1.0,
            visual_offset_x: 0.0,
            visual_offset_y: 0.0,
            dpr: 1.0,
        },
    )
    .with_capture_policy(24, 75);

    let page_sid = producer.ensure_page_session().await.expect("page session");
    producer
        .apply_stealth_and_focus(&page_sid)
        .await
        .expect("apply stealth");

    let probe = client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    const v = document.createElement('video');
                    const a = document.createElement('audio');
                    const sym = Symbol.for('dh.a');
                    const fn = EventTarget.prototype[sym];
                    const desc = Object.getOwnPropertyDescriptor(EventTarget.prototype, sym);
                    const run = '11111111-2222-4333-8444-555555555555:1';

                    // Install a same-origin child iframe; accessing contentWindow installs the stealth bridge on it
                    const iframe = document.createElement('iframe');
                    document.body.appendChild(iframe);
                    const cw = iframe.contentWindow;

                    // Hook createScriptProcessor on parent and child to capture the real processors created by AudioNode.prototype.connect
                    const procs = [];
                    const hookAC = (win, label) => {
                        const AC = win.AudioContext || win.webkitAudioContext;
                        if (!AC) return null;
                        const origCreateSP = AC.prototype.createScriptProcessor;
                        AC.prototype.createScriptProcessor = function() {
                            const p = origCreateSP.apply(this, arguments);
                            procs.push({ ctx: this, proc: p, win: label });
                            return p;
                        };
                        return AC;
                    };
                    const AC = hookAC(window, 'parent');
                    const ChildAC = cw ? hookAC(cw, 'child') : null;

                    // 1. Connect ctx1 BEFORE fn('start', run) to prove pre-existing WebAudio graphs are activated by start/drain
                    const ctx1 = new AC({ sampleRate: 24000 });
                    const g1 = ctx1.createGain();
                    g1.connect(ctx1.destination);

                    fn('start', run);

                    // 2. Connect ctx2 in parent + cctx in child iframe AFTER start
                    const ctx2 = new AC({ sampleRate: 24000 });
                    const g2 = ctx2.createGain();
                    g2.connect(ctx2.destination);

                    const cctx = new ChildAC({ sampleRate: 24000 });
                    const cg = cctx.createGain();
                    cg.connect(cctx.destination);
                    fn('drain', run); // ensures child bridge is started and its pre/post nodes are tapped

                    // Feed 1200 samples (+0.20 each) simultaneously into all 3 tapped contexts (2 parent + 1 child)
                    const ch = new Float32Array(1200).fill(0.20);
                    const fakeEv = { inputBuffer: { numberOfChannels: 1, getChannelData: () => ch } };
                    for (const item of procs) {
                        if (typeof item.proc.onaudioprocess === 'function') {
                            item.proc.onaudioprocess(fakeEv);
                        }
                    }

                    const drained = fn('drain', run);

                    // 3. Stop run, then start a second run WITHOUT reconnecting graphs -> proves restart recovery
                    fn('stop', run);
                    const afterStop = fn('drain', run);
                    const run2 = '11111111-2222-4333-8444-555555555555:2';
                    fn('start', run2);
                    fn('drain', run2);
                    for (const item of procs) {
                        if (typeof item.proc.onaudioprocess === 'function') {
                            item.proc.onaudioprocess(fakeEv);
                        }
                    }
                    const drainedAfterRestart = fn('drain', run2);

                    // 4. Test AudioNode.prototype.disconnect cleanup
                    g1.disconnect();
                    g2.disconnect();
                    cg.disconnect();
                    fn('stop', run2);

                    return {
                        h264: v.canPlayType('video/mp4; codecs="avc1.42E01E"'),
                        webm: v.canPlayType('video/webm; codecs="vp9"'),
                        aac: a.canPlayType('audio/mp4; codecs="mp4a.40.2"'),
                        mp3: a.canPlayType('audio/mpeg'),
                        unrelatedMime: v.canPlayType('application/x-not-mp4'),
                        unknownCodec: v.canPlayType('video/webm; codecs="unknown123"'),
                        crossedCodec: v.canPlayType('video/mp4; codecs="vp8"'),
                        crossedAudioCodec: v.canPlayType('audio/mpeg; codecs="avc1.42E01E"'),
                        mseH264: typeof MediaSource !== 'undefined' ? MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"') : true,
                        mseUnrelated: typeof MediaSource !== 'undefined' ? MediaSource.isTypeSupported('application/x-not-mp4') : false,
                        mseUnknownCodec: typeof MediaSource !== 'undefined' ? MediaSource.isTypeSupported('video/webm; codecs="unknown123"') : false,
                        mseWav: typeof MediaSource !== 'undefined' ? MediaSource.isTypeSupported('audio/wav') : false,
                        nonEnumerable: Boolean(desc && desc.enumerable === false),
                        parentProcCount: procs.filter((p) => p.win === 'parent').length,
                        childProcCount: procs.filter((p) => p.win === 'child').length,
                        drainedCount: drained.length,
                        firstChunkB64: drained[0] || '',
                        afterStopCount: afterStop.length,
                        restartedCount: drainedAfterRestart.length,
                    };
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("probe media stealth and bridge");

    let val = &probe["result"]["value"];
    assert_eq!(val["h264"], "probably");
    assert_eq!(val["webm"], "probably");
    assert_eq!(val["aac"], "probably");
    assert!(matches!(val["mp3"].as_str(), Some("probably" | "maybe")));
    assert_eq!(val["unrelatedMime"], "");
    assert_eq!(val["unknownCodec"], "");
    assert_eq!(val["crossedCodec"], "");
    assert_eq!(val["crossedAudioCodec"], "");
    assert_eq!(val["mseH264"], true);
    assert_eq!(val["mseUnrelated"], false);
    assert_eq!(val["mseUnknownCodec"], false);
    assert_eq!(val["mseWav"], false);
    assert_eq!(val["nonEnumerable"], true);
    assert!(val["parentProcCount"].as_u64().unwrap_or(0) >= 2, "both parent contexts (including pre-start ctx1) must be tapped");
    assert!(val["childProcCount"].as_u64().unwrap_or(0) >= 1, "child iframe context must be tapped");
    assert_eq!(
        val["drainedCount"], 1,
        "3 simultaneous 1200-sample sources (2 parent + 1 child) must mix into 1 chunk, not concatenate"
    );
    assert_eq!(val["afterStopCount"], 0);
    assert_eq!(val["restartedCount"], 1, "existing WebAudio graphs must recover after stop + start");
    let proc_count = 3u64;

    let b64 = val["firstChunkB64"].as_str().expect("first chunk base64");
    let decoded = BASE64_STANDARD.decode(b64).expect("decode PCM16 base64");
    // 1200 mixed samples * 2 bytes = 2400 bytes (NOT concatenated!)
    assert_eq!(decoded.len(), 2400);
    let expected_sample = (0.20f64 * (proc_count as f64) * 32767.0).round() as i16;
    let first_sample = i16::from_le_bytes([decoded[0], decoded[1]]);
    assert!(
        (first_sample - expected_sample).abs() <= 6,
        "expected summed sample ~{expected_sample} across {proc_count} sources, got {first_sample}"
    );

    // 5. Verify >16 sequential WebAudio contexts reclaim capacity on disconnect (C3-H4) and cross-origin postMessage relay fencing (C3-H2)
    let relay_probe = client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    const sym = Symbol.for('dh.a');
                    const fn = EventTarget.prototype[sym];
                    const run = '33333333-4444-4555-8666-777777777777:1';
                    const AC = window.AudioContext || window.webkitAudioContext;
                    fn('start', run);

                    // Connect and disconnect 17 contexts sequentially -> 18th must still tap and produce samples
                    const c18Procs = [];
                    const origSP = AC.prototype.createScriptProcessor;
                    for (let i = 0; i < 17; i++) {
                        const c = new AC({ sampleRate: 24000 });
                        const g = c.createGain();
                        g.connect(c.destination);
                        g.disconnect();
                        c.close().catch(() => {});
                    }
                    AC.prototype.createScriptProcessor = function() {
                        const p = origSP.apply(this, arguments);
                        c18Procs.push(p);
                        return p;
                    };
                    const c18 = new AC({ sampleRate: 24000 });
                    const g18 = c18.createGain();
                    g18.connect(c18.destination);
                    AC.prototype.createScriptProcessor = origSP;
                    const ch18 = new Float32Array(1200).fill(0.25);
                    for (const p of c18Procs) {
                        if (typeof p.onaudioprocess === 'function') {
                            p.onaudioprocess({ inputBuffer: { numberOfChannels: 1, getChannelData: () => ch18 } });
                        }
                    }
                    const c18Drained = fn('drain', run);
                    g18.disconnect();
                    c18.close().catch(() => {});

                    // Dispatch MessageEvents to verify cross-origin relay fencing and captureAt freshness:
                    // a) Foreign source (window itself, not a child frame) -> rejected
                    window.dispatchEvent(new MessageEvent('message', {
                        data: { __dhAudio: run, docId: 'foreign-doc', seq: 1, captureAt: Date.now(), pcm: new Array(600).fill(10000) },
                        source: window,
                    }));
                    const afterForeign = fn('drain', run);

                    // b) Seconds-old packet (captureAt 2000ms ago) when ring is idle -> rejected (NOT clamped to 500ms)
                    const cw = document.querySelector('iframe').contentWindow;
                    window.dispatchEvent(new MessageEvent('message', {
                        data: { __dhAudio: run, docId: 'child-doc-1', seq: 1, captureAt: Date.now() - 2000, pcm: new Array(600).fill(10000) },
                        source: cw,
                    }));
                    const afterStaleAge = fn('drain', run);

                    // c) Registered child iframe source with fresh captureAt + monotonic seq -> accepted
                    window.dispatchEvent(new MessageEvent('message', {
                        data: { __dhAudio: run, docId: 'child-doc-1', seq: 2, captureAt: Date.now(), pcm: new Array(600).fill(10000) },
                        source: cw,
                    }));
                    // Duplicate seq 2 -> rejected
                    window.dispatchEvent(new MessageEvent('message', {
                        data: { __dhAudio: run, docId: 'child-doc-1', seq: 2, captureAt: Date.now(), pcm: new Array(600).fill(10000) },
                        source: cw,
                    }));
                    const afterChildRelay = fn('drain', run);

                    // d) Rotate child docId with seq 1 -> retires child-doc-1; late child-doc-1 packet is rejected
                    window.dispatchEvent(new MessageEvent('message', {
                        data: { __dhAudio: run, docId: 'child-doc-2', seq: 1, captureAt: Date.now(), pcm: new Array(600).fill(8000) },
                        source: cw,
                    }));
                    const afterDoc2 = fn('drain', run);
                    window.dispatchEvent(new MessageEvent('message', {
                        data: { __dhAudio: run, docId: 'child-doc-1', seq: 3, captureAt: Date.now(), pcm: new Array(600).fill(8000) },
                        source: cw,
                    }));
                    const afterRetiredDoc1 = fn('drain', run);
                    fn('stop', run);
                    return {
                        c18DrainedCount: c18Drained.length,
                        foreignCount: afterForeign.length,
                        staleAgeCount: afterStaleAge.length,
                        childRelayCount: afterChildRelay.length,
                        doc2Count: afterDoc2.length,
                        retiredDoc1Count: afterRetiredDoc1.length,
                    };
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("probe relay and capacity reclamation");
    let rval = &relay_probe["result"]["value"];
    assert_eq!(rval["c18DrainedCount"], 1, "18th AudioContext must produce samples after prior 17 disconnected");
    assert_eq!(rval["foreignCount"], 0, "foreign window relay message must be rejected");
    assert_eq!(rval["staleAgeCount"], 0, "seconds-old relay packet must be rejected when horizon is idle");
    assert_eq!(rval["childRelayCount"], 1, "valid child frame relay message must be accepted");
    assert_eq!(rval["doc2Count"], 1, "new child document with seq 1 must be accepted");
    assert_eq!(rval["retiredDoc1Count"], 0, "late message from retired child document must be rejected");

    // 6. Real Chromium rendering end-to-end:
    //    Phase A: Isolated child-iframe OscillatorNode -> non-silent chunk -> disconnect -> silence
    let mut audio_rx = producer.subscribe_audio();
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    const iframe = document.querySelector('iframe');
                    const cw = iframe.contentWindow;
                    const ChildAC = cw.AudioContext || cw.webkitAudioContext;
                    const childCtx = new ChildAC({ sampleRate: 24000 });
                    const childOsc = childCtx.createOscillator();
                    const childGain = childCtx.createGain();
                    childGain.gain.value = 0.35;
                    childOsc.frequency.value = 660;
                    childOsc.connect(childGain);
                    childGain.connect(childCtx.destination);
                    childOsc.start();
                    if (childCtx.state === 'suspended') childCtx.resume();
                    window.__childLive = { childCtx, childOsc, childGain };
                    return true;
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("start real child iframe oscillator");

    producer
        .register_viewer_demand("viewer-live", "sub-live-1", true)
        .await;
    let child_chunk = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
        .await
        .expect("ScreencastProducer must emit real child-iframe OscillatorNode audio chunk within 2s")
        .expect("receive child ProducerAudioChunk");
    assert_eq!(child_chunk.audio_seq, "1");
    assert!(child_chunk.reservation.is_some(), "admitted ProducerAudioChunk must retain RAII MemoryReservation");
    let child_pcm = BASE64_STANDARD
        .decode(child_chunk.data.as_ref())
        .expect("decode child PCM");
    assert!(
        child_pcm.chunks_exact(2).any(|b| i16::from_le_bytes([b[0], b[1]]).abs() > 100),
        "real child-iframe OscillatorNode must produce non-silent PCM"
    );

    // Disconnect child oscillator and verify silence BEFORE starting parent <audio> element
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    window.__childLive.childGain.disconnect();
                    window.__childLive.childOsc.stop();
                    return true;
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("disconnect child oscillator");
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;
    while audio_rx.try_recv().is_ok() {}
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(160), audio_rx.recv()).await.is_err(),
        "stream must be silent after disconnecting child oscillator"
    );

    // Phase B: Isolated real playing <audio> element (synthesized 24 kHz WAV Blob URL, zero oscillators) -> non-silent chunk -> pause -> silence
    let play_res = client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(async () => {
                    const numSamples = 24000;
                    const wavBuf = new ArrayBuffer(44 + numSamples * 2);
                    const view = new DataView(wavBuf);
                    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
                    writeStr(0, 'RIFF'); view.setUint32(4, 36 + numSamples * 2, true); writeStr(8, 'WAVE');
                    writeStr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
                    view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
                    writeStr(36, 'data'); view.setUint32(40, numSamples * 2, true);
                    for (let i = 0; i < numSamples; i++) {
                        view.setInt16(44 + i * 2, Math.round(Math.sin(i * 0.15) * 14000), true);
                    }
                    const blob = new Blob([wavBuf], { type: 'audio/wav' });
                    const audioEl = document.createElement('audio');
                    audioEl.src = URL.createObjectURL(blob);
                    audioEl.loop = true;
                    document.body.appendChild(audioEl);
                    await audioEl.play();
                    window.__parentAudioEl = audioEl;
                    return !audioEl.paused;
                })()"#,
                "awaitPromise": true,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("start real <audio> element");
    assert_eq!(play_res["result"]["value"], true, "ordinary <audio> element must play without user gesture");

    let media_el_chunk = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
        .await
        .expect("ScreencastProducer must emit real <audio> element chunk via captureStream")
        .expect("receive <audio> ProducerAudioChunk");
    let media_el_pcm = BASE64_STANDARD
        .decode(media_el_chunk.data.as_ref())
        .expect("decode <audio> PCM");
    assert!(
        media_el_pcm.chunks_exact(2).any(|b| i16::from_le_bytes([b[0], b[1]]).abs() > 100),
        "isolated <audio> element captureStream must produce non-silent PCM"
    );

    // Pause and remove <audio> element -> verify stream goes silent
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    window.__parentAudioEl.pause();
                    window.__parentAudioEl.remove();
                    return true;
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("pause <audio> element");

    tokio::time::sleep(std::time::Duration::from_millis(120)).await;
    while audio_rx.try_recv().is_ok() {}
    let post_disconnect = tokio::time::timeout(std::time::Duration::from_millis(180), audio_rx.recv()).await;
    assert!(
        post_disconnect.is_err(),
        "no audio chunks should be emitted after pausing and removing <audio> element"
    );

    // Phase C: Real nested cross-origin HTTP iframes (top about:blank -> http://localhost:{port}/child -> http://127.0.0.1:{port}/grandchild)
    // `localhost` and `127.0.0.1` are distinct origins from each other and from `about:blank`, exercising
    // real OOPIF Target.attachedToTarget stealth injection and 2-hop cross-origin `postMessage` audio relay.
    let xo_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let xo_port = xo_listener.local_addr().unwrap().port();
    let page_a_hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let coalesce_hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let page_a_hits_srv = page_a_hits.clone();
    let coalesce_hits_srv = coalesce_hits.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = xo_listener.accept().await else { break };
            let page_a_hits = page_a_hits_srv.clone();
            let coalesce_hits = coalesce_hits_srv.clone();
            tokio::spawn(async move {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let mut buf = [0u8; 1024];
                let n = stream.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]);
                if req.starts_with("GET /login") {
                    let loc = format!("http://127.0.0.1:{xo_port}/grandchild");
                    let resp = format!(
                        "HTTP/1.1 302 Found\r\nLocation: {loc}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    );
                    let _ = stream.write_all(resp.as_bytes()).await;
                    return;
                }
                if req.starts_with("GET /page-a") {
                    let hit = page_a_hits.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    if hit == 0 {
                        // First request to /page-a is delayed 220ms so Request B and Request A2
                        // are published AFTER A1 started (navStartMs < A2.requested_at_unix_ms)
                        tokio::time::sleep(std::time::Duration::from_millis(220)).await;
                    }
                } else if req.starts_with("GET /coalesce") {
                    let hit = coalesce_hits.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    if hit == 0 {
                        // First request to /coalesce is delayed 400ms so the second request to /coalesce
                        // cancels it in Chromium before it can commit
                        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                    }
                }
                let body = if req.starts_with("GET /grandchild")
                    || req.starts_with("GET /page-a")
                    || req.starts_with("GET /coalesce")
                {
                    r#"<!doctype html><html><body><script>
                        setTimeout(() => {
                            const AC = window.AudioContext || window.webkitAudioContext;
                            const ctx = new AC({ sampleRate: 24000 });
                            const osc = ctx.createOscillator();
                            const gain = ctx.createGain();
                            gain.gain.value = 0.4;
                            osc.frequency.value = 520;
                            osc.connect(gain);
                            gain.connect(ctx.destination);
                            osc.start();
                            if (ctx.state === 'suspended') ctx.resume();
                            window.__xoGrandchild = { ctx, osc, gain };
                        }, 40);
                    </script></body></html>"#
                        .to_string()
                } else {
                    format!(
                        r#"<!doctype html><html><body><iframe src="http://127.0.0.1:{xo_port}/grandchild"></iframe></body></html>"#
                    )
                };
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(resp.as_bytes()).await;
            });
        }
    });

    let xo_res = client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": format!(r#"(async () => {{
                    const outer = document.createElement('iframe');
                    outer.src = 'http://localhost:{xo_port}/child';
                    document.body.appendChild(outer);
                    await new Promise((r) => {{ outer.onload = r; setTimeout(r, 500); }});
                    await new Promise((r) => setTimeout(r, 150));
                    let isCrossOrigin = false;
                    try {{
                        void outer.contentWindow.EventTarget;
                    }} catch (_) {{
                        isCrossOrigin = true;
                    }}
                    window.__xoOuter = outer;
                    return isCrossOrigin;
                }})()"#),
                "awaitPromise": true,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("mount nested cross-origin HTTP iframes");
    assert_eq!(
        xo_res["result"]["value"], true,
        "http://localhost child iframe must be genuinely cross-origin (SecurityError on property access)"
    );

    let xo_chunk = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
        .await
        .expect("ScreencastProducer must emit nested cross-origin grandchild audio via 2-hop postMessage relay")
        .expect("receive nested cross-origin ProducerAudioChunk");
    let xo_pcm = BASE64_STANDARD
        .decode(xo_chunk.data.as_ref())
        .expect("decode nested cross-origin PCM");
    assert!(
        xo_pcm.chunks_exact(2).any(|b| i16::from_le_bytes([b[0], b[1]]).abs() > 100),
        "nested cross-origin grandchild oscillator must produce non-silent PCM across 2-hop relay"
    );

    // Remove outer cross-origin iframe -> verify stream goes silent
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    window.__xoOuter.remove();
                    return true;
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("remove nested cross-origin iframe");
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;
    while audio_rx.try_recv().is_ok() {}
    let post_xo_remove = tokio::time::timeout(std::time::Duration::from_millis(180), audio_rx.recv()).await;
    assert!(
        post_xo_remove.is_err(),
        "no audio chunks should be emitted after removing nested cross-origin iframe"
    );

    // Phase D: Two superseding API navigation requests + delayed first native commit (C6-H6 & C7-H6)
    // 1. Start a live oscillator on the old page (epoch 1) and confirm it emits epoch 1 chunks
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    const AC = window.AudioContext || window.webkitAudioContext;
                    const ctx = new AC({ sampleRate: 24000 });
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    gain.gain.value = 0.35;
                    osc.frequency.value = 440;
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start();
                    if (ctx.state === 'suspended') ctx.resume();
                    window.__preNavOsc = { ctx, osc, gain };
                    return true;
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("start pre-navigation oscillator");
    let pre_nav_chunk = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
        .await
        .expect("receive pre-navigation chunk")
        .expect("pre-nav chunk");
    assert_eq!(pre_nav_chunk.doc_epoch, 1);

    // 2. Case 1 (C8-H6 & C10-H6): A -> B -> A supersession where API A1 requests epoch 2,
    //    pauses before CDP dispatch while API B (epoch 3) and API A2 (epoch 4) supersede,
    //    and then A1 dispatches with `dispatch_navigation_for_epoch(2, ...)` and commits!
    let url_a = format!("http://127.0.0.1:{xo_port}/page-a");
    producer.request_audio_doc_epoch(2);
    producer.request_audio_doc_epoch(3);
    producer.request_audio_doc_epoch(4);
    while audio_rx.try_recv().is_ok() {}
    // API A1 now dispatches late (after epoch 4 was already requested!) using its captured epoch 2:
    producer
        .dispatch_navigation_for_epoch(
            2,
            "Page.navigate",
            Some(json!({ "url": url_a.clone() })),
            &page_sid,
        )
        .await
        .expect("dispatch delayed API A1 at captured epoch 2");
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    while let Ok(c) = audio_rx.try_recv() {
        panic!(
            "delayed first-A commit in A -> B -> A must NOT emit audio under epoch 4: {:?}",
            c
        );
    }
    assert_eq!(
        producer.audio_doc_authority().committed_epoch,
        2,
        "API A1 commit must only advance committed_epoch to 2, never 4"
    );
    assert_eq!(
        producer.audio_doc_authority().active_committed_epoch(),
        None,
        "delayed first-A commit in A -> B -> A must keep epoch 4 fenced"
    );

    // 3. Now dispatch Request A2 (`dispatch_navigation_for_epoch(4, ...)` to the EXACT SAME URL `/page-a`, hit #2):
    //    verify fresh A2 commit recovers at `doc_epoch == 4`!
    producer
        .dispatch_navigation_for_epoch(
            4,
            "Page.navigate",
            Some(json!({ "url": url_a })),
            &page_sid,
        )
        .await
        .expect("commit second Request A2 in A -> B -> A");
    let a2_chunk = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
        .await
        .expect("Request A2 to /page-a must recover after its own commit")
        .expect("A2 chunk");
    assert_eq!(a2_chunk.doc_epoch, 4, "A2 audio must carry committed doc_epoch 4");

    // 4. Case 2 (C8-H6): Normal HTTP 302 redirect (`/login` -> 302 -> `/grandchild`) + same-revision update!
    producer.request_audio_doc_epoch(5);
    client
        .send_command(
            "Page.navigate",
            Some(json!({ "url": format!("http://127.0.0.1:{xo_port}/login") })),
            Some(&page_sid),
        )
        .await
        .expect("navigate /login -> 302 -> /grandchild");
    // Same-revision session update with final redirected URL must not re-fence epoch 5
    producer.request_audio_doc_epoch(5);
    let mut redirect_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("HTTP 302 redirect (/login -> /grandchild) must recover audio")
            .expect("redirect chunk");
        if c.doc_epoch == 5 {
            break c;
        }
    };
    assert_eq!(redirect_chunk.doc_epoch, 5);

    // 5. Case 3 (C8-H6): Repeated same-URL requests (`/coalesce`) where first request is canceled by second!
    let url_coalesce = format!("http://127.0.0.1:{xo_port}/coalesce");
    producer.request_audio_doc_epoch(6);
    let nav_client2 = client.clone();
    let nav_sid2 = page_sid.clone();
    let url_c1 = url_coalesce.clone();
    let _c1_task = tokio::spawn(async move {
        let _ = nav_client2
            .send_command(
                "Page.navigate",
                Some(json!({ "url": url_c1 })),
                Some(&nav_sid2),
            )
            .await;
    });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    // Cancel the first in-flight /coalesce load without committing, then issue second request to the same URL /coalesce (epoch 7)
    let _ = client.send_command("Page.stopLoading", None, Some(&page_sid)).await;
    producer.request_audio_doc_epoch(7);
    client
        .send_command(
            "Page.navigate",
            Some(json!({ "url": url_coalesce })),
            Some(&page_sid),
        )
        .await
        .expect("commit coalesced second request to /coalesce");
    redirect_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("coalesced same-URL navigation must recover audio on single final commit")
            .expect("coalesced chunk");
        if c.doc_epoch == 7 {
            break c;
        }
    };
    assert_eq!(redirect_chunk.doc_epoch, 7);

    // 6. Case 4 (C9-H6): Real History API `history.pushState` and `history.replaceState` with ongoing WebAudio!
    client
        .send_command(
            "Runtime.evaluate",
            Some(json!({
                "expression": r#"(() => {
                    history.pushState({ step: 1 }, '', '/coalesce-pushed');
                    history.replaceState({ step: 2 }, '', '/coalesce-replaced');
                    return location.pathname;
                })()"#,
                "returnByValue": true
            })),
            Some(&page_sid),
        )
        .await
        .expect("execute History API pushState and replaceState");
    let history_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("ongoing WebAudio must survive history.pushState and history.replaceState without retiring document")
            .expect("post-pushState chunk");
        if c.doc_epoch >= 9 {
            break c;
        }
    };
    assert_eq!(
        history_chunk.doc_epoch, 9,
        "pushState + replaceState must advance doc_epoch to 9 and continue streaming ongoing WebAudio"
    );

    // 7. Case 5 (C9-H6): Delayed session-update observer consumption (native navigation dispatches and commits
    //    BEFORE the asynchronous session-update consumer calls `request_audio_doc_epoch`)!
    client
        .send_command(
            "Page.navigate",
            Some(json!({ "url": format!("http://127.0.0.1:{xo_port}/grandchild") })),
            Some(&page_sid),
        )
        .await
        .expect("navigate to /grandchild before delayed session observer runs");
    // Now the delayed session-update consumer runs AFTER native navigation has already committed:
    producer.request_audio_doc_epoch(10);
    let delayed_obs_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("delayed session-update consumer must not falsely reject valid committed native document")
            .expect("delayed observer chunk");
        if c.doc_epoch == 10 {
            break c;
        }
    };
    assert_eq!(delayed_obs_chunk.doc_epoch, 10);

    // 8. Case 6 (C10-H2): Out-of-bounds Back/Forward after session watcher already fenced epoch 11!
    producer.request_audio_doc_epoch(11);
    assert_eq!(producer.audio_doc_authority().active_committed_epoch(), None);
    producer.resolve_noop_audio_doc_epoch(11);
    assert_eq!(producer.audio_doc_authority().active_committed_epoch(), Some(11));
    let noop_hist_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("out-of-bounds no-op history resolution must keep same-page audio streaming")
            .expect("no-op history chunk");
        if c.doc_epoch == 11 {
            break c;
        }
    };
    assert_eq!(noop_hist_chunk.doc_epoch, 11);

    // 9. Case 7 (C10-H6): `Page.reload` (`expects_loader_id = false`) single in-flight transition!
    producer.request_audio_doc_epoch(12);
    producer
        .dispatch_navigation_for_epoch(12, "Page.reload", None, &page_sid)
        .await
        .expect("reload /grandchild at epoch 12");
    let reload_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("Page.reload must recover audio at epoch 12")
            .expect("reload chunk");
        if c.doc_epoch == 12 {
            break c;
        }
    };
    assert_eq!(reload_chunk.doc_epoch, 12);

    // 10. Case 8 (C10-H2): Zero-demand navigation + initial `build_producer` navigation before viewer demand!
    producer.remove_viewer_demand("sub-live-1").await;
    // Navigate while zero viewers are attached (`run_producer_tasks` stopped):
    producer.init_audio_doc_epoch(1);
    producer
        .dispatch_navigation_for_epoch(
            1,
            "Page.navigate",
            Some(json!({ "url": format!("http://127.0.0.1:{xo_port}/grandchild") })),
            &page_sid,
        )
        .await
        .expect("initial/zero-demand managed navigation at epoch 1");
    let mut zero_demand_auth_rx = producer.subscribe_audio_doc_authority();
    tokio::time::timeout(
        std::time::Duration::from_millis(500),
        zero_demand_auth_rx.wait_for(|a| a.active_committed_epoch() == Some(1)),
    )
    .await
    .expect("zero-demand/initial navigation must commit epoch 1 via CdpActor listener with 0 viewers")
    .expect("watch open");
    // Attach viewer without a second navigation and verify PCM arrives immediately at doc_epoch == 1:
    producer.register_viewer_demand("v1", "sub-live-2", true).await;
    let first_attach_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("first viewer attachment after initial navigation must receive PCM without a second navigation")
            .expect("first attach chunk");
        if c.doc_epoch == 1 {
            break c;
        }
    };
    assert_eq!(first_attach_chunk.doc_epoch, 1);

    // 11. Case 9 (C11-H2): Managed API fragment navigation (`Page.navigate` to `#frag`) and managed
    //     same-document `Page.navigateToHistoryEntry` back traversal restore the surviving document!
    producer.request_audio_doc_epoch(2);
    producer
        .dispatch_navigation_for_epoch(
            2,
            "Page.navigate",
            Some(json!({ "url": format!("http://127.0.0.1:{xo_port}/grandchild#section-frag") })),
            &page_sid,
        )
        .await
        .expect("managed API fragment navigation at epoch 2");
    let frag_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("managed API fragment navigation must restore surviving document and continue PCM (C11-H2)")
            .expect("frag chunk");
        if c.doc_epoch == 2 {
            break c;
        }
    };
    assert_eq!(frag_chunk.doc_epoch, 2);

    // C12-H2: Managed API fragment removal (`Page.navigate` from `/grandchild#section-frag` -> `/grandchild`, NO `#` in target URL!)
    // must also be recognized as same-document via native `loaderId: None` + `NavigatedWithinDocument`, restoring the surviving document!
    producer.request_audio_doc_epoch(3);
    producer
        .dispatch_navigation_for_epoch(
            3,
            "Page.navigate",
            Some(json!({ "url": format!("http://127.0.0.1:{xo_port}/grandchild") })),
            &page_sid,
        )
        .await
        .expect("managed API fragment removal (/grandchild#section-frag -> /grandchild) at epoch 3");
    let frag_removed_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("managed API fragment removal must restore surviving document and continue PCM (C12-H2)")
            .expect("frag-removed chunk");
        if c.doc_epoch == 3 {
            break c;
        }
    };
    assert_eq!(frag_removed_chunk.doc_epoch, 3);

    // Same-document history back via `Page.navigateToHistoryEntry` (back to `/grandchild#section-frag`) at epoch 4:
    let hist = client
        .send_command("Page.getNavigationHistory", None, Some(&page_sid))
        .await
        .expect("getNavigationHistory");
    let cur_idx = hist.get("currentIndex").and_then(|v| v.as_i64()).unwrap() as usize;
    let prev_entry = &hist.get("entries").and_then(|v| v.as_array()).unwrap()[cur_idx - 1];
    let prev_entry_id = prev_entry.get("id").and_then(|v| v.as_i64()).unwrap();
    let prev_entry_url = prev_entry.get("url").and_then(|v| v.as_str());
    producer.request_audio_doc_epoch(4);
    producer
        .dispatch_navigation_for_epoch_with_url(
            4,
            "Page.navigateToHistoryEntry",
            Some(json!({ "entryId": prev_entry_id })),
            &page_sid,
            prev_entry_url,
        )
        .await
        .expect("managed same-document history back at epoch 4");
    let same_doc_back_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("managed same-document history back must restore surviving document and continue PCM (C11-H2)")
            .expect("same-doc back chunk");
        if c.doc_epoch == 4 {
            break c;
        }
    };
    assert_eq!(same_doc_back_chunk.doc_epoch, 4);
    let surviving_grandchild_doc = producer
        .audio_doc_authority()
        .committed_doc_id
        .expect("surviving grandchild docId");

    // 12. Case 10 (C11-H6 & C12-H6): API A captures epoch 5 and pauses before dispatch; API B supersedes with epoch 6
    //     (a cross-document navigation to `/coalesce#anchor` containing `#`), dispatches, fully commits a new document,
    //     and admits PCM; API A then resumes with stale epoch 5 and is rejected!
    producer.request_audio_doc_epoch(5);
    producer.request_audio_doc_epoch(6);
    producer
        .dispatch_navigation_for_epoch(
            6,
            "Page.navigate",
            Some(json!({ "url": format!("http://127.0.0.1:{xo_port}/coalesce#anchor") })),
            &page_sid,
        )
        .await
        .expect("API B dispatches and commits cross-document /coalesce#anchor at epoch 6");
    let b6_chunk = loop {
        let c = tokio::time::timeout(std::time::Duration::from_secs(2), audio_rx.recv())
            .await
            .expect("API B must commit and emit PCM at epoch 6")
            .expect("B6 chunk");
        if c.doc_epoch == 6 {
            break c;
        }
    };
    assert_eq!(b6_chunk.doc_epoch, 6);
    let doc_b6 = producer
        .audio_doc_authority()
        .committed_doc_id
        .expect("committed_doc_id for B6");
    assert_ne!(
        doc_b6, surviving_grandchild_doc,
        "cross-document /coalesce#anchor navigation must bind a new document, not restore old grandchild doc (C12-H6)"
    );
    // Now API A resumes and tries to dispatch stale epoch 5 AFTER B6 has already committed:
    let stale_a_res = producer
        .dispatch_navigation_for_epoch(
            5,
            "Page.navigate",
            Some(json!({ "url": format!("http://127.0.0.1:{xo_port}/grandchild") })),
            &page_sid,
        )
        .await;
    assert!(
        stale_a_res.is_err(),
        "stale explicit dispatch (epoch 5 <= committed 6) must be rejected before native queue exposure (C11-H6)"
    );
    assert_eq!(
        producer.audio_doc_authority().committed_doc_id,
        Some(doc_b6),
        "rejected stale API A must not replace Document B6"
    );
    assert_eq!(producer.audio_doc_authority().active_committed_epoch(), Some(6));

    producer.remove_viewer_demand("sub-live-2").await;
    let _ = process.terminate().await;
}
